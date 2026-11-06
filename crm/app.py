"""
HTTP layer: a small JSON API over db.py plus the static front end.

Run with `python3 crm.py`. Every route is thin; logic lives in db.py,
calls.py and vault.py.
"""

import shutil
import uuid
from datetime import date
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import calls, config, db, vault

STATIC = Path(__file__).resolve().parent.parent / "static"


def create_app(db_path=None) -> FastAPI:
    app = FastAPI(title="Vinea CRM", docs_url=None, redoc_url=None)
    conn = db.connect(db_path)
    app.state.conn = conn

    @app.exception_handler(ValueError)
    async def bad_value(_, exc):
        return JSONResponse({"error": str(exc)}, status_code=400)

    @app.exception_handler(KeyError)
    async def not_found(_, exc):
        return JSONResponse({"error": "not found"}, status_code=404)

    @app.exception_handler(RuntimeError)
    async def failed(_, exc):
        return JSONResponse({"error": str(exc)}, status_code=503)

    # ------------------------------------------------------------ meta ----
    @app.get("/api/meta")
    def meta():
        return {
            "tracks": config.TRACKS, "stages": config.STAGES, "stage_labels": config.STAGE_LABELS,
            "modules": config.MODULES, "touch_kinds": config.TOUCH_KINDS,
            "channels": config.CHANNELS, "default_channel": config.DEFAULT_CHANNEL,
            "draft_channels": config.DRAFT_CHANNELS,
            "hypothesis_statuses": config.HYPOTHESIS_STATUSES,
            "threshold": config.EVIDENCE_THRESHOLD, "today": db.today(),
            "is_friday": date.today().weekday() == 4,
            "transcriber": calls.transcription_backend(),
            "claude": calls.claude_available(),
        }

    # ----------------------------------------------------------- today ----
    @app.get("/api/today")
    def today():
        return db.today_items(conn)

    @app.get("/api/pulse")
    def pulse():
        return db.pulse(conn)

    @app.get("/api/week")
    def week():
        return db.week_summary(conn)

    @app.post("/api/people/{pid}/done")
    async def done(pid: int, req: Request):
        d = await req.json()
        if not db.get_person(conn, pid):
            raise KeyError(pid)
        return db.mark_done(conn, pid, note=d.get("note", ""), kind=d.get("kind", "note"),
                            next_step=d.get("next_step", ""), next_date=d.get("next_date", ""),
                            channel=d.get("channel"))

    # ---------------------------------------------------------- people ----
    @app.get("/api/people")
    def people(track: str | None = None):
        return db.list_people(conn, track)

    @app.get("/api/search")
    def search(q: str = ""):
        return db.search_people(conn, q) if q.strip() else []

    @app.post("/api/people")
    async def create_person(req: Request):
        return db.create_person(conn, await req.json())

    @app.get("/api/people/{pid}")
    def get_person(pid: int):
        p = db.get_person(conn, pid)
        if not p:
            raise KeyError(pid)
        return p

    @app.patch("/api/people/{pid}")
    async def update_person(pid: int, req: Request):
        return db.update_person(conn, pid, await req.json())

    @app.delete("/api/people/{pid}")
    def delete_person(pid: int):
        db.delete_person(conn, pid)
        return {"ok": True}

    @app.post("/api/people/{pid}/touches")
    async def add_touch(pid: int, req: Request):
        d = await req.json()
        if not db.get_person(conn, pid):
            raise KeyError(pid)
        return db.add_touch(conn, pid, d.get("kind", "note"), body=d.get("body", ""),
                            transcript=d.get("transcript", ""), at=d.get("at"),
                            channel=d.get("channel"))

    @app.delete("/api/touches/{tid}")
    def delete_touch(tid: int):
        db.delete_touch(conn, tid)
        return {"ok": True}

    # ---------------------------------------------------------- drafts ----
    @app.get("/api/drafts")
    def drafts(status: str = "pending"):
        return db.list_drafts(conn, status)

    @app.post("/api/people/{pid}/drafts")
    async def create_draft(pid: int, req: Request):
        d = await req.json()
        if not db.get_person(conn, pid):
            raise KeyError(pid)
        return db.create_draft(conn, pid, d.get("channel", "email"),
                               subject=d.get("subject", ""), body=d.get("body", ""))

    @app.post("/api/people/{pid}/drafts/generate")
    async def generate_draft(pid: int, req: Request):
        d = await req.json()
        p = db.get_person(conn, pid)
        if not p:
            raise KeyError(pid)
        channel = d.get("channel", "email")
        if channel not in config.DRAFT_CHANNELS:
            raise ValueError(f"channel must be one of {', '.join(config.DRAFT_CHANNELS)}")
        out = calls.draft(p, channel, about=d.get("about", ""))
        return db.create_draft(conn, pid, channel, subject=out["subject"], body=out["body"])

    @app.patch("/api/drafts/{did}")
    async def update_draft(did: int, req: Request):
        return db.update_draft(conn, did, await req.json())

    # ------------------------------------------------------ hypotheses ----
    @app.get("/api/hypotheses")
    def hypotheses(all: int = 1):
        return db.list_hypotheses(conn, include_revised=bool(all))

    @app.post("/api/hypotheses")
    async def create_hypothesis(req: Request):
        return db.create_hypothesis(conn, await req.json())

    @app.patch("/api/hypotheses/{hid}")
    async def update_hypothesis(hid: int, req: Request):
        if not db.get_hypothesis(conn, hid):
            raise KeyError(hid)
        return db.update_hypothesis(conn, hid, await req.json())

    @app.delete("/api/hypotheses/{hid}")
    def delete_hypothesis(hid: int):
        db.delete_hypothesis(conn, hid)
        return {"ok": True}

    @app.post("/api/hypotheses/{hid}/revise")
    async def revise(hid: int, req: Request):
        d = await req.json()
        claim = (d.get("claim") or "").strip()
        if not claim:
            raise ValueError("claim is required")
        return db.revise_hypothesis(conn, hid, claim)

    @app.post("/api/hypotheses/{hid}/evidence")
    async def add_evidence(hid: int, req: Request):
        d = await req.json()
        if not db.get_hypothesis(conn, hid):
            raise KeyError(hid)
        return db.add_evidence(conn, hid, d.get("verdict", ""), quote=d.get("quote", ""),
                               person_id=d.get("person_id") or None, touch_id=d.get("touch_id") or None)

    @app.delete("/api/evidence/{eid}")
    def delete_evidence(eid: int):
        db.delete_evidence(conn, eid)
        return {"ok": True}

    # ----------------------------------------------------------- calls ----
    @app.post("/api/calls/transcribe")
    async def transcribe(file: UploadFile, language: str = ""):
        config.AUDIO_DIR.mkdir(parents=True, exist_ok=True)
        suffix = Path(file.filename or "call").suffix or ".audio"
        dest = config.AUDIO_DIR / f"{db.today()}-{uuid.uuid4().hex[:8]}{suffix}"
        with dest.open("wb") as fh:
            shutil.copyfileobj(file.file, fh)
        text = calls.transcribe(dest, language)
        return {"transcript": text, "audio_path": str(dest)}

    @app.post("/api/calls/extract")
    async def extract(req: Request):
        d = await req.json()
        p = db.get_person(conn, int(d.get("person_id") or 0))
        if not p:
            raise KeyError("person")
        transcript = (d.get("transcript") or "").strip()
        if not transcript:
            raise ValueError("transcript is empty")
        active = [h for h in db.list_hypotheses(conn, include_revised=False)]
        return calls.extract(transcript, p, active, db.today())

    @app.post("/api/calls/confirm")
    async def confirm(req: Request):
        """Write everything the user confirmed from a logged call."""
        d = await req.json()
        pid = int(d.get("person_id") or 0)
        p = db.get_person(conn, pid)
        if not p:
            raise KeyError("person")
        touch = db.add_touch(conn, pid, d.get("kind", "call"), body=d.get("summary", ""),
                             transcript=d.get("transcript", ""), audio_path=d.get("audio_path", ""),
                             channel=d.get("channel"))
        for v in d.get("verdicts", []):
            db.add_evidence(conn, int(v["hypothesis_id"]), v["verdict"], quote=v.get("quote", ""),
                            person_id=pid, touch_id=touch["id"])
        for i in d.get("insights", []):
            db.add_insight(conn, i["module"], i["text"], person_id=pid, touch_id=touch["id"])
        made = []
        for r in d.get("referrals", []):
            made.append(db.create_person(conn, {
                "name": r["name"], "company": r.get("company", ""),
                "track": r.get("track") or p["track"], "referred_by": pid,
                "next_step": f"Reach out (via {p['name']})", "next_date": db.today()}))
        upd = {}
        if "next_step" in d:
            upd["next_step"] = d.get("next_step", "")
        if "next_date" in d:
            upd["next_date"] = d.get("next_date", "")
        if d.get("stage"):
            upd["stage"] = d["stage"]
        if upd:
            db.update_person(conn, pid, upd)
        return {"touch": touch, "referrals": made, "person": db.get_person(conn, pid)}

    # -------------------------------------------------------- insights ----
    @app.get("/api/insights")
    def insights(pending: int = 0):
        return db.list_insights(conn, unexported_only=bool(pending))

    @app.delete("/api/insights/{iid}")
    def delete_insight(iid: int):
        db.delete_insight(conn, iid)
        return {"ok": True}

    @app.post("/api/insights/export")
    def export_insights():
        pending = db.list_insights(conn, unexported_only=True)
        if not pending:
            return {"written": {}, "missing": [], "count": 0}
        result = vault.append_insights(pending)
        done_ids = [i["id"] for i in pending if i["module"] in result["written"]]
        db.mark_insights_exported(conn, done_ids)
        result["count"] = len(done_ids)
        return result

    # ---------------------------------------------------------- static ----
    @app.get("/")
    def index():
        return FileResponse(STATIC / "index.html")

    app.mount("/static", StaticFiles(directory=str(STATIC)), name="static")
    return app
