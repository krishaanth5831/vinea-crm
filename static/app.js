/* Vinea CRM front end. Three screens, one drawer, one modal, one palette.
   No framework: every screen is a render function that writes into #main. */

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const state = { meta: null, screen: "today", track: "growers", todayTrack: "", hypTrack: "", openDraft: null, openDue: null, openHyp: null, drawerId: null };

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
const ICONS = {
  cal: '<path d="M8 2v3M16 2v3M3 9h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/>',
  mail: '<path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/><path d="m2 7 10 7 10-7"/>',
  link: '<path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6z"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
  check: '<path d="m5 12 5 5L20 7"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  sprout: '<path d="M12 22V10"/><path d="M12 10C12 6 9 4 4 4c0 5 3 8 8 8z"/><path d="M12 14c0-4 3-6 8-6 0 5-3 8-8 8z"/>',
  seed: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
  bulb: '<path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 21l1.9-5.4A8 8 0 1 1 21 12z"/>',
  video: '<rect x="2" y="6" width="14" height="12" rx="2"/><path d="m16 10 6-3v10l-6-3z"/>',
  person: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  note: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h6"/>',
};
const icon = (n) => `<svg class="i" viewBox="0 0 24 24">${ICONS[n] || ""}</svg>`;
// Channel = the platform a touch went through. One icon each, used everywhere.
const CH_ICON = { email: "mail", linkedin: "link", whatsapp: "chat", phone: "phone", video: "video", "in person": "person" };
const chIcon = (c) => icon(CH_ICON[c] || "note");
const chChip = (c, cls = "") => c ? `<span class="chip ch ${cls}">${chIcon(c)} ${esc(c)}</span>` : "";
const channelOpts = (cur, list) => options(list || state.meta.channels, cur);
// When the kind of touch changes, the channel select jumps to that kind's usual channel.
const linkKindChannel = (kindSel, chSel, fallback = "") => {
  const apply = () => { const note = kindSel.value === "note"; chSel.value = note ? "" : (state.meta.default_channel[kindSel.value] || fallback || ""); chSel.disabled = note; };
  kindSel.addEventListener("change", apply); apply();
};
const eventLink = (title, day, details = "") => `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${(day || state.meta.today).replace(/-/g, "")}T100000/${(day || state.meta.today).replace(/-/g, "")}T103000&details=${encodeURIComponent(details)}`;
const fmtTime = (iso) => new Date(iso.replace(" ", "T")).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
const waLink = (phone, text) => `https://wa.me/${String(phone || "").replace(/[^\d]/g, "")}?text=${encodeURIComponent(text)}`;
const hue = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const initials = (name) => name.trim().split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
const avatar = (p, cls = "") => `<span class="avatar ${cls}" style="--h:${hue(p.name)}">${esc(initials(p.name || "?"))}</span>`;
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
const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const isOverdue = (iso) => iso && iso < state.meta.today;
const options = (list, cur, label = (x) => x) => list.map((x) => `<option value="${esc(x)}" ${x === cur ? "selected" : ""}>${esc(label(x))}</option>`).join("");
const trackOpts = (cur) => options(state.meta.tracks, cur);
const stageOpts = (track, cur) => options(state.meta.stages[track], cur, stageLabel);
const moduleOpts = (cur) => options(state.meta.modules, cur);
const langOpts = (cur) => options(["en", "nl", "de", "fr"], cur || "en");
const empty = (ic, title, text) => `<div class="empty">${icon(ic)}<strong>${title}</strong>${text}</div>`;

function setTheme(t) {
  if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  try { t ? localStorage.setItem("theme", t) : localStorage.removeItem("theme"); } catch {}
}
function toggleTheme() {
  const dark = document.documentElement.dataset.theme === "dark" || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
  setTheme(dark ? "light" : "dark");
}

async function refreshPulse() {
  const p = await get("/api/pulse").catch(() => null);
  if (!p) return;
  const pct = Math.min(100, Math.round(100 * p.touches / p.target));
  $("#pulse").innerHTML = `<span class="ring" style="--p:${pct}"></span><span><b>${p.touches}</b> / ${p.target} this week</span>`;
  const by = (p.by_channel || []).filter((c) => c.channel).map((c) => `${c.channel} ${c.c}`).join(" · ");
  $("#pulse").title = `${p.touches} messages and calls in the last 7 days · ${p.calls} calls · ${p.people} people in play${by ? "\nBy platform: " + by : ""}`;
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
  refreshPulse();
}

// -------------------------------------------------------------- today ----
async function renderToday() {
  const t = await get(`/api/today${state.todayTrack ? `?track=${encodeURIComponent(state.todayTrack)}` : ""}`);
  const d = new Date(t.date + "T00:00:00");
  const allN = Object.values(t.counts).reduce((a, b) => a + b, 0);
  // Filter by type of outreach: all, or one track (drafts + due counted per tab)
  const tabs = ["", ...state.meta.tracks].map((k) => `<button class="${k === state.todayTrack ? "active" : ""}" data-today-track="${k}">${k || "all"}<span class="count">${k ? t.counts[k] || 0 : allN}</span></button>`).join("");
  const friday = state.meta.is_friday ? await renderReview() : "";
  const calendar = await renderCalendar(t.date);
  const drafts = t.drafts.map((x, i) => draftItem(x, i)).join("");
  const due = t.due.map((x, i) => dueItem(x, i + t.drafts.length)).join("");
  const up = t.upcoming.map((x, i) => `<div class="item" data-open-person="${x.id}" style="--i:${i}">${avatar(x, "sm")}<div><span class="title">${esc(x.name)}</span> <span class="sub">${esc(x.company)}</span><div class="sub one">${esc(x.next_step)}</div></div><div class="meta"><span class="chip">${esc(x.track)}</span><span class="chip date">${icon("cal")} ${fmtDate(x.next_date)}</span></div></div>`).join("");
  const none = !t.drafts.length && !t.due.length;
  const parts = state.todayTrack ? [state.todayTrack] : [];
  if (t.drafts.length) parts.push(`${t.drafts.length} draft${t.drafts.length > 1 ? "s" : ""} to approve`);
  if (t.due.length) parts.push(`${t.due.length} due`);
  return `<div class="screen">
    <div class="hero"><div>
      <p class="eyebrow">${d.toLocaleDateString(undefined, { weekday: "long" })}</p>
      <h1>${d.toLocaleDateString(undefined, { day: "numeric", month: "long" })}</h1>
      <p class="sub">${!none ? parts.join(" · ") : state.todayTrack ? `Nothing for ${esc(state.todayTrack)} today.` : "A clear day. Add a person, write a draft, or log a call."}</p>
    </div></div>
    ${friday}
    ${calendar}
    ${allN ? `<div class="tabs today-tabs">${tabs}</div>` : ""}
    ${none ? (state.todayTrack && allN ? empty("sprout", `No ${esc(state.todayTrack)} to tick off`, `Pick another type above, or "all".`) : empty("sprout", "Nothing to tick off", "Press N to add a person, or L to log a call.")) : ""}
    ${t.drafts.length ? `<h2>Drafts to approve <em>${t.drafts.length}</em></h2><div class="list" id="drafts">${drafts}</div>` : ""}
    ${t.due.length ? `<h2>Due <em>${t.due.length}</em></h2><div class="list" id="due">${due}</div>` : ""}
    ${t.upcoming.length ? `<h2>Coming up</h2><div class="list">${up}</div>` : ""}
  </div>`;
}

async function renderCalendar(today) {
  const c = await get("/api/calendar?days=7").catch(() => null);
  if (!c) return "";
  if (!c.connected) return `<p class="small muted cal-connect">Meetings from your Google Calendar can show up here. <a href="#" data-act="connect-calendar">Connect calendar</a></p>`;
  if (c.error) return `<p class="small muted cal-connect">${esc(c.error)} <a href="#" data-act="connect-calendar">Change address</a></p>`;
  if (!c.events.length) return `<p class="small muted cal-connect">Nothing on the calendar this week. <a href="#" data-act="connect-calendar">Calendar settings</a></p>`;
  const row = (e, i) => {
    const day = e.start.slice(0, 10);
    const when = e.all_day ? (day === today ? "today" : fmtDate(day)) : `${day === today ? "today" : fmtDate(day)} ${fmtTime(e.start)}`;
    const who = e.people.map((p) => `<a href="#" class="chip accent" data-open-person="${p.id}">${esc(p.name)}</a>`).join("");
    return `<div class="item cal ${day === today ? "today" : ""}" style="--i:${i}"><span class="cal-when">${esc(when)}</span><div><span class="title">${esc(e.summary)}</span>${e.location ? ` <span class="sub">${esc(e.location)}</span>` : ""}</div><div class="meta">${who}</div></div>`;
  };
  return `<h2>Calendar <em>${c.events.length}</em><a href="#" class="small muted cal-settings" data-act="connect-calendar">settings</a></h2><div class="list">${c.events.map(row).join("")}</div>`;
}

function openCalendarModal() {
  const m = openModal(`<h2>Google Calendar</h2>
    <p class="small muted" style="margin-bottom:.8rem">In Google Calendar: Settings → your calendar → <b>Integrate calendar</b> → copy the <b>Secret address in iCal format</b> and paste it here. The CRM reads it every few minutes; nothing is written to your calendar except through the "Add to calendar" links.</p>
    <div class="field"><label>Secret iCal address</label><input data-f="ics" placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"></div>
    <div class="actions"><button class="link danger" data-act="disconnect">Disconnect</button><span class="spacer"></span><button class="ghost" data-act="cancel">Cancel</button><button class="primary" data-act="save">Save</button></div>`, true);
  $("[data-f=ics]", m).focus();
  $("[data-act=cancel]", m).onclick = closeModal;
  $("[data-act=save]", m).onclick = guard(async () => { await api("POST", "/api/settings", { calendar_ics: $("[data-f=ics]", m).value }); state.meta.calendar = true; closeModal(); toast("Calendar connected"); render(); });
  $("[data-act=disconnect]", m).onclick = guard(async () => { await api("POST", "/api/settings", { calendar_ics: "" }); state.meta.calendar = false; closeModal(); toast("Calendar disconnected"); render(); });
}

function draftItem(x, i) {
  const open = state.openDraft === x.id;
  const to = x.channel === "email" ? (x.to_email || "no email on file")
    : x.channel === "whatsapp" ? (x.to_phone || "no phone on file")
    : (x.to_linkedin ? "LinkedIn" : "no LinkedIn on file");
  const li = x.channel === "linkedin";
  const twoStep = li && !!x.subject;  // connection note + message for after they accept
  const fields = li
    ? `<div class="li-steps">
        ${twoStep ? `<div class="li-step"><div class="head"><span class="step">1 · Connection note</span><span class="count ${x.subject.length > 300 ? "over" : ""}" data-count>${x.subject.length} / 300</span></div><textarea data-f="subject" rows="3">${esc(x.subject)}</textarea></div>` : ""}
        <div class="li-step"><div class="head"><span class="step">${twoStep ? "2 · " : ""}Message after they accept</span></div><textarea data-f="body" rows="6">${esc(x.body)}</textarea></div>
      </div>`
    : `${x.channel === "email" ? `<div class="field"><label>Subject</label><input data-f="subject" value="${esc(x.subject)}"></div>` : ""}
      <div class="field"><label>Message</label><textarea data-f="body" rows="8">${esc(x.body)}</textarea></div>`;
  const body = open ? `<div class="expand">
      ${fields}
      <div class="actions">
        ${x.channel === "email"
          ? `<button class="primary" data-act="open-mail" ${x.to_email ? "" : "disabled"}>${icon("mail")} Open in mail</button>`
          : x.channel === "whatsapp"
          ? `<button class="primary" data-act="open-whatsapp" ${x.to_phone ? "" : "disabled"}>${icon("chat")} Open in WhatsApp</button>`
          : `<button class="primary" data-act="open-linkedin">${icon("link")} ${twoStep ? "Copy note + open LinkedIn" : "Copy message + open LinkedIn"}</button>`}
        <button data-act="copy">${twoStep ? "Copy message" : "Copy"}</button>
        <span class="spacer"></span>
        <button data-act="sent">${icon("check")} ${twoStep ? "Note sent" : "Mark sent"}</button>
        <button class="ghost" data-act="skip">Skip</button>
      </div></div>` : "";
  const line = x.subject || ((li ? "After they accept · " : "") + x.body.slice(0, 110));
  return `<div class="item ${open ? "open" : ""}" data-draft="${x.id}" data-email="${esc(x.to_email)}" data-linkedin="${esc(x.to_linkedin)}" data-phone="${esc(x.to_phone)}" data-channel="${x.channel}" style="--i:${i}">
    ${avatar(x)}
    <div><span class="title">${esc(x.name)}</span> <span class="sub">${esc(x.company)}</span><div class="sub one">${esc(line)}</div></div>
    <div class="meta">${chChip(x.channel, "accent")}<span class="sub small">${esc(to)}</span></div>${body}</div>`;
}

function dueItem(x, i) {
  const open = state.openDue === x.id;
  const body = open ? `<div class="expand">
      <div class="field"><label>What happened?</label><textarea data-f="note" rows="3" placeholder="Short note for the timeline (optional)"></textarea></div>
      <div class="row">
        <div class="field"><label>Logged as</label><select data-f="kind">${options(state.meta.touch_kinds, "note")}</select></div>
        <div class="field"><label>Via</label><select data-f="channel"><option value="">—</option>${channelOpts("")}</select></div>
        <div class="field"><label>Next step</label><input data-f="next_step" placeholder="e.g. Call to set a visit"></div>
        <div class="field"><label>When</label><input type="date" data-f="next_date"></div>
      </div>
      <div class="actions"><button class="primary" data-act="done-save">${icon("check")} Done</button><button data-act="log-call-here">${icon("phone")} Log a call instead</button>
        <span class="snooze"><span class="muted small">Snooze</span><button class="ghost" data-snooze="1">+1 day</button><button class="ghost" data-snooze="3">+3 days</button><button class="ghost" data-snooze="7">+1 week</button></span>
        <span class="spacer"></span><button class="ghost" data-open-person="${x.id}">Open person ${icon("arrow")}</button></div>
    </div>` : "";
  return `<div class="item ${open ? "open" : ""}" data-due="${x.id}" data-channel="${esc(x.channel || "")}" style="--i:${i}">
    <button class="tick" title="Done">${icon("check")}</button>
    <div><span class="title">${esc(x.name)}</span> <span class="sub">${esc(x.company)}</span><div class="sub one">${esc(x.next_step || "Follow up")}</div></div>
    <div class="meta">${chChip(x.channel)}<span class="chip">${esc(x.track)}</span><span class="chip ${isOverdue(x.next_date) ? "overdue" : "date"}">${icon("cal")} ${isOverdue(x.next_date) ? "overdue · " : ""}${fmtDate(x.next_date)}</span></div>${body}</div>`;
}

async function renderReview() {
  const w = await get("/api/week");
  const n = (k) => (w.touches.find((t) => t.kind === k) || { c: 0 }).c;
  const callsN = n("call") + n("visit") + n("meeting");
  const sentN = n("message");
  const byPlatform = (w.channels || []).filter((c) => c.channel).map((c) => `<span class="chip ch">${chIcon(c.channel)} ${esc(c.channel)} <b>${c.c}</b></span>`).join("");
  const byTrack = {};
  w.by_track.forEach((r) => { byTrack[r.track] = (byTrack[r.track] || 0) + r.c; });
  const yes = w.evidence.filter((e) => e.verdict === "yes").length, no = w.evidence.length - yes;
  return `<div class="card review">
    <h3>Friday review <span class="muted">· since ${fmtDate(w.since)}</span></h3>
    <div class="stats">
      <div class="stat"><b>${sentN}</b><span>messages sent</span></div>
      <div class="stat"><b>${callsN}</b><span>calls / visits</span></div>
      <div class="stat"><b>${w.moved.length}</b><span>people moved</span></div>
      <div class="stat"><b>${yes} ✓ · ${no} ✗</b><span>hypothesis evidence</span></div>
      <div class="stat"><b>${w.insights.length}</b><span>insights to export</span></div>
    </div>
    ${byPlatform ? `<p class="small muted">By platform</p><div class="chips">${byPlatform}</div>` : ""}
    ${w.calls.length ? `<p class="small muted">Calls</p><ul>${w.calls.map((c) => `<li><a href="#" data-open-person="${c.person_id}">${esc(c.name)}</a> <span class="muted">${esc(c.company)}</span> — ${esc(c.body.slice(0, 120))}</li>`).join("")}</ul>` : ""}
    ${w.evidence.length ? `<p class="small muted">Evidence</p><ul>${w.evidence.map((e) => `<li><b>${e.verdict === "yes" ? "✓" : "✗"}</b> ${esc(e.claim)} <span class="muted">— ${esc(e.person_name || "")}</span></li>`).join("")}</ul>` : ""}
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
  const stages = state.meta.stages[state.track];
  const last = stages.length - 2; // index of the last real stage before 'closed'
  const per = stages.map((s) => people.filter((p) => p.stage === s));
  const funnel = stages.map((s, i) => `<span data-n="${per[i].length}" style="--n:${per[i].length};--p:${Math.min(1, i / last)}" title="${esc(stageLabel(s))}: ${per[i].length}"></span>`).join("");
  const legend = stages.map((s, i) => `<span><b>${per[i].length}</b>${esc(stageLabel(s))}</span>`).join("");
  let k = 0;
  const cols = stages.map((s, i) => {
    const cards = per[i].map((p) => pcard(p, k++)).join("");
    return `<div class="col ${s === "closed" ? "closed" : ""}" data-stage="${s}"><h3><i class="sd" style="--p:${Math.min(1, i / last)}"></i><span>${esc(stageLabel(s))}</span><span class="n">${per[i].length || ""}</span></h3>${cards}</div>`;
  }).join("");
  return `<div class="screen">
    <div class="hero"><div><p class="eyebrow">Pipeline</p><h1>People</h1><p class="sub">${all.length ? `${people.length} in ${state.track} · ${all.length} in all` : "Everyone you are talking to, by track and stage."}</p></div>
      <div class="right"><button class="primary" data-act="new-person">+ Person<kbd>N</kbd></button></div></div>
    <div class="tabs">${tabs}</div>
    ${people.length ? `<div class="funnel">${funnel}</div><div class="funnel-legend">${legend}</div>` : ""}
    ${all.length ? "" : empty("seed", "No one yet", "Press N to add the first person. Drag cards between stages as things move.")}
    <div class="board">${cols}</div>
  </div>`;
}
function pcard(p, i) {
  const od = isOverdue(p.next_date);
  const via = p.channel || p.last_channel;
  return `<div class="pcard" draggable="true" data-person="${p.id}" style="--i:${i}">
    ${avatar(p)}
    <div class="name" title="${esc(p.name)}">${esc(p.name)}</div>
    <div class="company" title="${esc(p.company || "")}">${esc(p.company || "—")}</div>
    ${via ? `<span class="via" title="${p.channel ? "Reach via" : "Last touch via"} ${esc(via)}">${chIcon(via)}</span>` : ""}
    ${p.next_step || p.next_date ? `<div class="next ${od ? "overdue" : ""}">${icon("cal")}${p.next_date ? `<b>${fmtDate(p.next_date)}</b>` : ""}<span>${esc(p.next_step)}</span></div>` : ""}
  </div>`;
}

// ---------------------------------------------------------- hypotheses ----
async function renderHypotheses() {
  const all = await get("/api/hypotheses");
  const hs = state.hypTrack ? all.filter((h) => h.track === state.hypTrack) : all;
  const live = hs.filter((h) => h.status !== "revised"), old = hs.filter((h) => h.status === "revised");
  const holding = all.filter((h) => h.status === "holding").length, dis = all.filter((h) => h.status === "disproved").length;
  const tabs = ["", ...state.meta.tracks].map((t) => `<button class="${t === state.hypTrack ? "active" : ""}" data-hyp-track="${t}">${t || "all"}<span class="count">${(t ? all.filter((h) => h.track === t) : all).length}</span></button>`).join("");
  return `<div class="screen">
    <div class="hero"><div><p class="eyebrow">What we believe</p><h1>Hypotheses</h1><p class="sub">${all.length ? `${holding} holding · ${dis} disproved · ${all.length - holding - dis} still open` : "Pitch one to three on every call: “We think X. Is that true for you?”"}</p></div>
      <div class="right"><button class="primary" data-act="new-hyp">+ Hypothesis<kbd>H</kbd></button></div></div>
    <div class="tabs">${tabs}</div>
    ${all.length ? "" : empty("bulb", "No guesses yet", "Write down what you believe before the next call. Dots fill as people agree or disagree.")}
    <div class="hgrid">${live.map((h, i) => hcard(h, i)).join("")}</div>
    ${old.length ? `<h2>Revised</h2><div class="hgrid">${old.map((h, i) => hcard(h, i)).join("")}</div>` : ""}
  </div>`;
}
function dots(n, cls, thr) {
  let s = `<div class="dotrow ${cls}"><span class="lbl">${cls === "yes" ? "✓" : "✗"}</span>`;
  for (let i = 0; i < thr; i++) s += `<span class="d ${i < n ? "on" : ""}"></span>`;
  if (n > thr) s += `<span class="more">+${n - thr}</span>`;
  return s + "</div>";
}
function hcard(h, i) {
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
  return `<div class="card hcard ${open ? "open" : ""} ${h.status === "revised" ? "revised" : ""}" data-hyp="${h.id}" style="--i:${i}">
    <div class="actions"><span class="chip ${status}">${h.status}</span>${h.track ? `<span class="chip">${esc(h.track)}</span>` : ""}${h.module ? `<span class="chip">${esc(h.module)}</span>` : ""}${h.revised_from ? `<span class="muted small">from #${h.revised_from}</span>` : ""}</div>
    <div class="claim">${esc(h.claim)}</div>
    <div class="dots">${dots(h.yes, "yes", thr)}${dots(h.no, "no", thr)}</div>
    <p class="muted small" style="margin-top:.6rem">${h.source ? esc(h.source) + " · " : ""}${h.yes + h.no} call${h.yes + h.no === 1 ? "" : "s"}</p>
    ${body}</div>`;
}

// ---------------------------------------------------------------- wire ----
function wire(main) {
  $$("[data-track]", main).forEach((b) => b.onclick = () => { state.track = b.dataset.track; try { localStorage.setItem("track", state.track); } catch {} render(); });
  $$("[data-hyp-track]", main).forEach((b) => b.onclick = () => { state.hypTrack = b.dataset.hypTrack; render(); });
  $$("[data-today-track]", main).forEach((b) => b.onclick = () => { state.todayTrack = b.dataset.todayTrack; state.openDraft = null; state.openDue = null; try { localStorage.setItem("todayTrack", state.todayTrack); } catch {} render(); });
  $$("[data-open-person]", main).forEach((el) => el.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); openDrawer(+el.dataset.openPerson); }));
  $$("[data-act=connect-calendar]", main).forEach((a) => a.onclick = (e) => { e.preventDefault(); openCalendarModal(); });
  // drafts
  $$("[data-draft]", main).forEach((it) => {
    const id = +it.dataset.draft;
    it.addEventListener("click", (e) => {
      if (e.target.closest("button, input, textarea, select")) return;
      state.openDraft = state.openDraft === id ? null : id; render();
    });
    const vals = () => ({ subject: $("[data-f=subject]", it)?.value ?? "", body: $("[data-f=body]", it)?.value ?? "" });
    const note = $("[data-f=subject]", it), count = $("[data-count]", it);
    if (note && count && it.dataset.channel === "linkedin") note.addEventListener("input", () => {
      count.textContent = `${note.value.length} / 300`; count.classList.toggle("over", note.value.length > 300);
    });
    const save = guard(async (status) => {
      await api("PATCH", `/api/drafts/${id}`, { ...vals(), status });
      it.classList.add("gone"); state.openDraft = null;
      const v = vals();
      toast(status !== "sent" ? "Skipped" : it.dataset.channel === "linkedin" && v.subject ? "Note sent. The message waits on Today for when they accept" : "Marked sent, follow-up booked");
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
        // Two boxes: the note is what goes with the connection request.
        await navigator.clipboard.writeText(v.subject || v.body); toast(v.subject ? "Note copied. Paste it with the connection request." : "Message copied. Paste it on LinkedIn.");
        if (it.dataset.linkedin) window.open(it.dataset.linkedin, "_blank");
      } else if (act === "open-whatsapp") {
        await api("PATCH", `/api/drafts/${id}`, v);
        window.open(waLink(it.dataset.phone, v.body), "_blank");
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
        await api("POST", `/api/people/${id}/done`, { note: $("[data-f=note]", it).value, kind: $("[data-f=kind]", it).value, channel: $("[data-f=channel]", it).value, next_step: $("[data-f=next_step]", it).value, next_date: $("[data-f=next_date]", it).value });
        it.classList.add("gone"); state.openDue = null; toast("Done"); setTimeout(render, 350);
      } else if (b.dataset.act === "log-call-here") { state.openDue = null; openCallModal(id); }
    }));
    $$("[data-snooze]", it).forEach((b) => b.onclick = guard(async (e) => {
      e.stopPropagation();
      const days = +b.dataset.snooze;
      await api("PATCH", `/api/people/${id}`, { next_date: addDays(days) });
      it.classList.add("gone"); state.openDue = null; toast(`Snoozed to ${fmtDate(addDays(days))}`); setTimeout(render, 350);
    }));
    if (state.openDue === id) { $(".tick", it).classList.add("on"); linkKindChannel($("[data-f=kind]", it), $("[data-f=channel]", it), it.dataset.channel); $("[data-f=note]", it).focus(); }
  });
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
  const touches = p.touches.map((t) => `<div class="touch"><span class="when">${fmtWhen(t.at)}</span><div><span class="chip">${t.kind}</span>${chChip(t.channel)} <span class="body">${esc(t.body)}</span>${t.transcript ? `<details><summary>transcript</summary><pre>${esc(t.transcript)}</pre></details>` : ""}</div><button class="link" data-del-touch="${t.id}">×</button></div>`).join("");
  const ev = p.evidence.map((e) => `<div class="ev"><span class="v ${e.verdict}">${e.verdict === "yes" ? "✓" : "✗"}</span><div>${esc(e.claim)}${e.quote ? `<br><q>${esc(e.quote)}</q>` : ""}</div><span></span></div>`).join("");
  dr.innerHTML = `
    <div class="head">${avatar(p)}<div style="flex:1"><input class="big" data-f="name" value="${esc(p.name)}" placeholder="Name"><input class="co" data-f="company" value="${esc(p.company)}" placeholder="Company"></div><button class="icon close" data-act="close">×</button></div>
    <div class="row">
      <div class="field"><label>Track</label><select data-f="track">${trackOpts(p.track)}</select></div>
      <div class="field"><label>Stage</label><select data-f="stage">${stageOpts(p.track, p.stage)}</select></div>
      <div class="field"><label>Reach via</label><select data-f="channel"><option value="">not set</option>${channelOpts(p.channel)}</select></div>
    </div>
    <div class="row">
      <div class="field" style="flex:2"><label>Next step</label><input data-f="next_step" value="${esc(p.next_step)}" placeholder="What happens next"></div>
      <div class="field"><label>When</label><input type="date" data-f="next_date" value="${esc(p.next_date)}"></div>
      <div class="field cal-add"><label>&nbsp;</label><a class="button ghost" data-act="cal-add" href="#" title="Open Google Calendar with this next step filled in">${icon("cal")} Add to calendar</a></div>
    </div>
    <div data-cal-events></div>
    <details ${p.email || p.linkedin ? "" : "open"}><summary>Contact · ${esc(p.email || p.linkedin || p.phone || "none yet")}</summary>
      <div class="row"><div class="field"><label>Email</label><input data-f="email" value="${esc(p.email)}"></div><div class="field"><label>Language</label><select data-f="language">${langOpts(p.language)}</select></div></div>
      <div class="row"><div class="field"><label>LinkedIn</label><input data-f="linkedin" value="${esc(p.linkedin)}" placeholder="https://linkedin.com/in/…"></div><div class="field"><label>Phone</label><input data-f="phone" value="${esc(p.phone)}"></div></div>
    </details>
    ${p.referrer ? `<p class="small muted" style="margin:.5rem 0">Referred by <a href="#" data-open-person="${p.referrer.id}">${esc(p.referrer.name)}</a></p>` : ""}
    ${p.referrals.length ? `<p class="small muted" style="margin:.5rem 0">Referred: ${p.referrals.map((r) => `<a href="#" data-open-person="${r.id}">${esc(r.name)}</a>`).join(", ")}</p>` : ""}
    <div class="actions" style="margin-top:1rem">
      <button class="primary" data-act="call">${icon("phone")} Log a call</button>
      <button data-act="draft-email">${icon("mail")} Draft email</button>
      <button data-act="draft-linkedin">${icon("link")} Draft LinkedIn</button>
      <button data-act="draft-whatsapp">${icon("chat")} Draft WhatsApp</button>
      <button data-act="referral">Who else? +</button>
    </div>
    <div data-ref-box style="display:none;margin-top:.8rem" class="card"><label>They suggested talking to…</label><div class="row"><input data-f="ref_name" placeholder="Name"><input data-f="ref_company" placeholder="Company"><button class="primary" data-act="ref-save" style="flex:0">Add</button></div></div>
    <div class="timeline">
      <h2 style="margin-top:1.6rem">Timeline <em>${p.touches.length}</em></h2>
      <div class="quick"><select data-f="qkind">${options(state.meta.touch_kinds, "note")}</select><select data-f="qchannel"><option value="">—</option>${channelOpts("")}</select><input data-f="qnote" placeholder="Quick note… Enter to add"></div>
      ${touches || `<p class="muted small">Nothing yet.</p>`}
      ${ev ? `<h2>Hypotheses</h2>${ev}` : ""}
    </div>
    <p style="margin-top:2rem"><button class="link danger" data-act="delete">Delete person</button></p>`;
  dr.classList.add("show"); $("#drawer-scrim").classList.add("show");
  const close = () => { dr.classList.remove("show"); $("#drawer-scrim").classList.remove("show"); state.drawerId = null; render(); };
  $("[data-act=close]", dr).onclick = close; $("#drawer-scrim").onclick = close;
  const fields = ["name", "company", "track", "stage", "next_step", "next_date", "email", "linkedin", "phone", "language", "channel"];
  fields.forEach((f) => { const el = $(`[data-f=${f}]`, dr); el.onchange = guard(async () => {
    const data = { [f]: el.value };
    if (f === "track") data.stage = "new";
    const np = await api("PATCH", `/api/people/${id}`, data);
    if (f === "track") $("[data-f=stage]", dr).innerHTML = stageOpts(np.track, np.stage);
    toast("Saved");
  }); });
  $("[data-f=qnote]", dr).onkeydown = guard(async (e) => {
    if (e.key !== "Enter") return;
    const body = e.target.value.trim(); if (!body) return;
    await api("POST", `/api/people/${id}/touches`, { kind: $("[data-f=qkind]", dr).value, channel: $("[data-f=qchannel]", dr).value, body });
    toast("Added to timeline"); openDrawer(id);
  });
  linkKindChannel($("[data-f=qkind]", dr), $("[data-f=qchannel]", dr), p.channel);
  $$("[data-open-person]", dr).forEach((a) => a.onclick = (e) => { e.preventDefault(); openDrawer(+a.dataset.openPerson); });
  $$("[data-del-touch]", dr).forEach((b) => b.onclick = guard(async () => { await api("DELETE", `/api/touches/${b.dataset.delTouch}`); openDrawer(id); }));
  $("[data-act=call]", dr).onclick = () => openCallModal(id);
  $("[data-act=cal-add]", dr).onclick = (e) => {
    e.preventDefault();
    const step = $("[data-f=next_step]", dr).value.trim() || "Call";
    const title = `${step} · ${p.name}${p.company ? " (" + p.company + ")" : ""}`;
    window.open(eventLink(title, $("[data-f=next_date]", dr).value, [p.email, p.phone, p.linkedin].filter(Boolean).join("\n")), "_blank");
  };
  if (state.meta.calendar) get("/api/calendar?days=30").then((c) => {
    const mine = (c.events || []).filter((e) => e.people.some((x) => x.id === id));
    const box = $("[data-cal-events]", dr);
    if (!box || !mine.length) return;
    box.innerHTML = `<p class="small muted cal-planned">${icon("cal")} On the calendar: ${mine.map((e) => `<b>${esc(fmtDate(e.start.slice(0, 10)))}${e.all_day ? "" : " " + fmtTime(e.start)}</b> ${esc(e.summary)}`).join(" · ")}</p>`;
  }).catch(() => {});
  $("[data-act=draft-email]", dr).onclick = () => openDraftModal(p, "email");
  $("[data-act=draft-linkedin]", dr).onclick = () => openDraftModal(p, "linkedin");
  $("[data-act=draft-whatsapp]", dr).onclick = () => openDraftModal(p, "whatsapp");
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
    <div class="row"><div class="field"><label>Phone</label><input data-f="phone" placeholder="+31 …"></div><div class="field"><label>Reach via</label><select data-f="channel"><option value="">guess from contact details</option>${channelOpts("")}</select></div></div>
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
    <div class="row"><div class="field"><label>Track</label><select data-f="track"><option value="">any</option>${trackOpts(state.hypTrack)}</select></div><div class="field"><label>Module</label><select data-f="module"><option value="">none</option>${moduleOpts("")}</select></div></div>
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
    ${channel === "linkedin"
      ? `<div class="li-steps"><div class="li-step"><div class="head"><span class="step">1 · Connection note</span><span class="count">under 300 characters</span></div><textarea data-f="subject" rows="3" placeholder="Why you want to connect, in two sentences."></textarea></div>
         <div class="li-step"><div class="head"><span class="step">2 · Message after they accept</span></div><textarea data-f="body" rows="7" placeholder="The real message, with one question."></textarea></div></div>`
      : `<div class="field"><label>Message</label><textarea data-f="body" rows="9" placeholder="${channel === "whatsapp" ? "Short, like a text. One ask." : ""}"></textarea></div>`}
    <div class="actions"><span class="spacer"></span><button class="ghost" data-act="cancel">Cancel</button><button class="primary" data-act="save">Save for approval</button></div>`);
  $("[data-act=cancel]", m).onclick = closeModal;
  const ai = $("[data-act=ai]", m);
  if (ai) ai.onclick = guard(async () => {
    ai.disabled = true; $("[data-busy]", m).style.display = "";
    try {
      await api("POST", `/api/people/${p.id}/drafts/generate`, { channel, about: $("[data-f=about]", m).value });
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
  const hyps = await get("/api/hypotheses?all=0");
  const person = personId ? await get(`/api/people/${personId}`) : null;
  const tr = state.meta.transcriber;
  const m = openModal(`<h2>Log a call</h2>
    <div class="row">
      <div class="field" style="flex:2"><label>Who</label><input data-f="who" list="people-dl" value="${esc(person?.name || "")}" placeholder="Start typing a name"></div>
      <div class="field"><label>Kind</label><select data-f="kind">${options(["call", "visit", "meeting"], "call")}</select></div>
      <div class="field"><label>Via</label><select data-f="channel">${channelOpts("phone", ["phone", "video", "whatsapp", "in person"])}</select></div>
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
  linkKindChannel($("[data-f=kind]", m), $("[data-f=channel]", m));
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
  const wireSeg = (row) => $$(".seg button", row).forEach((b) => b.onclick = () => {
    $$(".seg button", row).forEach((x) => x.classList.remove("on")); b.classList.add("on");
    $("[data-f=quote]", row).style.display = b.dataset.v === "skip" ? "none" : "";
  });
  $$(".vrow", m).forEach(wireSeg);
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
  $("[data-act=save]", m).onclick = guard(async () => {
    if (!current) return toast("Pick a person first", true);
    const verdicts = $$(".vrow", m).map((r) => ({ hypothesis_id: +r.dataset.hid, verdict: $(".seg .on", r).dataset.v, quote: $("[data-f=quote]", r).value })).filter((v) => v.verdict !== "skip");
    const referrals = $$("[data-referrals] .lrow", m).filter((r) => $("input[type=checkbox]", r).checked && $("[data-f=rname]", r).value.trim()).map((r) => ({ name: $("[data-f=rname]", r).value.trim(), company: $("[data-f=rcompany]", r).value.trim() }));
    const insights = $$("[data-insights] .lrow", m).filter((r) => $("input[type=checkbox]", r).checked && $("[data-f=itext]", r).value.trim()).map((r) => ({ module: $("[data-f=imodule]", r).value, text: $("[data-f=itext]", r).value.trim() }));
    const payload = { person_id: current.id, kind: $("[data-f=kind]", m).value, channel: $("[data-f=channel]", m).value, transcript: $("[data-f=transcript]", m).value, audio_path,
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
    { t: "Calendar settings", k: "", f: openCalendarModal },
  ];
  let items = [], sel = 0;
  const paint = () => { res.innerHTML = items.map((it, i) => `<div class="r ${i === sel ? "sel" : ""}" data-i="${i}">${it.av || ""}<span>${esc(it.t)}</span>${it.sub ? `<span class="muted small">${esc(it.sub)}</span>` : ""}<span class="k">${esc(it.k || "")}</span></div>`).join("") || `<div class="r muted">No matches</div>`;
    $$(".r[data-i]", res).forEach((el) => el.onclick = () => pick(+el.dataset.i)); };
  const pick = (i) => { const it = items[i]; if (!it) return; closePalette(); it.f(); };
  const search = async () => {
    const q = input.value.trim().toLowerCase();
    const acts = actions.filter((a) => !q || a.t.toLowerCase().includes(q));
    const people = q ? (await get(`/api/search?q=${encodeURIComponent(q)}`)).map((p) => ({ t: p.name, av: avatar(p, "sm"), sub: `${p.company || ""} · ${p.track} · ${stageLabel(p.stage)}`, k: "", f: () => openDrawer(p.id) })) : [];
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
  try { const tt = localStorage.getItem("todayTrack") || ""; state.todayTrack = state.meta.tracks.includes(tt) ? tt : ""; } catch {}
  let screen = "today"; try { screen = localStorage.getItem("screen") || "today"; } catch {}
  show(state.meta.is_friday ? "today" : screen);
})();
