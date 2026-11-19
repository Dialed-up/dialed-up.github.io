// Owner admin panel: look up any member, suspend or ban, clean up their posts, and handle reports.
// Only the owner's account can open it, and the database rules enforce the same.
import { auth, db, ref, get, set, remove, onValue, off, normalize } from "./firebase.js";
import { openWindow, closeWindow, esc } from "./wm.js";
import { openInfo, openIM, iconHTML } from "./chat.js";

export const OWNER = "Dh35JEPVTiWIB96X03RGeiVmQN03";
const isOwner = () => auth.currentUser?.uid === OWNER;
const when = (ts) => (ts ? new Date(ts).toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—");

/** On sign-on: a suspended member sees why and is signed off. Returns true if suspended. */
export async function checkBan(uid) {
  try {
    const b = (await get(ref(db, `bans/${uid}`))).val();
    if (!b || !(b.until > Date.now())) return false;
    const forever = b.until > Date.now() + 5 * 365 * 86400000;
    alert(`Your DialedUp account is ${forever ? "banned" : `suspended until ${when(b.until)}`}.${b.reason ? `\n\nReason: ${b.reason}` : ""}`);
    return true;
  } catch { return false; }
}

export function openAdmin() {
  if (!isOwner()) return;
  let bansRef = null;
  openWindow("admin", {
    title: "Admin Panel (owner)", icon: "🛠", width: 420, height: 560, keyword: "admin",
    onClose: () => bansRef && off(bansRef),
    render(body) {
      body.innerHTML = `
        <form class="row" id="ad-f" style="gap:4px"><input id="ad-q" placeholder="Screen name to look up" style="flex:1" autocapitalize="off" data-no-altcaps><button class="btn primary small-btn">🔎 Look Up</button></form>
        <div id="ad-member"></div>
        <div class="row" style="gap:4px;margin:8px 0;justify-content:flex-start;flex-wrap:wrap">
          <button class="btn small-btn" data-go="reports">🛡 Reports</button>
          <button class="btn small-btn" data-go="stats">📊 Site Stats</button>
        </div>
        <div class="panel"><h3>⛔ Suspended & banned</h3><div id="ad-bans" class="small muted">Loading…</div></div>`;
      body.querySelector("[data-go=reports]").onclick = () => import("./social.js").then((m) => m.openReports());
      body.querySelector("[data-go=stats]").onclick = () => window.open("stats.html", "_blank");
      body.querySelector("#ad-f").onsubmit = async (e) => {
        e.preventDefault();
        const key = normalize(body.querySelector("#ad-q").value);
        const box = body.querySelector("#ad-member");
        const uid = key && (await get(ref(db, `screennames/${key}`)).catch(() => null))?.val();
        if (!uid) { box.innerHTML = `<p class="error">No member has that screen name.</p>`; return; }
        showMember(box, uid);
      };
      bansRef = ref(db, "bans");
      onValue(bansRef, async (s) => {
        const el = body.querySelector("#ad-bans");
        if (!el) return;
        const rows = Object.entries(s.val() || {}).filter(([, b]) => b.until > Date.now());
        if (!rows.length) { el.textContent = "Nobody is suspended."; return; }
        const names = await Promise.all(rows.map(async ([u]) => (await get(ref(db, `names/${u}`)).catch(() => null))?.val() || u.slice(0, 6)));
        el.innerHTML = `<ul class="list">${rows.map(([u, b], i) => `<li class="row"><a href="#" data-u="${esc(u)}">${esc(names[i])}</a>
          <span>${b.until > Date.now() + 5 * 365 * 86400000 ? "banned" : "until " + esc(when(b.until))}</span></li>`).join("")}</ul>`;
        el.querySelectorAll("[data-u]").forEach((a) => (a.onclick = (ev) => { ev.preventDefault(); showMember(body.querySelector("#ad-member"), a.dataset.u); }));
      }, () => { const el = body.querySelector("#ad-bans"); if (el) el.textContent = "Publish the latest database rules to use this."; });
    },
  });
}

async function showMember(box, uid) {
  box.innerHTML = `<p class="muted small">Loading…</p>`;
  const [u, email, ban, posts, stories] = await Promise.all([
    get(ref(db, `users/${uid}`)).then((s) => s.val() || {}).catch(() => ({})),
    get(ref(db, `emails/${uid}/email`)).then((s) => s.val()).catch(() => null),
    get(ref(db, `bans/${uid}`)).then((s) => s.val()).catch(() => null),
    get(ref(db, `posts/${uid}`)).then((s) => Object.keys(s.val() || {}).length).catch(() => 0),
    get(ref(db, `stories/${uid}`)).then((s) => Object.keys(s.val() || {}).length).catch(() => 0),
  ]);
  const name = u.screenName || (await get(ref(db, `names/${uid}`)).catch(() => null))?.val() || "Member";
  const banned = ban && ban.until > Date.now();
  box.innerHTML = `<div class="panel">
      <div class="row" style="justify-content:flex-start;gap:8px">${iconHTML(uid, 40)}<div><b>${esc(name)}</b>${uid === OWNER ? " ⭐" : ""}<br>
        <span class="small muted">${u.signedOn ? "🟢 Online" : "Last on " + esc(when(u.lastSeen))} · joined ${esc(when(u.since))}</span></div></div>
      <table class="member-info small" style="margin-top:6px">
        <tr><th>Email</th><td>${email ? esc(email) : "—"}</td></tr>
        <tr><th>Posts</th><td>${Number(posts) || 0} on their Wall · ${Number(stories) || 0} Homie Updates</td></tr>
        <tr><th>Status</th><td>${banned ? `⛔ ${ban.until > Date.now() + 5 * 365 * 86400000 ? "Banned" : "Suspended until " + esc(when(ban.until))}${ban.reason ? ` (${esc(ban.reason)})` : ""}` : "✅ In good standing"}</td></tr>
      </table>
      <div class="row" style="gap:4px;margin-top:8px;justify-content:flex-start;flex-wrap:wrap">
        <button class="btn small-btn" data-a="info">🪪 Profile</button><button class="btn small-btn" data-a="im">💬 IM</button>
        ${uid === OWNER ? "" : banned ? `<button class="btn primary small-btn" data-a="unban">✅ Lift suspension</button>`
          : `<button class="btn small-btn" data-a="s1">⏸ Suspend 1 day</button><button class="btn small-btn" data-a="s7">⏸ Suspend 7 days</button><button class="btn danger small-btn" data-a="ban">⛔ Ban</button>`}
        ${uid === OWNER ? "" : `<button class="btn danger small-btn" data-a="wipe">🗑 Delete their posts & updates</button>`}
      </div></div>`;
  const suspend = async (days) => {
    const reason = prompt(days ? `Suspend ${name} for ${days} day${days === 1 ? "" : "s"}. Reason (they'll see this):` : `Ban ${name}. Reason (they'll see this):`, "");
    if (reason === null) return;
    const until = days ? Date.now() + days * 86400000 : Date.now() + 100 * 365 * 86400000;
    try { await set(ref(db, `bans/${uid}`), { until, reason: reason.slice(0, 200), by: auth.currentUser.uid, at: Date.now() }); showMember(box, uid); }
    catch { alert("Couldn't save. Make sure the latest database rules are published."); }
  };
  const act = {
    info: () => openInfo(uid), im: () => openIM(uid),
    s1: () => suspend(1), s7: () => suspend(7), ban: () => suspend(0),
    unban: async () => { await remove(ref(db, `bans/${uid}`)).catch(() => {}); showMember(box, uid); },
    wipe: async () => {
      if (!confirm(`Delete ALL of ${name}'s Wall posts, photos, likes/comments on them, and Homie Updates? This can't be undone.`)) return;
      for (const p of ["posts", "postimgs", "postlikes", "postcomments", "stories"]) await remove(ref(db, `${p}/${uid}`)).catch(() => {});
      showMember(box, uid);
    },
  };
  box.querySelectorAll("[data-a]").forEach((b) => (b.onclick = () => act[b.dataset.a]?.()));
}
