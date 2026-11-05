/* Vinea CRM front end. Three screens, one drawer, one modal, one palette.
   No framework: every screen is a render function that writes into #main. */

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const state = { meta: null, screen: "today", track: "growers", openDraft: null, openDue: null, openHyp: null, drawerId: null };

// ------------------------------------------------------------------ api --
async function api(method, url, body) {
  const opts = { method, headers: {} };
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
  const r = await fetch(url, opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || r.statusText);
  return data;
}
const get = (u) => api("GET", u);

function toast(msg, err = false) {
  const t = document.createElement("div");
  t.className = "toast" + (err ? " err" : "");
  t.textContent = msg;
  $("#toasts").appendChild(t);
  setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity .3s"; setTimeout(() => t.remove(), 300); }, err ? 4000 : 2200);
}
const guard = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { toast(e.message, true); } };

// -------------------------------------------------------------- helpers --
const stageLabel = (s) => state.meta.stage_labels[s] || s;
const fmtDate = (iso) => {
  if (!iso) return "";
  const d = new Date(iso.slice(0, 10) + "T00:00:00");
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
};
const fmtWhen = (iso) => {
  const d = new Date(iso.replace(" ", "T"));
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" }) + " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
};
const isOverdue = (iso) => iso && iso < state.meta.today;
const options = (list, cur, label = (x) => x) => list.map((x) => `<option value="${esc(x)}" ${x === cur ? "selected" : ""}>${esc(label(x))}</option>`).join("");
const trackOpts = (cur) => options(state.meta.tracks, cur);
const stageOpts = (track, cur) => options(state.meta.stages[track], cur, stageLabel);
const moduleOpts = (cur) => options(state.meta.modules, cur);
const langOpts = (cur) => options(["en", "nl", "de", "fr"], cur || "en");

function setTheme(t) {
  if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  try { t ? localStorage.setItem("theme", t) : localStorage.removeItem("theme"); } catch {}
}
function toggleTheme() {
  const dark = document.documentElement.dataset.theme === "dark" || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
  setTheme(dark ? "light" : "dark");
}

// ---------------------------------------------------------------- nav ----
function show(screen) {
  if (screen !== state.screen) { state.openDraft = null; state.openDue = null; state.openHyp = null; }
  state.screen = screen;
  $$("#nav button").forEach((b) => b.classList.toggle("active", b.dataset.screen === screen));
  $("#main").className = screen === "people" ? "wide" : "";
  try { localStorage.setItem("screen", screen); } catch {}
  render();
}
async function render() {
  const main = $("#main");
  if (state.screen === "today") main.innerHTML = await renderToday();
  else if (state.screen === "people") main.innerHTML = await renderPeople();
  else main.innerHTML = await renderHypotheses();
  wire(main);
}

// -------------------------------------------------------------- today ----
async function renderToday() {
  const t = await get("/api/today");
  const d = new Date(t.date + "T00:00:00");
  const friday = state.meta.is_friday ? await renderReview() : "";
  const drafts = t.drafts.map((x) => draftItem(x)).join("");
  const due = t.due.map((x) => dueItem(x)).join("");
  const up = t.upcoming.map((x) => `<div class="item" data-open-person="${x.id}"><span class="muted small">${fmtDate(x.next_date)}</span><div><span class="title">${esc(x.name)}</span> <span class="sub">${esc(x.company)}</span><div class="sub">${esc(x.next_step)}</div></div><span class="chip">${esc(x.track)}</span></div>`).join("");
  const empty = !t.drafts.length && !t.due.length;
  return `<div class="screen">
    <h1>Today</h1>
    <p class="muted">${d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</p>
    ${friday}
    ${empty ? `<div class="empty"><strong>Nothing to tick off.</strong>Add a person, write a draft, or log a call.</div>` : ""}
    ${t.drafts.length ? `<h2>Drafts to approve · ${t.drafts.length}</h2><div class="list" id="drafts">${drafts}</div>` : ""}
    ${t.due.length ? `<h2>Due · ${t.due.length}</h2><div class="list" id="due">${due}</div>` : ""}
    ${t.upcoming.length ? `<h2>Coming up</h2><div class="list">${up}</div>` : ""}
  </div>`;
}

function draftItem(x) {
  const open = state.openDraft === x.id;
  const to = x.channel === "email" ? (x.to_email || "no email on file") : (x.to_linkedin ? "LinkedIn" : "no LinkedIn on file");
  const body = open ? `<div class="expand">
      ${x.channel === "email" ? `<div class="field"><label>Subject</label><input data-f="subject" value="${esc(x.subject)}"></div>` : ""}
      <div class="field"><label>Message</label><textarea data-f="body" rows="8">${esc(x.body)}</textarea></div>
      <div class="actions">
        ${x.channel === "email"
          ? `<button class="primary" data-act="open-mail" ${x.to_email ? "" : "disabled"}>Open in mail</button>`
          : `<button class="primary" data-act="open-linkedin">Copy + open LinkedIn</button>`}
        <button data-act="copy">Copy</button>
        <span class="spacer"></span>
        <button data-act="sent">Mark sent</button>
        <button class="ghost" data-act="skip">Skip</button>
      </div></div>` : "";
  return `<div class="item ${open ? "open" : ""}" data-draft="${x.id}" data-email="${esc(x.to_email)}" data-linkedin="${esc(x.to_linkedin)}" data-channel="${x.channel}">
    <span class="chip accent">${x.channel}</span>
    <div><span class="title">${esc(x.name)}</span> <span class="sub">${esc(x.company)}</span><div class="sub">${esc(x.subject || x.body.slice(0, 90))}</div></div>
    <span class="sub">${esc(to)}</span>${body}</div>`;
}

function dueItem(x) {
  const open = state.openDue === x.id;
  const body = open ? `<div class="expand">
      <div class="field"><label>What happened?</label><textarea data-f="note" rows="3" placeholder="Short note for the timeline (optional)"></textarea></div>
      <div class="row">
        <div class="field"><label>Logged as</label><select data-f="kind">${options(state.meta.touch_kinds, "note")}</select></div>
        <div class="field"><label>Next step</label><input data-f="next_step" placeholder="e.g. Call to set a visit"></div>
        <div class="field"><label>When</label><input type="date" data-f="next_date"></div>
      </div>
      <div class="actions"><button class="primary" data-act="done-save">Done</button><button data-act="log-call-here">Log a call instead</button><span class="spacer"></span><button class="ghost" data-open-person="${x.id}">Open person</button></div>
    </div>` : "";
  return `<div class="item ${open ? "open" : ""}" data-due="${x.id}">
    <button class="tick" title="Done"></button>
    <div><span class="title">${esc(x.name)}</span> <span class="sub">${esc(x.company)}</span><div class="sub">${esc(x.next_step || "Follow up")}</div></div>
    <span class="chip ${isOverdue(x.next_date) ? "overdue" : ""}">${isOverdue(x.next_date) ? "overdue · " : ""}${fmtDate(x.next_date)}</span>${body}</div>`;
}

async function renderReview() {
  const w = await get("/api/week");
  const n = (k) => (w.touches.find((t) => t.kind === k) || { c: 0 }).c;
  const callsN = n("call") + n("visit") + n("meeting");
  const sentN = n("email") + n("linkedin");
  const byTrack = {};
  w.by_track.forEach((r) => { byTrack[r.track] = (byTrack[r.track] || 0) + r.c; });
  const yes = w.evidence.filter((e) => e.verdict === "yes").length, no = w.evidence.length - yes;
  return `<div class="card review">
    <h3>Friday review · since ${fmtDate(w.since)}</h3>
    <div class="stats">
      <div class="stat"><b>${sentN}</b><span>messages sent</span></div>
      <div class="stat"><b>${callsN}</b><span>calls / visits</span></div>
      <div class="stat"><b>${w.moved.length}</b><span>people moved</span></div>
      <div class="stat"><b>${yes} ✓ · ${no} ✗</b><span>hypothesis evidence</span></div>
      <div class="stat"><b>${w.insights.length}</b><span>insights to export</span></div>
    </div>
    ${w.calls.length ? `<p class="small muted">Calls</p><ul>${w.calls.map((c) => `<li><a href="#" data-open-person="${c.person_id}">${esc(c.name)}</a> <span class="muted">${esc(c.company)}</span> — ${esc(c.body.slice(0, 120))}</li>`).join("")}</ul>` : ""}
    ${w.evidence.length ? `<p class="small muted">Evidence</p><ul>${w.evidence.map((e) => `<li><b class="${e.verdict === "yes" ? "" : ""}">${e.verdict === "yes" ? "✓" : "✗"}</b> ${esc(e.claim)} <span class="muted">— ${esc(e.person_name || "")}</span></li>`).join("")}</ul>` : ""}
    ${w.insights.length ? `<p class="small muted">Insights waiting for the vault</p><ul>${w.insights.map((i) => `<li><span class="chip">${i.module}</span> ${esc(i.text)}</li>`).join("")}</ul>` : ""}
    <div class="actions"><button class="primary" data-act="export" ${w.insights.length ? "" : "disabled"}>Export insights to vault</button><span class="muted small">People: ${Object.entries(byTrack).map(([k, v]) => `${k} ${v}`).join(" · ") || "none yet"}</span></div>
  </div>`;
}

// -------------------------------------------------------------- people ----
async function renderPeople() {
  const all = await get("/api/people");
  const counts = {};
  all.forEach((p) => { counts[p.track] = (counts[p.track] || 0) + 1; });
  const tabs = state.meta.tracks.map((t) => `<button class="${t === state.track ? "active" : ""}" data-track="${t}">${t}<span class="count">${counts[t] || 0}</span></button>`).join("");
  const people = all.filter((p) => p.track === state.track);
  const cols = state.meta.stages[state.track].map((s) => {
    const cards = people.filter((p) => p.stage === s).map(pcard).join("");
    return `<div class="col" data-stage="${s}"><h3><span>${esc(stageLabel(s))}</span><span>${people.filter((p) => p.stage === s).length || ""}</span></h3>${cards}</div>`;
  }).join("");
  return `<div class="screen">
    <div class="actions"><h1>People</h1><span class="spacer"></span><button class="primary" data-act="new-person">+ Person<kbd>N</kbd></button></div>
    <div class="tabs">${tabs}</div>
    ${all.length ? "" : `<div class="empty"><strong>No one yet.</strong>Press N to add the first person.</div>`}
    <div class="board">${cols}</div>
  </div>`;
}
function pcard(p) {
  const od = isOverdue(p.next_date);
  return `<div class="pcard" draggable="true" data-person="${p.id}">
    <div class="name">${esc(p.name)}</div>
    ${p.company ? `<div class="company">${esc(p.company)}</div>` : ""}
    ${p.next_step || p.next_date ? `<div class="next ${od ? "overdue" : ""}">${p.next_date ? `<b>${fmtDate(p.next_date)}</b>` : ""}<span>${esc(p.next_step)}</span></div>` : ""}
  </div>`;
}

// ---------------------------------------------------------- hypotheses ----
async function renderHypotheses() {
  const hs = await get("/api/hypotheses");
  const live = hs.filter((h) => h.status !== "revised"), old = hs.filter((h) => h.status === "revised");
  return `<div class="screen">
    <div class="actions"><h1>Hypotheses</h1><span class="spacer"></span><button class="primary" data-act="new-hyp">+ Hypothesis<kbd>H</kbd></button></div>
    <p class="muted">Pitch one to three on every call: "We think X. Is that true for you?" Dots fill as people agree or disagree.</p>
    ${hs.length ? "" : `<div class="empty"><strong>No guesses yet.</strong>Write down what you believe before the next call.</div>`}
    <div class="hgrid">${live.map(hcard).join("")}</div>
    ${old.length ? `<h2>Revised</h2><div class="hgrid">${old.map(hcard).join("")}</div>` : ""}
  </div>`;
}
function dots(n, cls, thr) {
  const slots = Math.max(thr, n);
  let s = `<div class="dotrow ${cls}"><span class="lbl">${cls === "yes" ? "✓" : "✗"}</span>`;
  for (let i = 0; i < Math.min(slots, thr); i++) s += `<span class="d ${i < n ? "on" : ""}"></span>`;
  if (n > thr) s += `<span class="more">+${n - thr}</span>`;
  return s + "</div>";
}
function hcard(h) {
  const open = state.openHyp === h.id;
  const thr = state.meta.threshold;
  const status = { untested: "", holding: "accent", disproved: "no", revised: "" }[h.status];
  const body = open ? `<div class="evidence">
      ${h.evidence.length ? h.evidence.map((e) => `<div class="ev"><span class="v ${e.verdict}">${e.verdict === "yes" ? "✓" : "✗"}</span><div>${e.quote ? `<q>${esc(e.quote)}</q><br>` : ""}<span class="muted small">${esc(e.person_name || "unknown")}${e.company ? ", " + esc(e.company) : ""} · ${fmtDate(e.created_at)}</span></div><button class="link" data-act="del-ev" data-ev="${e.id}">×</button></div>`).join("") : `<p class="muted small">No evidence yet.</p>`}
      <div class="row" style="margin-top:.8rem">
        <div class="field"><label>Add evidence</label><div class="seg" data-f="verdict"><button class="yes on" data-v="yes">✓</button><button class="no" data-v="no">✗</button></div></div>
        <div class="field" style="flex:2"><label>Who said it</label><input data-f="person" list="people-dl" placeholder="Start typing a name"></div>
      </div>
      <div class="field"><label>Quote</label><input data-f="quote" placeholder="Their words, verbatim"></div>
      <div class="actions">
        <button class="primary" data-act="add-ev">Add</button>
        <span class="spacer"></span>
        <select data-f="status" style="width:auto">${options(state.meta.hypothesis_statuses, h.status)}</select>
        <button data-act="revise">Revise…</button>
        <button class="link danger" data-act="del-hyp">Delete</button>
      </div>
      <div class="field" data-revise-box style="display:none;margin-top:.6rem"><label>New version of this claim</label><div class="row"><input data-f="revised" placeholder="What you believe now"><button class="primary" data-act="revise-save" style="flex:0">Save</button></div></div>
    </div>` : "";
  return `<div class="card hcard ${open ? "open" : ""} ${h.status === "revised" ? "revised" : ""}" data-hyp="${h.id}">
    <div class="actions"><span class="chip ${status}">${h.status}</span>${h.track ? `<span class="chip">${esc(h.track)}</span>` : ""}${h.module ? `<span class="chip">${esc(h.module)}</span>` : ""}${h.revised_from ? `<span class="muted small">from #${h.revised_from}</span>` : ""}</div>
    <div class="claim">${esc(h.claim)}</div>
    <div class="dots">${dots(h.yes, "yes", thr)}${dots(h.no, "no", thr)}</div>
    ${h.source ? `<p class="muted small" style="margin-top:.5rem">${esc(h.source)}</p>` : ""}
    ${body}</div>`;
}

// ---------------------------------------------------------------- wire ----
function wire(main) {
  // tabs
  $$("[data-track]", main).forEach((b) => b.onclick = () => { state.track = b.dataset.track; try { localStorage.setItem("track", state.track); } catch {} render(); });
  // open person
  $$("[data-open-person]", main).forEach((el) => el.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); openDrawer(+el.dataset.openPerson); }));
  // drafts
  $$("[data-draft]", main).forEach((it) => {
    const id = +it.dataset.draft;
    it.addEventListener("click", (e) => {
      if (e.target.closest("button, input, textarea, select")) return;
      state.openDraft = state.openDraft === id ? null : id; render();
    });
    const vals = () => ({ subject: $("[data-f=subject]", it)?.value ?? "", body: $("[data-f=body]", it)?.value ?? "" });
    const save = guard(async (status) => {
      await api("PATCH", `/api/drafts/${id}`, { ...vals(), status });
      it.classList.add("gone"); state.openDraft = null;
      toast(status === "sent" ? "Marked sent, follow-up booked" : "Skipped");
      setTimeout(render, 350);
    });
    $$("[data-act]", it).forEach((b) => b.onclick = guard(async (e) => {
      e.stopPropagation();
      const v = vals(), act = b.dataset.act;
      if (act === "copy") { await navigator.clipboard.writeText(v.body); toast("Copied"); }
      else if (act === "open-mail") {
        await api("PATCH", `/api/drafts/${id}`, v);
        location.href = `mailto:${encodeURIComponent(it.dataset.email)}?subject=${encodeURIComponent(v.subject)}&body=${encodeURIComponent(v.body)}`;
      } else if (act === "open-linkedin") {
        await api("PATCH", `/api/drafts/${id}`, v);
        await navigator.clipboard.writeText(v.body); toast("Copied. Paste it on LinkedIn.");
        if (it.dataset.linkedin) window.open(it.dataset.linkedin, "_blank");
      } else if (act === "sent") save("sent");
      else if (act === "skip") save("skipped");
    }));
  });
  // due
  $$("[data-due]", main).forEach((it) => {
    const id = +it.dataset.due;
    $(".tick", it).onclick = (e) => { e.stopPropagation(); $(".tick", it).classList.toggle("on"); state.openDue = state.openDue === id ? null : id; render(); };
    it.addEventListener("click", (e) => { if (e.target.closest("button, input, textarea, select, .expand")) return; openDrawer(id); });
    $$("[data-act]", it).forEach((b) => b.onclick = guard(async (e) => {
      e.stopPropagation();
      if (b.dataset.act === "done-save") {
        await api("POST", `/api/people/${id}/done`, { note: $("[data-f=note]", it).value, kind: $("[data-f=kind]", it).value, next_step: $("[data-f=next_step]", it).value, next_date: $("[data-f=next_date]", it).value });
        it.classList.add("gone"); state.openDue = null; toast("Done"); setTimeout(render, 350);
      } else if (b.dataset.act === "log-call-here") { state.openDue = null; openCallModal(id); }
    }));
    if (state.openDue === id) { $(".tick", it).classList.add("on"); $("[data-f=note]", it).focus(); }
  });
  // export
  const ex = $("[data-act=export]", main);
  if (ex) ex.onclick = guard(async () => {
    const r = await api("POST", "/api/insights/export");
    const parts = Object.entries(r.written).map(([m, n]) => `${m} ${n}`);
    toast(r.count ? `Appended to vault: ${parts.join(", ")}` : "Nothing to export");
    if (r.missing.length) toast(`No index file for ${r.missing.join(", ")}`, true);
    render();
  });
  // people
  $("[data-act=new-person]", main) && ($("[data-act=new-person]", main).onclick = () => openPersonModal());
  $$(".pcard", main).forEach((c) => {
    c.onclick = () => openDrawer(+c.dataset.person);
    c.addEventListener("dragstart", (e) => { c.classList.add("dragging"); e.dataTransfer.setData("text/plain", c.dataset.person); e.dataTransfer.effectAllowed = "move"; });
    c.addEventListener("dragend", () => c.classList.remove("dragging"));
  });
  $$(".col", main).forEach((col) => {
    col.addEventListener("dragover", (e) => { e.preventDefault(); col.classList.add("over"); });
    col.addEventListener("dragleave", () => col.classList.remove("over"));
    col.addEventListener("drop", guard(async (e) => {
      e.preventDefault(); col.classList.remove("over");
      const id = +e.dataTransfer.getData("text/plain");
      const card = $(`.pcard[data-person="${id}"]`, main);
      if (!card || card.parentElement === col) return;
      col.appendChild(card);
      await api("PATCH", `/api/people/${id}`, { stage: col.dataset.stage });
      toast(`Moved to ${stageLabel(col.dataset.stage)}`);
      render();
    }));
  });
  // hypotheses
  $("[data-act=new-hyp]", main) && ($("[data-act=new-hyp]", main).onclick = () => openHypModal());
  $$("[data-hyp]", main).forEach((card) => {
    const id = +card.dataset.hyp;
    card.addEventListener("click", (e) => { if (e.target.closest("button, input, select, .evidence")) return; state.openHyp = state.openHyp === id ? null : id; render(); });
    const seg = $(".seg", card);
    if (seg) $$("button", seg).forEach((b) => b.onclick = () => { $$("button", seg).forEach((x) => x.classList.remove("on")); b.classList.add("on"); });
    const sel = $("[data-f=status]", card);
    if (sel) sel.onchange = guard(async () => { await api("PATCH", `/api/hypotheses/${id}`, { status: sel.value }); render(); });
    $$("[data-act]", card).forEach((b) => b.onclick = guard(async (e) => {
      e.stopPropagation();
      const act = b.dataset.act;
      if (act === "add-ev") {
        const verdict = $(".seg .on", card).dataset.v;
        const who = $("[data-f=person]", card).value.trim();
        let person_id = null;
        if (who) { const r = await get(`/api/search?q=${encodeURIComponent(who)}`); person_id = r[0]?.id || null; if (!person_id) return toast("No person with that name; add them first", true); }
        await api("POST", `/api/hypotheses/${id}/evidence`, { verdict, quote: $("[data-f=quote]", card).value, person_id });
        toast(verdict === "yes" ? "✓ added" : "✗ added"); render();
      } else if (act === "del-ev") { await api("DELETE", `/api/evidence/${b.dataset.ev}`); render(); }
      else if (act === "revise") { const box = $("[data-revise-box]", card); box.style.display = ""; $("[data-f=revised]", card).focus(); }
      else if (act === "revise-save") {
        const claim = $("[data-f=revised]", card).value.trim(); if (!claim) return;
        const n = await api("POST", `/api/hypotheses/${id}/revise`, { claim }); state.openHyp = n.id; toast("Revised"); render();
      } else if (act === "del-hyp") { if (!confirm("Delete this hypothesis and its evidence?")) return; await api("DELETE", `/api/hypotheses/${id}`); state.openHyp = null; render(); }
    }));
    const rv = $("[data-f=revised]", card);
    if (rv) rv.onkeydown = (e) => { if (e.key === "Enter") $("[data-act=revise-save]", card).click(); };
  });
  refreshDatalist();
}

async function refreshDatalist() {
  let dl = $("#people-dl");
  if (!dl) { dl = document.createElement("datalist"); dl.id = "people-dl"; document.body.appendChild(dl); }
  const all = await get("/api/people");
  dl.innerHTML = all.map((p) => `<option value="${esc(p.name)}">${esc(p.company)}</option>`).join("");
}

// -------------------------------------------------------------- drawer ----
async function openDrawer(id) {
  const p = await get(`/api/people/${id}`).catch(() => null);
  if (!p) return toast("Person not found", true);
  state.drawerId = id;
  const dr = $("#drawer");
  const touches = p.touches.map((t) => `<div class="touch"><span class="when">${fmtWhen(t.at)}</span><div><span class="chip">${t.kind}</span> <span class="body">${esc(t.body)}</span>${t.transcript ? `<details><summary>transcript</summary><pre>${esc(t.transcript)}</pre></details>` : ""}</div><button class="link" data-del-touch="${t.id}">×</button></div>`).join("");
  const ev = p.evidence.map((e) => `<div class="ev"><span class="v ${e.verdict}">${e.verdict === "yes" ? "✓" : "✗"}</span><div>${esc(e.claim)}${e.quote ? `<br><q>${esc(e.quote)}</q>` : ""}</div><span></span></div>`).join("");
  dr.innerHTML = `
    <div class="head"><div style="flex:1"><input class="big" data-f="name" value="${esc(p.name)}" placeholder="Name"><input class="co" data-f="company" value="${esc(p.company)}" placeholder="Company"></div><button class="icon close" data-act="close">×</button></div>
    <div class="row">
      <div class="field"><label>Track</label><select data-f="track">${trackOpts(p.track)}</select></div>
      <div class="field"><label>Stage</label><select data-f="stage">${stageOpts(p.track, p.stage)}</select></div>
    </div>
    <div class="row">
      <div class="field" style="flex:2"><label>Next step</label><input data-f="next_step" value="${esc(p.next_step)}" placeholder="What happens next"></div>
      <div class="field"><label>When</label><input type="date" data-f="next_date" value="${esc(p.next_date)}"></div>
    </div>
    <details ${p.email || p.linkedin ? "" : "open"}><summary class="muted small" style="cursor:pointer;margin-bottom:.5rem">Contact · ${esc(p.email || p.linkedin || p.phone || "none yet")}</summary>
      <div class="row"><div class="field"><label>Email</label><input data-f="email" value="${esc(p.email)}"></div><div class="field"><label>Language</label><select data-f="language">${langOpts(p.language)}</select></div></div>
      <div class="row"><div class="field"><label>LinkedIn</label><input data-f="linkedin" value="${esc(p.linkedin)}" placeholder="https://linkedin.com/in/…"></div><div class="field"><label>Phone</label><input data-f="phone" value="${esc(p.phone)}"></div></div>
    </details>
    ${p.referrer ? `<p class="small muted" style="margin:.5rem 0">Referred by <a href="#" data-open-person="${p.referrer.id}">${esc(p.referrer.name)}</a></p>` : ""}
    ${p.referrals.length ? `<p class="small muted" style="margin:.5rem 0">Referred: ${p.referrals.map((r) => `<a href="#" data-open-person="${r.id}">${esc(r.name)}</a>`).join(", ")}</p>` : ""}
    <div class="actions" style="margin-top:1rem">
      <button class="primary" data-act="call">Log a call</button>
      <button data-act="draft-email">Draft email</button>
      <button data-act="draft-linkedin">Draft LinkedIn</button>
      <button data-act="referral">Who else? +</button>
    </div>
    <div data-ref-box style="display:none;margin-top:.8rem" class="card"><label>They suggested talking to…</label><div class="row"><input data-f="ref_name" placeholder="Name"><input data-f="ref_company" placeholder="Company"><button class="primary" data-act="ref-save" style="flex:0">Add</button></div></div>
    <div class="timeline">
      <h2 style="margin-top:1.4rem">Timeline · ${p.touches.length}</h2>
      ${touches || `<p class="muted small">Nothing yet.</p>`}
      ${ev ? `<h2>Hypotheses</h2>${ev}` : ""}
    </div>
    <p style="margin-top:2rem"><button class="link danger" data-act="delete">Delete person</button></p>`;
  dr.classList.add("show"); $("#drawer-scrim").classList.add("show");
  const close = () => { dr.classList.remove("show"); $("#drawer-scrim").classList.remove("show"); state.drawerId = null; render(); };
  $("[data-act=close]", dr).onclick = close; $("#drawer-scrim").onclick = close;
  // autosave
  const fields = ["name", "company", "track", "stage", "next_step", "next_date", "email", "linkedin", "phone", "language"];
  fields.forEach((f) => { const el = $(`[data-f=${f}]`, dr); el.onchange = guard(async () => {
    const data = { [f]: el.value };
    if (f === "track") data.stage = "new";
    const np = await api("PATCH", `/api/people/${id}`, data);
    if (f === "track") $("[data-f=stage]", dr).innerHTML = stageOpts(np.track, np.stage);
    toast("Saved");
  }); });
  $$("[data-open-person]", dr).forEach((a) => a.onclick = (e) => { e.preventDefault(); openDrawer(+a.dataset.openPerson); });
  $$("[data-del-touch]", dr).forEach((b) => b.onclick = guard(async () => { await api("DELETE", `/api/touches/${b.dataset.delTouch}`); openDrawer(id); }));
  $("[data-act=call]", dr).onclick = () => openCallModal(id);
  $("[data-act=draft-email]", dr).onclick = () => openDraftModal(p, "email");
  $("[data-act=draft-linkedin]", dr).onclick = () => openDraftModal(p, "linkedin");
  $("[data-act=referral]", dr).onclick = () => { const b = $("[data-ref-box]", dr); b.style.display = b.style.display ? "" : "none"; $("[data-f=ref_name]", dr).focus(); };
  $("[data-act=ref-save]", dr).onclick = guard(async () => {
    const name = $("[data-f=ref_name]", dr).value.trim(); if (!name) return;
    await api("POST", "/api/people", { name, company: $("[data-f=ref_company]", dr).value, track: p.track, referred_by: id, next_step: `Reach out (via ${p.name})`, next_date: state.meta.today });
    toast(`${name} added, due today`); openDrawer(id);
  });
  $("[data-act=delete]", dr).onclick = guard(async () => { if (!confirm(`Delete ${p.name} and their timeline?`)) return; await api("DELETE", `/api/people/${id}`); close(); toast("Deleted"); });
}

// --------------------------------------------------------------- modals ----
function openModal(html, narrow = false) {
  const w = $("#modal");
  w.innerHTML = `<div class="modal ${narrow ? "narrow" : ""}">${html}</div>`;
  w.classList.add("show");
  w.onclick = (e) => { if (e.target === w) closeModal(); };
  return $(".modal", w);
}
function closeModal() { $("#modal").classList.remove("show"); $("#modal").innerHTML = ""; }

function openPersonModal(track) {
  const m = openModal(`<h2>New person</h2>
    <div class="row"><div class="field"><label>Name</label><input data-f="name" autofocus></div><div class="field"><label>Company</label><input data-f="company"></div></div>
    <div class="row"><div class="field"><label>Track</label><select data-f="track">${trackOpts(track || state.track)}</select></div><div class="field"><label>Language</label><select data-f="language">${langOpts("en")}</select></div></div>
    <div class="row"><div class="field"><label>Email</label><input data-f="email"></div><div class="field"><label>LinkedIn</label><input data-f="linkedin"></div></div>
    <div class="row"><div class="field" style="flex:2"><label>Next step</label><input data-f="next_step" placeholder="e.g. Send first email"></div><div class="field"><label>When</label><input type="date" data-f="next_date" value="${state.meta.today}"></div></div>
    <div class="actions"><span class="spacer"></span><button class="ghost" data-act="cancel">Cancel</button><button class="primary" data-act="save">Add person</button></div>`, true);
  $("[data-f=name]", m).focus();
  $("[data-act=cancel]", m).onclick = closeModal;
  const save = guard(async () => {
    const d = {}; $$("[data-f]", m).forEach((el) => d[el.dataset.f] = el.value);
    const p = await api("POST", "/api/people", d);
    closeModal(); state.track = p.track; toast(`${p.name} added`); render(); openDrawer(p.id);
  });
  $("[data-act=save]", m).onclick = save;
  m.onkeydown = (e) => { if (e.key === "Enter" && e.target.tagName !== "TEXTAREA") save(); };
}

function openHypModal() {
  const m = openModal(`<h2>New hypothesis</h2>
    <div class="field"><label>We think…</label><textarea data-f="claim" rows="3" placeholder="e.g. Growers would rather rent a robot per season than buy one"></textarea></div>
    <div class="row"><div class="field"><label>Track</label><select data-f="track"><option value="">any</option>${trackOpts("")}</select></div><div class="field"><label>Module</label><select data-f="module"><option value="">none</option>${moduleOpts("")}</select></div></div>
    <div class="field"><label>Where it came from</label><input data-f="source" placeholder="report, a call, own guess"></div>
    <div class="actions"><span class="spacer"></span><button class="ghost" data-act="cancel">Cancel</button><button class="primary" data-act="save">Add</button></div>`, true);
  $("[data-f=claim]", m).focus();
  $("[data-act=cancel]", m).onclick = closeModal;
  $("[data-act=save]", m).onclick = guard(async () => {
    const d = {}; $$("[data-f]", m).forEach((el) => d[el.dataset.f] = el.value);
    const h = await api("POST", "/api/hypotheses", d);
    closeModal(); state.openHyp = h.id; toast("Added"); if (state.screen !== "hypotheses") show("hypotheses"); else render();
  });
}

function openDraftModal(p, channel) {
  const canAI = state.meta.claude;
  const m = openModal(`<h2>Draft ${channel} · ${esc(p.name)}</h2>
    ${canAI ? `<div class="field"><label>Anything Claude should know about them (optional)</label><input data-f="about" placeholder="e.g. grows cherry tomatoes near Westland, posted about labour costs"></div>
    <div class="actions" style="margin-bottom:1rem"><button data-act="ai">Draft with Claude</button><span class="busy" data-busy style="display:none">Writing…</span></div>` : `<p class="muted small" style="margin-bottom:.8rem">The claude CLI is not on PATH, so write it by hand.</p>`}
    ${channel === "email" ? `<div class="field"><label>Subject</label><input data-f="subject"></div>` : ""}
    <div class="field"><label>Message</label><textarea data-f="body" rows="9" placeholder="${channel === "linkedin" ? "Connection note first (under 280 characters), blank line, then the first message." : ""}"></textarea></div>
    <div class="actions"><span class="spacer"></span><button class="ghost" data-act="cancel">Cancel</button><button class="primary" data-act="save">Save for approval</button></div>`);
  $("[data-act=cancel]", m).onclick = closeModal;
  const ai = $("[data-act=ai]", m);
  if (ai) ai.onclick = guard(async () => {
    ai.disabled = true; $("[data-busy]", m).style.display = "";
    try {
      const d = await api("POST", `/api/people/${p.id}/drafts/generate`, { channel, about: $("[data-f=about]", m).value });
      closeModal(); toast("Draft saved to Today"); if (state.screen === "today") render();
    } finally { ai.disabled = false; }
  });
  $("[data-act=save]", m).onclick = guard(async () => {
    const body = $("[data-f=body]", m).value.trim(); if (!body) return toast("Nothing to save", true);
    await api("POST", `/api/people/${p.id}/drafts`, { channel, subject: $("[data-f=subject]", m)?.value || "", body });
    closeModal(); toast("Draft saved to Today"); if (state.screen === "today") render();
  });
}

// ------------------------------------------------------------- log call ----
async function openCallModal(personId) {
  const hyps = (await get("/api/hypotheses?all=0"));
  const person = personId ? await get(`/api/people/${personId}`) : null;
  const tr = state.meta.transcriber;
  const m = openModal(`<h2>Log a call</h2>
    <div class="row">
      <div class="field" style="flex:2"><label>Who</label><input data-f="who" list="people-dl" value="${esc(person?.name || "")}" placeholder="Start typing a name"></div>
      <div class="field"><label>Kind</label><select data-f="kind">${options(["call", "visit", "meeting"], "call")}</select></div>
    </div>
    <div class="drop" data-drop><input type="file" accept="audio/*,video/*"><span data-drop-label>${tr ? `Drop the recording here to transcribe (${tr})` : "Drop a recording here — install faster-whisper to transcribe, or paste the transcript below"}</span></div>
    <div class="field" style="margin-top:.8rem"><label>Transcript or notes</label><textarea data-f="transcript" rows="7" placeholder="Paste the transcript, or type your notes"></textarea></div>
    <div class="actions"><button data-act="suggest" ${state.meta.claude ? "" : "disabled title='claude CLI not found'"}>Suggest ✓ / ✗ with Claude</button><span class="busy" data-busy style="display:none">Reading the call…</span></div>
    <div class="suggest">
      <div class="field"><label>Summary for the timeline</label><textarea data-f="summary" rows="3"></textarea></div>
      <label>Hypotheses pitched</label>
      <div data-verdicts>${hyps.length ? hyps.map((h) => `<div class="vrow" data-hid="${h.id}"><span class="claim">${esc(h.claim)}</span><div class="seg"><button class="yes" data-v="yes">✓</button><button class="no" data-v="no">✗</button><button class="skip on" data-v="skip">–</button></div><input data-f="quote" placeholder="Quote (optional)" style="display:none"></div>`).join("") : `<p class="muted small">No active hypotheses yet.</p>`}</div>
      <label style="margin-top:1rem">Who else should I talk to?</label>
      <div data-referrals></div>
      <button class="link" data-act="add-ref">+ add a name</button>
      <label style="margin-top:1rem">Insights for the modules</label>
      <div data-insights></div>
      <button class="link" data-act="add-ins">+ add an insight</button>
      <div class="row" style="margin-top:1rem">
        <div class="field" style="flex:2"><label>Next step</label><input data-f="next_step"></div>
        <div class="field"><label>When</label><input type="date" data-f="next_date"></div>
        <div class="field"><label>Move to stage</label><select data-f="stage"><option value="">keep</option>${person ? stageOpts(person.track, "__") : ""}</select></div>
      </div>
      <div class="actions"><span class="spacer"></span><button class="ghost" data-act="cancel">Cancel</button><button class="primary" data-act="save">Save call</button></div>
    </div>`);
  let audio_path = "";
  let current = person;
  const who = $("[data-f=who]", m);
  who.onchange = guard(async () => {
    const r = await get(`/api/search?q=${encodeURIComponent(who.value)}`);
    current = r.find((x) => x.name.toLowerCase() === who.value.trim().toLowerCase()) || r[0] || null;
    $("[data-f=stage]", m).innerHTML = `<option value="">keep</option>` + (current ? stageOpts(current.track, "__") : "");
  });
  $("[data-act=cancel]", m).onclick = closeModal;
  // audio drop
  const drop = $("[data-drop]", m), file = $("input[type=file]", drop);
  drop.onclick = () => file.click();
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
  drop.ondragleave = () => drop.classList.remove("over");
  const handle = guard(async (f) => {
    if (!f) return;
    const lbl = $("[data-drop-label]", m);
    lbl.innerHTML = `<span class="busy">Transcribing ${esc(f.name)}…</span>`;
    const fd = new FormData(); fd.append("file", f);
    try {
      const r = await api("POST", `/api/calls/transcribe?language=${encodeURIComponent(current?.language || "")}`, fd);
      $("[data-f=transcript]", m).value = r.transcript; audio_path = r.audio_path;
      lbl.textContent = `Transcribed ${f.name}`;
    } catch (e) { lbl.textContent = f.name + " — " + e.message; throw e; }
  });
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); handle(e.dataTransfer.files[0]); };
  file.onchange = () => handle(file.files[0]);
  // segments
  const wireSeg = (row) => $$(".seg button", row).forEach((b) => b.onclick = () => {
    $$(".seg button", row).forEach((x) => x.classList.remove("on")); b.classList.add("on");
    $("[data-f=quote]", row).style.display = b.dataset.v === "skip" ? "none" : "";
  });
  $$(".vrow", m).forEach(wireSeg);
  // referrals / insights rows
  const addRef = (name = "", company = "") => {
    const d = document.createElement("div"); d.className = "lrow";
    d.innerHTML = `<input type="checkbox" checked><div class="row"><input data-f="rname" placeholder="Name" value="${esc(name)}"><input data-f="rcompany" placeholder="Company" value="${esc(company)}"></div><button class="link" data-x>×</button>`;
    $("[data-x]", d).onclick = () => d.remove(); $("[data-referrals]", m).appendChild(d);
  };
  const addIns = (module = "SHEAR", text = "") => {
    const d = document.createElement("div"); d.className = "lrow";
    d.innerHTML = `<input type="checkbox" checked><div class="row"><select data-f="imodule" style="flex:0 0 7rem">${moduleOpts(module)}</select><input data-f="itext" placeholder="One concrete takeaway" value="${esc(text)}"></div><button class="link" data-x>×</button>`;
    $("[data-x]", d).onclick = () => d.remove(); $("[data-insights]", m).appendChild(d);
  };
  $("[data-act=add-ref]", m).onclick = () => addRef();
  $("[data-act=add-ins]", m).onclick = () => addIns();
  // suggest
  $("[data-act=suggest]", m).onclick = guard(async () => {
    if (!current) return toast("Pick a person first", true);
    const transcript = $("[data-f=transcript]", m).value.trim();
    if (!transcript) return toast("Paste or transcribe the call first", true);
    const b = $("[data-act=suggest]", m); b.disabled = true; $("[data-busy]", m).style.display = "";
    try {
      const s = await api("POST", "/api/calls/extract", { person_id: current.id, transcript });
      $("[data-f=summary]", m).value = s.summary || "";
      $("[data-f=next_step]", m).value = s.next_step || "";
      $("[data-f=next_date]", m).value = s.next_date || "";
      s.verdicts.forEach((v) => { const row = $(`.vrow[data-hid="${v.hypothesis_id}"]`, m); if (!row) return; $(`.seg button[data-v=${v.verdict}]`, row).click(); $("[data-f=quote]", row).value = v.quote || ""; });
      $("[data-referrals]", m).innerHTML = ""; s.referrals.forEach((r) => addRef(r.name, r.company || ""));
      $("[data-insights]", m).innerHTML = ""; s.insights.forEach((i) => addIns(i.module, i.text));
      toast("Suggestions filled in. Check them, then save.");
    } finally { b.disabled = false; $("[data-busy]", m).style.display = "none"; }
  });
  // save
  $("[data-act=save]", m).onclick = guard(async () => {
    if (!current) return toast("Pick a person first", true);
    const verdicts = $$(".vrow", m).map((r) => ({ hypothesis_id: +r.dataset.hid, verdict: $(".seg .on", r).dataset.v, quote: $("[data-f=quote]", r).value })).filter((v) => v.verdict !== "skip");
    const referrals = $$("[data-referrals] .lrow", m).filter((r) => $("input[type=checkbox]", r).checked && $("[data-f=rname]", r).value.trim()).map((r) => ({ name: $("[data-f=rname]", r).value.trim(), company: $("[data-f=rcompany]", r).value.trim() }));
    const insights = $$("[data-insights] .lrow", m).filter((r) => $("input[type=checkbox]", r).checked && $("[data-f=itext]", r).value.trim()).map((r) => ({ module: $("[data-f=imodule]", r).value, text: $("[data-f=itext]", r).value.trim() }));
    const payload = { person_id: current.id, kind: $("[data-f=kind]", m).value, transcript: $("[data-f=transcript]", m).value, audio_path,
      summary: $("[data-f=summary]", m).value || $("[data-f=transcript]", m).value.slice(0, 200), verdicts, referrals, insights,
      next_step: $("[data-f=next_step]", m).value, next_date: $("[data-f=next_date]", m).value, stage: $("[data-f=stage]", m).value };
    const r = await api("POST", "/api/calls/confirm", payload);
    closeModal(); toast(`Call saved · ${verdicts.length} verdicts · ${r.referrals.length} referrals · ${insights.length} insights`);
    render(); if (state.drawerId === current.id) openDrawer(current.id);
  });
  (person ? $("[data-f=transcript]", m) : who).focus();
}

// -------------------------------------------------------------- palette ----
function openPalette() {
  const w = $("#palette");
  w.innerHTML = `<div class="palette"><input placeholder="Search people, or jump to a screen or action…"><div class="results"></div></div>`;
  w.classList.add("show");
  w.onclick = (e) => { if (e.target === w) closePalette(); };
  const input = $("input", w), res = $(".results", w);
  const actions = [
    { t: "Today", k: "1", f: () => show("today") }, { t: "People", k: "2", f: () => show("people") }, { t: "Hypotheses", k: "3", f: () => show("hypotheses") },
    { t: "New person", k: "N", f: () => openPersonModal() }, { t: "Log a call", k: "L", f: () => openCallModal() }, { t: "New hypothesis", k: "H", f: () => openHypModal() },
    { t: "Toggle dark mode", k: "", f: toggleTheme },
  ];
  let items = [], sel = 0;
  const paint = () => { res.innerHTML = items.map((it, i) => `<div class="r ${i === sel ? "sel" : ""}" data-i="${i}"><span>${esc(it.t)}</span>${it.sub ? `<span class="muted small">${esc(it.sub)}</span>` : ""}<span class="k">${esc(it.k || "")}</span></div>`).join("") || `<div class="r muted">No matches</div>`;
    $$(".r[data-i]", res).forEach((el) => el.onclick = () => pick(+el.dataset.i)); };
  const pick = (i) => { const it = items[i]; if (!it) return; closePalette(); it.f(); };
  const search = async () => {
    const q = input.value.trim().toLowerCase();
    const acts = actions.filter((a) => !q || a.t.toLowerCase().includes(q));
    const people = q ? (await get(`/api/search?q=${encodeURIComponent(q)}`)).map((p) => ({ t: p.name, sub: `${p.company || ""} · ${p.track} · ${stageLabel(p.stage)}`, k: "", f: () => openDrawer(p.id) })) : [];
    items = [...people, ...acts]; sel = 0; paint();
  };
  input.oninput = search;
  input.onkeydown = (e) => {
    if (e.key === "ArrowDown") { sel = Math.min(sel + 1, items.length - 1); paint(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { sel = Math.max(sel - 1, 0); paint(); e.preventDefault(); }
    else if (e.key === "Enter") pick(sel);
  };
  search(); input.focus();
}
function closePalette() { $("#palette").classList.remove("show"); $("#palette").innerHTML = ""; }

// ------------------------------------------------------------ shortcuts ----
document.addEventListener("keydown", (e) => {
  const typing = e.target.closest("input, textarea, select, [contenteditable]");
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); $("#palette").classList.contains("show") ? closePalette() : openPalette(); return; }
  if (e.key === "Escape") {
    if ($("#palette").classList.contains("show")) closePalette();
    else if ($("#modal").classList.contains("show")) closeModal();
    else if ($("#drawer").classList.contains("show")) $("[data-act=close]", $("#drawer")).click();
    else if (typing) e.target.blur();
    return;
  }
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
  if ($("#modal").classList.contains("show") || $("#palette").classList.contains("show")) return;
  const k = e.key.toLowerCase();
  if (k === "1") show("today"); else if (k === "2") show("people"); else if (k === "3") show("hypotheses");
  else if (k === "n") openPersonModal(); else if (k === "l") openCallModal(state.drawerId || undefined); else if (k === "h") openHypModal();
  else if (k === "/") { e.preventDefault(); openPalette(); }
});

// ----------------------------------------------------------------- boot ----
(async function boot() {
  try { const t = localStorage.getItem("theme"); if (t) setTheme(t); } catch {}
  $("#btn-theme").onclick = toggleTheme;
  $("#btn-search").onclick = openPalette;
  $("#btn-call").onclick = () => openCallModal(state.drawerId || undefined);
  $$("#nav button").forEach((b) => b.onclick = () => show(b.dataset.screen));
  state.meta = await get("/api/meta");
  try { state.track = localStorage.getItem("track") || state.track; } catch {}
  let screen = "today"; try { screen = localStorage.getItem("screen") || "today"; } catch {}
  show(state.meta.is_friday ? "today" : screen);
})();
