// Notifications bell: likes, comments, Wall posts, new homies and @mentions, in one list.
import { auth, db, ref, get, set, push, remove, update, onValue, off, query, orderByKey, limitToLast, serverTimestamp, normalize } from "./firebase.js";
import { openWindow, closeWindow, getWindow, esc } from "./wm.js";
import { me, userName, iconHTML, openInfo } from "./chat.js";
import * as sfx from "./sounds.js";

const uid = () => auth.currentUser?.uid;
const seenKey = () => "du.notifSeen." + uid();
const KEEP_DAYS = 30;

const TEXT = {
  like: (n) => `<b>${n}</b> liked your post`,
  comment: (n) => `<b>${n}</b> commented on your post`,
  wall: (n) => `<b>${n}</b> wrote on your Wall`,
  homie: (n) => `<b>${n}</b> added you to their Homies List`,
  mention: (n, x) => `<b>${n}</b> mentioned you${x.room ? ` in <b>${esc(x.room)}</b>` : x.pid ? " in a comment" : ""}`,
};
const ICON = { like: "❤️", comment: "💬", wall: "📝", homie: "➕", mention: "📣" };

/** Sends someone a notification (never to yourself). */
export function notify(to, type, extra = {}) {
  if (!to || !uid() || to === uid() || !TEXT[type]) return;
  const data = { type, from: uid(), n: me()?.screenName || "", ts: serverTimestamp() };
  // "added you to their Homies List" has one fixed spot per person, so it never shows up twice
  if (type === "homie") { set(ref(db, `notifs/${to}/h_${uid()}`), data).catch(() => {}); return; }
  if (extra.text) data.text = String(extra.text).slice(0, 120);
  if (extra.owner) data.owner = extra.owner;
  if (extra.pid) data.pid = extra.pid;
  if (extra.room) data.room = String(extra.room).slice(0, 60);
  push(ref(db, `notifs/${to}`), data).catch(() => {});
}

/** Finds @screennames in a message and notifies each person mentioned (up to 5). */
export async function notifyMentions(text, extra = {}) {
  const names = [...new Set([...String(text || "").matchAll(/@([A-Za-z0-9]{3,16})/g)].map((m) => normalize(m[1])))].slice(0, 5);
  for (const key of names) {
    try { const to = (await get(ref(db, `screennames/${key}`))).val(); if (to) notify(to, "mention", { ...extra, text }); } catch {}
  }
}

// ---------- the bell ----------
let list = [], watchRef = null, first = true;
const unseen = () => list.filter(([, x]) => (x.ts || 0) > Number(localStorage.getItem(seenKey()) || 0)).length;

function paintBell() {
  const n = unseen();
  document.querySelectorAll("[data-bell]").forEach((b) => {
    let badge = b.querySelector(".badge");
    if (!badge) { b.classList.add("has-badge"); b.insertAdjacentHTML("beforeend", `<b class="badge" hidden></b>`); badge = b.querySelector(".badge"); }
    badge.textContent = n > 99 ? "99+" : n || "";
    badge.hidden = !n;
  });
}

export function watchNotifs() {
  stopNotifs();
  first = true;
  watchRef = query(ref(db, `notifs/${uid()}`), orderByKey(), limitToLast(60));
  onValue(watchRef, (s) => {
    const before = list.length ? list[list.length - 1][0] : null;
    list = [];
    s.forEach((c) => { list.push([c.key, c.val()]); });
    list.sort((a, b) => (a[1].ts || 0) - (b[1].ts || 0));
    const newest = list[list.length - 1];
    if (!first && newest && newest[0] !== before && newest[1].from !== uid()) sfx.alertBlip();
    first = false;
    paintBell();
    if (getWindow("notifs")) paintList();
  }, () => {});
  // tidy up: notifications older than 30 days
  setTimeout(() => list.forEach(([k, x]) => Date.now() - (x.ts || 0) > KEEP_DAYS * 86400000 && remove(ref(db, `notifs/${uid()}/${k}`)).catch(() => {})), 8000);
  watchAddedMe();
}
export function stopNotifs() { if (watchRef) off(watchRef); watchRef = null; list = []; if (addedRef) off(addedRef); addedRef = null; }

/** A letter from DialedUp in your own Mailbox (no reply button; can link to a member). */
export function systemMail(subject, body, { about = null } = {}) {
  if (!uid()) return;
  const item = { system: true, fromName: "DialedUp", subject: String(subject).slice(0, 200), body: String(body).slice(0, 5000), ts: serverTimestamp(), read: false };
  if (about) item.about = about;
  push(ref(db, `mail/${uid()}`), item).catch(() => {});
}

// Anyone who adds you (from DialedUp, Instantly or the BuddyChat iPhone app) shows up in Alerts.
// buddyof/{you} lists everyone who has you on their Homies List.
let addedRef = null;
function watchAddedMe() {
  const me_ = uid(), key = "du.addedMe." + me_;
  addedRef = ref(db, `buddyof/${me_}`);
  onValue(addedRef, async (s) => {
    const now = Object.keys(s.val() || {});
    let known = null;
    try { known = JSON.parse(localStorage.getItem(key) || "null"); } catch {}
    localStorage.setItem(key, JSON.stringify(now));
    if (!known) return;   // first time on this device: just remember who's there
    for (const u of now.filter((x) => !known.includes(x) && x !== me_)) {
      const n = (await get(ref(db, `names/${u}`)).catch(() => null))?.val() || "Someone";
      const spot = ref(db, `notifs/${me_}/h_${u}`);
      if ((await get(spot).catch(() => null))?.val() != null) continue;   // already told you about this person
      set(spot, { type: "homie", from: u, n: String(n).slice(0, 20), ts: serverTimestamp() }).catch(() => {});
      systemMail(`👋 ${n} added you to their Homies List`,
        `Hi ${me()?.screenName || "there"},\n\n${n} just added you to their Homies List on DialedUp.\n\nWant to add them back? Tap "➕ Add Back" below, or open their profile to say hi.\n\n— DialedUp`,
        { about: u });
    }
  }, () => {});
}

const ago = (ts) => {
  const m = Math.max(0, Math.round((Date.now() - ts) / 60000));
  return m < 1 ? "just now" : m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`;
};

function paintList() {
  const body = getWindow("notifs")?.body;
  if (!body) return;
  const seen = Number(localStorage.getItem(seenKey()) || 0);
  const rows = [...list].reverse();
  body.innerHTML = rows.length ? `<ul class="list notif-list">${rows.map(([k, x]) => `<li class="notif ${(x.ts || 0) > seen ? "new" : ""}" data-k="${esc(k)}">
      <span class="notif-ic">${iconHTML(x.from, 34)}<i>${ICON[x.type] || "🔔"}</i></span>
      <span class="notif-txt">${(TEXT[x.type] || TEXT.mention)(esc(x.n || userName(x.from)), x)}${x.text ? `<br><span class="small muted">“${esc(String(x.text).slice(0, 80))}”</span>` : ""}
      <br><span class="small muted">${x.ts ? ago(x.ts) : ""}</span></span></li>`).join("")}</ul>
      <div class="row" style="margin-top:6px"><span></span><button class="btn small-btn" data-clear>Clear all</button></div>`
    : `<p class="muted" style="text-align:center;margin-top:30px">🔔 No notifications yet.<br><span class="small">Likes, comments, Wall posts, @mentions and people who add you to their Homies List show up here.</span></p>`;
  body.querySelectorAll("[data-k]").forEach((li) => (li.onclick = () => {
    const x = list.find(([k]) => k === li.dataset.k)?.[1];
    if (!x) return;
    if (x.room) import("./people.js").then((m) => m.openRoom(x.room));
    else if (x.type === "homie") openInfo(x.from);
    else if (x.owner) openInfo(x.owner);
    else openInfo(x.from);
  }));
  body.querySelector("[data-clear]")?.addEventListener("click", () => {
    if (confirm("Clear all notifications?")) remove(ref(db, `notifs/${uid()}`)).catch(() => {});
  });
}

export function openNotifs() {
  openWindow("notifs", {
    title: "Notifications", icon: "🔔", width: 340, height: 480, keyword: "alerts",
    onClose: () => { localStorage.setItem(seenKey(), String(Date.now())); paintBell(); },
    render() {
      paintList();
      // opening the bell marks everything as seen (the "new" highlight stays until you close it)
      setTimeout(() => { const newest = list[list.length - 1]?.[1]?.ts || Date.now(); localStorage.setItem(seenKey(), String(Math.max(newest, Date.now()))); paintBell(); }, 300);
    },
  });
}
