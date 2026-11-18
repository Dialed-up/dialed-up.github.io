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
import { pickEmoji, QUICK_REACTIONS } from "./emoji.js";
import { uploadMedia, paintMedia, isMedia, startRecording } from "./media.js";

const state = {
  uid: null, me: { screenName: "" }, users: {}, groups: [], inbox: {}, blocked: new Set(), notices: {},
  away: "", listeners: [], timers: [], icons: {}, known: {}, loadedUsers: false, loadedInbox: false, lastAuto: {},
};

export const me = () => state.me;
// Screen names for people who aren't buddies come from a small public list of names only.
const nameCache = {};
const fetching = new Set();
function lookUpName(uid) {
  if (!uid || fetching.has(uid) || nameCache[uid]) return;
  fetching.add(uid);
  const timeout = new Promise((_, bad) => setTimeout(() => bad(new Error("slow")), 8000));
  Promise.race([get(ref(db, `names/${uid}`)), timeout]).then((s) => {
    if (s.val()) { nameCache[uid] = s.val(); document.dispatchEvent(new CustomEvent("du:users")); refreshBuddyList(); }
  }).catch(() => {}).finally(() => setTimeout(() => fetching.delete(uid), 3000));
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
  if (b64) return `<img class="bicon" src="${String(b64).startsWith("data:image/") ? b64 : "data:image/jpeg;base64," + b64}" width="${size}" height="${size}" alt="">`;
  const n = name(uid);
  const hue = [...n].reduce((h, c) => h + c.charCodeAt(0), 0) % 360;
  return `<span class="bicon letter" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.55)}px;background:hsl(${hue} 65% 55%)">${esc((n[0] || "?").toUpperCase())}</span>`;
}

/** Shrink a picture to a 96×96 square and save it as your Buddy Icon. */
export async function setMyIcon(file) {
  // Animated GIFs stay animated (as long as they're small enough)
  if (file.type === "image/gif") {
    if (file.size > 200 * 1024) throw new Error("That GIF is too big. Animated icons can be up to 200 KB.");
    const dataUrl = await new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = bad; r.readAsDataURL(file); });
    await set(ref(db, `icons/${state.uid}`), dataUrl);
    import("./profile.js").then((m) => m.refreshPublicIcon?.(state.uid, dataUrl));
    return;
  }
  const img = await createImageBitmap(file);
  const side = Math.min(img.width, img.height);
  const c = document.createElement("canvas");
  c.width = c.height = 96;
  c.getContext("2d").drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 96, 96);
  const b64 = c.toDataURL("image/jpeg", 0.75).split(",")[1];
  await set(ref(db, `icons/${state.uid}`), b64);
  import("./profile.js").then((m) => m.refreshPublicIcon?.(state.uid, b64));
}
/** Everyone signed on right now (not just buddies), newest activity first. */
/** Buddies who are signed on right now, most recently active first. */
export const onlineMembers = () => [...buddyIDs()]
  .filter((id) => presence(state.users[id]) !== "offline")
  .sort((a, b) => (state.users[b]?.lastSeen || 0) - (state.users[a]?.lastSeen || 0));
export const memberCount = () => buddyIDs().size;
export const buddyList = () => [...new Set(state.groups.flatMap((g) => g.members))];

// ---------- Presence ----------
export function presence(u, now = Date.now()) {
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
  state.prevSeen = state.me.lastSeen || 0;   // when you were last on, so we can show what you missed
  state.away = state.me.away || "";
  try {
    const raw = (await get(ref(db, `buddylists/${uid}`))).val();
    state.groups = raw ? JSON.parse(raw) : [];
  } catch { state.groups = []; }
  if (!state.groups.length) state.groups = [{ id: crypto.randomUUID().toUpperCase(), name: "Buddies", members: [], collapsed: false }];

  const created = Date.parse(auth.currentUser.metadata?.creationTime || "") || null;
  await update(meRef, { signedOn: true, fg: document.visibilityState === "visible", lastSeen: serverTimestamp(), idleSince: null, onlineSince: serverTimestamp(),
    ...(created && state.me.since !== created ? { since: created } : {}) });
  onDisconnect(meRef).update({ signedOn: false, fg: false, lastSeen: serverTimestamp() });
  // "fg" = DialedUp is on screen right now. Push alerts are skipped only while it is.
  window.addEventListener("pagehide", () => state.uid && update(ref(db, `users/${state.uid}`), { fg: false }).catch(() => {}));
  state.timers.push(setInterval(() => update(meRef, { lastSeen: serverTimestamp(), signedOn: true }), 60000));
  set(ref(db, `names/${uid}`), state.me.screenName || "").catch(() => {});
  // Every 5 seconds: notice buddies whose connection quietly went away (closed the app without signing off)
  state.timers.push(setInterval(() => { checkPresenceChanges(); refreshBuddyList(); }, 5000));
  document.addEventListener("visibilitychange", onVisibility);

  await syncBuddyOf();   // tell the database who my buddies are first, so their status is readable
  syncWatches();
  import("./social.js").then((m) => {
    social = m;
    [...watches.keys()].forEach((u) => { if (!storyWatched.has(u)) { storyWatched.add(u); m.watchStories(u, refreshBuddyList); } });
    document.addEventListener("du:stories", refreshBuddyList);
  });
  setTimeout(() => { state.loadedUsers = true; }, 4000);
  listen(".info/connected", (v) => {
    const was = state.connected;
    state.connected = v === true;
    if (state.connected && was === false) {
      // Back online: re-announce presence and reload buddies' info
      update(meRef, { signedOn: true, lastSeen: serverTimestamp(), fg: document.visibilityState === "visible" }).catch(() => {});
      onDisconnect(meRef).update({ signedOn: false, fg: false, lastSeen: serverTimestamp() });
      watches.forEach((refs) => refs.forEach((r) => off(r))); watches.clear(); retries.clear();
      syncBuddyOf().then(syncWatches);
    }
    refreshBuddyList();
  });
  listen(`inbox/${uid}`, onInbox);
  listen(`blocks/${uid}`, (v) => { state.blocked = new Set(Object.keys(v || {})); refreshBuddyList(); });
  listen(`buddylists/${uid}`, (v) => {
    try { if (v) { state.groups = JSON.parse(v); syncWatches(); refreshBuddyList(); } } catch {}
  });
}

// ---------- Only load info for people you're connected to ----------
const watches = new Map();
let social = null;               // social.js (Buddy Updates rings), loaded after sign-on
const storyWatched = new Set();
const retries = new Map();   // uid → how many times we've retried reading their status   // uid → [userRef, iconRef]

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
      // DialedUp and DIM can both be open: if one tab closes and marks me offline, the other puts me back.
      if (uid === state.uid && s.val() && s.val().signedOn === false && !window.__duSigningOff && auth.currentUser)
        update(ref(db, `users/${uid}`), { signedOn: true, lastSeen: serverTimestamp() }).catch(() => {});
      checkPresenceChanges();
      refreshBuddyList();
      if (getWindow("im." + uid)) renderIMStatus(uid);
      document.dispatchEvent(new CustomEvent("du:users"));
    }, () => {
      // Not allowed yet (e.g. they were just added): drop this watch and try again shortly.
      const w = watches.get(uid);
      if (w) { w.forEach((r) => off(r)); watches.delete(uid); }
      const tries = (retries.get(uid) || 0) + 1;
      retries.set(uid, tries);
      if (tries <= 6) setTimeout(() => { if (state.uid) syncWatches(); }, 4000 * tries);
    });
    onValue(ir, (s) => {
      if (s.val()) state.icons[uid] = s.val(); else delete state.icons[uid];
      refreshBuddyList();
      document.dispatchEvent(new CustomEvent("du:icons"));
    }, () => {});
    watches.set(uid, [ur, ir]);
    if (social && !storyWatched.has(uid)) { storyWatched.add(uid); social.watchStories(uid, refreshBuddyList); }
  }
}

export function stopChat() {
  watches.forEach((refs) => refs.forEach((r) => off(r)));
  watches.clear();
  state.listeners.forEach((r) => off(r));
  state.timers.forEach(clearInterval);
  document.removeEventListener("visibilitychange", onVisibility);
  Object.assign(state, { uid: null, listeners: [], timers: [], known: {}, loadedUsers: false, loadedInbox: false, users: {}, inbox: {}, notices: {} });
  storyWatched.clear();
}

function onVisibility() {
  if (!state.uid) return;
  const r = ref(db, `users/${state.uid}`);
  if (document.hidden) update(r, { fg: false, idleSince: serverTimestamp(), lastSeen: serverTimestamp() });
  else {
    update(r, { fg: true, idleSince: null, lastSeen: serverTimestamp(), signedOn: true });
    // Coming back to the tab: if any buddy's info never loaded, try again
    if ([...buddyIDs()].some((b) => !state.users[b])) {
      [...buddyIDs()].filter((b) => !state.users[b]).forEach((b) => { const w = watches.get(b); if (w) { w.forEach((x) => off(x)); watches.delete(b); } });
      retries.clear();
      syncBuddyOf().then(syncWatches);
    }
  }
}

const buddyIDs = () => new Set(state.groups.flatMap((g) => g.members));

function checkPresenceChanges() {
  for (const uid of buddyIDs()) {
    const p = presence(state.users[uid]);
    const before = state.known[uid];
    state.known[uid] = p;
    if (!state.loadedUsers || !before || before === p) continue;
    if (before === "offline") { sfx.doorOpen(); imNotice(uid, "signed on"); }
    else if (p === "offline") { sfx.doorClose(); imNotice(uid, "signed off"); }
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
      import("./notify.js").then((m) => m.notify(`💬 ${name(e.from)}`, e.preview || "New Instant Message", { tag: "im-" + e.from }));
      const existed = !!getWindow("im." + e.from);
      if (!existed && needsKnock(e.from)) { openKnock(e.from, e.preview); continue; }
      openIM(e.from, { quiet: true });
      if (existed) flash("im." + e.from);
      autoReply(e.from, conv);
    }
  }
  if (!state.loadedInbox) {
    const missed = unreadIMs(state.prevSeen);
    if (missed.length) setTimeout(() => { sfx.imIn(); openUnreadIMs(missed, true); }, 1800);
  }
  state.loadedInbox = true;
  refreshBuddyList();
  paintIMBadge();
}

async function saveGroups() {
  document.dispatchEvent(new CustomEvent("du:groups"));
  await set(ref(db, `buddylists/${state.uid}`), JSON.stringify(state.groups));
  await syncBuddyOf();
  syncWatches();
  refreshBuddyList();
}

/** buddyof/{them}/{me} = true for everyone on my list, so the server can let me see their status (and nobody else's). */
async function syncBuddyOf() {
  const mine = buddyIDs();
  const prev = new Set(JSON.parse(localStorage.getItem("du.buddyof." + state.uid) || "[]"));
  await Promise.all([
    ...[...mine].map((b) => set(ref(db, `buddyof/${b}/${state.uid}`), true).catch(() => {})),
    ...[...prev].filter((b) => !mine.has(b)).map((b) => remove(ref(db, `buddyof/${b}/${state.uid}`)).catch(() => {})),
  ]);
  localStorage.setItem("du.buddyof." + state.uid, JSON.stringify([...mine]));
}

// ---------- Buddy List ----------
export function openBuddyList() {
  const desk = document.getElementById("desk");
  const wide = desk.clientWidth > desk.clientHeight;
  const bigScreen = desk.clientWidth >= 1000 && desk.clientHeight >= 560;
  const w = bigScreen ? 250
    : Math.max(220, Math.min(wide ? 250 : 230, Math.round(desk.clientWidth * (wide ? 0.32 : 0.5))));
  openWindow("buddies", {
    title: `${state.me.screenName}'s Buddy List`, icon: "👥", width: w, height: bigScreen ? Math.min(600, desk.clientHeight - 80) : desk.clientHeight - (document.body.classList.contains("dim") ? 70 : 12),
    x: desk.clientWidth - w - (bigScreen ? 24 : 6),
    y: document.body.classList.contains("dim") ? (bigScreen ? 60 : 44) : bigScreen ? 16 : 6, render: () => refreshBuddyList(),
  });
}

function unreadIMCount() {
  return Object.entries(state.inbox || {}).filter(([conv, e]) => e.from && e.from !== state.uid && !state.blocked.has(e.from)
    && (e.ts || 0) > Number(localStorage.getItem("du.read." + conv) || 0)).length;
}

function refreshBuddyList() {
  paintIMBadge();
  if (state.uid) import("./notify.js").then((m) => m.setBadgePart("im", unreadIMCount()));
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
      <span class="dot"></span>${social?.hasStory(uid) ? `<span class="ring ${social.hasNewStory(uid) ? "new" : ""}" data-story="${uid}" title="See ${esc(name(uid))}'s Buddy Update">${iconHTML(uid, 20)}</span>` : iconHTML(uid, 20)}<span>${esc(name(uid))}</span>
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
  // IM Requests: people who aren't buddies that messaged you (last 7 days)
  const weekAgo = Date.now() - 7 * 86400000;
  const entries = Object.values(state.inbox).filter((e) => e.with && e.with !== state.uid && !state.blocked.has(e.with));
  const strangers = [...new Set(entries.filter((e) => (e.ts || 0) > weekAgo && !buddyIDs().has(e.with) && e.from !== state.uid).map((e) => e.with))];
  body.innerHTML = `
    ${state.connected === false ? `<div class="bl-offline">📡 Reconnecting to DialedUp…</div>` : ""}
    <div class="bl-top"><b class="bl-title">Buddy List</b>
      <select id="bl-show" title="Who to show">
        <option value="everyone" ${show === "everyone" ? "selected" : ""}>Show Everyone</option>
        <option value="online" ${show === "online" ? "selected" : ""}>Online Only</option>
        <option value="available" ${show === "available" ? "selected" : ""}>Hide Away & Idle</option>
      </select></div>
    <div class="bl-me" data-me title="Tap to edit your profile">${state.icons[state.uid] ? iconHTML(state.uid, 34) : `<img src="${document.body.classList.contains("dim") ? "img/dim-logo.png" : "img/logo.png"}" width="40" height="28" alt="" style="object-fit:contain">`}
      <div><b>${esc(state.me.screenName)}</b><br>${myStatus}${warningLevel(state.uid) ? `<br><span class="small">⚠️ Warning level ${warningLevel(state.uid)}%</span>` : ""}</div></div>
    <div class="group"><button>▾ Bots (1/1)</button>
      <div class="buddy online bot-row" data-bot="1" title="Always online"><span class="dot"></span><span class="bot-ic">🤖</span><span>DialBot</span><span class="small muted">always on</span></div></div>
    ${groupsHTML}
    ${strangers.length ? `<div class="group im-requests"><div class="row" style="align-items:center"><button>▾ IM Requests (${strangers.length})</button>
      <a href="#" class="small" data-clear-recent title="Clear all IM Requests">Clear</a></div>${strangers.map((u) => row(u).replace('data-buddy=', 'data-recent="1" data-buddy=')).join("")}</div>` : ""}
    ${show === "everyone" ? `<div class="group"><button>▾ Offline (${off_.length})</button>${off_.sort((a, b) => name(a).localeCompare(name(b))).map(row).join("")}</div>` : ""}
    <div class="bl-bottom">
      <button class="bl-icon" data-act="im"><span>💬</span>Send IM</button>
      <button class="bl-icon${state.away ? " on" : ""}" data-act="awaymenu" title="Away Message"><span>🌙<i class="bl-caret">▾</i></span>Away Message</button>
      <button class="bl-icon" data-act="add"><span>➕</span>Add Buddy</button>
      <button class="bl-icon" data-act="rooms"><span>🗨️</span>Chat Rooms</button>
      <button class="bl-icon" data-act="profile"><span>🪪</span>My Profile</button>
    </div>
    <div class="bl-bottom2">
      <button class="btn small-btn" data-act="setup">Setup</button>
    </div>`;
  body.scrollTop = scroll;
  body.querySelector("[data-me]").onclick = () => openProfile();
  body.querySelectorAll("[data-story]").forEach((r) => (r.onclick = (e) => { e.stopPropagation(); social?.viewStories(r.dataset.story, refreshBuddyList); }));
  body.querySelector("[data-bot]").onclick = () => import("./bot.js").then((m) => m.openBot());
  body.querySelectorAll("[data-buddy]").forEach((el) => {
    el.onclick = () => openIM(el.dataset.buddy);
    onMenu(el, (x, y) => el.dataset.recent ? contextMenu(x, y, [
      { label: "💬 Send IM", action: () => openIM(el.dataset.buddy) },
      { label: "➕ Add Buddy", action: () => openAddBuddy(name(el.dataset.buddy)) },
      { label: "🪪 Buddy Info", action: () => openInfo(el.dataset.buddy) },
      "-",
      { label: "✖ Remove Request", action: () => forgetRecent(el.dataset.buddy) },
      { label: "⛔ Block", danger: true, action: () => { if (confirm(`Block ${name(el.dataset.buddy)}?`)) set(ref(db, `blocks/${state.uid}/${el.dataset.buddy}`), true); } },
    ]) : buddyMenu(el.dataset.buddy, x, y));
  });
  body.querySelector("[data-clear-recent]")?.addEventListener("click", (e) => {
    e.preventDefault();
    if (confirm("Clear all IM Requests? Your chat history stays in IM History.")) strangers.forEach((u) => forgetRecent(u));
  });
  body.querySelectorAll("[data-group]").forEach((b) => onMenu(b, (x, y) => groupMenu(b.dataset.group, x, y)));
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
    rooms: () => openPeoplePlaza(),
    profile: () => openProfile(),
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
      { label: "➖ Remove a Buddy…", action: () => pickBuddyToRemove(...at(b)) },
      { label: "📁 Add a Group", action: newGroup },
      { label: "🔎 Get Member Info…", action: () => openGetInfo() },
      { label: "🛠 Manage Buddy List…", action: openEditGroups },
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

function moveToGroup(uid, x, y) {
  const cur = state.groups.find((g) => g.members.includes(uid));
  if (x === undefined) { const r = document.querySelector(`[data-buddy="${uid}"]`)?.getBoundingClientRect(); x = r ? r.left + 20 : innerWidth / 2 - 80; y = r ? r.bottom : innerHeight / 3; }
  contextMenu(x, y, state.groups.map((g) => ({ label: `${g === cur ? "✅" : "📁"} ${g.name}`, action: () => putInGroup(uid, g.id) })));
}
function putInGroup(uid, gid) {
  const dest = state.groups.find((g) => g.id === gid);
  if (!dest) return;
  state.groups.forEach((g) => (g.members = g.members.filter((m) => m !== uid)));
  dest.members.push(uid);
  saveGroups();
}

async function removeBuddy(uid, { ask = true } = {}) {
  if (ask && !confirm(`Remove ${name(uid)} from your Buddy List?`)) return false;
  state.groups.forEach((g) => (g.members = g.members.filter((m) => m !== uid)));
  await saveGroups();
  forgetRecent(uid);
  return true;
}

/** Takes someone off Recent IMs (the conversation itself stays in IM History). */
function forgetRecent(uid) {
  remove(ref(db, `inbox/${state.uid}/${conversationID(state.uid, uid)}`)).catch(() => {});
}

/** Setup → Remove a Buddy: pick from your list. */
function pickBuddyToRemove(x, y) {
  const list = [...buddyIDs()].sort((a, b) => name(a).localeCompare(name(b)));
  if (!list.length) { alert("Your Buddy List is empty."); return; }
  contextMenu(x, y, list.map((u) => ({ label: "➖ " + name(u), action: () => removeBuddy(u) })));
}

/** Opens a file picker, then sends the chosen file to `uid`. */
export function sendFileTo(uid) {
  const input = document.createElement("input");
  input.type = "file";
  input.onchange = () => {
    const f = input.files[0];
    if (!f) return;
    openIM(uid);
    const tx = getWindow("im." + uid)?.body.querySelector(".transcript");
    sendMediaIM(uid, f, isMedia(f) ? {} : { kind: "file" }, tx);
  };
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

// ---------- Editing groups ----------
function groupMenu(gid, x, y) {
  const i = state.groups.findIndex((g) => g.id === gid);
  if (i < 0) return;
  contextMenu(x, y, [
    { label: "✏️ Rename Group", action: () => renameGroup(gid) },
    ...(i > 0 ? [{ label: "⬆️ Move Up", action: () => moveGroup(gid, -1) }] : []),
    ...(i < state.groups.length - 1 ? [{ label: "⬇️ Move Down", action: () => moveGroup(gid, 1) }] : []),
    { label: "📁 Add a Group", action: newGroup },
    { label: "🛠 Manage Buddy List…", action: openEditGroups },
    "-",
    { label: "🗑 Delete Group", danger: true, action: () => deleteGroup(gid) },
  ]);
}
function renameGroup(gid) {
  const g = state.groups.find((x) => x.id === gid);
  const n = prompt("New name for this group:", g?.name || "");
  if (!g || !n || !n.trim()) return;
  g.name = n.trim().slice(0, 30);
  saveGroups();
}
function moveGroup(gid, dir) {
  const i = state.groups.findIndex((g) => g.id === gid), j = i + dir;
  if (i < 0 || j < 0 || j >= state.groups.length) return;
  [state.groups[i], state.groups[j]] = [state.groups[j], state.groups[i]];
  saveGroups();
}
function deleteGroup(gid) {
  const g = state.groups.find((x) => x.id === gid);
  if (!g) return;
  if (state.groups.length === 1) { alert("You need at least one group. Rename this one instead."); return; }
  const others = state.groups.filter((x) => x.id !== gid);
  const dest = others[0];
  if (g.members.length && !confirm(`Delete "${g.name}"? The ${g.members.length} buddy${g.members.length === 1 ? "" : "s"} in it will move to "${dest.name}".`)) return;
  if (!g.members.length && !confirm(`Delete the "${g.name}" group?`)) return;
  g.members.forEach((m) => { if (!dest.members.includes(m)) dest.members.push(m); });
  state.groups = others;
  saveGroups();
}
export function openEditGroups() {
  openWindow("managebuddies", {
    title: "Manage Buddy List", icon: "🛠", width: 360, height: 500, keyword: "managebuddies",
    render(body) {
      const paint = () => {
        const opts = (sel) => state.groups.map((g) => `<option value="${g.id}" ${g.id === sel ? "selected" : ""}>${esc(g.name)}</option>`).join("");
        body.innerHTML = `<div class="row" style="gap:4px;justify-content:flex-start;margin-bottom:8px">
            <button class="btn primary small-btn" data-addb>➕ Add a Buddy</button><button class="btn small-btn" data-new>📁 Add a Group</button></div>
          ${state.groups.map((g, i) => `<div class="panel mg-group">
            <div class="row"><b>📁 ${esc(g.name)} <span class="small muted">(${g.members.length})</span></b>
              <span style="white-space:nowrap"><button class="btn small-btn" data-r="${g.id}" title="Rename group">✏️</button><button class="btn small-btn" data-u="${g.id}" ${i ? "" : "disabled"} title="Move group up">⬆️</button><button class="btn small-btn" data-d="${g.id}" ${i < state.groups.length - 1 ? "" : "disabled"} title="Move group down">⬇️</button><button class="btn danger small-btn" data-x="${g.id}" title="Delete group">🗑</button></span></div>
            ${g.members.length ? `<ul class="list mg-members">${[...g.members].sort((a, b) => name(a).localeCompare(name(b))).map((m) => `<li class="row">
              <span class="mg-name">${iconHTML(m, 18)} ${esc(name(m))}</span>
              <span style="white-space:nowrap"><select data-mv="${m}" title="Move to group">${opts(g.id)}</select>
              <button class="btn small-btn" data-rm="${m}" title="Remove buddy">✖</button></span></li>`).join("")}</ul>`
              : `<p class="small muted" style="margin:4px 0 0">No buddies in this group yet.</p>`}</div>`).join("")}
          <p class="small muted">Tip: press and hold any buddy or group on the Buddy List for quick options.</p>`;
        body.querySelector("[data-addb]").onclick = () => openAddBuddy();
        body.querySelector("[data-new]").onclick = newGroup;
        body.querySelectorAll("[data-r]").forEach((b) => (b.onclick = () => renameGroup(b.dataset.r)));
        body.querySelectorAll("[data-u]").forEach((b) => (b.onclick = () => moveGroup(b.dataset.u, -1)));
        body.querySelectorAll("[data-d]").forEach((b) => (b.onclick = () => moveGroup(b.dataset.d, 1)));
        body.querySelectorAll("[data-x]").forEach((b) => (b.onclick = () => deleteGroup(b.dataset.x)));
        body.querySelectorAll("[data-mv]").forEach((sel) => (sel.onchange = () => putInGroup(sel.dataset.mv, sel.value)));
        body.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = () => {
          removeBuddy(b.dataset.rm);
        }));
      };
      paint();
      const onGroups = () => (getWindow("managebuddies") ? paint() : document.removeEventListener("du:groups", onGroups));
      document.addEventListener("du:groups", onGroups);
    },
  });
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
export const smileys = [[/:-?\)/g, "🙂"], [/;-?\)/g, "😉"], [/:-?\(/g, "🙁"], [/:-?D/g, "😀"], [/:-?P/gi, "😛"], [/:-?O/g, "😮"],
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
    onClose: () => refs.forEach((r) => (r.__cleanup ? r.__cleanup() : off(r))),
    render(body) {
      body.innerHTML = `<div class="im" data-im="${uid}">
        <div class="im-head"><button class="im-who" data-a="menu" title="Tap for IM options"><span class="im-ic"></span><b class="im-name"></b><span class="im-caret">▾</span></button>
          <span class="st"></span></div>
        <div class="transcript" data-conv="${conv}" style="background:${imBackgroundFor(conv)}"></div>
        <div class="typing"></div>
        <div class="fmt">
          <select data-f="font">${["Verdana", "Arial", "Georgia", "Courier New", "Trebuchet MS", "Times New Roman", "Comic Sans MS", "Impact"]
            .map((f) => `<option ${f === myStyle.font ? "selected" : ""}>${f}</option>`).join("")}</select>
          <button data-f="smaller">A-</button><button data-f="bigger">A+</button>
          <button data-f="bold"><b>B</b></button><button data-f="italic"><i>I</i></button><button data-f="underline"><u>U</u></button>
          <input type="color" data-f="color" value="${myStyle.color}">
          <button data-f="smiley" title="Emojis">😀</button>
          <button data-f="mic" title="Record a voice note">🎙</button>
          <label class="btn small-btn" style="margin:0;font-weight:normal" title="Send a photo, video or file (up to 25 MB)">📎<input type="file" data-f="file" hidden></label>
        </div>
        <div class="compose"><textarea placeholder="Type a message…"></textarea><button class="btn primary">Send</button></div>
        <div class="recbar" hidden><span class="rec-dot"></span><b class="rec-time">0:00</b><span class="small muted">Recording voice note…</span>
          <span style="flex:1"></span><button class="btn small-btn" data-r="cancel">Cancel</button><button class="btn primary small-btn" data-r="send">Send 🎙</button></div>
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
      const smileyBtn = body.querySelector("[data-f=smiley]");
      smileyBtn.onclick = () => pickEmoji(smileyBtn, (emo) => {
        const at = ta.selectionStart ?? ta.value.length;
        ta.value = ta.value.slice(0, at) + emo + ta.value.slice(ta.selectionEnd ?? at);
        ta.selectionStart = ta.selectionEnd = at + emo.length;
      });
      body.querySelector("[data-f=file]").onchange = (e) => {
        const f = e.target.files[0]; e.target.value = "";
        if (!f) return;
        sendMediaIM(uid, f, isMedia(f) ? {} : { kind: "file" }, tx);   // every file goes right into the chat (up to 25 MB)
      };
      // Voice notes
      const recbar = body.querySelector(".recbar"), compose = body.querySelector(".compose");
      let rec = null;
      const endRec = () => { rec = null; recbar.hidden = true; compose.hidden = false; };
      body.querySelector("[data-f=mic]").onclick = async () => {
        if (rec) return;
        try {
          rec = await startRecording((s) => (recbar.querySelector(".rec-time").textContent = `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`));
        } catch { alert("DialedUp needs microphone permission to record a voice note."); return; }
        recbar.querySelector(".rec-time").textContent = "0:00";
        recbar.hidden = false; compose.hidden = true;
      };
      recbar.querySelector("[data-r=cancel]").onclick = () => { rec?.cancel(); endRec(); };
      recbar.querySelector("[data-r=send]").onclick = async () => {
        if (!rec) return;
        const { blob, dur } = await rec.stop();
        endRec();
        if (dur < 0.7) return;
        sendMediaIM(uid, blob, { kind: "audio", dur }, tx);
      };
      const doWarn = async () => {
        if (alreadyWarned(uid)) { alert(`You already warned ${name(uid)} today.`); return; }
        if (!confirm(`Warn ${name(uid)}? It raises their warning level by 10% for 24 hours.`)) return;
        try { await warn(uid); alert(`${name(uid)} has been warned.`); } catch { alert("Couldn't warn right now."); }
      };
      const imMenu = (x, y) => contextMenu(x, y, [
        { label: "🪪 Buddy Info", action: () => openInfo(uid) },
        { label: "📎 Send a File", action: () => body.querySelector("[data-f=file]").click() },
        { label: "📞 Talk", action: () => import("./voice.js").then((m) => m.startCall(uid, name(uid))) },
        { label: "📹 Video Chat", action: () => import("./voice.js").then((m) => m.startCall(uid, name(uid), { video: true })) },
        { label: "📜 IM History", action: () => openHistory(uid) },
        ...(buddyIDs().has(uid) ? [{ label: "🗑 Remove Buddy", action: () => removeBuddy(uid) }] : [{ label: "➕ Add Buddy", action: () => openAddBuddy(name(uid)) }]),
        "-",
        { label: "⚠️ Warn", action: doWarn },
        { label: state.blocked.has(uid) ? "✅ Unblock" : "⛔ Block", danger: !state.blocked.has(uid), action: () => toggleBlock(uid) },
      ]);
      const who = body.querySelector("[data-a=menu]");
      who.onclick = () => { const r = who.getBoundingClientRect(); imMenu(r.left, r.bottom + 2); };
      onMenu(who, imMenu);

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
        lastMsgs = msgs;
        const notes = (state.notices[uid] || []).map((n) => [null, n]);
        const all = [...msgs, ...notes].sort((a, b) => (a[1].ts || 0) - (b[1].ts || 0));
        tx.innerHTML = all.map(([k, m]) => (k === null ? noticeHTML(m) : renderMessage(k, m))).join("") + `<div class="seen-line small"></div>`;
        tx.querySelectorAll("[data-file]").forEach((el) => paintFile(el, uid, conv, metas));
        tx.querySelectorAll("[data-media]").forEach((el) => paintMedia(el, conv));
        tx.querySelectorAll(".msg[data-k]").forEach((el) => onMenu(el, (x, y) => reactMenu(conv, el.dataset.k, x, y, el)));
        tx.querySelectorAll(".react-chip").forEach((c) => (c.onclick = () => toggleReaction(conv, c.closest(".msg").dataset.k, c.dataset.e, lastMsgs)));
        paintSeen();
        markSeen();
        if (atBottom || msgs.length < 20) tx.scrollTop = tx.scrollHeight;
        const last = msgs[msgs.length - 1];
        localStorage.setItem("du.read." + conv, String(last?.[1]?.ts || Date.now()));
        refreshBuddyList();
      });
      refs.push(q);

      // Seen receipts
      let theirSeen = 0, lastMsgs = [], seenWritten = 0;
      const paintSeen = () => {
        const line = tx.querySelector(".seen-line");
        if (!line) return;
        const mineLast = [...lastMsgs].reverse().find(([, m]) => m.from === state.uid);
        const theirsAfter = mineLast && lastMsgs.some(([, m]) => m.from !== state.uid && (m.ts || 0) > (mineLast[1].ts || 0));
        line.textContent = mineLast && !theirsAfter && theirSeen >= (mineLast[1].ts || 0) ? `✓✓ Seen ${new Date(theirSeen).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "";
      };
      const markSeen = () => {
        const w = getWindow(id);
        if (!w || w.el.classList.contains("minimized") || document.visibilityState !== "visible") return;
        const newest = [...lastMsgs].reverse().find(([, m]) => m.from !== state.uid);
        if (!newest || (newest[1].ts || 0) <= seenWritten) return;
        seenWritten = newest[1].ts || Date.now();
        set(ref(db, `seen/${conv}/${state.uid}`), serverTimestamp()).catch(() => {});
      };
      const seenRef = ref(db, `seen/${conv}/${uid}`);
      onValue(seenRef, (s) => { theirSeen = s.val() || 0; paintSeen(); }, () => {});
      refs.push(seenRef);
      const onVis = () => markSeen();
      document.addEventListener("visibilitychange", onVis);
      body.addEventListener("pointerdown", markSeen);
      refs.push({ __cleanup: () => document.removeEventListener("visibilitychange", onVis) });

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
  if (m.media?.mid) {
    content = `<div class="im-media" data-media="${esc(JSON.stringify(m.media))}"></div>`;
  } else if (m.file) {
    content = `<div class="panel" data-file="${esc(m.file.tid)}" data-name="${esc(m.file.name)}" data-size="${Number(m.file.size) || 0}"
      data-mime="${esc(m.file.mime || "")}" data-mine="${mine ? 1 : 0}" style="margin:3px 0"></div>`;
  } else if (Array.isArray(m.rich) && m.rich.length) {
    content = m.rich.map((seg) => `<span style="${styleCSS(seg.s)}">${formatText(seg.t)}</span>`).join("");
  } else {
    content = `<span style="${styleCSS(m.style)}">${formatText(m.text)}</span>`;
  }
  const counts = {};
  Object.values(m.reactions || {}).forEach((e) => (counts[e] = (counts[e] || 0) + 1));
  const myReact = m.reactions?.[state.uid];
  const chips = Object.entries(counts).map(([e, n]) => `<button class="react-chip ${myReact === e ? "mine" : ""}" data-e="${esc(e)}">${esc(e)}${n > 1 ? " " + n : ""}</button>`).join("");
  return `<div class="msg" data-k="${esc(key)}"><span class="who ${mine ? "me" : "them"}">${m.auto ? "Auto response from " : ""}${esc(who)}</span>
    <time>(${time})</time>: ${content}${chips ? `<div class="reacts">${chips}</div>` : ""}</div>`;
}

function renderIMStatus(uid) {
  const win = getWindow("im." + uid);
  if (!win) return;
  const u = state.users[uid];
  const p = presence(u);
  const st = win.body.querySelector(".st");
  if (st) {
    st.innerHTML = { online: "🟢 Online", away: "🟠 Away", idle: `⚪ Idle ${idleMin(u)}m`, offline: "⚫ Offline" }[p]
      + (state.blocked.has(uid) ? " · ⛔ Blocked" : "") + (warningLevel(uid) ? ` · ⚠️ ${warningLevel(uid)}%` : "");
    st.title = p === "away" ? `Away: ${u?.away || ""}` : p === "offline" ? "Offline — they'll get it when they sign on" : "";
  }
  const ic = win.body.querySelector(".im-ic");
  if (ic) ic.innerHTML = iconHTML(uid, 22);
  const nm = win.body.querySelector(".im-name");
  if (nm) nm.textContent = name(uid);
  const aw = win.body.querySelector(".im-away");
  if (p === "away" && u?.away) {
    if (!aw) win.body.querySelector(".im-head")?.insertAdjacentHTML("afterend", `<div class="im-away small"></div>`);
    win.body.querySelector(".im-away").textContent = "📝 " + u.away;
  } else aw?.remove();
  setTitle("im." + uid, `${name(uid)} — Instant Message`);
}

async function sendIM(uid, text, style, { auto = false, file = null, media = null } = {}) {
  const conv = conversationID(state.uid, uid);
  const msg = { from: state.uid, name: state.me.screenName, text, ts: serverTimestamp(),
    style: { font: style.font, size: style.size, color: style.color, bold: !!style.bold, italic: !!style.italic, underline: !!style.underline } };
  if (auto) msg.auto = true;
  if (file) msg.file = file;
  if (media) msg.media = media;
  await push(ref(db, `messages/${conv}`), msg);
  if (!auto) acceptFrom(uid);
  const preview = text.slice(0, 80);
  const delivered = await set(ref(db, `inbox/${uid}/${conv}`), { with: state.uid, from: state.uid, ts: serverTimestamp(), preview }).then(() => true, () => false);
  await set(ref(db, `inbox/${state.uid}/${conv}`), { with: uid, from: state.uid, ts: serverTimestamp(), preview }).catch(() => {});
  if (delivered && !auto && uid !== "__bot") import("./notify.js").then((m) => m.pushTo(uid, "im"));
  if (!auto) import("./stats-track.js").then((m) => m.trackIM());
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

// ---------- IMs that came in while you were away ----------
/** Conversations where the last message is from them and you haven't read it (optionally: only since a time). */
function unreadIMs(since = 0) {
  const twoWeeks = Date.now() - 14 * 86400000;
  return Object.entries(state.inbox || {})
    .filter(([conv, e]) => e.from && e.from !== state.uid && e.with && !state.blocked.has(e.with)
      && (e.ts || 0) > Math.max(since, twoWeeks) && (e.ts || 0) > Number(localStorage.getItem("du.read." + conv) || 0))
    .map(([conv, e]) => ({ conv, ...e }))
    .sort((a, b) => (b.ts || 0) - (a.ts || 0));
}

/** The "While You Were Away" / "Unread IMs" window. */
export function openUnreadIMs(list = null, away = false) {
  const items = list || unreadIMs();
  openWindow("unreadims", {
    title: away ? "While You Were Away" : "Unread IMs", icon: "📨", width: 330, height: 380, keyword: "unread",
    render(body) {
      const paint = (rows) => {
        body.innerHTML = rows.length ? `<p class="small" style="margin-top:0">${away ? `You got ${rows.length === 1 ? "an IM" : rows.length + " IMs"} while you were signed off:` : "Conversations with new messages:"}</p>
          <ul class="list unread-list">${rows.map((r, i) => `<li data-i="${i}"><span class="ur-who">${iconHTML(r.with, 26)}<span><b>${esc(name(r.with))}</b>
            <span class="small muted">${r.ts ? timeLabel(r.ts) : ""}</span><br><span class="small">${esc((r.preview || "").slice(0, 70))}</span></span></span></li>`).join("")}</ul>
          <div class="row" style="margin-top:8px"><button class="btn small-btn" data-x="clear">Mark All Read</button><button class="btn primary small-btn" data-x="all">Open All</button></div>`
          : `<p class="muted">No unread IMs. You're all caught up! 🎉</p>`;
        body.querySelectorAll("[data-i]").forEach((li) => (li.onclick = () => { openIM(rows[li.dataset.i].with); paint(unreadIMs()); }));
        body.querySelector("[data-x=all]")?.addEventListener("click", () => { rows.forEach((r) => openIM(r.with, { quiet: true })); closeWindow("unreadims"); });
        body.querySelector("[data-x=clear]")?.addEventListener("click", () => {
          rows.forEach((r) => localStorage.setItem("du.read." + r.conv, String(r.ts || Date.now())));
          refreshBuddyList(); paint([]);
        });
      };
      paint(items);
    },
  });
}
const timeLabel = (ts) => {
  const d = new Date(ts), today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) + " " + d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
};

/** Red number on the toolbar's IMs button. */
function paintIMBadge() {
  const btn = document.querySelector('#toolbar [data-open="buddies"]');
  if (!btn) return;
  let b = btn.querySelector(".badge");
  if (!b) { btn.classList.add("has-badge"); btn.insertAdjacentHTML("beforeend", `<b class="badge" hidden></b>`); b = btn.querySelector(".badge"); }
  const n = unreadIMs().length;
  b.textContent = n > 99 ? "99+" : n || "";
  b.hidden = !n;
}

// ---------- "Jerry has signed off" lines inside open IM windows ----------
const noticeHTML = (n) => `<div class="im-notice">${esc(n.text)} <span>${new Date(n.ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span></div>`;
function imNotice(uid, what) {
  const win = getWindow("im." + uid);
  if (!win) return;
  const n = { ts: Date.now(), text: `${name(uid)} has ${what}` };
  (state.notices[uid] ||= []).push(n);
  if (state.notices[uid].length > 30) state.notices[uid].shift();
  const tx = win.body.querySelector(".transcript");
  if (!tx) return;
  const atBottom = tx.scrollHeight - tx.scrollTop - tx.clientHeight < 60;
  tx.querySelector(".seen-line")?.insertAdjacentHTML("beforebegin", noticeHTML(n));
  if (atBottom) tx.scrollTop = tx.scrollHeight;
}

// ---------- Photos, videos & voice notes in IMs ----------
async function sendMediaIM(uid, file, opts, tx) {
  const conv = conversationID(state.uid, uid);
  const isVoice = opts.kind === "audio" && !file.name;
  const label = isVoice ? "🎙 Voice note" : opts.kind === "file" ? `📄 ${file.name || "File"}` : file.type?.startsWith("audio/") ? `🎵 ${file.name || "Audio"}` : file.type?.startsWith("video/") ? "🎬 Video" : "📷 Photo";
  const note = document.createElement("div");
  note.className = "small muted sending-note";
  const what = isVoice ? "voice note" : opts.kind === "file" ? file.name || "file" : file.type?.startsWith("audio/") ? file.name || "audio" : file.type?.startsWith("video/") ? "video" : "photo";
  note.textContent = `Sending ${what}… 0%`;
  tx?.appendChild(note);
  if (tx) tx.scrollTop = tx.scrollHeight;
  try {
    const media = await uploadMedia(conv, state.uid, file, { ...opts, name: file.name || "" }, (f) => (note.textContent = `Sending ${what}… ${Math.round(f * 100)}%`));
    await sendIM(uid, label, { font: "Verdana", size: 14, color: "#000000" }, { media });
    sfx.imOut();
  } catch (e) {
    alert(e.message && !/permission/i.test(e.message) ? e.message : "Couldn't send that. They may have blocked you, or the connection dropped.");
  } finally { note.remove(); }
}

// ---------- Reactions ----------
function reactMenu(conv, key, x, y, el) {
  document.querySelector(".react-bar")?.remove();
  const bar = document.createElement("div");
  bar.className = "react-bar glossy";
  bar.innerHTML = QUICK_REACTIONS.map((e) => `<button data-e="${e}">${e}</button>`).join("") + `<button data-more title="More emojis">＋</button><button data-copy title="Copy text">📋</button>`;
  document.body.appendChild(bar);
  const w = bar.offsetWidth, h = bar.offsetHeight;
  bar.style.left = Math.max(6, Math.min(x - w / 2, innerWidth - w - 6)) + "px";
  bar.style.top = Math.max(6, y - h - 10) + "px";
  const close = () => { bar.remove(); document.removeEventListener("pointerdown", away, true); };
  const away = (ev) => { if (!bar.contains(ev.target)) close(); };
  setTimeout(() => document.addEventListener("pointerdown", away, true), 0);
  bar.onclick = (ev) => {
    const b = ev.target.closest("button");
    if (!b) return;
    close();
    if (b.dataset.e) toggleReaction(conv, key, b.dataset.e);
    else if (b.hasAttribute("data-more")) pickEmoji(el, (e) => toggleReaction(conv, key, e), { keepOpen: false });
    else navigator.clipboard?.writeText(el.innerText.replace(/^.*?\):\s*/, "")).catch(() => {});
  };
}
async function toggleReaction(conv, key, emoji) {
  const r = ref(db, `messages/${conv}/${key}/reactions/${state.uid}`);
  const cur = (await get(r).catch(() => null))?.val();
  if (cur === emoji) await remove(r).catch(() => {}); else await set(r, emoji).catch(() => alert("Couldn't react right now."));
}

// ---------- "Accept IMs from strangers?" ----------
const acceptedKey = () => "du.accepted." + state.uid;
const accepted = () => new Set(JSON.parse(localStorage.getItem(acceptedKey()) || "[]"));
function acceptFrom(uid) {
  const a = accepted();
  if (a.has(uid)) return;
  a.add(uid);
  localStorage.setItem(acceptedKey(), JSON.stringify([...a]));
}
export const askStrangers = () => localStorage.getItem("du.knock") !== "0";
function needsKnock(uid) {
  return askStrangers() && !buddyIDs().has(uid) && !accepted().has(uid);
}
function openKnock(uid, preview = "") {
  const id = "knock." + uid;
  openWindow(id, {
    title: "Incoming IM", icon: "🚪", width: 300, height: 250,
    render(body) {
      body.innerHTML = `<p style="margin-top:0"><b>${esc(name(uid))}</b> isn't on your Buddy List and wants to send you an Instant Message.</p>
        ${preview ? `<div class="panel small" style="font-style:italic">"${esc(preview)}"</div>` : ""}
        <div class="row" style="margin-top:10px;justify-content:flex-end;gap:6px">
          <button class="btn danger small-btn" data-k="block">Block</button>
          <button class="btn small-btn" data-k="ignore">Ignore</button>
          <button class="btn primary small-btn" data-k="accept">Accept</button></div>
        <label class="check small" style="margin-top:8px"><input type="checkbox" data-k="always"> Always accept IMs from everyone</label>`;
      body.querySelector("[data-k=always]").onchange = (e) => localStorage.setItem("du.knock", e.target.checked ? "0" : "1");
      body.querySelector("[data-k=accept]").onclick = () => { acceptFrom(uid); closeWindow(id); openIM(uid); };
      body.querySelector("[data-k=ignore]").onclick = () => closeWindow(id);
      body.querySelector("[data-k=block]").onclick = async () => {
        if (!confirm(`Block ${name(uid)}? They won't be able to IM or mail you.`)) return;
        await set(ref(db, `blocks/${state.uid}/${uid}`), true).catch(() => {});
        closeWindow(id);
      };
    },
  });
}

// ---------- Info / block ----------
async function toggleBlock(uid) {
  const r = ref(db, `blocks/${state.uid}/${uid}`);
  if (state.blocked.has(uid)) await remove(r); else await set(r, true);
  renderIMStatus(uid);
}

export async function openInfo(uid) {
  let u = state.users[uid];
  let isPublic = false;
  if (!u) {
    const pub = (await get(ref(db, `publicprofiles/${uid}`)).catch(() => null))?.val();
    if (pub) { u = pub; isPublic = true; if (pub.icon && !state.icons[uid]) state.icons[uid] = pub.icon; }
  }
  u = u || {};
  openWindow("info." + uid, {
    title: `Info: ${name(uid)}`, icon: "🪪", width: 360, height: 520,
    render(body) {
      const p = isPublic ? "unknown" : presence(u);
      const isBuddy = buddyIDs().has(uid);
      const ago = (ts) => { const m = Math.max(1, Math.round((Date.now() - ts) / 60000)); return m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.floor(m / 1440)} days`; };
      const stats = [
        u.since ? `📅 Member since ${new Date(u.since).toLocaleDateString([], { month: "long", year: "numeric" })}` : "",
        !isPublic && p !== "offline" && u.onlineSince ? `⏱ Online ${ago(u.onlineSince)}` : "",
        !isPublic && p === "idle" && u.idleSince ? `💤 Idle ${ago(u.idleSince)}` : "",
        `⚠️ Warning level ${warningLevel(uid)}%`,
      ].filter(Boolean);
      body.innerHTML = `<div style="display:flex;gap:10px;align-items:center">${iconHTML(uid, 56)}<div><h2 style="margin:0 0 4px;color:var(--grape)">${esc(u.screenName || name(uid) || "…")}</h2>
          <span class="small">${isPublic ? "🌍 Public profile" : { online: "🟢 Online", away: "🟠 Away", idle: "⚪ Idle", offline: `⚫ Offline${u.lastSeen ? " · last seen " + new Date(u.lastSeen).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : ""}` }[p]}</span></div></div>
        <p class="small info-stats">${stats.join(" · ")}</p>
        ${!isPublic && u.away ? `<div class="panel"><h3>Away Message</h3>${formatText(u.away)}</div>` : ""}
        ${!u.screenName ? `<div class="panel"><p style="margin:0">🔒 <b>This profile is private.</b> Only their buddies can see it. You can still send them an IM.</p></div>` : `<div class="info-profile"></div>`}
        <div class="row" style="flex-wrap:wrap;gap:4px">
          <button class="btn primary small-btn" data-x="im">Send IM</button>
          <button class="btn small-btn" data-x="file">📎 Send File</button>
          <a class="btn small-btn" href="home.html?u=${encodeURIComponent(normalize(u.screenName || name(uid) || ""))}" target="_blank">🌐 Home Page</a>
          ${isBuddy ? `<button class="btn small-btn" data-x="remove">Remove Buddy</button>` : `<button class="btn small-btn" data-x="add">Add Buddy</button>`}
          <button class="btn danger small-btn" data-x="block">${state.blocked.has(uid) ? "Unblock" : "Block"}</button>
        </div>`;
      if (u.screenName) import("./profile.js").then((m) => m.renderProfile(body.querySelector(".info-profile"), u, uid, { viewer: state.me.screenName, openDirectory }));
      body.querySelector("[data-x=im]").onclick = () => openIM(uid);
      body.querySelector("[data-x=file]").onclick = () => sendFileTo(uid);
      body.querySelector("[data-x=add]")?.addEventListener("click", () => openAddBuddy(u.screenName || name(uid)));
      body.querySelector("[data-x=remove]")?.addEventListener("click", async () => {
        if (await removeBuddy(uid)) closeWindow("info." + uid);
      });
      body.querySelector("[data-x=block]").onclick = async () => { await toggleBlock(uid); closeWindow("info." + uid); };
    },
  });
}

/** Look up anyone's profile by screen name (shows it if they're your buddy or made it public). */
export function openGetInfo(prefill = "") {
  openWindow("getinfo", {
    title: "Get Member Info", icon: "🔎", width: 300, height: 200, keyword: "getinfo",
    render(body) {
      body.innerHTML = `<form id="gi"><label>Screen name<input id="gi-n" value="${esc(prefill)}" autocapitalize="off" required></label>
        <p class="error" id="gi-e"></p><div class="row"><span class="small muted">Public profiles and your buddies' profiles.</span><button class="btn primary">Get Info</button></div></form>`;
      body.querySelector("#gi").onsubmit = async (e) => {
        e.preventDefault();
        const n = body.querySelector("#gi-n").value.trim();
        const target = (await get(ref(db, `screennames/${normalize(n)}`)).catch(() => null))?.val();
        if (!target) { body.querySelector("#gi-e").textContent = `No one has the screen name "${n}".`; return; }
        if (!nameCache[target]) nameCache[target] = n;
        closeWindow("getinfo");
        openInfo(target);
      };
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
  import("./profile.js").then((m) => m.openProfileEditor({
    uid: state.uid, user: state.users[state.uid] || state.me, screenName: state.me.screenName,
    iconHTML, setMyIcon, openDirectory,
  }));
}

export function openDirectory(startQuery = "") {
  if (getWindow("directory")) closeWindow("directory");
  openWindow("directory", {
    title: "Member Directory", icon: "🔎", width: 340, height: 460,
    async render(body) {
      body.innerHTML = `<p class="small muted" style="margin-top:0">Only members who chose to be listed (in My Profile) show up here.</p>
        <input id="dq" placeholder="Search names, interests, places…" value="${esc(typeof startQuery === "string" ? startQuery : "")}"><ul class="list" id="dr" style="margin-top:8px"><li class="muted">Loading…</li></ul>`;
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
