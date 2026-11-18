// The owner's live stats page. Only the owner's account can read these numbers (see database rules).
import { auth, db, ref, get, onValue, query, orderByKey, limitToLast, onAuthStateChanged, signOn } from "./firebase.js";

const OWNER = "Dh35JEPVTiWIB96X03RGeiVmQN03";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fmt = (n) => (n || 0).toLocaleString();

let days = {}, online = {}, totalMembers = null, emails = null;

$("gf").onsubmit = async (e) => {
  e.preventDefault();
  $("ge").textContent = "";
  try { await signOn($("gn").value, $("gp").value, true); } catch (err) { $("ge").textContent = err.message; }
};

onAuthStateChanged(auth, (user) => {
  if (!user) { $("gate").hidden = false; $("dash").hidden = true; return; }
  if (user.uid !== OWNER) {
    $("gate").hidden = true; $("dash").hidden = false;
    $("dash").innerHTML = `<div class="card"><h2>🔒 Not allowed</h2><p class="muted">This page is only for the owner of DialedUp.</p></div>`;
    return;
  }
  $("gate").hidden = true; $("dash").hidden = false;
  $("dash").innerHTML = `<p class="muted">Loading…</p>`;
  onValue(query(ref(db, "stats/days"), orderByKey(), limitToLast(31)), (s) => { days = s.val() || {}; paint(); },
    () => ($("dash").innerHTML = `<div class="card"><h2>Almost there</h2><p class="muted">Publish the latest database rules in Firebase to turn on stats.</p></div>`));
  onValue(ref(db, "online"), (s) => { online = s.val() || {}; paint(); }, () => {});
  get(ref(db, "emails")).then((s) => { emails = s.val() || {}; paint(); }).catch(() => {});
  get(ref(db, "screennames")).then((s) => { totalMembers = new Set(Object.values(s.val() || {})).size; paint(); }).catch(() => {});
  setInterval(paint, 30000);   // keeps "online now" fresh
});

function paint() {
  const today = days[dayKey()] || {};
  const uniq = (d) => Object.keys(d?.members || {}).length;
  const now = Date.now();
  const on = Object.values(online).filter((o) => o && now - (o.t || 0) < 180000).sort((a, b) => String(a.n).localeCompare(String(b.n)));

  // last 30 days
  const list = [];
  for (let i = 29; i >= 0; i--) { const d = new Date(now - i * 86400000); const k = dayKey(d); list.push({ k, d, v: days[k] || {} }); }
  const max = Math.max(1, ...list.map((x) => uniq(x.v)));
  const week = list.slice(-7);
  const sum = (arr, f) => arr.reduce((a, x) => a + (f(x.v) || 0), 0);

  const dev = today.devices || {};
  const devTotal = (dev.app || 0) + (dev.phonebrowser || 0) + (dev.computer || 0);
  const pages = today.pages || {};
  const pageTotal = (pages.dialedup || 0) + (pages.dim || 0);
  const pct = (n, t) => (t ? Math.round((n / t) * 100) : 0);

  $("dash").innerHTML = `
    <div class="tiles">
      <div class="tile hot"><div class="n">${on.length}</div><div class="l">🟢 Online right now</div></div>
      <div class="tile"><div class="n">${fmt(uniq(today))}</div><div class="l">👥 Members today</div></div>
      <div class="tile"><div class="n">${fmt(today.visits)}</div><div class="l">🚪 Sign-ons today</div></div>
      <div class="tile"><div class="n">${fmt(today.ims)}</div><div class="l">💬 IMs today</div></div>
      <div class="tile"><div class="n">${fmt(today.mail)}</div><div class="l">📬 Mail today</div></div>
      <div class="tile"><div class="n">${fmt(today.signups)}</div><div class="l">✨ New members today</div></div>
      <div class="tile"><div class="n">${totalMembers === null ? "…" : fmt(totalMembers)}</div><div class="l">🧾 Total members</div></div>
      <div class="tile"><div class="n">${fmt(sum(week, uniq))}</div><div class="l">📅 Member-visits, last 7 days</div></div>
    </div>

    <div class="card"><h2>👥 Members per day (last 30 days)</h2>
      <div class="bars">${list.map((x, i) => `<div class="${i === list.length - 1 ? "today" : ""}" style="height:${Math.round((uniq(x.v) / max) * 100)}%" title="${x.k}: ${uniq(x.v)}">${uniq(x.v) && (i % 5 === 4 || i === list.length - 1) ? `<span>${uniq(x.v)}</span>` : ""}</div>`).join("")}</div>
      <div class="axis"><span>${list[0].d.toLocaleDateString([], { month: "short", day: "numeric" })}</span><span>Today</span></div>
    </div>

    <div class="grid2">
      <div class="card"><h2>🟢 Online now</h2>
        ${on.length ? `<ul class="online">${on.map((o) => `<li><span>${esc(o.n)}</span><span class="muted">${{ app: "📱 App", phonebrowser: "📱 Browser", computer: "💻 Computer" }[o.d] || ""} · ${o.p === "dim" ? "DIM" : "DialedUp"}</span></li>`).join("")}</ul>` : `<p class="muted">Nobody's on right now.</p>`}
      </div>
      <div class="card"><h2>📱 How people connect today</h2>
        <div class="split"><i style="width:${pct(dev.app, devTotal)}%;background:#8a4dff"></i><i style="width:${pct(dev.phonebrowser, devTotal)}%;background:#ff5ec4"></i><i style="width:${pct(dev.computer, devTotal)}%;background:#21a0fd"></i></div>
        <div class="legend"><span><i style="background:#8a4dff"></i>Home Screen app ${pct(dev.app, devTotal)}%</span><span><i style="background:#ff5ec4"></i>Phone browser ${pct(dev.phonebrowser, devTotal)}%</span><span><i style="background:#21a0fd"></i>Computer ${pct(dev.computer, devTotal)}%</span></div>
        <h2 style="margin-top:12px">🖥 Which layout</h2>
        <div class="split"><i style="width:${pct(pages.dialedup, pageTotal)}%;background:#5b2a86"></i><i style="width:${pct(pages.dim, pageTotal)}%;background:#22a35a"></i></div>
        <div class="legend"><span><i style="background:#5b2a86"></i>DialedUp ${pct(pages.dialedup, pageTotal)}%</span><span><i style="background:#22a35a"></i>DIM ${pct(pages.dim, pageTotal)}%</span></div>
      </div>
    </div>

    <div class="card"><h2>📅 Last 7 days</h2>
      <table><tr><th>Day</th><th>Members</th><th>Sign-ons</th><th>IMs</th><th>Mail</th><th>New</th></tr>
      ${[...week].reverse().map((x) => `<tr><td>${x.d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}</td><td>${uniq(x.v)}</td><td>${fmt(x.v.visits)}</td><td>${fmt(x.v.ims)}</td><td>${fmt(x.v.mail)}</td><td>${fmt(x.v.signups)}</td></tr>`).join("")}
      </table></div>
    ${emailCard()}
    <p class="muted" style="text-align:center">Updates live. Counting started ${Object.keys(days)[0] ? new Date(Object.keys(days)[0] + "T12:00").toLocaleDateString([], { month: "long", day: "numeric" }) : "today"}.</p>`;
}

function emailCard() {
  if (!emails) return "";
  const rows = Object.values(emails).filter((e) => e?.email).sort((a, b) => String(a.n).localeCompare(String(b.n)));
  setTimeout(() => {
    const b = document.getElementById("copy-emails");
    if (b) b.onclick = () => navigator.clipboard.writeText(rows.map((r) => r.email).join(", ")).then(() => (b.textContent = "✅ Copied!"));
  });
  return `<div class="card"><h2>📧 Member emails (${rows.length}${totalMembers ? ` of ${totalMembers} members` : ""})</h2>
    <p class="muted">Private — only you can see this. Use it for important announcements.</p>
    ${rows.length ? `<button class="btn" id="copy-emails">📋 Copy all emails</button>
    <table><tr><th>Screen name</th><th>Email</th></tr>${rows.map((r) => `<tr><td>${esc(r.n)}</td><td>${esc(r.email)}</td></tr>`).join("")}</table>` : `<p class="muted">No emails yet.</p>`}</div>`;
}
