// Buddy List, IMs, chat rooms, away messages and profiles — shared with the BuddyChat iPhone app.
import {
  auth, db, ref, get, set, update, push, remove, onValue, off, serverTimestamp, onDisconnect,
  query, orderByKey, limitToLast, normalize, conversationID,
} from "./firebase.js";
import { openWindow, closeWindow, getWindow, setTitle, flash, esc, contextMenu, onMenu } from "./wm.js";
import * as sfx from "./sounds.js";
import { warningLevel, warn, alreadyWarned } from "./extras.js";
import { imBackgroundFor } from "./prefs.js";
import { openPeoplePlaza, openRoom as openPlazaRoom } from "./people.js";

const state = {
  uid: null, me: { screenName: "" }, users: {}, groups: [], inbox: {}, blocked: new Set(),
  away: "", listeners: [], timers: [], icons: {}, known: {}, loadedUsers: false, loadedInbox: false, lastAuto: {},
};

export const me = () => state.me;
// Screen names for people who aren't buddies come from a small public list of names only.
const nameCache = {};
const fetching = new Set();
function lookUpName(uid) {
  if (!uid || fetching.has(uid) || nameCache[uid]) return;
  fetching.add(uid);
  get(ref(db, `names/${uid}`)).then((s) => {
    if (s.val()) { nameCache[uid] = s.val(); document.dispatchEvent(new CustomEvent("du:users")); refreshBuddyList(); }
  }).catch(() => {}).finally(() => fetching.delete(uid));
}
const name = (uid) => {
  const n = state.users[uid]?.screenName || nameCache[uid];
  if (!n) lookUpName(uid);
  return n || "…";
};
export const userName = name;
/** A buddy's icon as an <img>, or a colored letter if they haven't picked one. */
export function iconHTML(uid, size = 22) {
  const b64 = state.icons[uid];
  if (b64) return `<img class="bicon" src="data:image/jpeg;base64,${b64}" width="${size}" height="${size}" alt="">`;
  const n = name(uid);
  const hue = [...n].reduce((h, c) => h + c.charCodeAt(0), 0) % 360;
  return `<span class="bicon letter" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.55)}px;background:hsl(${hue} 65% 55%)">${esc((n[0] || "?").toUpperCase())}</span>`;
}

/** Shrink a picture to a 96×96 square and save it as your Buddy Icon. */
export async function setMyIcon(file) {
  const img = await createImageBitmap(file);
  const side = Math.min(img.width, img.height);
  const c = document.createElement("canvas");
  c.width = c.height = 96;
  c.getContext("2d").drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 96, 96);
  const b64 = c.toDataURL("image/jpeg", 0.75).split(",")[1];
  await set(ref(db, `icons/${state.uid}`), b64);
}
/** Everyone signed on right now (not just buddies), newest activity first. */
/** Buddies who are signed on right now, most recently active first. */
export const onlineMembers = () => [...buddyIDs()]
  .filter((id) => presence(state.users[id]) !== "offline")
  .sort((a, b) => (state.users[b]?.lastSeen || 0) - (state.users[a]?.lastSeen || 0));
export const memberCount = () => buddyIDs().size;
export const buddyList = () => [...new Set(state.groups.flatMap((g) => g.members))];

// ---------- Presence ----------
function presence(u, now = Date.now()) {
  if (!u || !u.signedOn || u.invisible) return "offline";
  const age = now - (u.lastSeen || 0);
  if (!u.idleSince && age < 150000) return u.away ? "away" : "online";
  if (u.idleSince && age < 7200000) return u.away ? "away" : "idle";
  return "offline";
}
const idleMin = (u) => (u?.idleSince ? Math.max(1, Math.round((Date.now() - u.idleSince) / 60000)) : 0);

function listen(path, cb, q) {
  const r = q || ref(db, path);
  onValue(r, (snap) => cb(snap.val()));
  state.listeners.push(r);
}

export async function startChat() {
  const uid = auth.currentUser.uid;
  state.uid = uid;
  const meRef = ref(db, `users/${uid}`);
  state.me = (await get(meRef)).val() || { screenName: "Me" };
  state.away = state.me.away || "";
  try {
    const raw = (await get(ref(db, `buddylists/${uid}`))).val();
    state.groups = raw ? JSON.parse(raw) : [];
  } catch { state.groups = []; }
  if (!state.groups.length) state.groups = [{ id: crypto.randomUUID().toUpperCase(), name: "Buddies", members: [], collapsed: false }];

  await update(meRef, { signedOn: true, lastSeen: serverTimestamp(), idleSince: null });
  onDisconnect(meRef).update({ signedOn: false, lastSeen: serverTimestamp() });
  state.timers.push(setInterval(() => update(meRef, { lastSeen: serverTimestamp(), signedOn: true }), 60000));
  set(ref(db, `names/${uid}`), state.me.screenName || "").catch(() => {});
  state.timers.push(setInterval(refreshBuddyList, 10000));
  document.addEventListener("visibilitychange", onVisibility);

  syncWatches();
  syncBuddyOf();
  setTimeout(() => { state.loadedUsers = true; }, 4000);
  listen(`inbox/${uid}`, onInbox);
  listen(`blocks/${uid}`, (v) => { state.blocked = new Set(Object.keys(v || {})); refreshBuddyList(); });
  listen(`buddylists/${uid}`, (v) => {
    try { if (v) { state.groups = JSON.parse(v); syncWatches(); refreshBuddyList(); } } catch {}
  });
}

// ---------- Only load info for people you're connected to ----------
const watches = new Map();   // uid → [userRef, iconRef]

/** You, your buddies, and anyone you have an IM conversation with. */
function peopleToWatch() {
  const set_ = new Set([state.uid, ...buddyIDs()]);
  Object.values(state.inbox || {}).forEach((e) => e.with && set_.add(e.with));
  return set_;
}

function syncWatches() {
  if (!state.uid) return;
  const want = peopleToWatch();
  for (const [uid, refs] of watches) {
    if (!want.has(uid)) { refs.forEach((r) => off(r)); watches.delete(uid); delete state.users[uid]; delete state.icons[uid]; }
  }
  for (const uid of want) {
    if (watches.has(uid)) continue;
    const ur = ref(db, `users/${uid}`), ir = ref(db, `icons/${uid}`);
    onValue(ur, (s) => {
      if (s.val()) state.users[uid] = s.val(); else delete state.users[uid];
      if (uid === state.uid) state.me = state.users[uid] || state.me;
      checkPresenceChanges();
      refreshBuddyList();
      if (getWindow("im." + uid)) renderIMStatus(uid);
      document.dispatchEvent(new CustomEvent("du:users"));
    }, () => {});
    onValue(ir, (s) => {
      if (s.val()) state.icons[uid] = s.val(); else delete state.icons[uid];
      refreshBuddyList();
      document.dispatchEvent(new CustomEvent("du:icons"));
    }, () => {});
    watches.set(uid, [ur, ir]);
  }
}

export function stopChat() {
  watches.forEach((refs) => refs.forEach((r) => off(r)));
  watches.clear();
  state.listeners.forEach((r) => off(r));
  state.timers.forEach(clearInterval);
  document.removeEventListener("visibilitychange", onVisibility);
  Object.assign(state, { uid: null, listeners: [], timers: [], known: {}, loadedUsers: false, loadedInbox: false, users: {}, inbox: {} });
}

function onVisibility() {
  if (!state.uid) return;
  const r = ref(db, `users/${state.uid}`);
  if (document.hidden) update(r, { idleSince: serverTimestamp(), lastSeen: serverTimestamp() });
  else update(r, { idleSince: null, lastSeen: serverTimestamp(), signedOn: true });
}

const buddyIDs = () => new Set(state.groups.flatMap((g) => g.members));

function checkPresenceChanges() {
  for (const uid of buddyIDs()) {
    const p = presence(state.users[uid]);
    const before = state.known[uid];
    state.known[uid] = p;
    if (!state.loadedUsers || !before || before === p) continue;
    if (before === "offline") sfx.buddyIn();
    else if (p === "offline") sfx.buddyOut();
    fireAlerts(uid, before, p);
  }
}

function onInbox(v) {
  const old = state.inbox;
  state.inbox = v || {};
  syncWatches();
  if (state.loadedInbox) {
    for (const [conv, e] of Object.entries(state.inbox)) {
      if (e.from === state.uid || state.blocked.has(e.from) || (e.ts || 0) <= (old[conv]?.ts || 0)) continue;
      sfx.imIn();
      const existed = !!getWindow("im." + e.from);
      openIM(e.from, { quiet: true });
      if (existed) flash("im." + e.from);
      autoReply(e.from, conv);
    }
  }
  state.loadedInbox = true;
  refreshBuddyList();
}

async function saveGroups() {
  await set(ref(db, `buddylists/${state.uid}`), JSON.stringify(state.groups));
  syncBuddyOf();
  syncWatches();
  refreshBuddyList();
}

/** buddyof/{them}/{me} = true for everyone on my list, so the server can let me see their status (and nobody else's). */
async function syncBuddyOf() {
  const mine = buddyIDs();
  const prev = new Set(JSON.parse(localStorage.getItem("du.buddyof." + state.uid) || "[]"));
  for (const b of mine) if (!prev.has(b)) set(ref(db, `buddyof/${b}/${state.uid}`), true).catch(() => {});
  for (const b of prev) if (!mine.has(b)) remove(ref(db, `buddyof/${b}/${state.uid}`)).catch(() => {});
  localStorage.setItem("du.buddyof." + state.uid, JSON.stringify([...mine]));
}

// ---------- Buddy List ----------
export function openBuddyList() {
  const desk = document.getElementById("desk");
  const wide = desk.clientWidth > desk.clientHeight;
  const w = Math.min(wide ? 250 : 230, Math.round(desk.clientWidth * (wide ? 0.32 : 0.5)));
  openWindow("buddies", {
    title: `${state.me.screenName}'s Buddy List`, icon: "👥", width: w, height: desk.clientHeight - 12,
    x: desk.clientWidth - w - 6, y: 6, render: () => refreshBuddyList(),
  });
}

function refreshBuddyList() {
  const win = getWindow("buddies");
  if (!win) return;
  const body = win.body;
  const scroll = body.scrollTop;
  const myStatus = state.away ? `<span class="status away">Away: ${esc(state.away)}</span>` : `<span class="status">Available</span>`;
  const row = (uid) => {
    const u = state.users[uid];
    const p = presence(u);
    const conv = conversationID(state.uid, uid);
    const unread = state.inbox[conv] && state.inbox[conv].from !== state.uid && (state.inbox[conv].ts || 0) > Number(localStorage.getItem("du.read." + conv) || 0);
    return `<div class="buddy ${p}" data-buddy="${uid}" title="${p}">
      <span class="dot"></span>${iconHTML(uid, 20)}<span>${esc(name(uid))}</span>
      ${p === "idle" ? `<span class="small">(idle ${idleMin(u)})</span>` : ""}
      ${p === "away" ? `<span class="small" title="${esc(u.away)}">📝</span>` : ""}
      ${unread ? `<span class="unread">✉️</span>` : ""}</div>`;
  };
  const show = localStorage.getItem("du.show") || "everyone";
  const visible = (m) => {
    const p = presence(state.users[m]);
    return p !== "offline" && !(show === "available" && (p === "away" || p === "idle"));
  };
  const groupsHTML = state.groups.map((g) => {
    const on = g.members.filter(visible);
    return `<div class="group"><button data-group="${g.id}">${g.collapsed ? "▸" : "▾"} ${esc(g.name)} (${on.length}/${g.members.length})</button>
      ${g.collapsed ? "" : on.sort((a, b) => name(a).localeCompare(name(b))).map(row).join("")}</div>`;
  }).join("");
  const off_ = [...buddyIDs()].filter((m) => presence(state.users[m]) === "offline");
  const strangers = Object.values(state.inbox).map((e) => e.with).filter((u) => u && !buddyIDs().has(u) && u !== state.uid);
  body.innerHTML = `
    <div class="bl-top"><b class="bl-title">Buddy List</b>
      <select id="bl-show" title="Who to show">
        <option value="everyone" ${show === "everyone" ? "selected" : ""}>Show Everyone</option>
        <option value="online" ${show === "online" ? "selected" : ""}>Online Only</option>
        <option value="available" ${show === "available" ? "selected" : ""}>Hide Away & Idle</option>
      </select></div>
    <div class="bl-me">${state.icons[state.uid] ? iconHTML(state.uid, 34) : `<img src="img/logo.png" width="40" height="28" alt="" style="object-fit:contain">`}
      <div><b>${esc(state.me.screenName)}</b><br>${myStatus}${warningLevel(state.uid) ? `<br><span class="small">⚠️ Warning level ${warningLevel(state.uid)}%</span>` : ""}</div></div>
    ${groupsHTML}
    ${strangers.length ? `<div class="group"><button>▾ Recent IMs (${strangers.length})</button>${[...new Set(strangers)].map(row).join("")}</div>` : ""}
    ${show === "everyone" ? `<div class="group"><button>▾ Offline (${off_.length})</button>${off_.sort((a, b) => name(a).localeCompare(name(b))).map(row).join("")}</div>` : ""}
    <div class="bl-bottom">
      <button class="bl-icon" data-act="im"><span>💬</span>Send IM</button>
      <button class="bl-icon" data-act="info"><span>🪪</span>Buddy Info</button>
      <button class="bl-icon" data-act="add"><span>➕</span>Add Buddy</button>
    </div>
    <div class="bl-bottom2">
      <button class="btn small-btn" data-act="awaymenu">Away Message ▾</button>
      <button class="btn small-btn" data-act="setup">Setup</button>
    </div>`;
  body.scrollTop = scroll;
  body.querySelectorAll("[data-buddy]").forEach((el) => {
    el.onclick = () => openIM(el.dataset.buddy);
    onMenu(el, (x, y) => buddyMenu(el.dataset.buddy, x, y));
  });
  body.querySelectorAll("[data-group]").forEach((b) => (b.onclick = () => {
    const g = state.groups.find((x) => x.id === b.dataset.group);
    g.collapsed = !g.collapsed;
    saveGroups();
  }));
  body.querySelector("#bl-show").onchange = (e) => { localStorage.setItem("du.show", e.target.value); refreshBuddyList(); };
  const pickBuddy = (verb, then) => {
    const n = prompt(`${verb} — type a screen name:`);
    if (!n) return;
    get(ref(db, `screennames/${normalize(n)}`)).then((s) => (s.val() ? then(s.val()) : alert(`No one has the screen name "${n}".`)));
  };
  const at = (b) => { const r = b.getBoundingClientRect(); return [r.left, r.top - 4]; };
  const acts = {
    add: () => openAddBuddy(),
    im: () => pickBuddy("Send an Instant Message", openIM),
    info: () => pickBuddy("Get Buddy Info", openInfo),
    chat: () => {
      const room = prompt("Name a chat room to invite your online buddies to:", "Buddy Chat " + Math.floor(Math.random() * 900 + 100));
      if (!room) return;
      const online = [...buddyIDs()].filter((u) => presence(state.users[u]) !== "offline");
      online.forEach((u) => push(ref(db, `invites/${u}`), { from: state.uid, room, message: "Join my Buddy Chat!", ts: serverTimestamp() }).catch(() => {}));
      import("./people.js").then((m) => m.openRoom(room, "Member Rooms"));
    },
    awaymenu: (b) => {
      const saved = JSON.parse(localStorage.getItem("du.awaySaved") || "null") || ["Away from my desk. Leave a message!", "brb", "Out living my best life. Back at %t."];
      contextMenu(...at(b), [
        ...(state.away ? [{ label: "✅ I'm Back", action: () => setAwayMsg("") }, "-"] : []),
        ...saved.slice(0, 6).map((m) => ({ label: "📝 " + m.slice(0, 40), action: () => setAwayMsg(m) })),
        "-", { label: "New / Edit Away Message…", action: openAway },
      ]);
    },
    setup: (b) => contextMenu(...at(b), [
      { label: "➕ Add a Buddy", action: () => openAddBuddy() },
      { label: "📁 Add a Group", action: newGroup },
      { label: "🪪 Edit My Profile", action: openProfile },
      { label: "🔎 Member Directory", action: openDirectory },
    ]),
  };
  body.querySelectorAll("[data-act]").forEach((b) => (b.onclick = () => acts[b.dataset.act](b)));
}

// ---------- Buddy Alerts ----------
export const alerts = () => JSON.parse(localStorage.getItem("du.alerts") || "{}");
function saveAlerts(a) { localStorage.setItem("du.alerts", JSON.stringify(a)); }

function fireAlerts(uid, before, after) {
  const a = alerts()[uid];
  if (!a) return;
  const signedOn = before === "offline" && after !== "offline";
  const back = (before === "away" || before === "idle") && after === "online";
  if (!((signedOn && a.signOn) || (back && a.back))) return;
  sfx.alertBlip();
  openWindow("alert." + uid, {
    title: "Buddy Alert!", icon: "🔔", width: 260, height: 170,
    render(body) {
      body.innerHTML = `<div style="display:flex;gap:8px;align-items:center">${iconHTML(uid, 40)}<p style="margin:0"><b>${esc(name(uid))}</b> ${signedOn ? "just signed on!" : "is back!"}</p></div>
        <div class="row" style="margin-top:10px"><span></span><button class="btn primary small-btn" data-x="im">Send IM</button></div>`;
      body.querySelector("[data-x=im]").onclick = () => { closeWindow("alert." + uid); openIM(uid); };
    },
  });
  if (a.message) sendIM(uid, a.message, { font: "Verdana", size: 14, color: "#000000" }).catch(() => {});
  if (a.once) { const all = alerts(); delete all[uid]; saveAlerts(all); }
}

export function openBuddyAlert(uid) {
  openWindow("alertset." + uid, {
    title: `Buddy Alert: ${name(uid)}`, icon: "🔔", width: 320, height: 330,
    render(body) {
      const a = alerts()[uid] || { signOn: true, back: false, message: "", once: false };
      body.innerHTML = `<p class="small">Tell me when <b>${esc(name(uid))}</b>…</p>
        <label class="check"><input type="checkbox" id="al-on" ${a.signOn ? "checked" : ""}> signs on</label>
        <label class="check"><input type="checkbox" id="al-back" ${a.back ? "checked" : ""}> comes back from away or idle</label>
        <label>…and automatically send this IM (optional)<input id="al-msg" value="${esc(a.message || "")}" placeholder="Yo! Call me when you see this"></label>
        <label class="check"><input type="checkbox" id="al-once" ${a.once ? "checked" : ""}> Only alert me once</label>
        <div class="row"><button class="btn small-btn" data-x="off">Remove Alert</button><button class="btn primary small-btn" data-x="save">Save Alert</button></div>`;
      body.querySelector("[data-x=save]").onclick = () => {
        const all = alerts();
        all[uid] = { signOn: body.querySelector("#al-on").checked, back: body.querySelector("#al-back").checked,
          message: body.querySelector("#al-msg").value.trim(), once: body.querySelector("#al-once").checked };
        saveAlerts(all);
        closeWindow("alertset." + uid);
      };
      body.querySelector("[data-x=off]").onclick = () => { const all = alerts(); delete all[uid]; saveAlerts(all); closeWindow("alertset." + uid); };
    },
  });
}

// ---------- IM History ----------
export function openHistory(uid) {
  const conv = conversationID(state.uid, uid);
  openWindow("history." + uid, {
    title: `IM History: ${name(uid)}`, icon: "📜", width: 420, height: 480,
    async render(body) {
      body.innerHTML = `<div class="row" style="margin-bottom:6px"><input id="h-q" placeholder="Search this conversation…" style="flex:1">
          <button class="btn small-btn" id="h-save">💾 Save as file</button></div><div class="transcript" id="h-list" style="height:calc(100% - 44px)">Loading…</div>`;
      const snap = await get(query(ref(db, `messages/${conv}`), orderByKey(), limitToLast(1000)));
      const msgs = [];
      snap.forEach((c) => { msgs.push(c.val()); });
      const line = (m) => `${m.ts ? new Date(m.ts).toLocaleString() : ""} — ${m.from === state.uid ? state.me.screenName : m.name || name(uid)}: ${m.text}`;
      const paint = () => {
        const q = body.querySelector("#h-q").value.toLowerCase();
        const shown = msgs.filter((m) => !q || (m.text || "").toLowerCase().includes(q));
        body.querySelector("#h-list").innerHTML = shown.map((m) =>
          `<div class="msg"><time>${m.ts ? new Date(m.ts).toLocaleString() : ""}</time> <span class="who ${m.from === state.uid ? "me" : "them"}">${esc(m.from === state.uid ? state.me.screenName : m.name || name(uid))}</span>: ${formatText(m.text)}</div>`).join("")
          || `<p class="muted">${q ? "No matches." : "No messages yet."}</p>`;
      };
      paint();
      body.querySelector("#h-q").oninput = paint;
      body.querySelector("#h-save").onclick = () => {
        const blob = new Blob([msgs.map(line).join("\n")], { type: "text/plain" });
        const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `IMs with ${name(uid)}.txt` });
        a.click();
      };
    },
  });
}

export function buddyMenu(uid, x, y) {
  const isBuddy = buddyIDs().has(uid);
  contextMenu(x, y, [
    { label: "💬 Send Instant Message", action: () => openIM(uid) },
    { label: "📎 Send File…", action: () => sendFileTo(uid) },
    { label: "📞 Talk", action: () => import("./voice.js").then((m) => m.startCall(uid, name(uid))) },
    { label: "📹 Video Chat", action: () => import("./voice.js").then((m) => m.startCall(uid, name(uid), { video: true })) },
    { label: "🪪 Get Info", action: () => openInfo(uid) },
    { label: "🔔 Buddy Alert…", action: () => openBuddyAlert(uid) },
    { label: "📜 IM History", action: () => openHistory(uid) },
    { label: "📸 Photo Albums", action: () => import("./albums.js").then((m) => m.openAlbums(uid)) },
    { label: "✉️ Invite to Chat…", action: () => {
      const room = prompt(`Invite ${name(uid)} to which chat room?`, "Lobby");
      if (room) push(ref(db, `invites/${uid}`), { from: state.uid, room, message: "Come chat with me!", ts: serverTimestamp() }).catch(() => {});
    } },
    "-",
    ...(isBuddy
      ? [{ label: "📁 Move to Group…", action: () => moveToGroup(uid) }, { label: "🗑 Remove Buddy", danger: true, action: () => removeBuddy(uid) }]
      : [{ label: "➕ Add Buddy", action: () => openAddBuddy(name(uid)) }]),
    { label: state.blocked.has(uid) ? "✅ Unblock" : "⛔ Block", danger: !state.blocked.has(uid), action: () => toggleBlock(uid) },
  ]);
}

function moveToGroup(uid) {
  const names = state.groups.map((g, i) => `${i + 1}. ${g.name}`).join("\n");
  const pick = Number(prompt(`Move ${name(uid)} to which group?\n${names}`)) - 1;
  if (!state.groups[pick]) return;
  state.groups.forEach((g) => (g.members = g.members.filter((m) => m !== uid)));
  state.groups[pick].members.push(uid);
  saveGroups();
}

async function removeBuddy(uid) {
  state.groups.forEach((g) => (g.members = g.members.filter((m) => m !== uid)));
  await saveGroups();
}

/** Opens a file picker, then sends the chosen file to `uid`. */
export function sendFileTo(uid) {
  const input = document.createElement("input");
  input.type = "file";
  input.onchange = () => { const f = input.files[0]; if (f) { openIM(uid, { quiet: true }); sendFile(uid, f); } };
  input.click();
}

/** The classic "File Transfer" pop-up with a progress bar. Returns an updater. */
function transferWindow(tid, { fileName, size, direction, who }) {
  const id = "xfer." + tid;
  const started = Date.now();
  openWindow(id, {
    title: direction === "send" ? `Sending to ${who}` : `Receiving from ${who}`, icon: "📎", width: 300, height: 230,
    render(body) {
      body.innerHTML = `<div><b>📎 ${esc(fileName)}</b> <span class="small muted">${sizeLabel(size)}</span></div>
        <div class="xfer-bar"><div></div></div>
        <div class="small" data-status>${direction === "send" ? "Starting upload…" : "Starting download…"}</div>
        <div class="small muted" data-speed></div>
        <div class="row" style="margin-top:8px"><span></span><button class="btn small-btn" data-x="close">Close</button></div>`;
      body.querySelector("[data-x=close]").onclick = () => closeWindow(id);
    },
  });
  return (fraction, statusText, done = false) => {
    const w = getWindow(id);
    if (!w) return;
    w.body.querySelector(".xfer-bar > div").style.width = Math.round(fraction * 100) + "%";
    w.body.querySelector("[data-status]").textContent = statusText;
    const secs = Math.max(0.5, (Date.now() - started) / 1000);
    const rate = (size * fraction) / secs;
    w.body.querySelector("[data-speed]").textContent = done ? `Took ${Math.round(secs)} seconds`
      : `${sizeLabel(rate)}/sec · about ${Math.max(1, Math.round((size - size * fraction) / Math.max(rate, 1)))} sec left`;
    if (done) setTimeout(() => closeWindow(id), 4000);
  };
}

function newGroup() {
  const n = prompt("Name for the new group:");
  if (!n || !n.trim()) return;
  state.groups.push({ id: crypto.randomUUID().toUpperCase(), name: n.trim(), members: [], collapsed: false });
  saveGroups();
}

export function openAddBuddy(prefill = "") {
  openWindow("addbuddy", {
    title: "Add a Buddy", icon: "➕", width: 300, height: 300,
    render(body) {
      body.innerHTML = `<form id="ab">
        <label>Buddy's Screen Name <input id="ab-sn" value="${esc(typeof prefill === "string" ? prefill : "")}" required></label>
        <label>Group <select id="ab-g">${state.groups.map((g) => `<option value="${g.id}">${esc(g.name)}</option>`).join("")}</select></label>
        <p class="error" id="ab-err"></p>
        <div class="row"><span></span><button class="btn primary">Add Buddy</button></div></form>`;
      body.querySelector("#ab").onsubmit = async (e) => {
        e.preventDefault();
        const err = body.querySelector("#ab-err");
        const key = normalize(body.querySelector("#ab-sn").value);
        const uid = key && (await get(ref(db, `screennames/${key}`))).val();
        if (!uid) { err.textContent = "No one has that screen name."; return; }
        if (uid === state.uid) { err.textContent = "That's you!"; return; }
        state.groups.forEach((g) => (g.members = g.members.filter((m) => m !== uid)));
        state.groups.find((g) => g.id === body.querySelector("#ab-g").value)?.members.push(uid);
        await saveGroups();
        err.style.color = "green";
        err.textContent = `Added ${name(uid)}!`;
        body.querySelector("#ab-sn").value = "";
      };
    },
  });
}

// ---------- IM windows ----------
const smileys = [[/:-?\)/g, "🙂"], [/;-?\)/g, "😉"], [/:-?\(/g, "🙁"], [/:-?D/g, "😀"], [/:-?P/gi, "😛"], [/:-?O/g, "😮"],
  [/8-?\)/g, "😎"], [/:'\(/g, "😢"], [/>:-?\(/g, "😠"], [/:-?\//g, "😕"], [/<3/g, "❤️"]];

function formatText(text) {
  let html = esc(text);
  html = html.replace(/(https?:\/\/[^\s<]+)/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
  for (const [re, emoji] of smileys) html = html.replace(re, (m, off_, full) => {
    // skip anything inside a link we just made
    const before = full.slice(0, off_);
    return before.lastIndexOf("<a ") > before.lastIndexOf("</a>") ? m : emoji;
  });
  return html.replace(/\n/g, "<br>");
}

function styleCSS(s = {}) {
  return `font-family:${esc(s.font || "Verdana")}, Verdana, sans-serif;font-size:${Math.min(28, Math.max(10, Number(s.size) || 14))}px;`
    + `color:${/^#[0-9a-f]{6}$/i.test(s.color || "") ? s.color : "#000"};${s.bold ? "font-weight:bold;" : ""}`
    + `${s.italic ? "font-style:italic;" : ""}${s.underline ? "text-decoration:underline;" : ""}`;
}

const sizeLabel = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB");

export function openIM(uid, { quiet = false } = {}) {
  const id = "im." + uid;
  const conv = conversationID(state.uid, uid);
  const existing = getWindow(id);
  if (existing) { if (!quiet) existing.el.classList.remove("minimized"); return; }
  const myStyle = JSON.parse(localStorage.getItem("du.style") || "null") || { font: "Verdana", size: 14, color: "#000000", bold: false, italic: false, underline: false };
  const refs = [];
  let lastTyping = 0;
  let metas = {};

  openWindow(id, {
    title: `${name(uid)} — Instant Message`, icon: "💬", width: 340, height: 420,
    onClose: () => refs.forEach((r) => off(r)),
    render(body) {
      body.innerHTML = `<div class="im" data-im="${uid}">
        <div class="im-status"><span class="st"></span>
          <span><button class="btn small-btn" data-a="info">Info</button> <button class="btn small-btn" data-a="warn">Warn</button> <button class="btn small-btn" data-a="hist">History</button> <button class="btn small-btn" data-a="talk">📞 Talk</button> <button class="btn small-btn" data-a="video">📹 Video</button> <button class="btn small-btn" data-a="block"></button></span></div>
        <div class="transcript" data-conv="${conv}" style="background:${imBackgroundFor(conv)}"></div>
        <div class="typing"></div>
        <div class="fmt">
          <select data-f="font">${["Verdana", "Arial", "Georgia", "Courier New", "Trebuchet MS", "Times New Roman", "Comic Sans MS", "Impact"]
            .map((f) => `<option ${f === myStyle.font ? "selected" : ""}>${f}</option>`).join("")}</select>
          <button data-f="smaller">A-</button><button data-f="bigger">A+</button>
          <button data-f="bold"><b>B</b></button><button data-f="italic"><i>I</i></button><button data-f="underline"><u>U</u></button>
          <input type="color" data-f="color" value="${myStyle.color}">
          <button data-f="smiley" title="Smileys">🙂</button>
          <label class="btn small-btn" style="margin:0;font-weight:normal" title="Send a file (up to 10 MB)">📎<input type="file" data-f="file" hidden></label>
        </div>
        <div class="compose"><textarea placeholder="Type a message…"></textarea><button class="btn primary">Send</button></div>
      </div>`;
      const tx = body.querySelector(".transcript");
      const ta = body.querySelector("textarea");
      const paintStyle = () => {
        ta.style.cssText = styleCSS(myStyle);
        ["bold", "italic", "underline"].forEach((k) => body.querySelector(`[data-f=${k}]`).classList.toggle("on", !!myStyle[k]));
        localStorage.setItem("du.style", JSON.stringify(myStyle));
      };
      paintStyle();
      body.querySelector("[data-f=font]").onchange = (e) => { myStyle.font = e.target.value; paintStyle(); };
      body.querySelector("[data-f=smaller]").onclick = () => { myStyle.size = Math.max(11, myStyle.size - 2); paintStyle(); };
      body.querySelector("[data-f=bigger]").onclick = () => { myStyle.size = Math.min(28, myStyle.size + 2); paintStyle(); };
      ["bold", "italic", "underline"].forEach((k) => (body.querySelector(`[data-f=${k}]`).onclick = () => { myStyle[k] = !myStyle[k]; paintStyle(); }));
      body.querySelector("[data-f=color]").oninput = (e) => { myStyle.color = e.target.value; paintStyle(); };
      body.querySelector("[data-f=smiley]").onclick = () => { ta.value += " :) "; ta.focus(); };
      body.querySelector("[data-f=file]").onchange = (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) sendFile(uid, f, body); };
      body.querySelector("[data-a=info]").onclick = () => openInfo(uid);
      body.querySelector("[data-a=hist]").onclick = () => openHistory(uid);
      body.querySelector("[data-a=talk]").onclick = () => import("./voice.js").then((m) => m.startCall(uid, name(uid)));
      body.querySelector("[data-a=video]").onclick = () => import("./voice.js").then((m) => m.startCall(uid, name(uid), { video: true }));
      body.querySelector("[data-a=block]").onclick = () => toggleBlock(uid);
      body.querySelector("[data-a=warn]").onclick = async () => {
        if (alreadyWarned(uid)) { alert(`You already warned ${name(uid)} today.`); return; }
        if (!confirm(`Warn ${name(uid)}? It raises their warning level by 10% for 24 hours.`)) return;
        try { await warn(uid); alert(`${name(uid)} has been warned.`); } catch { alert("Couldn't warn right now."); }
      };

      let lastSend = 0;
      const send = async () => {
        const text = ta.value.trim();
        if (!text) return;
        const level = warningLevel(state.uid);
        if (level >= 50 && Date.now() - lastSend < level * 100) {
          tx.insertAdjacentHTML("beforeend", `<div class="error">Your warning level is ${level}%. Slow down a little.</div>`);
          return;
        }
        lastSend = Date.now();
        ta.value = "";
        try { await sendIM(uid, text, myStyle); sfx.imOut(); }
        catch { ta.value = text; tx.insertAdjacentHTML("beforeend", `<div class="error">Couldn't send — they may have blocked you.</div>`); }
      };
      body.querySelector(".compose .btn").onclick = send;
      ta.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } };
      ta.oninput = () => {
        if (Date.now() - lastTyping > 3000) { lastTyping = Date.now(); set(ref(db, `typing/${conv}/${state.uid}`), serverTimestamp()); }
      };

      const metaRef = ref(db, `filemeta/${conv}`);
      onValue(metaRef, (s) => { metas = s.val() || {}; tx.querySelectorAll("[data-file]").forEach((el) => paintFile(el, uid, conv, metas)); });
      refs.push(metaRef);

      const q = query(ref(db, `messages/${conv}`), orderByKey(), limitToLast(150));
      onValue(q, (snap) => {
        const atBottom = tx.scrollHeight - tx.scrollTop - tx.clientHeight < 60;
        const msgs = [];
        snap.forEach((c) => { msgs.push([c.key, c.val()]); });
        tx.innerHTML = msgs.map(([k, m]) => renderMessage(k, m)).join("");
        tx.querySelectorAll("[data-file]").forEach((el) => paintFile(el, uid, conv, metas));
        if (atBottom || msgs.length < 20) tx.scrollTop = tx.scrollHeight;
        const last = msgs[msgs.length - 1];
        localStorage.setItem("du.read." + conv, String(last?.[1]?.ts || Date.now()));
        refreshBuddyList();
      });
      refs.push(q);

      const typRef = ref(db, `typing/${conv}`);
      onValue(typRef, (s) => {
        const v = s.val() || {};
        const on = v[uid] && Date.now() - v[uid] < 8000;
        body.querySelector(".typing").textContent = on ? `${name(uid)} is typing…` : "";
      });
      refs.push(typRef);
      renderIMStatus(uid);
      if (!quiet) ta.focus();
    },
  });
}

function renderMessage(key, m) {
  const mine = m.from === state.uid;
  const who = mine ? state.me.screenName : (m.name || name(m.from));
  const time = m.ts ? new Date(m.ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" }) : "";
  let content;
  if (m.file) {
    content = `<div class="panel" data-file="${esc(m.file.tid)}" data-name="${esc(m.file.name)}" data-size="${Number(m.file.size) || 0}"
      data-mime="${esc(m.file.mime || "")}" data-mine="${mine ? 1 : 0}" style="margin:3px 0"></div>`;
  } else if (Array.isArray(m.rich) && m.rich.length) {
    content = m.rich.map((seg) => `<span style="${styleCSS(seg.s)}">${formatText(seg.t)}</span>`).join("");
  } else {
    content = `<span style="${styleCSS(m.style)}">${formatText(m.text)}</span>`;
  }
  return `<div class="msg"><span class="who ${mine ? "me" : "them"}">${m.auto ? "Auto response from " : ""}${esc(who)}</span>
    <time>(${time})</time>: ${content}</div>`;
}

function renderIMStatus(uid) {
  const win = getWindow("im." + uid);
  if (!win) return;
  const u = state.users[uid];
  const p = presence(u);
  const st = win.body.querySelector(".st");
  if (st) st.innerHTML = iconHTML(uid, 26) + " " + { online: "🟢 Online", away: `🟠 Away: ${esc(u?.away || "")}`, idle: `⚪ Idle ${idleMin(u)} min`,
    offline: "⚫ Offline — they'll get it when they sign on" }[p] + (warningLevel(uid) ? ` · ⚠️ ${warningLevel(uid)}%` : "");
  const b = win.body.querySelector("[data-a=block]");
  if (b) b.textContent = state.blocked.has(uid) ? "Unblock" : "Block";
  setTitle("im." + uid, `${name(uid)} — Instant Message`);
}

async function sendIM(uid, text, style, { auto = false, file = null } = {}) {
  const conv = conversationID(state.uid, uid);
  const msg = { from: state.uid, name: state.me.screenName, text, ts: serverTimestamp(),
    style: { font: style.font, size: style.size, color: style.color, bold: !!style.bold, italic: !!style.italic, underline: !!style.underline } };
  if (auto) msg.auto = true;
  if (file) msg.file = file;
  await push(ref(db, `messages/${conv}`), msg);
  const preview = text.slice(0, 80);
  await set(ref(db, `inbox/${uid}/${conv}`), { with: state.uid, from: state.uid, ts: serverTimestamp(), preview }).catch(() => {});
  await set(ref(db, `inbox/${state.uid}/${conv}`), { with: uid, from: state.uid, ts: serverTimestamp(), preview }).catch(() => {});
  remove(ref(db, `typing/${conv}/${state.uid}`)).catch(() => {});
}

function autoReply(uid, conv) {
  if (!state.away) return;
  if (Date.now() - (state.lastAuto[conv] || 0) < 300000) return;
  state.lastAuto[conv] = Date.now();
  const text = state.away.replaceAll("%n", name(uid)).replaceAll("%t", new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }))
    .replaceAll("%d", new Date().toLocaleDateString());
  sendIM(uid, text, { font: "Verdana", size: 14, color: "#000000" }, { auto: true }).catch(() => {});
}

// ---------- File transfer (same format as the iPhone app) ----------
const CHUNK = 192 * 1024;

async function sendFile(uid, file, body) {
  if (file.size > 10 * 1024 * 1024) { alert("That file is over 10 MB. DialedUp can send files up to 10 MB."); return; }
  const conv = conversationID(state.uid, uid);
  const tid = "f" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const chunks = Math.max(1, Math.ceil(bytes.length / CHUNK));
  const mime = file.type || "application/octet-stream";
  await set(ref(db, `filemeta/${conv}/${tid}`), { from: state.uid, to: uid, name: file.name, size: bytes.length, mime,
    chunks, uploaded: 0, status: "uploading", ts: serverTimestamp() });
  await sendIM(uid, `📎 ${file.name} (${sizeLabel(bytes.length)})`, { font: "Verdana", size: 14, color: "#000000" },
    { file: { tid, name: file.name, size: bytes.length, mime } });
  const progress = transferWindow(tid, { fileName: file.name, size: bytes.length, direction: "send", who: name(uid) });
  try {
    for (let i = 0; i < chunks; i++) {
      progress(i / chunks, `Sending… ${Math.round((i / chunks) * 100)}%`);
      const part = bytes.subarray(i * CHUNK, Math.min(bytes.length, (i + 1) * CHUNK));
      let bin = "";
      for (let j = 0; j < part.length; j += 0x8000) bin += String.fromCharCode.apply(null, part.subarray(j, j + 0x8000));
      await set(ref(db, `filechunks/${conv}/${tid}/${i}`), btoa(bin));
      await update(ref(db, `filemeta/${conv}/${tid}`), { uploaded: i + 1 });
    }
    await update(ref(db, `filemeta/${conv}/${tid}`), { status: "ready" });
    progress(1, `Sent! Waiting for ${name(uid)} to accept.`, true);
  } catch {
    await update(ref(db, `filemeta/${conv}/${tid}`), { status: "failed" }).catch(() => {});
    progress(0, "Sending failed. Check your connection and try again.");
  }
}

const received = {};   // tid → object URL (this visit only)

function paintFile(el, uid, conv, metas) {
  const tid = el.dataset.file;
  const meta = metas[tid];
  const mine = el.dataset.mine === "1";
  const fname = el.dataset.name, size = Number(el.dataset.size);
  const pct = meta ? Math.round(((meta.uploaded || 0) / Math.max(1, meta.chunks || 1)) * 100) : 0;
  let status = "";
  if (received[tid]) {
    status = el.dataset.mime.startsWith("image/") ? `<img src="${received[tid]}" style="max-width:100%;border-radius:6px" alt=""><br>` : "";
    status += `<a class="btn small-btn" href="${received[tid]}" download="${esc(fname)}">💾 Save</a>`;
  } else if (!meta) status = `<span class="small muted">No longer available.</span>`;
  else if (mine) {
    status = { uploading: `Sending… ${pct}%`, ready: `Waiting for ${esc(name(uid))} to accept`, accepted: `${esc(name(uid))} is receiving it…`,
      received: `✅ Received by ${esc(name(uid))}`, declined: `${esc(name(uid))} declined.`, canceled: "Canceled.", failed: "Sending failed." }[meta.status] || "";
  } else {
    if (meta.status === "uploading") status = `${esc(name(uid))} is sending… ${pct}%`;
    else if (meta.status === "ready" || meta.status === "accepted")
      status = `<button class="btn small-btn" data-x="decline">Decline</button> <button class="btn primary small-btn" data-x="accept">Accept</button>`;
    else status = { received: "Received on another device.", declined: "You declined this file.", canceled: "They canceled it.", failed: "It didn't finish." }[meta.status] || "";
  }
  el.innerHTML = `<b>📎 ${esc(fname)}</b> <span class="small muted">${sizeLabel(size)}</span><div class="small" style="margin-top:4px">${status}</div>`;
  el.querySelector("[data-x=accept]")?.addEventListener("click", () => acceptFile(el, conv, tid, meta));
  el.querySelector("[data-x=decline]")?.addEventListener("click", async () => {
    await update(ref(db, `filemeta/${conv}/${tid}`), { status: "declined" });
    remove(ref(db, `filechunks/${conv}/${tid}`));
  });
}

async function acceptFile(el, conv, tid, meta) {
  el.querySelector(".small").textContent = "Receiving… 0%";
  const progress = transferWindow(tid, { fileName: el.dataset.name, size: Number(el.dataset.size), direction: "receive", who: name(meta.from) });
  await update(ref(db, `filemeta/${conv}/${tid}`), { status: "accepted" }).catch(() => {});
  const parts = [];
  for (let i = 0; i < (meta.chunks || 1); i++) {
    const b64 = (await get(ref(db, `filechunks/${conv}/${tid}/${i}`))).val();
    if (!b64) { el.querySelector(".small").textContent = "That file isn't available anymore."; return; }
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let j = 0; j < bin.length; j++) arr[j] = bin.charCodeAt(j);
    parts.push(arr);
    el.querySelector(".small").textContent = `Receiving… ${Math.round(((i + 1) / meta.chunks) * 100)}%`;
    progress((i + 1) / meta.chunks, `Receiving… ${Math.round(((i + 1) / meta.chunks) * 100)}%`);
  }
  received[tid] = URL.createObjectURL(new Blob(parts, { type: el.dataset.mime || "application/octet-stream" }));
  await update(ref(db, `filemeta/${conv}/${tid}`), { status: "received" });
  remove(ref(db, `filechunks/${conv}/${tid}`));
  progress(1, "Done! Tap 💾 Save in the IM window to keep it.", true);
  sfx.imIn();
}

// ---------- Info / block ----------
async function toggleBlock(uid) {
  const r = ref(db, `blocks/${state.uid}/${uid}`);
  if (state.blocked.has(uid)) await remove(r); else await set(r, true);
  renderIMStatus(uid);
}

export function openInfo(uid) {
  openWindow("info." + uid, {
    title: `Info: ${name(uid)}`, icon: "🪪", width: 320, height: 420,
    render(body) {
      const u = state.users[uid] || {};
      const p = presence(u);
      const isBuddy = buddyIDs().has(uid);
      body.innerHTML = `<div style="display:flex;gap:10px;align-items:center">${iconHTML(uid, 56)}<h2 style="margin:0 0 4px;color:var(--grape)">${esc(u.screenName || "…")}</h2></div>
        <p class="small">${{ online: "🟢 Online", away: "🟠 Away", idle: `⚪ Idle ${idleMin(u)} min`, offline: `⚫ Offline${u.lastSeen ? " · last seen " + new Date(u.lastSeen).toLocaleString() : ""}` }[p]}</p>
        ${u.away ? `<div class="panel"><h3>Away Message</h3>${formatText(u.away)}</div>` : ""}
        <div class="panel"><h3>Profile</h3>${u.profile ? formatText(u.profile) : "<span class='muted'>(no profile)</span>"}</div>
        ${u.interests || u.location ? `<div class="panel"><h3>Interests</h3>${esc(u.interests || "")}${u.location ? `<br><span class="small muted">📍 ${esc(u.location)}</span>` : ""}</div>` : ""}
        <div class="row">
          <button class="btn primary small-btn" data-x="im">Send IM</button>
          <button class="btn small-btn" data-x="file">📎 Send File</button>
          <a class="btn small-btn" href="home.html?u=${encodeURIComponent(normalize(u.screenName || ""))}" target="_blank">🌐 Home Page</a>
          ${isBuddy ? `<button class="btn small-btn" data-x="remove">Remove Buddy</button>` : `<button class="btn small-btn" data-x="add">Add Buddy</button>`}
          <button class="btn danger small-btn" data-x="block">${state.blocked.has(uid) ? "Unblock" : "Block"}</button>
        </div>`;
      body.querySelector("[data-x=im]").onclick = () => openIM(uid);
      body.querySelector("[data-x=file]").onclick = () => sendFileTo(uid);
      body.querySelector("[data-x=add]")?.addEventListener("click", () => openAddBuddy(u.screenName));
      body.querySelector("[data-x=remove]")?.addEventListener("click", async () => {
        state.groups.forEach((g) => (g.members = g.members.filter((m) => m !== uid)));
        await saveGroups();
        closeWindow("info." + uid);
      });
      body.querySelector("[data-x=block]").onclick = async () => { await toggleBlock(uid); closeWindow("info." + uid); };
    },
  });
}

// ---------- Away & profile ----------
async function setAwayMsg(msg) {
  state.away = msg;
  await update(ref(db, `users/${state.uid}`), { away: msg });
  refreshBuddyList();
}

export function openAway() {
  openWindow("away", {
    title: "Away Message", icon: "📝", width: 340, height: 440,
    render(body) {
      const saved = JSON.parse(localStorage.getItem("du.awaySaved") || "null") || ["Away from my desk. Leave a message!", "brb", "Out living my best life. Back at %t."];
      body.innerHTML = `<label>Your away message<textarea id="aw" rows="4">${esc(state.away)}</textarea></label>
        <p class="small muted">%n = their screen name · %t = time · %d = date</p>
        <div class="row"><button class="btn" id="back" ${state.away ? "" : "disabled"}>I'm Back</button>
          <button class="btn" id="save">Save</button><button class="btn primary" id="go">I'm Away</button></div>
        <div class="panel" style="margin-top:10px"><h3>Saved messages</h3><ul class="list" id="saved"></ul></div>`;
      const ta = body.querySelector("#aw");
      const paint = () => {
        body.querySelector("#saved").innerHTML = saved.map((m, i) =>
          `<li class="row"><a href="#" data-i="${i}">${esc(m)}</a><button class="btn small-btn" data-del="${i}">🗑</button></li>`).join("");
        body.querySelectorAll("[data-i]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); ta.value = saved[a.dataset.i]; }));
        body.querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => { saved.splice(b.dataset.del, 1); store(); paint(); }));
      };
      const store = () => localStorage.setItem("du.awaySaved", JSON.stringify(saved));
      paint();
      const setAway = async (msg) => {
        state.away = msg;
        await update(ref(db, `users/${state.uid}`), { away: msg });
        refreshBuddyList();
        closeWindow("away");
      };
      body.querySelector("#go").onclick = () => setAway(ta.value.trim() || "I am away right now.");
      body.querySelector("#back").onclick = () => setAway("");
      body.querySelector("#save").onclick = () => { const t = ta.value.trim(); if (t && !saved.includes(t)) { saved.unshift(t); store(); paint(); } };
    },
  });
}

export function openProfile() {
  openWindow("profile", {
    title: "My Profile", icon: "🪪", width: 340, height: 460,
    render(body) {
      const u = state.users[state.uid] || state.me;
      body.innerHTML = `<div class="panel" style="display:flex;gap:10px;align-items:center"><span id="pf-icon">${iconHTML(state.uid, 56)}</span>
          <div><b>Buddy Icon</b><br><label class="btn small-btn" style="margin:4px 0 0;display:inline-block;font-weight:normal">Choose a picture<input type="file" accept="image/*" id="pf-file" hidden></label>
          <span class="small muted" id="pf-msg"></span></div></div>
        <label>About me<textarea id="pf" rows="6">${esc(u.profile || "")}</textarea></label>
        <label>Interests (for the Member Directory)<input id="pi" value="${esc(u.interests || "")}" placeholder="music, sneakers, basketball"></label>
        <label>Location<input id="pl" value="${esc(u.location || "")}" placeholder="Brooklyn, NY"></label>
        <label class="check"><input type="checkbox" id="pd" ${localStorage.getItem("du.listed." + state.uid) === "1" ? "checked" : ""}> List me in the Member Directory (screen name, interests and location only)</label>
        <div class="row"><span class="small muted">Buddies see this in Info.</span><button class="btn primary" id="ps">Save</button></div>`;
      body.querySelector("#pf-file").onchange = async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        body.querySelector("#pf-msg").textContent = "Saving…";
        try { await setMyIcon(f); body.querySelector("#pf-msg").textContent = "Saved!"; }
        catch { body.querySelector("#pf-msg").textContent = "Couldn't use that picture."; }
      };
      document.addEventListener("du:icons", () => { const el = body.querySelector("#pf-icon"); if (el) el.innerHTML = iconHTML(state.uid, 56); });
      body.querySelector("#ps").onclick = async () => {
        const interests = body.querySelector("#pi").value, location = body.querySelector("#pl").value;
        await update(ref(db, `users/${state.uid}`), { profile: body.querySelector("#pf").value, interests, location });
        const listed = body.querySelector("#pd").checked;
        localStorage.setItem("du.listed." + state.uid, listed ? "1" : "0");
        if (listed) await set(ref(db, `directory/${state.uid}`), { screenName: state.me.screenName, interests, location }).catch(() => {});
        else await remove(ref(db, `directory/${state.uid}`)).catch(() => {});
        closeWindow("profile");
      };
    },
  });
}

export function openDirectory() {
  openWindow("directory", {
    title: "Member Directory", icon: "🔎", width: 340, height: 460,
    async render(body) {
      body.innerHTML = `<p class="small muted" style="margin-top:0">Only members who chose to be listed (in My Profile) show up here.</p>
        <input id="dq" placeholder="Search names, interests, places…"><ul class="list" id="dr" style="margin-top:8px"><li class="muted">Loading…</li></ul>`;
      const all = (await get(ref(db, "directory")).catch(() => null))?.val() || {};
      const paint = () => {
        const q = body.querySelector("#dq").value.toLowerCase().trim();
        const people = Object.entries(all).filter(([id, u]) => id !== state.uid && u.screenName &&
          (!q || [u.screenName, u.interests, u.location].some((x) => (x || "").toLowerCase().includes(q))))
          .sort((a, b) => a[1].screenName.localeCompare(b[1].screenName)).slice(0, 100);
        body.querySelector("#dr").innerHTML = people.map(([id, u]) =>
          `<li><a href="#" data-u="${id}"><b>${esc(u.screenName)}</b></a> <span class="small muted">${esc(u.interests || "")}${u.location ? " · 📍 " + esc(u.location) : ""}</span></li>`).join("")
          || `<li class="muted">No members found.</li>`;
        body.querySelectorAll("[data-u]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); nameCache[a.dataset.u] = all[a.dataset.u].screenName; openInfo(a.dataset.u); }));
      };
      body.querySelector("#dq").oninput = paint;
      paint();
    },
  });
}

// ---------- Chat rooms (People Plaza) ----------
export function openChatRooms(room) {
  if (typeof room === "string" && room) return openPlazaRoom(room);
  openPeoplePlaza();
}
