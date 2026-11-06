"""
Fixed choices for the CRM. Everything the app treats as a "list of allowed
values" lives here so the front end and the server agree.

Design (2026-11-05): three screens, four tracks, hypotheses as first-class
records, two key actions (log a call, approve a draft). Keep this small.
"""

import os
from pathlib import Path

# Where the SQLite file and call recordings live. Both are git-ignored.
# CRM_DB=/some/path overrides the database file (handy for a demo or a test).
DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DB_PATH = Path(os.environ.get("CRM_DB") or DATA_DIR / "crm.db")
AUDIO_DIR = DATA_DIR / "calls"

# The four outreach tracks. Each has its own ladder of stages; the People
# board shows one column per stage. 'closed' means stop contacting.
TRACKS = ["growers", "engineers", "labs", "angels"]

STAGES = {
    # growers: email then phone; call -> visit -> demo -> pilot scope -> LOI
    "growers":   ["new", "contacted", "call", "visit", "demo", "pilot", "loi", "closed"],
    # engineers: give-first; goal is someone who reviews the approach and stays an ally
    "engineers": ["new", "contacted", "replied", "call", "reviewing", "ally", "closed"],
    # labs: what data / evals would they want; partner on an eval suite
    "labs":      ["new", "contacted", "replied", "call", "eval", "partner", "closed"],
    # angels: relationship + monthly update first; ask only after grower LOIs
    "angels":    ["new", "contacted", "relationship", "updates", "asked", "committed", "closed"],
}

# Labels for the stage names that are not self-explanatory.
STAGE_LABELS = {
    "pilot": "pilot scope",
    "loi": "LOI",
    "eval": "eval spec",
    "updates": "monthly updates",
    "reviewing": "reviewing us",
}

# Vinea module names; call insights get tagged with one so they can be
# appended to that module's Progress log in the vault.
MODULES = ["SPINE", "BLUSH", "SHEAR", "HOIST", "RAVEN"]

# Kinds of touch on a person's timeline: WHAT happened.
TOUCH_KINDS = ["note", "message", "call", "visit", "meeting"]

# Channels: WHERE it happened. Every touch except a plain note carries one, a
# draft is written for one, and a person has a preferred one ("reach via").
CHANNELS = ["email", "linkedin", "whatsapp", "phone", "video", "in person"]

# The channel a kind of touch uses unless the user picks another.
DEFAULT_CHANNEL = {"note": "", "message": "email", "call": "phone",
                   "visit": "in person", "meeting": "in person"}

# Channels you can write a draft for (the ones that carry text).
DRAFT_CHANNELS = ["email", "linkedin", "whatsapp"]

HYPOTHESIS_STATUSES = ["untested", "holding", "disproved", "revised"]

# ~5 agreeing calls -> holding; ~5 disagreeing -> disproved (design threshold).
EVIDENCE_THRESHOLD = 5

# After a message is marked sent with no next step set, a follow-up lands on
# Today this many days later.
FOLLOW_UP_DAYS = 7

# Vault folder where the Friday export appends module insights.
VAULT_VINEA = Path.home() / "Desktop/personal_projects/k7_ideaverse_2.0/03 Projects/Vinea"
VAULT_MODULES = VAULT_VINEA / "08 Modules"

# Pace: the "Lucas-max" target of touches per week (messages + calls). The
# ring in the top bar fills towards it.
WEEKLY_TOUCH_TARGET = 100

# Port for the local web app. CRM_PORT=5567 runs a second copy beside it.
PORT = int(os.environ.get("CRM_PORT") or 5566)

# What Claude is told when it drafts a message for a track. Rules that apply
# to every track come first; the per-track brief says what the message is for.
DRAFT_RULES = """
You write short outreach messages for Krishaanth Ramaraj, a TU/e electrical
engineering student and the solo founder of Vinea (greenhouse robotics,
getvinea.nl). Rules that never bend:
- No numbers of any kind in the body: no percentages, counts, prices, dates.
- Never claim pilots, customers, a finished robot or any traction.
- Present Krishaanth as a solo founder. Mention no cofounder.
- Plain words, no marketing cadence, no exclamation marks, no flattery.
- One ask, easy to say yes to. Offer to work around their schedule.
- Write in the person's language (nl / de / fr / en). Use the formal register
  unless the language is English.
- End with just the name 'Krishaanth' on its own line. No title, no company
  line, no links.
- LinkedIn connection notes must fit in 280 characters. LinkedIn messages and
  emails stay under 120 words. WhatsApp messages stay under 60 words and read
  like a text, not a letter.
"""

TRACK_BRIEFS = {
    "growers": """
Greenhouse growers (tomato, pepper, cucumber under glass). The message starts
a conversation, it does not sell. Krishaanth no longer describes the robot to
growers because polite yeses taught him nothing; he asks one thing: what
automation have they already been shown, and why didn't they buy it? Ask for
a short call. Dutch growers may also be offered a visit to their greenhouse.
Growers outside the Netherlands get a video call only, never a visit.
Leave out: data, labs, investors, funding, competitors, any robot claim.
""",
    "engineers": """
Robotics and horticulture engineers (research groups, R&D teams, open-source
authors). Give first: Krishaanth has public simulations of greenhouse tasks
(deleafing and harvesting, repos S.H.E.A.R and B.L.U.S.H on GitHub) and
wants their critique. Open with one sharp, specific question about their own
paper, repo or product, then ask whether they would review his approach in a
short call. No pitch, no funding talk.
""",
    "labs": """
Robot foundation-model labs and other buyers of robot data. Ask what
greenhouse data or evaluations would actually be useful to them. Offer an
evaluation suite built from his MuJoCo greenhouse scenes. Say plainly that no
real-world data capture has run yet. Ask for a short call to learn what they
would want.
""",
    "angels": """
Angel investors who backed robotics or agtech, exited founders, operator
syndicates. The goal is a relationship and permission to send a short monthly
update. Do not ask for money. Share what he is learning from growers in one
line and ask whether they would be open to a short call or to receiving the
update.
""",
}
