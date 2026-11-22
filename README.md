# Vinea CRM

A small local tool for running Vinea's outreach: who you are talking to,
what you are pitching them, what to do today, and how to run each meeting.
It is a Python + SQLite web app that runs on your own laptop and opens in the
browser. There are no accounts and no cloud database. The data stays in one
file on disk.

Status: in daily use by one person (the author). It is built for that one
user, so there is no login, no multi-user mode and no settings screen beyond
the calendar address.

## What leaves the laptop

The database and call recordings never do. A few features do talk to the
internet:

- **Draft with Claude** and **Suggest ✓/✗** pipe the person's details or the
  call transcript through the local `claude` CLI (Anthropic).
- The **calendar** feature fetches your Google Calendar's private iCal address.
- The page loads its fonts from Google Fonts.

Everything else, including sending, is done by you: the CRM opens your mail
client, LinkedIn or WhatsApp with the text filled in.

## Setup

Needs Python 3.11 or newer.

```bash
git clone https://github.com/krishaanth5831/vinea-crm.git
cd vinea-crm
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt -r requirements-dev.txt
```

`requirements.txt` is what the app needs (FastAPI, uvicorn,
python-multipart); `requirements-dev.txt` adds pytest and httpx for the tests.

Optional extras:

- `.venv/bin/pip install faster-whisper` to transcribe call recordings on
  your machine (openai-whisper also works if it is installed instead).
- The `claude` CLI (Claude Code) on your PATH, logged in, for drafts and ✓/✗ suggestions. Without it those buttons
  are disabled and you write by hand.

## Run it

```bash
.venv/bin/python crm.py            # starts http://127.0.0.1:5566 and opens it in your browser
.venv/bin/python crm.py --no-open  # just the server; open http://127.0.0.1:5566 yourself
```

Stop it with Ctrl+C. The server only listens on 127.0.0.1, so nothing else on
the network can reach it.

A running server keeps the Python code it started with. After pulling changes,
restart it (Ctrl+C, then run it again). The page files in `static/` are
re-read on every load, so a browser reload picks those up.

### Settings (environment variables)

| Variable | Default | What it does |
| --- | --- | --- |
| `CRM_DB` | `data/crm.db` | Path of the SQLite database file. |
| `CRM_PORT` | `5566` | Port of the web app. |
| `CRM_WHISPER_MODEL` | `small` | Whisper model size used for transcription. |

To try things out without touching your real data, run a second copy on
another port with its own database:

```bash
CRM_PORT=5567 CRM_DB=/tmp/crm-demo.db .venv/bin/python crm.py
```

## Where the data lives

- `data/crm.db`: the database (people, timeline, drafts, hypotheses,
  evidence, insights, settings). Created on first start; older databases are
  upgraded in place when the app opens them.
- `data/calls/`: call recordings dropped into *Log a call*.

The whole `data/` folder and every `*.db` file are git-ignored. Back up
`data/crm.db` by copying it while the app is stopped.

The Friday export writes into Markdown files outside the repo: one Progress
log per Vinea module in an Obsidian vault, at the path set by `VAULT_MODULES`
in `crm/config.py`. If a module's file is not there, the export skips it and
says which ones were missing.

## The screens

**Today**: one list to tick off. Drafts waiting for approval (edit inline,
open in mail or copy for LinkedIn, mark sent, skip) and follow-ups that are
due, growers first. Tabs filter by track. Marking a draft sent logs it on the
timeline, bumps the person to *contacted* and, if nothing else is planned,
books a follow-up a week out (a call if there is a phone number on file). On
Fridays the week's review sits on top, with a button that appends the week's
call insights to each module's Progress log in the vault.

**People**: a board per track (growers, engineers, labs, angels), one column
per stage, drag a card to move it. A card opens a drawer: name, company,
track, stage, *reach via* (the platform you use with them), next step and
date, contact details, referrals, timeline.

**Channels**: every touch on a timeline says what happened (note, message,
call, visit, meeting) and where (email, LinkedIn, WhatsApp, phone, video, in
person). Drafts are written for email, LinkedIn or WhatsApp and land on the
timeline on that channel when marked sent. A LinkedIn draft has two boxes:
the connection note (up to 300 characters) and the message for after they
accept; marking the note sent puts the message back on Today to wait. Each
person has a preferred channel, guessed from the first contact detail if you
do not set it; the board card shows it as a small icon (or the channel of the
last touch). The top-bar ring and the Friday review break the week down by
platform.

**Hypotheses**: one card per guess. Dots fill green as calls confirm it and
red as they contradict it; past five one-sided calls the status flips to
*holding* or *disproved*. *Revise* closes a guess and opens the next version
linked to it, so the chain reads as "X conversations, what I found, how I
changed".

**Resources**: one guide per step of the growers ladder: discovery call,
demo, criteria meeting, site visit, letter of intent walk-through, then
"after the signature" and "keeping them warm". Each guide says what to talk
about, the questions (bold ones first, with a copy button), what the meeting
must end with, what to send afterwards and what to do before the next
meeting. A person's drawer links to the guide for their next step, and a
guide lists who has it next. The growers board runs in the same order: call,
demo, pilot scope (the criteria meeting), visit, LOI. The text lives in
`crm/resources.py`; edit it there and restart.

## The two actions

**Log a call** (`L`): pick the person, drop the recording (transcribed
locally) or paste the transcript, press *Suggest* and Claude fills in a
summary, a ✓/✗ per hypothesis with a quote, the names they referred you to,
module insights and the next step. Nothing is written until you press *Save
call*. Referrals become people due today, with who referred them.

**Approve a draft**: drafts come from *Draft with Claude* on a person (the
track briefs in `crm/config.py` carry the rules: no numbers, solo founder,
growers never hear about data, growers outside the Netherlands get a video
call only) or are written by hand. Sending is still yours: *Open in mail*
hands the text to your mail client, *Copy + open LinkedIn* puts it on the
clipboard, *Open in WhatsApp* opens a wa.me link with the text filled in.

## Calendar

Paste your Google Calendar's *secret address in iCal format* (Settings → your
calendar → Integrate calendar) under *Calendar settings* (Ctrl+K). Today then
shows this week's events with the people they match, a person's drawer shows
what is planned with them, and *Add to calendar* next to a next step opens
Google Calendar with the event prefilled. Read-only otherwise: nothing is
written to the calendar behind your back.

## Keys

`1` `2` `3` `4` screens · `N` new person · `L` log a call · `H` new
hypothesis · `Ctrl+K` or `/` search · `Esc` close. Everything also works with
the mouse.

## Importing a batch

`scripts/import_harvey_growers.py` loads a review CSV exported from the
Harvey outreach agent: one person per row, plus an email draft and a LinkedIn
draft where an address or profile is on file. It writes to the database the
app uses (`CRM_DB` if set), so point it at a copy first if you are unsure.

```bash
.venv/bin/python scripts/import_harvey_growers.py review.csv --track growers
```

`--track` is one of growers, engineers, labs, angels (Harvey's "investors"
also lands on angels). Re-running it does not duplicate people or drafts.

## Tests

```bash
.venv/bin/python -m pytest -q
```

Every test builds its own database in a temporary folder and stubs out the
`claude` CLI, the calendar fetch and the vault, so the suite never touches
`data/` or the network. It takes about a second.

If pytest fails at start-up with an import error from an unrelated package
(a system-wide `PYTHONPATH`, for example from ROS, can load foreign pytest
plugins), run it in a clean environment:

```bash
env -u PYTHONPATH PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 .venv/bin/python -m pytest -q
```

## Layout

```
crm.py              starts the server and opens the browser
crm/config.py       tracks, stages, modules, thresholds, draft briefs, paths, env vars
crm/db.py           SQLite schema, upgrades for older databases, every read/write
crm/app.py          FastAPI routes (thin; logic lives in the modules below)
crm/calls.py        transcribe, extract ✓/✗ with Claude, draft with Claude
crm/calendar.py     read the Google Calendar iCal feed, match events to people
crm/resources.py    the stage guides shown on the Resources screen
crm/vault.py        Friday export into 08 Modules/<NAME>/(C) <NAME> Index.md
static/             index.html, style.css, app.js (plain JS, no build step)
scripts/            import_harvey_growers.py (batch import from Harvey)
tests/test_crm.py   pytest, end to end through the HTTP API
requirements.txt    app dependencies; requirements-dev.txt adds the test tools
.github/workflows/  only-dev-into-main: pull requests into main must come from dev
data/               crm.db + call recordings (git-ignored, created on first run)
```

## License

Source-available, not open source. Copyright (c) 2026 Krishaanth Ramaraj, all
rights reserved except as granted in [LICENSE](LICENSE), which is the
PolyForm Strict License 1.0.0. In short: you may read and run the code for
personal or other noncommercial purposes; commercial use, modification and
redistribution need a separate written license.
