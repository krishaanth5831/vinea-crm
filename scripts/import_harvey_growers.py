"""Import a Harvey outreach batch (the review CSV from assemble_growers.py)
into the CRM: one person per row (reach via email, phone + LinkedIn on file)
and, for every fit person, an email draft and a LinkedIn draft on Today so
each message can be approved and sent from the CRM.

Usage: .venv/bin/python scripts/import_harvey_growers.py <review.csv> [--track growers|engineers|labs|angels]
Harvey's "investors" track lands on the CRM's "angels" track.
Safe to re-run: people are matched on name + company, drafts are not duplicated.
"""

import csv
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from crm import config, db  # noqa: E402

SIGNATURE = "\n\nKrishaanth Ramaraj\nFounder, Vinea\ngetvinea.nl"
OPT_OUT = {
    "nl": "Liever geen berichten meer van mij? Laat het weten, dan schrijf ik niet meer.",
    "en": "If you'd rather not hear from me again, just say so and I won't write again.",
    "de": "Wenn Sie lieber nichts mehr von mir hören möchten, sagen Sie es einfach, dann schreibe ich nicht wieder.",
    "fr": "Si vous préférez ne plus recevoir de messages de ma part, dites-le simplement et je n'écrirai plus.",
}


HARVEY_TO_CRM_TRACK = {"investors": "angels"}

# RTL marks, zero-width spaces and similar: LinkedIn names often carry them.
INVISIBLE = re.compile("[\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]")


def clean(s: str) -> str:
    return INVISIBLE.sub("", s or "").strip()


def next_step(r) -> str:
    """What Today should say, given which contact details are actually on file.
    A published business line comes first: the call is the opener, the drafts
    follow it (or replace it when nobody picks up)."""
    if r.get("phone"):
        rest = " + ".join(x for x, ok in (("email", r["email"]), ("LinkedIn note", r["linkedin"])) if ok)
        return f"Call {r['phone']}" + (f", then {rest}" if rest else "")
    if r["email"] and r["linkedin"]:
        return "Approve and send first email; LinkedIn note by hand"
    if r["email"]:
        return "Approve and send first email (no LinkedIn profile on file)"
    if r["linkedin"]:
        return "LinkedIn note by hand (no public email)"
    return "Find a public address or LinkedIn profile first"


def main(path: str, track: str = "growers") -> None:
    track = HARVEY_TO_CRM_TRACK.get(track, track)
    if track not in config.TRACKS:
        raise SystemExit(f"unknown track {track!r}; use one of {config.TRACKS}")
    conn = db.connect()
    rows = list(csv.DictReader(open(path, encoding="utf-8")))
    made = drafts = 0
    people = conn.execute("SELECT id, name, company FROM people").fetchall()
    known = {(clean(x["name"]).lower(), clean(x["company"]).lower()): x["id"] for x in people}
    for r in rows:
        if r["fit"] != "draft":
            continue
        r["name"], r["company"] = clean(r["name"]), clean(r["company"])
        pid = known.get((r["name"].lower(), r["company"].lower()))
        if not pid:
            p = db.create_person(conn, {
                "name": r["name"], "company": r["company"], "track": track,
                "email": r["email"], "linkedin": r["linkedin"], "phone": r["phone"],
                "language": r["language"] or "nl",
                "channel": "phone" if r["phone"] else "email" if r["email"] else "linkedin",
                "next_step": next_step(r),
                "next_date": db.today(),
            })
            pid = p["id"]
            known[(r["name"].lower(), r["company"].lower())] = pid
            made += 1
            lines = [f"Source: {r['source']}", f"Role: {r['title']}"]
            if r.get("fit_reason"):
                lines.append(f"Why: {r['fit_reason']}")
            if r.get("phone_source_url"):
                lines.append(f"Phone from: {r['phone_source_url']}")
            if r.get("email_source_url"):
                lines.append(f"Email from: {r['email_source_url']}")
            if r.get("harvey_draft_id"):
                lines.append(f"Harvey draft {r['harvey_draft_id']}")
            db.add_touch(conn, pid, "note", body="\n".join(lines))
        have = {d["channel"] for d in db.get_person(conn, pid)["drafts"]}
        lang = r["language"] or "nl"
        # No address on file = no email draft on Today (it would look sendable).
        if r["email"] and r["email_body"] and "email" not in have:
            body = r["email_body"].strip() + SIGNATURE + "\n\n" + OPT_OUT.get(lang, OPT_OUT["en"])
            db.create_draft(conn, pid, "email", subject=r["email_subject"], body=body)
            drafts += 1
        # Same for LinkedIn: no profile URL on file = no LinkedIn draft.
        if r["linkedin"] and r["linkedin_message"] and "linkedin" not in have:
            # Note and message in their own boxes (subject = connection note).
            db.create_draft(conn, pid, "linkedin", subject=r["linkedin_note"].strip(),
                            body=r["linkedin_message"].strip())
            drafts += 1
    print(f"CRM: {made} people added, {drafts} drafts on Today ({config.DB_PATH})")


if __name__ == "__main__":
    args = sys.argv[1:]
    track = args[args.index("--track") + 1] if "--track" in args else "growers"
    main(args[0], track)
