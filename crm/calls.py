"""
The two helpers behind "log a call" and "draft a message".

    transcribe(path)   audio file -> text, with faster-whisper if installed
    extract(...)       transcript -> suggested ✓/✗, next step, referrals, insights
    draft(...)         person + track -> a message to approve

Claude is reached through the `claude` CLI already on this machine, so no API
key is needed. Both Claude helpers return plain dicts; the front end shows
them as suggestions and nothing is written until the user confirms.
"""

import json
import os
import re
import shutil
import subprocess
from pathlib import Path

from . import config


# ----------------------------------------------------------- transcribe ----

def transcription_backend() -> str:
    """Which transcriber would run right now; '' when none is installed."""
    try:
        import faster_whisper  # noqa: F401
        return "faster-whisper"
    except Exception:
        pass
    try:
        import whisper  # noqa: F401
        return "openai-whisper"
    except Exception:
        pass
    return ""


def transcribe(path: Path, language: str = "") -> str:
    """Return the transcript of an audio file. Raises RuntimeError when no
    transcriber is installed; the message says what to install."""
    backend = transcription_backend()
    lang = language if language in ("nl", "en", "de", "fr") else None
    if backend == "faster-whisper":
        from faster_whisper import WhisperModel
        model = WhisperModel(os.environ.get("CRM_WHISPER_MODEL", "small"),
                             device="cpu", compute_type="int8")
        segments, _ = model.transcribe(str(path), language=lang, vad_filter=True)
        return " ".join(s.text.strip() for s in segments).strip()
    if backend == "openai-whisper":
        import whisper
        model = whisper.load_model(os.environ.get("CRM_WHISPER_MODEL", "small"))
        return model.transcribe(str(path), language=lang)["text"].strip()
    raise RuntimeError(
        "No transcriber installed. Run `pip install faster-whisper` once, "
        "or paste the transcript by hand.")


# --------------------------------------------------------------- claude ----

def claude_available() -> bool:
    return shutil.which("claude") is not None


def run_claude(prompt: str, timeout: int = 180) -> str:
    """Run the local `claude` CLI non-interactively and return its text."""
    if not claude_available():
        raise RuntimeError("The `claude` CLI is not on PATH.")
    env = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}
    proc = subprocess.run(
        ["claude", "-p", "--output-format", "text"],
        input=prompt, capture_output=True, text=True, timeout=timeout, env=env,
        cwd=str(Path.home()))
    if proc.returncode != 0:
        raise RuntimeError((proc.stderr or proc.stdout).strip()[-400:] or "claude failed")
    return proc.stdout.strip()


def parse_json(text: str) -> dict:
    """Pull the first JSON object out of a model reply."""
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.S)
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("no JSON object in reply")
    return json.loads(text[start:end + 1])


# -------------------------------------------------------------- extract ----

EXTRACT_PROMPT = """You are helping a founder log a customer-discovery call.
Read the transcript and reply with ONE JSON object and nothing else:

{{
  "summary": "<3-5 plain sentences on what was said and decided>",
  "next_step": "<one short action for the founder, or ''>",
  "next_date": "<ISO date for that action, or ''>",
  "verdicts": [
    {{"hypothesis_id": <id>, "verdict": "yes" | "no", "quote": "<short verbatim quote that supports it>"}}
  ],
  "referrals": [
    {{"name": "<person the speaker suggested talking to>", "company": "<company or ''>"}}
  ],
  "insights": [
    {{"module": "SPINE" | "BLUSH" | "SHEAR" | "HOIST" | "RAVEN", "text": "<one concrete takeaway for that module>"}}
  ]
}}

Rules: only include a verdict for a hypothesis the speaker clearly agreed or
disagreed with; skip the rest. Quotes must be verbatim from the transcript.
Modules: SPINE = rail base platform, BLUSH = harvesting, SHEAR = deleafing
and pruning, HOIST = lowering and rehanging, RAVEN = scouting. Write the
summary in English even if the call was not. Today is {today}.

Call with {name} ({company}, track: {track}).

Hypotheses pitched on this call (id: claim):
{hypotheses}

Transcript:
\"\"\"
{transcript}
\"\"\"
"""


def extract(transcript: str, person: dict, hypotheses: list[dict], today: str) -> dict:
    hyp_lines = "\n".join(f"{h['id']}: {h['claim']}" for h in hypotheses) or "(none)"
    prompt = EXTRACT_PROMPT.format(
        today=today, name=person["name"], company=person.get("company") or "",
        track=person["track"], hypotheses=hyp_lines, transcript=transcript.strip())
    out = parse_json(run_claude(prompt))
    valid_ids = {h["id"] for h in hypotheses}
    verdicts = [v for v in out.get("verdicts", [])
                if v.get("hypothesis_id") in valid_ids and v.get("verdict") in ("yes", "no")]
    insights = [i for i in out.get("insights", []) if i.get("module") in config.MODULES and i.get("text")]
    referrals = [r for r in out.get("referrals", []) if (r.get("name") or "").strip()]
    return {
        "summary": out.get("summary", ""),
        "next_step": out.get("next_step", ""),
        "next_date": out.get("next_date", ""),
        "verdicts": verdicts,
        "referrals": referrals,
        "insights": insights,
    }


# ---------------------------------------------------------------- draft ----

DRAFT_PROMPT = """{rules}

Track brief:
{brief}

Write a {what} for this person:
- name: {name}
- company: {company}
- language: {language}
- what we know about them: {about}

Reply with ONE JSON object and nothing else:
{{"subject": "<email subject, or '' for LinkedIn>", "body": "<the message>"}}
"""


def draft(person: dict, channel: str, about: str = "") -> dict:
    what = {
        "email": "short email",
        "linkedin": "LinkedIn message (a connection note under 280 characters, "
                    "then a blank line, then the first message to send once connected)",
    }[channel]
    prompt = DRAFT_PROMPT.format(
        rules=config.DRAFT_RULES.strip(), brief=config.TRACK_BRIEFS[person["track"]].strip(),
        what=what, name=person["name"], company=person.get("company") or "(unknown)",
        language=person.get("language") or "en", about=about.strip() or "(nothing yet)")
    out = parse_json(run_claude(prompt))
    body = (out.get("body") or "").strip()
    if re.search(r"\d", body):
        # the no-numbers rule is absolute: strip digits rather than ship them
        body = re.sub(r"\d+", "", body)
    return {"subject": (out.get("subject") or "").strip() if channel == "email" else "",
            "body": body}
