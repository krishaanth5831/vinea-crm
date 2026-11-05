"""
Friday export: append each unexported insight to its module's Progress log
in the vault (`08 Modules/<NAME>/(C) <NAME> Index.md`), newest first, in the
same `- **YYYY-MM-DD**: text` form the logs already use.
"""

import re
from pathlib import Path

from . import config


def index_path(module: str) -> Path:
    return config.VAULT_MODULES / module / f"(C) {module} Index.md"


def _entry(ins: dict) -> str:
    who = ins.get("person_name") or ""
    company = ins.get("company") or ""
    src = f" ({who}{', ' + company if company else ''})" if who else ""
    day = ins["created_at"][:10]
    return f"- **{day}**: Call{src}: {ins['text'].strip()}"


def append_insights(insights: list[dict]) -> dict:
    """Write the entries. Returns {module: n} for what landed, and 'missing'
    for modules whose index file could not be found."""
    written: dict[str, int] = {}
    missing: list[str] = []
    by_module: dict[str, list[dict]] = {}
    for ins in insights:
        by_module.setdefault(ins["module"], []).append(ins)
    for module, items in by_module.items():
        path = index_path(module)
        if not path.exists():
            missing.append(module)
            continue
        text = path.read_text(encoding="utf-8")
        lines = "\n".join(_entry(i) for i in items)
        m = re.search(r"^## Progress[ \t]*\n+", text, flags=re.M)
        if m:
            text = text[:m.end()] + lines + "\n" + text[m.end():]
        else:
            text = text.rstrip("\n") + "\n\n## Progress\n\n" + lines + "\n"
        path.write_text(text, encoding="utf-8")
        written[module] = len(items)
    return {"written": written, "missing": missing}
