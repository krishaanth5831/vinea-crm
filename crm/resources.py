"""
Stage guides for the Resources screen: one document per step of a track's
ladder, saying what to talk about, what to ask, what the meeting must end
with, what to send afterwards and what to do before the next one.

The text lives here, in code, so it is versioned with the app and needs no
database table. To change a guide, edit this file and restart the CRM.

Each guide is a dict:
  id          short name, used in the URL-less state of the front end
  track       which track it belongs to (only growers have guides so far)
  step        1..n for a meeting, None for a guide that spans the ladder
  title       shown on the step button and as the page heading
  goal        one sentence under the heading
  done_stage  the board column a person moves to once this meeting is done
  next_for    board columns for which this guide is the NEXT thing to do;
              the person drawer links to it from those columns
  sections    ordered blocks; see the helpers below for the four kinds

Source: the vault note "(C) Meeting Playbook — Discovery Call to Signed LOI"
(2026-11-15). Keep the two in step when one changes.
"""

from . import config


# ------------------------------------------------------------- helpers ----
def _text(title, body, side=False):
    """A paragraph."""
    return {"kind": "text", "title": title, "text": body, "side": side}


def _list(title, items, side=False):
    """A plain bulleted list."""
    return {"kind": "list", "title": title, "items": list(items), "side": side}


def _questions(items, title="Questions"):
    """Interview questions. Start an item with '*' to mark it 'ask first'."""
    out = []
    for q in items:
        first = q.startswith("*")
        out.append({"q": q.lstrip("* ").strip(), "first": first})
    return {"kind": "questions", "title": title, "items": out, "side": False}


def _ask(say, failed, title="End the meeting with"):
    """The closing ask, in words to say, and how to tell the meeting failed."""
    return {"kind": "ask", "title": title, "say": say, "failed": failed, "side": True}


# -------------------------------------------------------------- growers ----
GROWERS = [
    {
        "id": "discovery", "track": "growers", "step": 1,
        "title": "Discovery call",
        "goal": "Learn which job hurts, what they already tried, and who decides.",
        "done_stage": "call", "next_for": ["new", "contacted"],
        "sections": [
            _text("What to talk about",
                  "Their greenhouse, not Vinea. Introduce yourself in one sentence, then ask about "
                  "things that already happened: last week, last season, the last machine they "
                  "turned down. Avoid \"would you use a robot that…\", because people answer "
                  "hypotheticals politely. Listen for three things: which job hurts most, how they "
                  "solve it today, and who decides on new equipment. Near the end, test one or two "
                  "hypotheses as \"We think X. Is that true for you?\""),
            _questions([
                "* Which jobs take the most crew hours in a normal week?",
                "* Which job is hardest to finish on time? What happened the last time it slipped?",
                "* What automation have you tried or been shown? Why did you say no, or stop using it?",
                "How do you staff that job today, and how has that changed in the last few years?",
                "How long before a new person does it to your standard?",
                "If one job were taken off your hands tomorrow, which one, and why?",
                "Who is involved when you bring in a new machine or supplier? How did the last decision go?",
                "When in the year do you plan next season's labour and investments?",
            ]),
            _text("Listen for",
                  "A problem they have already tried to fix. If they never looked for a fix, it is "
                  "not a real pain. Praise for the idea tells you nothing."),
            _list("Before the meeting", [
                "Look up the company, the crop, the size, and any press about robot trials there.",
                "Pick one or two hypotheses to test.",
                "Have two dates ready to offer for the demo.",
            ], side=True),
            _ask("Can I show you what we're building for that job next week? Who else should see it?",
                 "No date in the calendar, or \"send me something and I'll have a look.\""),
            _list("Deliverables", [
                "Recap message the same day: what you heard in their words, what you agreed, the demo date.",
                "The call logged here, with a ✓ or ✗ on each hypothesis and a quote.",
                "A synthesis note in the vault within the hour.",
                "Anyone they named, added as a person and due today.",
            ], side=True),
            _list("Before the next meeting", [
                "Cut the demo down to the one job they named.",
                "List the figures you need from them in the demo.",
                "Send the calendar invite, with the other people they named on it.",
            ], side=True),
            _list("Keep them warm", [
                "The demo should be within a week or two, so the recap is enough.",
                "If the demo slips, send one thing that came up in the call: an answer you promised, or a short clip of their job.",
            ], side=True),
            _list("Numbers to bring back", [
                "Area and crop.",
                "People per hectare, peak and quiet months.",
                "Which jobs take which share of the hours.",
                "How long their last machine decision took, and how many people were in it.",
            ], side=True),
        ],
    },
    {
        "id": "demo", "track": "growers", "step": 2,
        "title": "Demo",
        "goal": "Show the simulation on their job and collect how they measure that job today.",
        "done_stage": "demo", "next_for": ["call"],
        "sections": [
            _text("What to talk about",
                  "Open by repeating what they told you and checking it still holds. Show only the "
                  "job they named, and say plainly that it is a simulation. Stop often and ask what "
                  "would fail in their greenhouse; the objections are worth more than the praise. "
                  "Then move to how they measure the job today, because those figures become the "
                  "test the robot has to pass."),
            _questions([
                "* Last time you said this job was the biggest problem. Is that still true?",
                "* What in this video would not work in your greenhouse?",
                "* How fast does a good worker do this job, and how do you measure it?",
                "What would worry you most about a machine doing this in your crop?",
                "Which mistakes cost you the most?",
                "Could a machine work at night or at weekends here? What would stand in the way?",
                "What would it have to do for you to give it one path?",
                "How would you expect to pay for something like this: buy, rent, or per kilo?",
            ]),
            _text("Listen for",
                  "The unit they judge by: hours per path, kilos per hour, whether the crew finishes "
                  "earlier, whether overtime goes down. Use their unit from now on."),
            _list("Before the meeting", [
                "One chapter of the demo, not the whole system.",
                "Their own words from the discovery call, ready to quote back.",
                "The list of figures you need.",
            ], side=True),
            _ask("I'll turn your figures into a pass or fail test. Can we go through it on a set date, with whoever would decide?",
                 "They liked it and gave no figures, or the next meeting has no date."),
            _list("Deliverables", [
                "Recap message the same day.",
                "A pass or fail sheet built from their figures, sent within two days.",
                "At most five questions with it. Keep the rest for the meeting.",
            ], side=True),
            _list("Before the next meeting", [
                "Check what each figure covers: walking, trolleys, best worker or average.",
                "Draft the one-page letter of intent, in case the person who signs attends.",
                "Ask that whoever would sign joins.",
            ], side=True),
            _list("Keep them warm", [
                "Sending the sheet is the touch. It shows their figures were used.",
                "If the criteria meeting is more than two weeks out, send one progress note against one of their figures.",
            ], side=True),
            _list("Numbers to bring back", [
                "Speed per job, average and best worker, and what it includes.",
                "Shift length, days per week, overtime and weekend work.",
                "Rounds per week per job.",
                "Whether nights and weekends are possible for a machine.",
            ], side=True),
        ],
    },
    {
        "id": "criteria", "track": "growers", "step": 3,
        "title": "Criteria meeting",
        "goal": "Agree what \"it works\" means and what follows a pass, with the person who signs.",
        "done_stage": "pilot", "next_for": ["demo"],
        "sections": [
            _text("What to talk about",
                  "What \"it works\" means, in their units, before any robot arrives. Go through "
                  "each figure and check what it covers. Pick one job. Then talk about what happens "
                  "after a pass: who decides, what they would need to see, and roughly what the job "
                  "costs them today. Ask who signs and which site in the first five minutes, "
                  "because the rest depends on it."),
            _questions([
                "* Who would sign something like this for your company?",
                "* Which site and which section are we talking about?",
                "* If one robot does one person's week of that job at your quality, is that a pass? If not, what is?",
                "Does this speed include walking and moving trolleys, or only the handwork? Is it an average worker or your best?",
                "Which one job would you start with?",
                "Which quality line matters most, and what is your own crew's rate on it?",
                "If it passes, what happens next on your side?",
                "What does that job cost you today, per kilo, per plant or per hour?",
                "What could stop this even if the robot passes?",
                "Have you signed a trial agreement or letter of intent before? Who checked it?",
            ]),
            _text("Listen for",
                  "A contact who likes the idea and cannot decide. Pilots stall on exactly that. "
                  "If the person who signs is missing, the ask becomes a meeting with them."),
            _list("Before the meeting", [
                "The sheet open and editable, so figures are corrected on screen.",
                "The one-page letter of intent ready, in case the signer is there.",
                "The price sentence ready: rent per robot, below what the job costs in labour today, final after the pilot.",
            ], side=True),
            _ask("Can I come and see the path? And I'll put this on one page. Can we read it together on a set date?",
                 "The bar is still vague, or you still don't know who signs."),
            _list("Deliverables", [
                "Recap message with the agreed bar, in their numbers.",
                "The updated sheet.",
                "The letter of intent, written from what they said.",
            ], side=True),
            _list("Before the next meeting", [
                "Ask what to wear and bring for their hygiene routine.",
                "List what to measure on site.",
                "Abroad, replace the visit with a video walk-through of one path with the crew lead.",
            ], side=True),
            _list("Keep them warm", [
                "Send the recalculated bar within a few days, so they see their corrections landed.",
                "One question only they can answer, about a design choice their answer changes.",
            ], side=True),
            _list("Numbers to bring back", [
                "All-in cost of a worker per hour.",
                "Cost of the job per kilo, per plant or per hectare.",
                "Their own error rate on the job.",
                "The payback they expect on a machine.",
            ], side=True),
        ],
    },
    {
        "id": "visit", "track": "growers", "step": 4,
        "title": "Site visit",
        "goal": "See the job, the path and the hygiene routine, and ask for access.",
        "done_stage": "visit", "next_for": ["pilot"],
        "sections": [
            _text("What to talk about",
                  "Mostly watch and listen. Ask the crew lead to show the job at normal pace and to "
                  "explain what they look at before each cut or pick. Measure the path and note what "
                  "a robot would meet. Ask about hygiene before touching anything, and follow their "
                  "routine exactly. This is the moment to ask for access to their crop."),
            _questions([
                "* Can you show me the job at normal pace?",
                "* What is your hygiene routine between compartments? What would a machine have to follow?",
                "* Where could a machine be tested with the least risk to your crop?",
                "What do you look at before you cut, pick or lower? When do you break your own rule?",
                "What goes wrong most often, and how do you spot it?",
                "How wide is the path, and is there pipe rail in every one?",
                "Where do trolleys and crates go, and where is there power and wifi?",
                "What happens in this section at night and at weekends?",
                "Who would be my contact day to day?",
                "Could I spend a day or a week here doing the job myself and recording it, under your rules?",
            ]),
            _text("Listen for",
                  "Fear of crop damage. Offer the low-risk forms: one row under their crew lead, or "
                  "plants about to be cleared at crop change. Only you are filmed until consent "
                  "for the crew is settled."),
            _list("Before the meeting", [
                "What to wear and bring for hygiene, confirmed with them.",
                "Tape measure, and the phone for photos. Ask before taking any.",
                "The question list.",
            ], side=True),
            _ask("Can we read the letter together on a set date?",
                 "You saw the greenhouse and have no next date and no access."),
            _list("Deliverables", [
                "Thank-you note with two things you learned on site.",
                "The final letter of intent, one page plus the criteria.",
                "Photos and measurements filed in the vault.",
            ], side=True),
            _list("Before the next meeting", [
                "Put what you saw into the letter: the site, the section, the one job.",
                "Send the letter a day ahead, so nothing in it is a surprise.",
            ], side=True),
            _list("Keep them warm", [
                "The thank-you note is the touch.",
                "If you noticed something useful for them on site, say it.",
            ], side=True),
            _list("Numbers to bring back", [
                "Path width and length, pipe-rail gauge and diameter.",
                "Paths per hectare, wire height, working height of the job.",
                "Trolley and crate sizes.",
                "Time one path takes, per job.",
            ], side=True),
        ],
    },
    {
        "id": "loi", "track": "growers", "step": 5,
        "title": "Letter of intent walk-through",
        "goal": "Read the page together and ask for the signature.",
        "done_stage": "loi", "next_for": ["visit"],
        "sections": [
            _text("What to talk about",
                  "Read the page together, section by section, on a call or in person. Don't email "
                  "it and wait. Pause after each part and change the wording on the spot if they "
                  "object. Say clearly what it is: not binding, no payment now, either side can "
                  "stop. Then ask for the signature directly. If they hesitate, find out what is in "
                  "the way and agree a smaller step the same day."),
            _questions([
                "* Does this say what we agreed? What is wrong or missing?",
                "* Is there anything preventing us from signing this week?",
                "Is the pass line one you are comfortable judging the robot against?",
                "Would your owner, accountant or lawyer object to anything here?",
                "Can we name your company, or only \"a tomato grower\"?",
                "If not yet: what would need to change?",
                "If still not: what smaller step can we agree today?",
                "How often do you want a progress update, and who else should come to the first test?",
                "Who else should I talk to?",
            ]),
            _text("Listen for",
                  "Which clause they slow down on. If it is the rent clause, fall back in order: "
                  "rent intent with a paid last stage, rent intent without payment, then the pass "
                  "or fail bar with a named signer only."),
            _list("Before the meeting", [
                "The letter as a PDF they can sign.",
                "An editable copy for changes during the call.",
                "The smaller steps you would accept: named as first test site, site access, an introduction.",
            ], side=True),
            _ask("Is there anything preventing us from signing this week?",
                 "No signature and no smaller step with a date on it."),
            _list("Deliverables", [
                "The signed copy sent back to them the same day.",
                "A date for the first progress update.",
                "The stage moved to LOI here, with the next update as the next step.",
            ], side=True),
            _list("Before the next meeting", [
                "There is no next meeting on the ladder. Switch to the \"After the signature\" guide.",
            ], side=True),
            _list("Keep them warm", [
                "Ask how they want updates: phone, WhatsApp or email, and how often.",
            ], side=True),
            _list("Numbers to bring back", [
                "How many robots they would rent if it passes.",
                "The month their budget for next year is set.",
            ], side=True),
        ],
    },
    {
        "id": "after", "track": "growers", "step": None,
        "title": "After the signature",
        "goal": "Hold the relationship through the months until a robot can be tested at their site.",
        "done_stage": "", "next_for": ["loi"],
        "sections": [
            _text("What this period is",
                  "The letter is signed and the robot is not ready. The wait is set by the build, "
                  "not by selling. The risk is silence: a grower who hears nothing for three months "
                  "has forgotten what they signed. Every touch reports progress against a figure "
                  "they gave, or asks them something only they can answer."),
            _list("Every month: progress, plans, problems", [
                "Progress: where the robot stands against their pass line, in their unit, with one short clip of their job.",
                "Plans: what happens next, with a date.",
                "Problems: one thing you are stuck on that they can help with. This is the ask.",
                "Three to five short lines in all, on the channel they chose.",
            ]),
            _list("Milestones to invite them to", [
                "The first run on hardware.",
                "The entry test, away from their crop. Ask them to witness it.",
                "A visit to the workshop, or a call from it.",
            ]),
            _list("Asks that keep the commitment alive", [
                "One introduction to another grower.",
                "A capture day or week in their crop, under their rules.",
                "A date window for the supervised pilot, tied to their season.",
            ], side=True),
            _list("Stop and ask if", [
                "Two updates go unanswered. Call, and ask whether the plan still stands.",
                "The contact leaves the company. Ask who takes over before they go.",
                "Their season or crop plan changes. Recheck the figures the bar rests on.",
            ], side=True),
        ],
    },
    {
        "id": "warm", "track": "growers", "step": None,
        "title": "Keeping them warm",
        "goal": "Give every grower a real reason to hear from you, from the first call to the pilot.",
        "done_stage": "", "next_for": [],
        "sections": [
            _text("The idea",
                  "A grower stays warm when contact has a reason: a test, a result, a question about "
                  "their greenhouse. Dusty Robotics kept its first customers through a whole year "
                  "of rough prototypes by coming back every month with a test and an improvement "
                  "built on last month's feedback. Copy the loop, not the frequency: something "
                  "they said, what you did with it, what you need from them next."),
            _list("What a touch can carry", [
                "Progress against a figure they gave you.",
                "A short clip of the job they named.",
                "A question only they can answer, where the answer changes the design.",
                "What other growers asked for, without names: \"three growers want X, would it matter to you?\"",
                "Something useful to them: an introduction, an answer you promised, a result from another site.",
                "An invitation: the first hardware run, the entry test, a demo day.",
                "A visit, when you are near.",
            ]),
            _list("Rhythm by phase", [
                "Between meetings 1 and 5: the dated next meeting is the thread. Add one touch only if the gap passes two weeks.",
                "After the signature: one update a month, plus an invitation at every milestone.",
                "Said \"not now\": one note a quarter with one concrete result, and ask again at each milestone.",
                "Never twice in one week unless they replied.",
            ]),
            _list("Ask them, don't guess", [
                "In the first or second meeting: \"How do you want to hear from me, and how often?\" Set it as Reach via.",
                "\"Which weeks should I leave you alone?\" Crop change and planting are busy; ask rather than assume.",
                "In their busy weeks, help or stay quiet. Don't ask for anything.",
            ], side=True),
            _list("In this CRM", [
                "Every touch ends with a next step and a date, so the person shows up on Today.",
                "Log the touch on their timeline with the channel you used.",
                "A grower past the discovery call with no date is going cold. Give them one.",
            ], side=True),
            _list("Signs they are cooling", [
                "Replies get shorter or slower.",
                "A meeting moves twice.",
                "Your contact stops bringing in the person who decides.",
                "Then call and ask plainly whether the plan still makes sense for them.",
            ], side=True),
            _list("Don't", [
                "Send a message with nothing new in it.",
                "Build for one grower's wishes only. Check each request against the others.",
                "Sound in a hurry. Growers notice.",
                "Mention data licensing, investors or other growers by name.",
            ], side=True),
        ],
    },
]


GUIDES = GROWERS


def guides(track=None):
    """All guides, or the ones for one track."""
    return [g for g in GUIDES if not track or g["track"] == track]


def check():
    """Raise if a guide points at a board column that does not exist."""
    seen = set()
    for g in GUIDES:
        if g["id"] in seen:
            raise ValueError(f"duplicate guide id {g['id']}")
        seen.add(g["id"])
        stages = config.STAGES[g["track"]]
        for s in [g["done_stage"], *g["next_for"]]:
            if s and s not in stages:
                raise ValueError(f"guide {g['id']} names unknown stage {s}")
