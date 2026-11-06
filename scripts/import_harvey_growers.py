"""Import a Harvey grower batch (the review CSV from assemble_growers.py) into
the CRM: one person per row (track growers, reach via email, phone +
LinkedIn on file) and, for every fit person, an email draft and a LinkedIn
draft on Today so each message can be approved and sent from the CRM.

Usage: .venv/bin/python scripts/import_harvey_growers.py <review.csv>
Safe to re-run: people are matched on name + company, drafts are not duplicated.
"""

import csv
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


def main(path: str) -> None:
    conn = db.connect()
    rows = list(csv.DictReader(open(path, encoding="utf-8")))
    made = drafts = 0
    for r in rows:
        if r["fit"] != "draft":
            continue
        existing = db.one(conn.execute(
            "SELECT id FROM people WHERE name = ? AND company = ?", (r["name"], r["company"])))
        if existing:
            pid = existing["id"]
        else:
            p = db.create_person(conn, {
                "name": r["name"], "company": r["company"], "track": "growers",
                "email": r["email"], "linkedin": r["linkedin"], "phone": r["phone"],
                "language": r["language"] or "nl", "channel": "email" if r["email"] else "linkedin",
                "next_step": "Approve and send first email; LinkedIn note by hand",
                "next_date": db.today(),
            })
            pid = p["id"]
            made += 1
            db.add_touch(conn, pid, "note", body=f"Source: {r['source']}\nRole: {r['title']}\n"
                                               f"Harvey draft {r['harvey_draft_id']}")
        have = {d["channel"] for d in db.get_person(conn, pid)["drafts"]}
        lang = r["language"] or "nl"
        if r["email_body"] and "email" not in have:
            body = r["email_body"].strip() + SIGNATURE + "\n\n" + OPT_OUT.get(lang, OPT_OUT["en"])
            db.create_draft(conn, pid, "email", subject=r["email_subject"], body=body)
            drafts += 1
        if r["linkedin_message"] and "linkedin" not in have:
            body = r["linkedin_note"].strip() + "\n\n" + r["linkedin_message"].strip()
            db.create_draft(conn, pid, "linkedin", body=body)
            drafts += 1
    print(f"CRM: {made} people added, {drafts} drafts on Today ({config.DB_PATH})")


if __name__ == "__main__":
    main(sys.argv[1])
