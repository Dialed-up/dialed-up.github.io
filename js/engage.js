// Reasons to come back: sign-on streaks, badges, birthday alerts, leaderboards (+ weekly Trivia Night),
// Trending, People You May Know, invite links and interest groups.
import { auth, db, ref, get, set, push, remove, update, runTransaction, onValue, off, query, orderByKey, limitToLast, serverTimestamp, normalize } from "./firebase.js";
import { openWindow, closeWindow, getWindow, esc, contextMenu } from "./wm.js";
import { me, userName, iconHTML, buddyList, openInfo, openIM, openAddBuddy } from "./chat.js";
import * as sfx from "./sounds.js";

const uid = () => auth.currentUser.uid;
const pad = (n) => String(n).padStart(2, "0");
const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const weekKey = (d = new Date()) => { const t = new Date(d); t.setHours(0, 0, 0, 0); t.setDate(t.getDate() - ((t.getDay() + 6) % 7)); return dayKey(t); };   // Monday of this week

// =================== Badges ===================
export const BADGES = {
  founding: ["⭐", "Founding Member", "Joined DialedUp in its first days"],
  streak7: ["🔥", "On Fire", "7-day sign-on streak"],
  streak30: ["💯", "Dedicated", "30-day sign-on streak"],
  streak100: ["👑", "Legend", "100-day sign-on streak"],
  nightowl: ["🦉", "Night Owl", "Signed on between 2 and 5 AM"],
  earlybird: ["🐦", "Early Bird", "Signed on between 5 and 7 AM"],
  chatterbox: ["💬", "Chatterbox", "Sent 1,000 IMs"],
  regular: ["🗨️", "Room Regular", "200 messages in chat rooms"],
  poster: ["📸", "Poster", "Shared 10 posts"],
  trivia: ["🧠", "Trivia Champ", "Scored 8+ in Trivia"],
  recruiter: ["🎟", "Recruiter", "Invited a friend who joined"],
  host: ["🎧", "Party Host", "Hosted a Listening or Watch Party"],
};
const FOUNDING_BEFORE = Date.UTC(2027, 0, 1);   // everyone who joins before 2027 is a Founding Member

async function award(key) {
  const r = ref(db, `users/${uid()}/badges/${key}`);
  try {
    if ((await get(r)).val()) return;
    await set(r, Date.now());
    const [emo, title] = BADGES[key];
    sfx.alertBlip();
    toast(`${emo} New badge: <b>${esc(title)}</b>!`);
  } catch {}
}
export const awardBadge = award;

export function badgesHTML(badges) {
  const keys = Object.keys(badges || {}).filter((k) => BADGES[k]);
  return keys.length ? `<div class="badges">${keys.map((k) => `<span class="badge-chip" title="${esc(BADGES[k][1])}: ${esc(BADGES[k][2])}">${BADGES[k][0]} ${esc(BADGES[k][1])}</span>`).join("")}</div>` : "";
}

/** Count something on your account (IMs, room messages, posts) and award badges at milestones. */
export async function countUp(what) {
  try {
    const res = await runTransaction(ref(db, `users/${uid()}/counts/${what}`), (n) => (n || 0) + 1);
    const n = res.snapshot.val() || 0;
    if (what === "ims" && n >= 1000) award("chatterbox");
    if (what === "room" && n >= 200) award("regular");
    if (what === "posts" && n >= 10) award("poster");
  } catch {}
}

function toast(html) {
  const t = document.createElement("div");
  t.className = "du-toast";
  t.innerHTML = html;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add("gone"), 4200);
  setTimeout(() => t.remove(), 5000);
}

// =================== Sign-on: streak, time badges, birthdays, invite credit ===================
export async function onSignOn() {
  const me_ = me();
  // streak
  try {
    const r = ref(db, `users/${uid()}/streak`);
    const s = (await get(r)).val() || {};
    const today = dayKey(), yesterday = dayKey(new Date(Date.now() - 86400000));
    if (s.last !== today) {
      const n = s.last === yesterday ? (s.n || 0) + 1 : 1;
      await set(r, { n, last: today, best: Math.max(n, s.best || 0) });
      if (n > 1) setTimeout(() => toast(`🔥 <b>${n}-day streak!</b> Keep signing on every day.`), 3000);
      if (n >= 7) award("streak7");
      if (n >= 30) award("streak30");
      if (n >= 100) award("streak100");
    }
  } catch {}
  const h = new Date().getHours();
  if (h >= 2 && h < 5) award("nightowl");
  if (h >= 5 && h < 7) award("earlybird");
  if ((me_.since || Date.now()) < FOUNDING_BEFORE) award("founding");
  if (Number(localStorage.getItem("du.trivia.best") || 0) >= 8) award("trivia");
  try { if (Object.keys((await get(ref(db, `invited/${uid()}`))).val() || {}).length) award("recruiter"); } catch {}
  setTimeout(birthdays, 6000);
  // Friday = Trivia Night
  if (new Date().getDay() === 5 && localStorage.getItem("du.tn") !== dayKey()) {
    localStorage.setItem("du.tn", dayKey());
    setTimeout(() => toast(`🏆 <b>It's Trivia Night!</b> <a href="#" data-tn>Play now</a> and top this week's leaderboard.`), 8000);
  }
}
document.addEventListener("click", (e) => { if (e.target.closest?.("[data-tn]")) { e.preventDefault(); openLeaderboards(); } });

// Birthdays from buddies' Member Info ("May 4", "5/4", "December 10th")
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
function parseBirthday(text) {
  const t = String(text || "").toLowerCase().trim();
  let m = t.match(/^(\d{1,2})[/.-](\d{1,2})/);
  if (m) return [Number(m[1]), Number(m[2])];
  m = t.match(/([a-z]{3})[a-z]*\.?\s+(\d{1,2})/);
  if (m && MONTHS.includes(m[1])) return [MONTHS.indexOf(m[1]) + 1, Number(m[2])];
  m = t.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3})/);
  if (m && MONTHS.includes(m[2])) return [MONTHS.indexOf(m[2]) + 1, Number(m[1])];
  return null;
}
async function birthdays() {
  const now = new Date(), key = "du.bday." + dayKey();
  const shown = new Set(JSON.parse(localStorage.getItem(key) || "[]"));
  for (const b of buddyList()) {
    if (shown.has(b)) continue;
    let card = null;
    try { card = (await get(ref(db, `users/${b}/card`))).val(); } catch {}
    const md = parseBirthday(card?.birthday);
    if (!md || md[0] !== now.getMonth() + 1 || md[1] !== now.getDate()) continue;
    shown.add(b);
    localStorage.setItem(key, JSON.stringify([...shown]));
    sfx.alertBlip();
    openWindow("bday." + b, {
      title: "Birthday!", icon: "🎂", width: 300, height: 230,
      render(body) {
        body.innerHTML = `<div style="text-align:center"><div style="font-size:42px">🎂🎉</div><p>It's <b>${esc(userName(b))}</b>'s birthday today!</p>
          <div class="row" style="justify-content:center;gap:4px;flex-wrap:wrap"><button class="btn primary small-btn" data-x="card">💌 Send a Card</button>
          <button class="btn small-btn" data-x="wall">📝 Post on Wall</button><button class="btn small-btn" data-x="im">💬 IM</button></div></div>`;
        body.querySelector("[data-x=card]").onclick = () => { closeWindow("bday." + b); import("./portal.js").then((m) => m.runKeyword("greetings")); };
        body.querySelector("[data-x=wall]").onclick = () => { closeWindow("bday." + b); openInfo(b); };
        body.querySelector("[data-x=im]").onclick = () => { closeWindow("bday." + b); openIM(b); };
      },
    });
  }
}

// =================== Leaderboards (+ weekly Trivia Night) ===================
const GAMES = { trivia: "❓ Trivia", scramble: "🔤 Word Scramble", snake: "🐍 Byte Snake" };
/** Saves your best score for a game (and this week's Trivia Night board). */
export async function submitScore(game, score) {
  if (!auth.currentUser || !GAMES[game] || !(score > 0)) return;
  const entry = { s: score, n: me().screenName, ts: Date.now() };
  const save = async (path) => {
    try { const cur = (await get(ref(db, path))).val(); if (!cur || score > cur.s) await set(ref(db, path), entry); } catch {}
  };
  await save(`leaderboards/${game}/${uid()}`);
  if (game === "trivia") { await save(`triviaweek/${weekKey()}/${uid()}`); if (score >= 8) award("trivia"); }
}

async function topScores(path, n = 10) {
  try { return Object.entries((await get(ref(db, path))).val() || {}).map(([u, e]) => ({ u, ...e })).sort((a, b) => b.s - a.s || a.ts - b.ts).slice(0, n); } catch { return []; }
}

export function openLeaderboards() {
  openWindow("leaderboards", {
    title: "Leaderboards", icon: "🏆", width: 360, height: 520, keyword: "leaderboards",
    async render(body) {
      body.innerHTML = `<p class="muted">Loading scores…</p>`;
      const isFriday = new Date().getDay() === 5;
      const week = await topScores(`triviaweek/${weekKey()}`);
      const boards = await Promise.all(Object.keys(GAMES).map(async (g) => [g, await topScores(`leaderboards/${g}`)]));
      const table = (rows, unit = "") => rows.length ? `<ol class="lb">${rows.map((r, i) => `<li class="${r.u === uid() ? "me" : ""}"><span>${["🥇", "🥈", "🥉"][i] || i + 1 + "."} ${esc(r.n)}</span><b>${r.s}${unit}</b></li>`).join("")}</ol>` : `<p class="small muted">No scores yet. Be the first!</p>`;
      body.innerHTML = `<div class="panel trivia-night"><h3>🏆 Trivia Night — this week</h3>
          <p class="small" style="margin:0 0 6px">${isFriday ? "🎉 <b>It's Trivia Night!</b> Play now to climb the board." : "Every week's best Trivia scores. The board resets Monday — Friday is Trivia Night!"}</p>
          ${table(week, "/10")}<button class="btn primary small-btn" data-play>❓ Play Trivia</button></div>
        ${boards.map(([g, rows]) => `<div class="panel"><h3>${GAMES[g]} — all-time</h3>${table(rows)}</div>`).join("")}`;
      body.querySelector("[data-play]").onclick = () => import("./portal.js").then((m) => m.runKeyword("trivia"));
    },
  });
}

// =================== Trending ===================
export function openTrending() {
  openWindow("trending", {
    title: "Trending on DialedUp", icon: "🔥", width: 380, height: 540, keyword: "trending",
    async render(body) {
      body.innerHTML = `<p class="muted">🔥 Checking what's hot…</p>`;
      const { categories } = await import("./people.js");
      const names = [...Object.values(categories).flat()];
      try { Object.values((await get(ref(db, "roomlist"))).val() || {}).forEach((r) => !r.private && names.push(r.name)); } catch {}
      const rooms = (await Promise.all([...new Set(names)].map(async (n) => {
        try {
          const m = (await get(ref(db, `rooms/${normalize(n)}/members`))).val() || {};
          return [n, Object.values(m).filter((v) => Date.now() - (typeof v === "object" ? v.t : v) < 120000).length];
        } catch { return [n, 0]; }
      }))).filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]).slice(0, 8);
      // most-liked posts from you and your buddies this week
      const weekAgo = Date.now() - 7 * 86400000;
      const posts = (await Promise.all([uid(), ...buddyList()].map(async (o) => {
        try {
          const s = await get(query(ref(db, `posts/${o}`), orderByKey(), limitToLast(20)));
          const out = [];
          s.forEach((c) => { const p = c.val(); if ((p.ts || 0) > weekAgo) out.push({ o, pid: c.key, p }); });
          return Promise.all(out.map(async (x) => ({ ...x, likes: Object.keys((await get(ref(db, `postlikes/${o}/${x.pid}`)).catch(() => null))?.val() || {}).length })));
        } catch { return []; }
      }))).flat().filter((x) => x.likes > 0).sort((a, b) => b.likes - a.likes).slice(0, 5);
      // busiest message board threads
      let threads = [];
      try {
        const all = (await get(ref(db, "boards"))).val() || {};
        threads = Object.entries(all).flatMap(([bk, b]) => Object.entries(b.threads || {}).map(([tid, t]) => ({ bk, tid, ...t })))
          .filter((t) => (t.last || t.ts || 0) > weekAgo).sort((a, b) => (b.replies || 0) - (a.replies || 0)).slice(0, 5);
      } catch {}
      let events = [];
      try { events = Object.values((await get(ref(db, "events"))).val() || {}).filter((e) => e.start > Date.now() - 2 * 3600000).sort((a, b) => a.start - b.start).slice(0, 3); } catch {}
      body.innerHTML = `
        <div class="panel"><h3>💬 Hot chat rooms</h3>${rooms.length ? `<ul class="list">${rooms.map(([n, c]) => `<li class="row"><a href="#" data-room="${esc(n)}">💬 ${esc(n)}</a><span class="small">${c} 🟢</span></li>`).join("")}</ul>` : `<p class="small muted">The rooms are quiet. Start the party!</p>`}</div>
        <div class="panel"><h3>❤️ Most-liked posts this week</h3>${posts.length ? `<ul class="list">${posts.map((x) => `<li><a href="#" data-who="${x.o}"><b>${esc(x.p.n)}</b></a>: ${esc((x.p.text || "📷 Photo").slice(0, 60))} <span class="small">❤️ ${x.likes}</span></li>`).join("")}</ul>` : `<p class="small muted">No liked posts yet this week.</p>`}</div>
        <div class="panel"><h3>📌 Busy message boards</h3>${threads.length ? `<ul class="list">${threads.map((t) => `<li>${esc(t.title || "Thread")} <span class="small muted">· ${t.replies || 0} replies</span></li>`).join("")}</ul>` : `<p class="small muted">No busy threads this week.</p>`}</div>
        <div class="panel"><h3>🎤 Coming up</h3>${events.length ? `<ul class="list">${events.map((e) => `<li>${esc(e.title)} <span class="small muted">· ${new Date(e.start).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}</span></li>`).join("")}</ul>` : `<p class="small muted">No live events scheduled.</p>`}
          <button class="btn small-btn" data-ev>See Live Events</button></div>`;
      body.querySelectorAll("[data-room]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); import("./people.js").then((m) => m.openRoom(a.dataset.room)); }));
      body.querySelectorAll("[data-who]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); openInfo(a.dataset.who); }));
      body.querySelector("[data-ev]").onclick = () => import("./portal.js").then((m) => m.runKeyword("events"));
    },
  });
}

// =================== People You May Know ===================
export function openPYMK() {
  openWindow("pymk", {
    title: "People You May Know", icon: "👋", width: 340, height: 460, keyword: "pymk",
    async render(body) {
      body.innerHTML = `<p class="muted">Finding people…</p>`;
      const mine = new Set([uid(), ...buddyList()]);
      const added = Object.keys((await get(ref(db, `buddyof/${uid()}`)).catch(() => null))?.val() || {}).filter((u) => !mine.has(u));
      const myInterests = String(me().interests || "").toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
      const dir = (await get(ref(db, "directory")).catch(() => null))?.val() || {};
      const alike = Object.entries(dir).filter(([u]) => !mine.has(u) && !added.includes(u)).map(([u, d]) => {
        const theirs = String(d.interests || "").toLowerCase().split(",").map((s) => s.trim());
        return { u, d, shared: myInterests.filter((i) => theirs.includes(i)) };
      }).filter((x) => x.shared.length).sort((a, b) => b.shared.length - a.shared.length).slice(0, 15);
      const nameOf = async (u) => (userName(u) !== "…" && userName(u)) || (await get(ref(db, `names/${u}`)).catch(() => null))?.val() || "Someone";
      const addedRows = await Promise.all(added.slice(0, 15).map(async (u) => ({ u, n: await nameOf(u) })));
      body.innerHTML = `
        <div class="panel"><h3>➕ Added you as a buddy</h3>${addedRows.length ? `<ul class="list">${addedRows.map((x) => `<li class="row"><a href="#" data-info="${x.u}">${esc(x.n)}</a><button class="btn primary small-btn" data-add="${esc(x.n)}">Add Back</button></li>`).join("")}</ul>` : `<p class="small muted">Nobody new.</p>`}</div>
        <div class="panel"><h3>❤️ Likes what you like</h3>${alike.length ? `<ul class="list">${alike.map((x) => `<li class="row"><span><a href="#" data-info="${x.u}">${esc(x.d.screenName)}</a><br><span class="small muted">${esc(x.shared.join(", "))}</span></span><button class="btn small-btn" data-add="${esc(x.d.screenName)}">Add</button></li>`).join("")}</ul>`
          : `<p class="small muted">${myInterests.length ? "No matches yet." : "Add Interests to your profile (My Profile → Member Info) to find people who like the same things."}</p>`}</div>
        <button class="btn small-btn" data-invite>🎟 Invite Friends to DialedUp</button>`;
      body.querySelectorAll("[data-info]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); openInfo(a.dataset.info); }));
      body.querySelectorAll("[data-add]").forEach((b) => (b.onclick = () => openAddBuddy(b.dataset.add)));
      body.querySelector("[data-invite]").onclick = openInvite;
    },
  });
}

// =================== Invite links ===================
export function openInvite() {
  const link = `${location.origin}/?invite=${encodeURIComponent(me().screenName)}`;
  openWindow("invite.link", {
    title: "Invite Friends", icon: "🎟", width: 330, height: 300, keyword: "invite",
    render(body) {
      body.innerHTML = `<p style="margin-top:0">Send friends your invite link. When they join, you'll be buddies automatically and you earn the <b>🎟 Recruiter</b> badge!</p>
        <input readonly value="${esc(link)}" style="width:100%">
        <div class="row" style="margin-top:8px;gap:4px;justify-content:flex-start"><button class="btn primary small-btn" data-share>📤 Share</button><button class="btn small-btn" data-copy>📋 Copy Link</button></div>
        <p class="small muted" id="inv-count"></p>`;
      body.querySelector("[data-copy]").onclick = () => navigator.clipboard?.writeText(link).then(() => (body.querySelector("[data-copy]").textContent = "✅ Copied!")).catch(() => {});
      body.querySelector("[data-share]").onclick = () => (navigator.share ? navigator.share({ title: "Join me on DialedUp", text: `Come hang out with me on DialedUp! My screen name is ${me().screenName}.`, url: link }).catch(() => {}) : body.querySelector("[data-copy]").click());
      get(ref(db, `invited/${uid()}`)).then((s) => { const n = Object.keys(s.val() || {}).length; if (n) body.querySelector("#inv-count").textContent = `🎉 ${n} friend${n === 1 ? "" : "s"} joined from your invites.`; }).catch(() => {});
    },
  });
}

/** Right after a new member signs up from an invite link: credit the inviter, add each other, say hi. */
export async function handleInviteAfterSignup(addBuddyByUid) {
  const inviter = localStorage.getItem("du.invitedBy");
  if (!inviter) return;
  localStorage.removeItem("du.invitedBy");
  try {
    const iu = (await get(ref(db, `screennames/${normalize(inviter)}`))).val();
    if (!iu || iu === uid()) return;
    await set(ref(db, `invited/${iu}/${uid()}`), Date.now());
    await addBuddyByUid?.(iu);
    award("founding");
    setTimeout(() => openIM(iu), 1500);
  } catch {}
}
// Remember who invited you (from the ?invite= link) until you sign up.
try { const inv = new URLSearchParams(location.search).get("invite"); if (inv) localStorage.setItem("du.invitedBy", inv.slice(0, 20)); } catch {}

// =================== Interest groups ===================
export function openGroups() {
  let r = null;
  openWindow("groups", {
    title: "Groups", icon: "🌍", width: 380, height: 520, keyword: "groups", onClose: () => r && off(r),
    render(body) {
      body.innerHTML = `<div class="row" style="margin-bottom:6px"><span class="small">Join groups for the things you love. Each has its own chat room and Wall.</span>
        <button class="btn primary small-btn" data-new>+ New Group</button></div><div id="gl"><p class="muted">Loading groups…</p></div>`;
      body.querySelector("[data-new]").onclick = newGroup;
      r = ref(db, "groups");
      onValue(r, async (s) => {
        const groups = Object.entries(s.val() || {});
        const counts = await Promise.all(groups.map(async ([gid]) => Object.keys((await get(ref(db, `groupmembers/${gid}`)).catch(() => null))?.val() || {}).length));
        const rows = groups.map(([gid, g], i) => ({ gid, g, c: counts[i] })).sort((a, b) => b.c - a.c);
        const el = body.querySelector("#gl");
        if (!el) return;
        el.innerHTML = rows.length ? rows.map(({ gid, g, c }) => `<button class="group-tile" data-g="${gid}"><span class="g-emo">${esc(g.emoji || "🌍")}</span>
            <span><b>${esc(g.name)}</b><br><span class="small muted">${esc((g.desc || "").slice(0, 70))}</span></span><span class="small">${c} 👥</span></button>`).join("")
          : `<p class="muted">No groups yet. Start the first one!</p>`;
        el.querySelectorAll("[data-g]").forEach((b) => (b.onclick = () => openGroup(b.dataset.g)));
      });
    },
  });
}

function newGroup() {
  openWindow("groups.new", {
    title: "New Group", icon: "🌍", width: 320, height: 330,
    render(body) {
      body.innerHTML = `<form id="ng"><label>Group name <input id="ng-n" maxlength="40" required placeholder="NYC DJs"></label>
        <label>Emoji <input id="ng-e" maxlength="4" value="🎧"></label>
        <label>What's it about? <textarea id="ng-d" maxlength="200" rows="3"></textarea></label>
        <div class="row"><span></span><button class="btn primary">Create Group</button></div></form>`;
      body.querySelector("#ng").onsubmit = async (e) => {
        e.preventDefault();
        try {
          const g = { key: "g" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8) };
          await set(ref(db, `groups/${g.key}`), { name: body.querySelector("#ng-n").value.trim(), emoji: body.querySelector("#ng-e").value.trim() || "🌍",
            desc: body.querySelector("#ng-d").value.trim(), owner: uid(), ts: serverTimestamp() });
          await set(ref(db, `groupmembers/${g.key}/${uid()}`), true);
          closeWindow("groups.new");
          openGroup(g.key);
        } catch { alert("Couldn't create the group right now."); }
      };
    },
  });
}

export async function openGroup(gid) {
  const g = (await get(ref(db, `groups/${gid}`)).catch(() => null))?.val();
  if (!g) { alert("That group doesn't exist anymore."); return; }
  let wallCleanup = null, mr = null;
  openWindow("group." + gid, {
    title: `${g.emoji || "🌍"} ${g.name}`, icon: "🌍", width: 420, height: 580,
    onClose: () => { wallCleanup?.(); mr && off(mr); },
    render(body) {
      body.innerHTML = `<div class="panel"><h3 style="margin:0">${esc(g.emoji || "🌍")} ${esc(g.name)}</h3><p class="small" style="margin:4px 0">${esc(g.desc || "")}</p>
          <div class="row" style="justify-content:flex-start;gap:4px;flex-wrap:wrap"><button class="btn primary small-btn" data-join></button>
          <button class="btn small-btn" data-chat>💬 Group Chat</button>${g.owner === uid() || uid() === "Dh35JEPVTiWIB96X03RGeiVmQN03" ? `<button class="btn danger small-btn" data-del>Delete Group</button>` : `<button class="btn small-btn" data-rep>🚩</button>`}</div>
          <p class="small muted g-members"></p></div><div class="g-wall"></div>`;
      let member = false;
      mr = ref(db, `groupmembers/${gid}`);
      onValue(mr, (s) => {
        const m = s.val() || {};
        member = !!m[uid()];
        body.querySelector("[data-join]").textContent = member ? "✅ Joined (leave)" : "➕ Join Group";
        const ids = Object.keys(m);
        Promise.all(ids.slice(0, 12).map(async (u) => (userName(u) !== "…" && userName(u)) || (await get(ref(db, `names/${u}`)).catch(() => null))?.val() || "…")).then((ns) => {
          const el = body.querySelector(".g-members");
          if (el) el.textContent = `${ids.length} member${ids.length === 1 ? "" : "s"}${ns.length ? ": " + ns.join(", ") + (ids.length > 12 ? "…" : "") : ""}`;
        });
        if (member && !wallCleanup) import("./social.js").then((sm) => (wallCleanup = sm.renderWall(body.querySelector(".g-wall"), "g_" + gid, { label: g.name, groupOwnerUid: g.owner })));
        if (!member) { wallCleanup?.(); wallCleanup = null; body.querySelector(".g-wall").innerHTML = `<p class="small muted">Join the group to see and write on its Wall.</p>`; }
      }, () => {});
      body.querySelector("[data-join]").onclick = () => (member ? remove(ref(db, `groupmembers/${gid}/${uid()}`)) : set(ref(db, `groupmembers/${gid}/${uid()}`), true)).catch(() => {});
      body.querySelector("[data-chat]").onclick = () => import("./people.js").then((m) => m.openRoom("Group " + g.name, "Groups"));
      body.querySelector("[data-del]")?.addEventListener("click", async () => {
        if (!confirm(`Delete the group "${g.name}"?`)) return;
        await remove(ref(db, `groupmembers/${gid}`)).catch(() => {});
        await remove(ref(db, `groups/${gid}`)).catch(() => {});
        closeWindow("group." + gid);
      });
      body.querySelector("[data-rep]")?.addEventListener("click", () => import("./social.js").then((m) => m.report("group", `groups/${gid}`, g.owner, g.name + " — " + (g.desc || ""))));
    },
  });
}
