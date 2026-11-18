// Favorite Places, the Online Clock, and warnings.
import { auth, db, ref, set, onValue, off, serverTimestamp } from "./firebase.js";
import { openWindow, esc } from "./wm.js";

// ---------- Favorite Places ----------
const favKey = "du.favorites";
export const favorites = () => JSON.parse(localStorage.getItem(favKey) || "[]");
export function addFavorite(keyword, label) {
  const f = favorites().filter((x) => x.keyword !== keyword);
  f.unshift({ keyword, label });
  localStorage.setItem(favKey, JSON.stringify(f.slice(0, 30)));
}

export function openFavorites(run) {
  openWindow("favorites", {
    title: "Favorite Places", icon: "❤️", width: 300, height: 380,
    render(body) {
      const paint = () => {
        const f = favorites();
        body.innerHTML = `<form id="fa" class="row" style="margin-bottom:8px"><input id="fa-k" placeholder="Add a keyword (e.g. sports)" style="flex:1">
            <button class="btn small-btn">❤️ Add</button></form>
          ${f.length ? `<ul class="list">${f.map((x, i) => `<li class="row"><a href="#" data-k="${esc(x.keyword)}">❤️ ${esc(x.label)}</a>
            <button class="btn small-btn" data-del="${esc(i)}">✕</button></li>`).join("")}</ul>`
            : `<p class="muted small">No favorites yet. Add keywords like <i>news</i>, <i>nyc</i> or <i>games</i>.</p>`}`;
        body.querySelectorAll("[data-k]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); run(a.dataset.k); }));
        body.querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => {
          const l = favorites(); l.splice(b.dataset.del, 1); localStorage.setItem(favKey, JSON.stringify(l)); paint();
        }));
        body.querySelector("#fa").onsubmit = (e) => {
          e.preventDefault();
          const k = body.querySelector("#fa-k").value.trim().toLowerCase();
          if (k) { addFavorite(k, k.charAt(0).toUpperCase() + k.slice(1)); paint(); }
        };
      };
      paint();
    },
  });
}

// ---------- Online Clock ----------
let signedOnAt = Date.now();
export const startClock = () => (signedOnAt = Date.now());
export function onlineFor() {
  const m = Math.floor((Date.now() - signedOnAt) / 60000);
  return m < 60 ? `${m} minute${m === 1 ? "" : "s"}` : `${Math.floor(m / 60)} hr ${m % 60} min`;
}
export function openClock() {
  openWindow("clock", {
    title: "Online Clock", icon: "⏱", width: 280, height: 190,
    render(body, win) {
      const paint = () => (body.innerHTML = `<p style="text-align:center;font-size:15px">You've been DialedUp for<br>
        <b style="font-size:22px;color:var(--grape)">${onlineFor()}</b></p>
        <p class="small muted" style="text-align:center">Current time: ${new Date().toLocaleTimeString()}</p>`);
      paint();
      const t = setInterval(() => (document.body.contains(body) ? paint() : clearInterval(t)), 1000);
    },
  });
}

// ---------- Warnings (same format as the BuddyChat app) ----------
let warnings = {};
let warnRef = null;
export function watchWarnings() {
  warnRef = ref(db, "warnings");
  onValue(warnRef, (s) => (warnings = s.val() || {}));
}
export function stopWarnings() { if (warnRef) off(warnRef); warnRef = null; }

/** Each warning from a different person in the last 24 hours adds 10%. */
export function warningLevel(uid) {
  const dayAgo = Date.now() - 86400000;
  return Math.min(100, Object.values(warnings[uid] || {}).filter((t) => t > dayAgo).length * 10);
}
export const alreadyWarned = (uid) => (warnings[uid]?.[auth.currentUser?.uid] || 0) > Date.now() - 86400000;
export async function warn(uid) {
  await set(ref(db, `warnings/${uid}/${auth.currentUser.uid}`), serverTimestamp());
}
