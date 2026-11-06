"""
Google Calendar link, kept deliberately small.

Reading: the calendar's private iCal address (Google Calendar > Settings >
your calendar > "Secret address in iCal format") is stored once in the
settings table. The CRM fetches it, parses the events and matches them to
people by name, so Today shows who you are meeting and the person drawer
shows what is planned with them. No OAuth, no Google Cloud project.

Writing: a prefilled Google Calendar link (`event_link`) opens the normal
"new event" page with the person, next step and date filled in. One click,
and the event is on the calendar the user already has open.
"""

import re
import time
import urllib.request
from datetime import date, datetime, timedelta, timezone
from urllib.parse import quote

_CACHE: dict = {"url": "", "at": 0.0, "events": []}
CACHE_SECONDS = 300


def fetch_ics(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "vinea-crm"})
    with urllib.request.urlopen(req, timeout=15) as r:
        return r.read().decode("utf-8", "ignore")


def _unfold(text: str) -> list[str]:
    """iCal folds long lines with a leading space; join them back."""
    lines: list[str] = []
    for raw in text.replace("\r\n", "\n").split("\n"):
        if raw.startswith((" ", "\t")) and lines:
            lines[-1] += raw[1:]
        else:
            lines.append(raw)
    return lines


def _parse_dt(value: str, params: str) -> tuple[datetime, bool]:
    """Returns (local naive datetime, all_day)."""
    value = value.strip()
    if "VALUE=DATE" in params or re.fullmatch(r"\d{8}", value):
        return datetime.strptime(value[:8], "%Y%m%d"), True
    if value.endswith("Z"):
        dt = datetime.strptime(value[:15], "%Y%m%dT%H%M%S").replace(tzinfo=timezone.utc)
        return dt.astimezone().replace(tzinfo=None), False
    # Floating or TZID: treat as local time. Good enough for one person's calendar.
    return datetime.strptime(value[:15], "%Y%m%dT%H%M%S"), False


def _unescape(s: str) -> str:
    return s.replace("\\n", "\n").replace("\\,", ",").replace("\\;", ";").replace("\\\\", "\\")


def parse_ics(text: str) -> list[dict]:
    events, cur = [], None
    for line in _unfold(text):
        if line == "BEGIN:VEVENT":
            cur = {}
        elif line == "END:VEVENT":
            if cur and "start" in cur:
                cur.setdefault("end", cur["start"] + timedelta(days=1 if cur.get("all_day") else 0, hours=0 if cur.get("all_day") else 1))
                cur.setdefault("summary", "(no title)")
                events.append(cur)
            cur = None
        elif cur is not None and ":" in line:
            head, _, value = line.partition(":")
            name, _, params = head.partition(";")
            if name == "DTSTART":
                cur["start"], cur["all_day"] = _parse_dt(value, params)
            elif name == "DTEND":
                cur["end"], _ = _parse_dt(value, params)
            elif name == "SUMMARY":
                cur["summary"] = _unescape(value)
            elif name == "DESCRIPTION":
                cur["description"] = _unescape(value)
            elif name == "LOCATION":
                cur["location"] = _unescape(value)
            elif name == "UID":
                cur["uid"] = value
            elif name == "STATUS" and value == "CANCELLED":
                cur["cancelled"] = True
    return [e for e in events if not e.get("cancelled")]


def upcoming(url: str, days: int = 7, now: datetime | None = None) -> list[dict]:
    """Events from the start of today until `days` ahead, cached briefly."""
    now = now or datetime.now()
    if url != _CACHE["url"] or time.time() - _CACHE["at"] > CACHE_SECONDS:
        _CACHE.update(url=url, at=time.time(), events=parse_ics(fetch_ics(url)))
    start = datetime.combine(now.date(), datetime.min.time())
    end = start + timedelta(days=days)
    out = [e for e in _CACHE["events"] if e["end"] > start and e["start"] < end]
    out.sort(key=lambda e: e["start"])
    return out


def forget_cache() -> None:
    _CACHE.update(url="", at=0.0, events=[])


def match_people(events: list[dict], people: list[dict]) -> list[dict]:
    """Attach the people whose name or company appears in the event text."""
    out = []
    for e in events:
        hay = " ".join(str(e.get(k, "")) for k in ("summary", "description", "location")).lower()
        hits = []
        for p in people:
            name = p["name"].strip().lower()
            last = name.split()[-1] if name else ""
            company = (p.get("company") or "").strip().lower()
            if (name and name in hay) or (company and len(company) > 3 and company in hay) \
                    or (last and len(last) > 3 and re.search(r"\b" + re.escape(last) + r"\b", hay)):
                hits.append({"id": p["id"], "name": p["name"], "company": p.get("company", "")})
        out.append({
            "uid": e.get("uid", ""), "summary": e["summary"], "location": e.get("location", ""),
            "start": e["start"].isoformat(sep=" "), "end": e["end"].isoformat(sep=" "),
            "all_day": bool(e.get("all_day")), "people": hits,
        })
    return out


def event_link(title: str, day: str, details: str = "", location: str = "",
               hour: int = 10, minutes: int = 30) -> str:
    """A Google Calendar 'new event' URL prefilled for `day` (ISO date)."""
    try:
        d = date.fromisoformat(day)
    except ValueError:
        d = date.today()
    start = datetime.combine(d, datetime.min.time()).replace(hour=hour)
    end = start + timedelta(minutes=minutes)
    fmt = "%Y%m%dT%H%M%S"
    return ("https://calendar.google.com/calendar/render?action=TEMPLATE"
            f"&text={quote(title)}&dates={start.strftime(fmt)}/{end.strftime(fmt)}"
            f"&details={quote(details)}&location={quote(location)}")
