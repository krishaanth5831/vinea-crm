"""
SQLite storage. One file, six tables, no ORM.

    people      one row per person you are talking to
    touches     the timeline: notes, emails, LinkedIn messages, calls, visits
    drafts      messages waiting for approval
    hypotheses  the guesses you pitch on calls
    evidence    one ✓ or ✗ per hypothesis per call, with a quote
    insights    call takeaways tagged with a Vinea module, exported to the vault

Every function takes and returns plain dicts so the API layer stays thin.
"""

import sqlite3
from datetime import date, datetime, timedelta

from . import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS people (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    company     TEXT DEFAULT '',
    track       TEXT NOT NULL,
    stage       TEXT NOT NULL DEFAULT 'new',
    next_step   TEXT DEFAULT '',
    next_date   TEXT DEFAULT '',          -- ISO date or ''
    email       TEXT DEFAULT '',
    linkedin    TEXT DEFAULT '',
    phone       TEXT DEFAULT '',
    language    TEXT DEFAULT 'en',        -- nl / en / de / fr
    channel     TEXT DEFAULT '',          -- preferred channel: email / linkedin / whatsapp / phone / video / in person
    referred_by INTEGER REFERENCES people(id) ON DELETE SET NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS touches (
    id          INTEGER PRIMARY KEY,
    person_id   INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL,            -- note / message / call / visit / meeting
    channel     TEXT DEFAULT '',          -- email / linkedin / whatsapp / phone / video / in person ('' for notes)
    at          TEXT NOT NULL,            -- ISO datetime
    body        TEXT DEFAULT '',          -- short summary
    transcript  TEXT DEFAULT '',          -- full transcript for calls
    audio_path  TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS drafts (
    id          INTEGER PRIMARY KEY,
    person_id   INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    channel     TEXT NOT NULL,            -- email / linkedin / whatsapp
    subject     TEXT DEFAULT '',
    body        TEXT DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'pending',  -- pending / sent / skipped
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS hypotheses (
    id           INTEGER PRIMARY KEY,
    claim        TEXT NOT NULL,
    track        TEXT DEFAULT '',
    module       TEXT DEFAULT '',
    source       TEXT DEFAULT '',         -- where the guess came from
    status       TEXT NOT NULL DEFAULT 'untested',
    revised_from INTEGER REFERENCES hypotheses(id) ON DELETE SET NULL,
    created_at   TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS evidence (
    id            INTEGER PRIMARY KEY,
    hypothesis_id INTEGER NOT NULL REFERENCES hypotheses(id) ON DELETE CASCADE,
    person_id     INTEGER REFERENCES people(id) ON DELETE SET NULL,
    touch_id      INTEGER REFERENCES touches(id) ON DELETE SET NULL,
    verdict       TEXT NOT NULL,          -- yes / no
    quote         TEXT DEFAULT '',
    created_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS insights (
    id          INTEGER PRIMARY KEY,
    touch_id    INTEGER REFERENCES touches(id) ON DELETE SET NULL,
    person_id   INTEGER REFERENCES people(id) ON DELETE SET NULL,
    module      TEXT NOT NULL,
    text        TEXT NOT NULL,
    exported_at TEXT DEFAULT '',
    created_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
    key         TEXT PRIMARY KEY,
    value       TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_touches_person ON touches(person_id, at);
CREATE INDEX IF NOT EXISTS idx_people_track ON people(track, stage);
"""


def now() -> str:
    return datetime.now().replace(microsecond=0).isoformat(sep=" ")


def today() -> str:
    return date.today().isoformat()


def connect(path=None) -> sqlite3.Connection:
    path = path or config.DB_PATH
    if path != ":memory:":
        path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript(SCHEMA)
    _migrate(conn)
    return conn


def _migrate(conn) -> None:
    """Bring a database made by an older version up to the current schema."""
    for table in ("people", "touches"):
        cols = [r["name"] for r in conn.execute(f"PRAGMA table_info({table})")]
        if "channel" not in cols:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN channel TEXT DEFAULT ''")
    # Before channels existed, the platform was folded into the touch kind.
    conn.execute("UPDATE touches SET kind = 'message', channel = 'email' WHERE kind = 'email'")
    conn.execute("UPDATE touches SET kind = 'message', channel = 'linkedin' WHERE kind = 'linkedin'")
    conn.execute("UPDATE touches SET channel = 'phone' WHERE kind = 'call' AND channel = ''")
    conn.execute("UPDATE touches SET channel = 'in person' WHERE kind IN ('visit', 'meeting') AND channel = ''")
    conn.commit()


def rows(cur) -> list[dict]:
    return [dict(r) for r in cur.fetchall()]


def one(cur) -> dict | None:
    r = cur.fetchone()
    return dict(r) if r else None


# -------------------------------------------------------------- settings ----

def get_setting(conn, key: str, default: str = "") -> str:
    r = one(conn.execute("SELECT value FROM settings WHERE key = ?", (key,)))
    return r["value"] if r else default


def set_setting(conn, key: str, value: str) -> None:
    conn.execute("INSERT INTO settings (key, value) VALUES (?, ?) "
                 "ON CONFLICT(key) DO UPDATE SET value = excluded.value", (key, value))
    conn.commit()


# ---------------------------------------------------------------- people ----

PERSON_FIELDS = ["name", "company", "track", "stage", "next_step", "next_date",
                 "email", "linkedin", "phone", "language", "channel", "referred_by"]


def _check_channel(channel: str) -> str:
    if channel and channel not in config.CHANNELS:
        raise ValueError(f"unknown channel {channel}")
    return channel


def _guess_channel(vals: dict) -> str:
    """Preferred channel when none was given: the first contact detail on file."""
    if vals.get("email"):
        return "email"
    if vals.get("linkedin"):
        return "linkedin"
    if vals.get("phone"):
        return "whatsapp"
    return ""


def list_people(conn, track: str | None = None) -> list[dict]:
    sql = ("SELECT p.*, (SELECT count(*) FROM touches t WHERE t.person_id = p.id) AS touch_count, "
           "(SELECT channel FROM touches t WHERE t.person_id = p.id AND t.kind != 'note' "
           " ORDER BY t.at DESC, t.id DESC LIMIT 1) AS last_channel "
           "FROM people p")
    args = []
    if track:
        sql += " WHERE track = ?"
        args.append(track)
    sql += " ORDER BY updated_at DESC"
    return rows(conn.execute(sql, args))


def get_person(conn, pid: int) -> dict | None:
    p = one(conn.execute("SELECT * FROM people WHERE id = ?", (pid,)))
    if not p:
        return None
    p["touches"] = rows(conn.execute(
        "SELECT * FROM touches WHERE person_id = ? ORDER BY at DESC, id DESC", (pid,)))
    p["drafts"] = rows(conn.execute(
        "SELECT * FROM drafts WHERE person_id = ? ORDER BY created_at DESC", (pid,)))
    p["evidence"] = rows(conn.execute(
        "SELECT e.*, h.claim FROM evidence e JOIN hypotheses h ON h.id = e.hypothesis_id "
        "WHERE e.person_id = ? ORDER BY e.created_at DESC", (pid,)))
    p["referrals"] = rows(conn.execute(
        "SELECT id, name, company, track, stage FROM people WHERE referred_by = ? ORDER BY name", (pid,)))
    p["referrer"] = None
    if p["referred_by"]:
        p["referrer"] = one(conn.execute(
            "SELECT id, name, company FROM people WHERE id = ?", (p["referred_by"],)))
    return p


def _check(track: str, stage: str) -> tuple[str, str]:
    if track not in config.TRACKS:
        raise ValueError(f"unknown track {track}")
    if stage not in config.STAGES[track]:
        raise ValueError(f"unknown stage {stage} for {track}")
    return track, stage


def create_person(conn, data: dict) -> dict:
    name = (data.get("name") or "").strip()
    if not name:
        raise ValueError("name is required")
    track, stage = _check(data.get("track") or "growers", data.get("stage") or "new")
    ts = now()
    vals = {f: (data.get(f) or "") for f in PERSON_FIELDS}
    vals.update(name=name, track=track, stage=stage, created_at=ts, updated_at=ts)
    vals["referred_by"] = data.get("referred_by") or None
    vals["language"] = vals["language"] or "en"
    vals["channel"] = _check_channel(vals["channel"]) or _guess_channel(vals)
    cols = ", ".join(vals)
    marks = ", ".join("?" for _ in vals)
    cur = conn.execute(f"INSERT INTO people ({cols}) VALUES ({marks})", list(vals.values()))
    conn.commit()
    return get_person(conn, cur.lastrowid)


def update_person(conn, pid: int, data: dict) -> dict:
    current = one(conn.execute("SELECT * FROM people WHERE id = ?", (pid,)))
    if not current:
        raise KeyError(pid)
    track = data.get("track", current["track"])
    stage = data.get("stage", current["stage"])
    if track not in config.TRACKS:
        raise ValueError(f"unknown track {track}")
    if stage not in config.STAGES[track]:
        if track == current["track"]:
            raise ValueError(f"unknown stage {stage} for {track}")
        # moved to another track whose ladder lacks this stage: start over
        stage = "new"
    sets, args = ["track = ?", "stage = ?"], [track, stage]
    for f in PERSON_FIELDS:
        if f in ("track", "stage") or f not in data:
            continue
        v = data[f]
        if f == "referred_by":
            v = v or None
        elif f == "name":
            v = (v or "").strip() or current["name"]
        elif f == "channel":
            v = _check_channel(v or "")
        else:
            v = v or ""
        sets.append(f"{f} = ?")
        args.append(v)
    sets.append("updated_at = ?")
    args += [now(), pid]
    conn.execute(f"UPDATE people SET {', '.join(sets)} WHERE id = ?", args)
    conn.commit()
    return get_person(conn, pid)


def delete_person(conn, pid: int) -> None:
    conn.execute("DELETE FROM people WHERE id = ?", (pid,))
    conn.commit()


def search_people(conn, q: str, limit: int = 12) -> list[dict]:
    like = f"%{q.strip()}%"
    return rows(conn.execute(
        "SELECT id, name, company, track, stage FROM people "
        "WHERE name LIKE ? OR company LIKE ? ORDER BY updated_at DESC LIMIT ?",
        (like, like, limit)))


def mark_done(conn, pid: int, note: str = "", kind: str = "note",
              next_step: str = "", next_date: str = "", channel: str | None = None) -> dict:
    """Tick off a Today item: log what happened and set the next step."""
    if note.strip():
        add_touch(conn, pid, kind, body=note.strip(), channel=channel)
    return update_person(conn, pid, {"next_step": next_step, "next_date": next_date})


# --------------------------------------------------------------- touches ----

def add_touch(conn, person_id: int, kind: str, body: str = "", transcript: str = "",
              at: str | None = None, audio_path: str = "", channel: str | None = None) -> dict:
    if kind not in config.TOUCH_KINDS:
        raise ValueError(f"unknown touch kind {kind}")
    # A note has no channel; anything else defaults to the usual one for its kind.
    channel = "" if kind == "note" else _check_channel(channel or config.DEFAULT_CHANNEL[kind])
    cur = conn.execute(
        "INSERT INTO touches (person_id, kind, channel, at, body, transcript, audio_path) VALUES (?,?,?,?,?,?,?)",
        (person_id, kind, channel, at or now(), body, transcript, audio_path))
    conn.execute("UPDATE people SET updated_at = ? WHERE id = ?", (now(), person_id))
    conn.commit()
    return one(conn.execute("SELECT * FROM touches WHERE id = ?", (cur.lastrowid,)))


def delete_touch(conn, tid: int) -> None:
    conn.execute("DELETE FROM touches WHERE id = ?", (tid,))
    conn.commit()


# ---------------------------------------------------------------- drafts ----

def list_drafts(conn, status: str = "pending") -> list[dict]:
    return rows(conn.execute(
        "SELECT d.*, p.name, p.company, p.track, p.email AS to_email, "
        "p.linkedin AS to_linkedin, p.phone AS to_phone, p.language "
        "FROM drafts d JOIN people p ON p.id = d.person_id "
        "WHERE d.status = ? ORDER BY d.created_at", (status,)))


LINKEDIN_NOTE_MAX = 300  # LinkedIn's limit on a connection note


def split_linkedin(body: str) -> tuple[str, str]:
    """A LinkedIn draft written as 'connection note, blank line, message for
    after they accept' becomes (note, message); anything else is ('', body)."""
    body = (body or "").strip()
    head, _, rest = body.partition("\n\n")
    if rest.strip() and len(head.strip()) <= LINKEDIN_NOTE_MAX:
        return head.strip(), rest.strip()
    return "", body


def create_draft(conn, person_id: int, channel: str, subject: str = "", body: str = "") -> dict:
    if channel not in config.DRAFT_CHANNELS:
        raise ValueError(f"channel must be one of {', '.join(config.DRAFT_CHANNELS)}")
    if channel == "linkedin" and not subject:
        # The note and the message live in their own boxes: subject = note.
        subject, body = split_linkedin(body)
    ts = now()
    cur = conn.execute(
        "INSERT INTO drafts (person_id, channel, subject, body, status, created_at, updated_at) "
        "VALUES (?,?,?,?,'pending',?,?)", (person_id, channel, subject, body, ts, ts))
    conn.commit()
    return one(conn.execute("SELECT * FROM drafts WHERE id = ?", (cur.lastrowid,)))


def update_draft(conn, did: int, data: dict) -> dict:
    d = one(conn.execute("SELECT * FROM drafts WHERE id = ?", (did,)))
    if not d:
        raise KeyError(did)
    sets, args = [], []
    for f in ("subject", "body", "status", "channel"):
        if f in data:
            sets.append(f"{f} = ?")
            args.append(data[f])
    sets.append("updated_at = ?")
    args += [now(), did]
    conn.execute(f"UPDATE drafts SET {', '.join(sets)} WHERE id = ?", args)
    if data.get("status") == "sent" and d["status"] != "sent":
        # A sent message lands on the timeline, bumps a 'new' person to
        # 'contacted' and books a follow-up if nothing else is planned.
        body = data.get("body", d["body"])
        subject = data.get("subject", d["subject"])
        summary = (subject or body[:80]).strip()
        conn.execute(
            "INSERT INTO touches (person_id, kind, channel, at, body) VALUES (?,?,?,?,?)",
            (d["person_id"], "message", data.get("channel", d["channel"]), now(), f"Sent: {summary}"))
        p = one(conn.execute("SELECT * FROM people WHERE id = ?", (d["person_id"],)))
        stage = "contacted" if p["stage"] == "new" else p["stage"]
        next_step, next_date = p["next_step"], p["next_date"]
        if not next_date:
            # No reply by then? With a number on file the follow-up is a
            # call, which lands on Today as "Call ..." with the number.
            phone = (p["phone"] or "").strip()
            if not next_step:
                next_step = f"No reply? Call {phone}" if phone else "Follow up"
            next_date = (date.today() + timedelta(days=config.FOLLOW_UP_DAYS)).isoformat()
        conn.execute(
            "UPDATE people SET stage = ?, next_step = ?, next_date = ?, updated_at = ? WHERE id = ?",
            (stage, next_step, next_date, now(), d["person_id"]))
        if d["channel"] == "linkedin" and subject.strip() and body.strip():
            # The connection note went out. The message for after they
            # accept becomes its own draft, so it waits on Today until then.
            conn.execute(
                "INSERT INTO drafts (person_id, channel, subject, body, status, created_at, updated_at) "
                "VALUES (?,?,?,?,'pending',?,?)", (d["person_id"], "linkedin", "", body.strip(), now(), now()))
    conn.commit()
    return one(conn.execute("SELECT * FROM drafts WHERE id = ?", (did,)))


# ------------------------------------------------------------ hypotheses ----

def list_hypotheses(conn, include_revised: bool = True) -> list[dict]:
    sql = "SELECT * FROM hypotheses"
    if not include_revised:
        sql += " WHERE status != 'revised'"
    hs = rows(conn.execute(sql + " ORDER BY created_at DESC, id DESC"))
    for h in hs:
        h["evidence"] = rows(conn.execute(
            "SELECT e.*, p.name AS person_name, p.company FROM evidence e "
            "LEFT JOIN people p ON p.id = e.person_id "
            "WHERE e.hypothesis_id = ? ORDER BY e.created_at", (h["id"],)))
        h["yes"] = sum(1 for e in h["evidence"] if e["verdict"] == "yes")
        h["no"] = sum(1 for e in h["evidence"] if e["verdict"] == "no")
    return hs


def get_hypothesis(conn, hid: int) -> dict | None:
    return one(conn.execute("SELECT * FROM hypotheses WHERE id = ?", (hid,)))


def create_hypothesis(conn, data: dict) -> dict:
    claim = (data.get("claim") or "").strip()
    if not claim:
        raise ValueError("claim is required")
    status = data.get("status") or "untested"
    if status not in config.HYPOTHESIS_STATUSES:
        raise ValueError(f"unknown status {status}")
    cur = conn.execute(
        "INSERT INTO hypotheses (claim, track, module, source, status, revised_from, created_at) "
        "VALUES (?,?,?,?,?,?,?)",
        (claim, data.get("track") or "", data.get("module") or "", data.get("source") or "",
         status, data.get("revised_from") or None, now()))
    conn.commit()
    return get_hypothesis(conn, cur.lastrowid)


def update_hypothesis(conn, hid: int, data: dict) -> dict:
    sets, args = [], []
    for f in ("claim", "track", "module", "source", "status"):
        if f in data:
            if f == "status" and data[f] not in config.HYPOTHESIS_STATUSES:
                raise ValueError(f"unknown status {data[f]}")
            sets.append(f"{f} = ?")
            args.append(data[f])
    if sets:
        args.append(hid)
        conn.execute(f"UPDATE hypotheses SET {', '.join(sets)} WHERE id = ?", args)
        conn.commit()
    return get_hypothesis(conn, hid)


def delete_hypothesis(conn, hid: int) -> None:
    conn.execute("DELETE FROM hypotheses WHERE id = ?", (hid,))
    conn.commit()


def revise_hypothesis(conn, hid: int, new_claim: str) -> dict:
    """Close the old guess as 'revised' and open a new one linked to it."""
    old = get_hypothesis(conn, hid)
    if not old:
        raise KeyError(hid)
    conn.execute("UPDATE hypotheses SET status = 'revised' WHERE id = ?", (hid,))
    conn.commit()
    return create_hypothesis(conn, {
        "claim": new_claim, "track": old["track"], "module": old["module"],
        "source": f"revised from #{hid}", "revised_from": hid})


def add_evidence(conn, hypothesis_id: int, verdict: str, quote: str = "",
                 person_id: int | None = None, touch_id: int | None = None) -> dict:
    if verdict not in ("yes", "no"):
        raise ValueError("verdict must be yes or no")
    cur = conn.execute(
        "INSERT INTO evidence (hypothesis_id, person_id, touch_id, verdict, quote, created_at) "
        "VALUES (?,?,?,?,?,?)", (hypothesis_id, person_id, touch_id, verdict, quote, now()))
    _auto_status(conn, hypothesis_id)
    conn.commit()
    return one(conn.execute("SELECT * FROM evidence WHERE id = ?", (cur.lastrowid,)))


def delete_evidence(conn, eid: int) -> None:
    e = one(conn.execute("SELECT hypothesis_id FROM evidence WHERE id = ?", (eid,)))
    conn.execute("DELETE FROM evidence WHERE id = ?", (eid,))
    if e:
        _auto_status(conn, e["hypothesis_id"])
    conn.commit()


def _auto_status(conn, hid: int) -> None:
    """Once evidence is one-sided past the threshold, the status follows it."""
    h = get_hypothesis(conn, hid)
    if not h or h["status"] == "revised":
        return
    yes = one(conn.execute("SELECT count(*) c FROM evidence WHERE hypothesis_id=? AND verdict='yes'", (hid,)))["c"]
    no = one(conn.execute("SELECT count(*) c FROM evidence WHERE hypothesis_id=? AND verdict='no'", (hid,)))["c"]
    new = "untested"
    if yes >= config.EVIDENCE_THRESHOLD and yes > no:
        new = "holding"
    elif no >= config.EVIDENCE_THRESHOLD and no > yes:
        new = "disproved"
    if new != h["status"]:
        conn.execute("UPDATE hypotheses SET status = ? WHERE id = ?", (new, hid))


# -------------------------------------------------------------- insights ----

def add_insight(conn, module: str, text: str, person_id: int | None = None,
                touch_id: int | None = None) -> dict:
    if module not in config.MODULES:
        raise ValueError(f"unknown module {module}")
    cur = conn.execute(
        "INSERT INTO insights (touch_id, person_id, module, text, created_at) VALUES (?,?,?,?,?)",
        (touch_id, person_id, module, text.strip(), now()))
    conn.commit()
    return one(conn.execute("SELECT * FROM insights WHERE id = ?", (cur.lastrowid,)))


def list_insights(conn, unexported_only: bool = False) -> list[dict]:
    sql = ("SELECT i.*, p.name AS person_name, p.company FROM insights i "
           "LEFT JOIN people p ON p.id = i.person_id")
    if unexported_only:
        sql += " WHERE i.exported_at = ''"
    sql += " ORDER BY i.module, i.created_at"
    return rows(conn.execute(sql))


def delete_insight(conn, iid: int) -> None:
    conn.execute("DELETE FROM insights WHERE id = ?", (iid,))
    conn.commit()


def mark_insights_exported(conn, ids: list[int]) -> None:
    ts = now()
    conn.executemany("UPDATE insights SET exported_at = ? WHERE id = ?", [(ts, i) for i in ids])
    conn.commit()


# ----------------------------------------------------------------- today ----

def today_items(conn, track: str | None = None) -> dict:
    """Everything that belongs on the Today screen, optionally for one track
    (growers / engineers / labs / angels). `counts` is always over every track
    (drafts + due per track) so the filter tabs can show what each one holds."""
    t = today()
    due = rows(conn.execute(
        "SELECT id, name, company, track, stage, channel, next_step, next_date FROM people "
        "WHERE next_date != '' AND next_date <= ? AND stage != 'closed' "
        "ORDER BY next_date, name", (t,)))
    drafts = list_drafts(conn, "pending")
    counts: dict[str, int] = {}
    for x in due + drafts:
        counts[x["track"]] = counts.get(x["track"], 0) + 1
    upcoming_sql = ("SELECT id, name, company, track, stage, channel, next_step, next_date FROM people "
                    "WHERE next_date > ? AND stage != 'closed' ")
    args: tuple = (t,)
    if track:
        due = [x for x in due if x["track"] == track]
        drafts = [x for x in drafts if x["track"] == track]
        upcoming_sql += "AND track = ? "
        args += (track,)
    upcoming = rows(conn.execute(upcoming_sql + "ORDER BY next_date, name LIMIT 8", args))
    return {"date": t, "track": track or "", "counts": counts,
            "due": due, "upcoming": upcoming, "drafts": drafts}


def pulse(conn) -> dict:
    """Small numbers for the top bar: touches and calls in the last 7 days."""
    since = (datetime.now() - timedelta(days=7)).replace(microsecond=0).isoformat(sep=" ")
    touches = one(conn.execute(
        "SELECT count(*) c FROM touches WHERE at >= ? AND kind != 'note'", (since,)))["c"]
    calls = one(conn.execute(
        "SELECT count(*) c FROM touches WHERE at >= ? AND kind IN ('call','visit','meeting')", (since,)))["c"]
    people = one(conn.execute("SELECT count(*) c FROM people WHERE stage != 'closed'"))["c"]
    by_channel = rows(conn.execute(
        "SELECT channel, count(*) c FROM touches WHERE at >= ? AND kind != 'note' "
        "GROUP BY channel ORDER BY c DESC", (since,)))
    return {"touches": touches, "calls": calls, "people": people,
            "target": config.WEEKLY_TOUCH_TARGET, "by_channel": by_channel}


def week_summary(conn) -> dict:
    """Lists for the Friday review (last 7 days)."""
    since = (datetime.now() - timedelta(days=7)).replace(microsecond=0).isoformat(sep=" ")
    touches = rows(conn.execute(
        "SELECT kind, count(*) c FROM touches WHERE at >= ? GROUP BY kind ORDER BY c DESC", (since,)))
    channels = rows(conn.execute(
        "SELECT channel, count(*) c FROM touches WHERE at >= ? AND kind != 'note' "
        "GROUP BY channel ORDER BY c DESC", (since,)))
    calls = rows(conn.execute(
        "SELECT t.id, t.at, t.body, p.id AS person_id, p.name, p.company, p.track "
        "FROM touches t JOIN people p ON p.id = t.person_id "
        "WHERE t.kind IN ('call','visit','meeting') AND t.at >= ? ORDER BY t.at DESC", (since,)))
    moved = rows(conn.execute(
        "SELECT id, name, company, track, stage FROM people "
        "WHERE updated_at >= ? AND stage NOT IN ('new') ORDER BY track, stage", (since,)))
    evidence = rows(conn.execute(
        "SELECT e.verdict, e.quote, h.claim, h.id AS hypothesis_id, h.status, p.name AS person_name "
        "FROM evidence e JOIN hypotheses h ON h.id = e.hypothesis_id "
        "LEFT JOIN people p ON p.id = e.person_id "
        "WHERE e.created_at >= ? ORDER BY h.id, e.created_at", (since,)))
    by_track = rows(conn.execute(
        "SELECT track, stage, count(*) c FROM people GROUP BY track, stage"))
    return {"since": since[:10], "touches": touches, "channels": channels, "calls": calls, "moved": moved,
            "evidence": evidence, "by_track": by_track,
            "insights": list_insights(conn, unexported_only=True)}
