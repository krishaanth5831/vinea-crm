# Vinea CRM

A three-screen local tool for running Vinea's outreach: who you are talking to,
what you are pitching them, and what to do today. Python + SQLite, opens in the
browser, nothing leaves the laptop.

```
python3 crm.py          # starts http://127.0.0.1:5566 and opens it
python3 crm.py --no-open
```

Needs Python 3.11+ with `fastapi`, `uvicorn` and `python-multipart` (already on
this machine). Optional: `pip install faster-whisper` to transcribe call
recordings; the `claude` CLI on PATH to get draft messages and ✓/✗ suggestions.

## The three screens

**Today** — one list to tick off. Drafts waiting for approval (edit inline, open
in mail or copy for LinkedIn, mark sent, skip) and follow-ups that are due.
Marking a draft sent logs it on the timeline, bumps the person to *contacted*
and books a follow-up a week out. On Fridays the week's review sits on top, with
a button that appends the week's call insights to each module's Progress log in
the vault.

**People** — a board per track (growers, engineers, labs, angels), one column per
stage, drag a card to move it. A card opens a drawer: name, company, track,
stage, next step and date, contact details, referrals, timeline.

**Hypotheses** — one card per guess. Dots fill green as calls confirm it and red
as they contradict it; past five one-sided calls the status flips to *holding*
or *disproved*. *Revise* closes a guess and opens the next version linked to it,
so the chain reads as "X conversations, what I found, how I changed".

## The two actions

**Log a call** (`L`) — pick the person, drop the recording (transcribed locally
with faster-whisper) or paste the transcript, press *Suggest* and Claude fills
in a summary, a ✓/✗ per hypothesis with a quote, the names they referred you
to, module insights and the next step. Nothing is written until you press
*Save call*. Referrals become people due today, with who referred them.

**Approve a draft** — drafts come from *Draft with Claude* on a person (the
track briefs in `crm/config.py` carry the rules: no numbers, solo founder,
growers never hear the data line, non-Dutch growers get a video call only) or
are written by hand. Sending is still yours: *Open in mail* hands the text to
your mail client, *Copy + open LinkedIn* puts it on the clipboard.

## Keys

`1` `2` `3` screens · `N` new person · `L` log a call · `H` new hypothesis ·
`Ctrl+K` or `/` search · `Esc` close. Everything also works with the mouse.

## Layout

```
crm.py            launcher
crm/config.py     tracks, stages, modules, thresholds, draft briefs, paths
crm/db.py         SQLite schema and every read/write
crm/calls.py      transcribe, extract ✓/✗ with Claude, draft with Claude
crm/vault.py      Friday export into 08 Modules/<NAME>/(C) <NAME> Index.md
crm/app.py        FastAPI routes
static/           index.html, style.css, app.js (no build step)
tests/            pytest, run with:  python3 -m pytest -q
data/             crm.db + call recordings (git-ignored)
```
