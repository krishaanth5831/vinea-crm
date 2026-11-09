"""End-to-end checks through the HTTP API on an in-memory database."""

import json
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from crm import calls, config, vault
from crm.app import create_app


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "AUDIO_DIR", tmp_path / "calls")
    app = create_app(tmp_path / "t.db")
    with TestClient(app) as c:
        yield c


def person(c, **kw):
    d = {"name": "Ali Khaleel", "company": "Agrocare", "track": "growers"}
    d.update(kw)
    r = c.post("/api/people", json=d)
    assert r.status_code == 200, r.text
    return r.json()


def test_meta_and_empty_today(client):
    m = client.get("/api/meta").json()
    assert m["tracks"] == ["growers", "engineers", "labs", "angels"]
    assert m["threshold"] == 5
    t = client.get("/api/today").json()
    assert t["due"] == [] and t["drafts"] == []


def test_person_crud_and_stage_rules(client):
    p = person(client)
    assert p["stage"] == "new" and p["language"] == "en"
    # move along the ladder
    r = client.patch(f"/api/people/{p['id']}", json={"stage": "visit"})
    assert r.json()["stage"] == "visit"
    # unknown stage is a 400
    assert client.patch(f"/api/people/{p['id']}", json={"stage": "ally"}).status_code == 400
    # switching track with a stage the new ladder lacks falls back to new
    r = client.patch(f"/api/people/{p['id']}", json={"track": "angels"})
    assert r.json()["stage"] == "new"
    # name required
    assert client.post("/api/people", json={"name": "  "}).status_code == 400
    assert client.get("/api/search?q=ali").json()[0]["id"] == p["id"]
    client.delete(f"/api/people/{p['id']}")
    assert client.get(f"/api/people/{p['id']}").status_code == 404


def test_due_and_done(client):
    yesterday = (date.today() - timedelta(days=1)).isoformat()
    p = person(client, next_step="Call", next_date=yesterday)
    t = client.get("/api/today").json()
    assert [d["id"] for d in t["due"]] == [p["id"]]
    nxt = (date.today() + timedelta(days=3)).isoformat()
    r = client.post(f"/api/people/{p['id']}/done", json={"note": "Spoke briefly", "kind": "call", "next_step": "Visit", "next_date": nxt})
    assert r.json()["next_date"] == nxt
    assert r.json()["touches"][0]["kind"] == "call"
    assert client.get("/api/today").json()["due"] == []


def test_draft_sent_books_follow_up(client):
    p = person(client, email="ali@example.com")
    d = client.post(f"/api/people/{p['id']}/drafts", json={"channel": "email", "subject": "Hi", "body": "Hello"}).json()
    assert client.get("/api/today").json()["drafts"][0]["id"] == d["id"]
    client.patch(f"/api/drafts/{d['id']}", json={"status": "sent", "body": "Hello edited"})
    p2 = client.get(f"/api/people/{p['id']}").json()
    assert p2["stage"] == "contacted"
    assert p2["next_step"] == "Follow up"
    assert p2["next_date"] == (date.today() + timedelta(days=config.FOLLOW_UP_DAYS)).isoformat()
    assert p2["touches"][0]["body"] == "Sent: Hi"
    assert client.get("/api/today").json()["drafts"] == []
    assert client.post(f"/api/people/{p['id']}/drafts", json={"channel": "fax"}).status_code == 400


def test_draft_sent_with_phone_books_a_call(client):
    p = person(client, email="bo@example.com", phone="0174 123 456")
    d = client.post(f"/api/people/{p['id']}/drafts", json={"channel": "email", "subject": "Hi", "body": "Hello"}).json()
    client.patch(f"/api/drafts/{d['id']}", json={"status": "sent"})
    p2 = client.get(f"/api/people/{p['id']}").json()
    assert p2["next_step"] == "No reply? Call 0174 123 456"
    assert p2["next_date"] == (date.today() + timedelta(days=config.FOLLOW_UP_DAYS)).isoformat()


def test_linkedin_draft_keeps_note_and_message_apart(client):
    p = person(client, linkedin="https://www.linkedin.com/in/bo")
    d = client.post(f"/api/people/{p['id']}/drafts", json={"channel": "linkedin", "body": "Hi Bo, nice to connect.\n\nThanks for connecting. One question for you."}).json()
    assert d["subject"] == "Hi Bo, nice to connect." and d["body"] == "Thanks for connecting. One question for you."
    client.patch(f"/api/drafts/{d['id']}", json={"status": "sent"})
    # The note went out; the message waits on Today as its own draft.
    left = client.get("/api/today").json()["drafts"]
    assert len(left) == 1 and left[0]["subject"] == "" and left[0]["body"] == "Thanks for connecting. One question for you."
    client.patch(f"/api/drafts/{left[0]['id']}", json={"status": "sent"})
    assert client.get("/api/today").json()["drafts"] == []


def test_hypothesis_dots_and_auto_status(client):
    h = client.post("/api/hypotheses", json={"claim": "Growers rent, not buy", "track": "growers"}).json()
    assert h["status"] == "untested"
    for i in range(5):
        client.post(f"/api/hypotheses/{h['id']}/evidence", json={"verdict": "yes", "quote": f"q{i}"})
    hs = client.get("/api/hypotheses").json()
    assert hs[0]["yes"] == 5 and hs[0]["status"] == "holding"
    # revise: old closes, new links back
    n = client.post(f"/api/hypotheses/{h['id']}/revise", json={"claim": "Growers rent per season"}).json()
    assert n["revised_from"] == h["id"]
    old = [x for x in client.get("/api/hypotheses").json() if x["id"] == h["id"]][0]
    assert old["status"] == "revised"
    assert len(client.get("/api/hypotheses?all=0").json()) == 1
    assert client.post(f"/api/hypotheses/{h['id']}/evidence", json={"verdict": "maybe"}).status_code == 400


def test_confirm_call_writes_everything(client):
    p = person(client)
    h = client.post("/api/hypotheses", json={"claim": "Deleafing is the pain"}).json()
    r = client.post("/api/calls/confirm", json={
        "person_id": p["id"], "kind": "call", "summary": "Good call", "transcript": "long text",
        "verdicts": [{"hypothesis_id": h["id"], "verdict": "no", "quote": "not really"}],
        "referrals": [{"name": "Jan de Vries", "company": "Looye"}],
        "insights": [{"module": "SHEAR", "text": "Knives are a virus hot spot"}],
        "next_step": "Visit", "next_date": "2026-11-20", "stage": "call"}).json()
    assert r["person"]["stage"] == "call" and r["person"]["next_date"] == "2026-11-20"
    assert r["person"]["touches"][0]["transcript"] == "long text"
    assert r["person"]["evidence"][0]["verdict"] == "no"
    ref = r["referrals"][0]
    assert ref["referred_by"] == p["id"] and ref["track"] == "growers" and ref["next_date"] == date.today().isoformat()
    assert r["person"]["referrals"][0]["name"] == "Jan de Vries"
    ins = client.get("/api/insights?pending=1").json()
    assert ins[0]["module"] == "SHEAR" and ins[0]["person_name"] == "Ali Khaleel"
    week = client.get("/api/week").json()
    assert len(week["calls"]) == 1 and len(week["evidence"]) == 1


def test_export_appends_to_vault(client, tmp_path, monkeypatch):
    monkeypatch.setattr(config, "VAULT_MODULES", tmp_path / "mods")
    idx = tmp_path / "mods" / "SHEAR" / "(C) SHEAR Index.md"
    idx.parent.mkdir(parents=True)
    idx.write_text("# SHEAR\n\n## Progress\n\n- **2026-11-01**: older line\n", encoding="utf-8")
    p = person(client)
    client.post("/api/calls/confirm", json={"person_id": p["id"], "summary": "x",
                                            "insights": [{"module": "SHEAR", "text": "Flush cut confirmed"},
                                                         {"module": "RAVEN", "text": "no file for this one"}]})
    r = client.post("/api/insights/export").json()
    assert r["written"] == {"SHEAR": 1} and r["missing"] == ["RAVEN"] and r["count"] == 1
    text = idx.read_text(encoding="utf-8")
    lines = text.splitlines()
    assert lines[2] == "## Progress"
    assert lines[4].startswith(f"- **{date.today().isoformat()}**: Call (Ali Khaleel, Agrocare): Flush cut confirmed")
    assert lines[5] == "- **2026-11-01**: older line"
    # RAVEN stays pending, SHEAR is marked exported
    pending = client.get("/api/insights?pending=1").json()
    assert [i["module"] for i in pending] == ["RAVEN"]


def test_extract_and_draft_parse_model_output(client, monkeypatch):
    p = person(client, language="nl")
    h = client.post("/api/hypotheses", json={"claim": "A"}).json()
    reply = json.dumps({"summary": "s", "next_step": "n", "next_date": "", "verdicts": [
        {"hypothesis_id": h["id"], "verdict": "yes", "quote": "ja"}, {"hypothesis_id": 999, "verdict": "yes", "quote": "x"}],
        "referrals": [{"name": "Piet", "company": ""}, {"name": ""}], "insights": [{"module": "BLUSH", "text": "t"}, {"module": "NOPE", "text": "t"}]})
    monkeypatch.setattr(calls, "run_claude", lambda prompt, timeout=180: "```json\n" + reply + "\n```")
    r = client.post("/api/calls/extract", json={"person_id": p["id"], "transcript": "hallo"}).json()
    assert len(r["verdicts"]) == 1 and len(r["referrals"]) == 1 and len(r["insights"]) == 1
    monkeypatch.setattr(calls, "run_claude", lambda prompt, timeout=180: '{"subject": "Kort gesprek", "body": "Beste Ali, 3 dingen.\\n\\nKrishaanth"}')
    d = client.post(f"/api/people/{p['id']}/drafts/generate", json={"channel": "email"}).json()
    assert d["subject"] == "Kort gesprek" and "3" not in d["body"] and d["status"] == "pending"


def test_transcribe_without_backend_is_503(client, monkeypatch):
    monkeypatch.setattr(calls, "transcription_backend", lambda: "")
    r = client.post("/api/calls/transcribe", files={"file": ("a.m4a", b"xx", "audio/mp4")})
    assert r.status_code == 503 and "faster-whisper" in r.json()["error"]


def test_channels_on_touches_drafts_and_people(client):
    # preferred channel is guessed from the first contact detail, or set outright
    p = person(client, linkedin="https://linkedin.com/in/ali")
    assert p["channel"] == "linkedin"
    p2 = person(client, name="Bo", phone="+31 6 1234", channel="whatsapp")
    assert p2["channel"] == "whatsapp"
    assert client.post("/api/people", json={"name": "X", "channel": "fax"}).status_code == 400
    # a touch defaults to its kind's usual channel; a note has none
    t = client.post(f"/api/people/{p['id']}/touches", json={"kind": "call", "body": "rang"}).json()
    assert t["channel"] == "phone"
    t = client.post(f"/api/people/{p['id']}/touches", json={"kind": "call", "channel": "video", "body": "zoomed"}).json()
    assert t["channel"] == "video"
    t = client.post(f"/api/people/{p['id']}/touches", json={"kind": "note", "channel": "email", "body": "x"}).json()
    assert t["channel"] == ""
    assert client.post(f"/api/people/{p['id']}/touches", json={"kind": "message", "channel": "pigeon"}).status_code == 400
    # the board knows the last channel used
    row = [x for x in client.get("/api/people").json() if x["id"] == p["id"]][0]
    assert row["last_channel"] == "video"
    # a sent draft lands as a 'message' touch on its channel; whatsapp drafts carry the phone
    d = client.post(f"/api/people/{p2['id']}/drafts", json={"channel": "whatsapp", "body": "Hoi"}).json()
    assert client.get("/api/today").json()["drafts"][0]["to_phone"] == "+31 6 1234"
    client.patch(f"/api/drafts/{d['id']}", json={"status": "sent"})
    top = client.get(f"/api/people/{p2['id']}").json()["touches"][0]
    assert (top["kind"], top["channel"]) == ("message", "whatsapp")
    # ticking off a due item logs the channel too
    client.post(f"/api/people/{p['id']}/done", json={"note": "met at the fair", "kind": "meeting", "channel": "in person"})
    top = client.get(f"/api/people/{p['id']}").json()["touches"][0]
    assert (top["kind"], top["channel"]) == ("meeting", "in person")
    # counts by platform for the pulse and the Friday review
    pulse = client.get("/api/pulse").json()
    assert {c["channel"]: c["c"] for c in pulse["by_channel"]} == {"phone": 1, "video": 1, "whatsapp": 1, "in person": 1}
    week = client.get("/api/week").json()
    assert sum(c["c"] for c in week["channels"]) == 4


def test_old_database_gets_channels(tmp_path):
    """A db from before channels existed: column added, platforms recovered from the old kinds."""
    import sqlite3
    from crm import db
    path = tmp_path / "old.db"
    raw = sqlite3.connect(path)
    raw.executescript("""
        CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT NOT NULL, company TEXT DEFAULT '', track TEXT NOT NULL,
            stage TEXT NOT NULL DEFAULT 'new', next_step TEXT DEFAULT '', next_date TEXT DEFAULT '', email TEXT DEFAULT '',
            linkedin TEXT DEFAULT '', phone TEXT DEFAULT '', language TEXT DEFAULT 'en', referred_by INTEGER,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE touches (id INTEGER PRIMARY KEY, person_id INTEGER NOT NULL, kind TEXT NOT NULL, at TEXT NOT NULL,
            body TEXT DEFAULT '', transcript TEXT DEFAULT '', audio_path TEXT DEFAULT '');
        INSERT INTO people (id, name, track, created_at, updated_at) VALUES (1, 'Old', 'growers', 't', 't');
        INSERT INTO touches (person_id, kind, at) VALUES (1, 'email', 't'), (1, 'linkedin', 't'), (1, 'call', 't'), (1, 'visit', 't'), (1, 'note', 't');
    """)
    raw.commit(); raw.close()
    conn = db.connect(path)
    got = [(t["kind"], t["channel"]) for t in db.get_person(conn, 1)["touches"]]
    assert sorted(got) == sorted([("message", "email"), ("message", "linkedin"), ("call", "phone"), ("visit", "in person"), ("note", "")])
    assert db.get_person(conn, 1)["channel"] == ""


ICS = """BEGIN:VCALENDAR
BEGIN:VEVENT
UID:a1
DTSTART:{d1}T090000Z
DTEND:{d1}T100000Z
SUMMARY:Call with Ali Khaleel (Agrocare)
DESCRIPTION:about deleafing\\, then visit
END:VEVENT
BEGIN:VEVENT
UID:a2
DTSTART;VALUE=DATE:{d2}
SUMMARY:Westland trip
LOCATION:Naaldwijk
END:VEVENT
BEGIN:VEVENT
UID:a3
DTSTART:20200101T090000Z
DTEND:20200101T100000Z
SUMMARY:Ancient
END:VEVENT
BEGIN:VEVENT
UID:a4
DTSTART:{d1}T120000Z
DTEND:{d1}T130000Z
SUMMARY:Cancelled thing
STATUS:CANCELLED
END:VEVENT
END:VCALENDAR
"""


def test_calendar_parse_match_and_link(client, monkeypatch):
    from crm import calendar as cal
    d1 = date.today().strftime("%Y%m%d")
    d2 = (date.today() + timedelta(days=2)).strftime("%Y%m%d")
    monkeypatch.setattr(cal, "fetch_ics", lambda url: ICS.format(d1=d1, d2=d2))
    cal.forget_cache()
    p = person(client)
    # not connected yet
    assert client.get("/api/calendar").json() == {"connected": False, "events": []}
    assert client.get("/api/meta").json()["calendar"] is False
    assert client.post("/api/settings", json={"calendar_ics": "not a url"}).status_code == 400
    client.post("/api/settings", json={"calendar_ics": "webcal://calendar.google.com/x/basic.ics"})
    assert client.get("/api/meta").json()["calendar"] is True
    c = client.get("/api/calendar?days=7").json()
    titles = [e["summary"] for e in c["events"]]
    assert titles == ["Call with Ali Khaleel (Agrocare)", "Westland trip"]  # old + cancelled dropped, sorted
    assert c["events"][0]["people"][0]["id"] == p["id"]
    assert c["events"][0]["all_day"] is False and c["events"][1]["all_day"] is True
    assert c["events"][1]["people"] == []
    # description unescaped, and a prefilled Google Calendar link
    link = cal.event_link("Visit · Ali", "2026-11-20", "x y")
    assert "action=TEMPLATE" in link and "20261120T100000/20261120T103000" in link and "Visit%20%C2%B7%20Ali" in link
    # disconnect
    client.post("/api/settings", json={"calendar_ics": ""})
    assert client.get("/api/calendar").json()["connected"] is False


def test_today_filters_by_track(client):
    yesterday = (date.today() - timedelta(days=1)).isoformat()
    later = (date.today() + timedelta(days=2)).isoformat()
    g = person(client, name="Grower", next_step="Call", next_date=yesterday)
    a = person(client, name="Angel", track="angels", email="a@example.com", next_step="Intro", next_date=later)
    client.post(f"/api/people/{a['id']}/drafts", json={"channel": "email", "subject": "Hi", "body": "Hello"})
    t = client.get("/api/today").json()
    assert t["track"] == "" and t["counts"] == {"growers": 1, "angels": 1}
    assert len(t["due"]) == 1 and len(t["drafts"]) == 1 and len(t["upcoming"]) == 1
    t = client.get("/api/today?track=angels").json()
    assert t["due"] == [] and [d["name"] for d in t["drafts"]] == ["Angel"]
    assert [u["id"] for u in t["upcoming"]] == [a["id"]]
    assert t["counts"] == {"growers": 1, "angels": 1}  # counts stay over every track
    t = client.get("/api/today?track=growers").json()
    assert [d["id"] for d in t["due"]] == [g["id"]] and t["drafts"] == [] and t["upcoming"] == []


def test_due_list_runs_growers_first(client):
    yesterday = (date.today() - timedelta(days=1)).isoformat()
    week_ago = (date.today() - timedelta(days=7)).isoformat()
    person(client, name="Angel A", track="angels", next_step="Call", next_date=week_ago)
    person(client, name="Zed Grower", next_step="Call", next_date=yesterday)
    person(client, name="Eng", track="engineers", next_step="Call", next_date=yesterday)
    assert [d["track"] for d in client.get("/api/today").json()["due"]] == ["growers", "engineers", "angels"]
