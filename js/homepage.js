// "Build Your Home Page": your own little corner of DialedUp, with a counter and a guestbook.
import { auth, db, ref, get, set, push, onValue, serverTimestamp, runTransaction, normalize, query, orderByKey, limitToLast } from "./firebase.js";
import { openWindow, esc } from "./wm.js";

export const backgrounds = {
  stars: "radial-gradient(#fff 1px, transparent 1.5px) 0 0/22px 22px, linear-gradient(#0b0630, #2a0f5e)",
  bubblegum: "linear-gradient(135deg, #ff9de2, #ffd1f0 50%, #a8e8ff)",
  checker: "repeating-conic-gradient(#111 0 25%, #333 0 50%) 0 0/40px 40px",
  sunset: "linear-gradient(180deg, #2b1055, #d5426b 55%, #ffb86b)",
  matrix: "repeating-linear-gradient(0deg, #021a02 0 3px, #032903 3px 6px)",
  ocean: "linear-gradient(180deg, #0f5ea8, #4fc3f7)",
  plain: "#ffffff",
};

export const songs = {
  none: null,
  "Neon Mall": [523, 659, 784, 659, 587, 698, 880, 698, 523, 659, 784, 1046, 988, 784, 659, 587],
  "Slow Jam": [392, 0, 466, 523, 466, 392, 0, 349, 392, 0, 466, 523, 587, 523, 466, 392],
  "Arcade Rush": [659, 659, 0, 659, 0, 523, 659, 784, 0, 392, 0, 523, 392, 330, 440, 494],
};

let songTimer = null;
let songCtx = null;
export function playSong(name) {
  stopSong();
  const notes = songs[name];
  if (!notes) return;
  songCtx = new (window.AudioContext || window.webkitAudioContext)();
  let i = 0;
  songTimer = setInterval(() => {
    const f = notes[i++ % notes.length];
    if (!f) return;
    const o = songCtx.createOscillator(), g = songCtx.createGain();
    o.type = "square"; o.frequency.value = f;
    g.gain.setValueAtTime(0.05, songCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, songCtx.currentTime + 0.22);
    o.connect(g).connect(songCtx.destination);
    o.start(); o.stop(songCtx.currentTime + 0.25);
  }, 240);
}
export function stopSong() { clearInterval(songTimer); songTimer = null; songCtx?.close(); songCtx = null; }

const safeURL = (u) => (/^https?:\/\//i.test(u) ? u : "");

/** Draws a home page into `el`. Used by the builder preview and by home.html. */
export function renderHomepage(el, d, { counter = null } = {}) {
  const links = String(d.links || "").split("\n").map((l) => l.split("|")).filter(([, u]) => safeURL((u || "").trim()));
  const counterHTML = counter == null ? "" : `<p style="text-align:center">You are visitor number
      <span class="counter">${String(counter).padStart(6, "0").split("").map((c) => `<b>${c}</b>`).join("")}</span></p>`;
  el.innerHTML = `<div class="homepage" style="background:${backgrounds[d.bg] || backgrounds.stars};color:${/^#[0-9a-f]{6}$/i.test(d.color || "") ? d.color : "#ffffff"};font-family:${esc(d.font || "Comic Sans MS")}, Verdana, sans-serif">
    <h1 class="${d.glitter ? "glitter" : ""}">${esc(d.title || "Welcome to my page!")}</h1>
    ${d.marquee ? `<div class="marquee"><span>${esc(d.marquee)}</span></div>` : ""}
    ${d.intro ? `<p style="white-space:pre-wrap">${esc(d.intro)}</p>` : ""}
    ${links.length ? `<h3>🔗 My Links</h3><ul>${links.map(([label, u]) => `<li><a style="color:inherit" href="${esc(safeURL(u.trim()))}" target="_blank" rel="noopener nofollow">${esc((label || u).trim())}</a></li>`).join("")}</ul>` : ""}
    ${d.song && d.song !== "none" ? `<p><button class="btn small-btn" data-song>🎵 Play "${esc(d.song)}"</button></p>` : ""}
    ${counterHTML}
    <p class="small" style="text-align:center;opacity:.8">Made with DialedUp · ${esc(d.screenName || "")}</p>
  </div>`;
  el.querySelector("[data-song]")?.addEventListener("click", (e) => {
    if (songTimer) { stopSong(); e.target.textContent = `🎵 Play "${d.song}"`; }
    else { playSong(d.song); e.target.textContent = "⏹ Stop music"; }
  });
}

export function openMyPage() {
  const uid = auth.currentUser.uid;
  openWindow("mypage", {
    title: "Build Your Home Page", icon: "🌐", width: 440, height: 560, onClose: stopSong,
    async render(body) {
      const me = (await get(ref(db, `users/${uid}`))).val() || {};
      const key = normalize(me.screenName);
      const d = (await get(ref(db, `homepages/${key}`))).val() || {
        title: `${me.screenName}'s Home Page`, intro: "Welcome to my corner of the web!", bg: "stars", color: "#ffffff",
        font: "Comic Sans MS", glitter: true, marquee: "Thanks for stopping by!", links: "", song: "Neon Mall",
      };
      body.innerHTML = `
        <div class="panel"><h3>✏️ Edit</h3>
          <label>Page title <input data-k="title" value="${esc(d.title)}"></label>
          <label class="check"><input type="checkbox" data-k="glitter" ${d.glitter ? "checked" : ""}> Glitter title ✨</label>
          <label>Scrolling message <input data-k="marquee" value="${esc(d.marquee || "")}"></label>
          <label>About me <textarea data-k="intro" rows="4">${esc(d.intro || "")}</textarea></label>
          <label>Links (one per line: <i>Name | https://…</i>) <textarea data-k="links" rows="3" data-no-altcaps>${esc(d.links || "")}</textarea></label>
          <div class="grid2">
            <label>Background <select data-k="bg">${Object.keys(backgrounds).map((b) => `<option ${b === d.bg ? "selected" : ""}>${b}</option>`).join("")}</select></label>
            <label>Font <select data-k="font">${["Comic Sans MS", "Verdana", "Impact", "Courier New", "Georgia", "Trebuchet MS"].map((f) => `<option ${f === d.font ? "selected" : ""}>${f}</option>`).join("")}</select></label>
            <label>Text color <input type="color" data-k="color" value="${esc(d.color || "#ffffff")}"></label>
            <label>Song <select data-k="song">${Object.keys(songs).map((s) => `<option ${s === d.song ? "selected" : ""}>${s}</option>`).join("")}</select></label>
          </div>
          <div class="row"><a class="btn" href="home.html?u=${encodeURIComponent(key)}" target="_blank">👀 View my page</a>
            <button class="btn primary" id="hp-save">Save</button></div>
          <p class="small muted" id="hp-msg">Your page lives at <b>${location.host}/home.html?u=${esc(key)}</b> — share it!</p>
        </div>
        <div class="panel"><h3>👀 Preview</h3><div id="hp-preview"></div></div>`;
      const read = () => {
        const out = { ...d };
        body.querySelectorAll("[data-k]").forEach((el) => (out[el.dataset.k] = el.type === "checkbox" ? el.checked : el.value));
        return out;
      };
      const preview = () => renderHomepage(body.querySelector("#hp-preview"), { ...read(), screenName: me.screenName }, { counter: 1999 });
      body.querySelectorAll("[data-k]").forEach((el) => (el.oninput = el.onchange = preview));
      preview();
      body.querySelector("#hp-save").onclick = async () => {
        const data = read();
        const visits = (await get(ref(db, `homepages/${key}/visits`))).val() || 0;
        try {
          await set(ref(db, `homepages/${key}`), { ...data, owner: uid, screenName: me.screenName, visits, updated: serverTimestamp() });
          body.querySelector("#hp-msg").innerHTML = `✅ Saved! Share <b>${location.host}/home.html?u=${esc(key)}</b>`;
        } catch {
          body.querySelector("#hp-msg").innerHTML = `<span class="error">Couldn't save. (The site's database rules may need updating.)</span>`;
        }
      };
    },
  });
}

/** For home.html: load a page by screen name, count the visit, show the guestbook. */
export async function showPublicPage(key, el, guestEl) {
  const pageRef = ref(db, `homepages/${key}`);
  const d = (await get(pageRef)).val();
  if (!d) { el.innerHTML = `<div class="panel"><h3>Page not found</h3>Nobody has built a page called "${esc(key)}" yet.</div>`; return; }
  document.title = `${d.title} — DialedUp`;
  let count = d.visits || 0;
  if (!sessionStorage.getItem("du.visited." + key)) {
    try {
      const r = await runTransaction(ref(db, `homepages/${key}/visits`), (v) => (v || 0) + 1);
      count = r.snapshot.val();
      sessionStorage.setItem("du.visited." + key, "1");
    } catch {}
  }
  renderHomepage(el, d, { counter: count });

  const gbRef = query(ref(db, `guestbook/${key}`), orderByKey(), limitToLast(50));
  onValue(gbRef, (s) => {
    const rows = [];
    s.forEach((c) => { const g = c.val(); rows.unshift(`<div class="guest"><b>${esc(g.name)}</b> <span class="small muted">${g.ts ? new Date(g.ts).toLocaleDateString() : ""}</span><br>${esc(g.text)}</div>`); });
    guestEl.querySelector("#gb-list").innerHTML = rows.join("") || `<p class="small">Be the first to sign!</p>`;
  });
  const form = guestEl.querySelector("#gb-form");
  form.onsubmit = async (e) => {
    e.preventDefault();
    const u = auth.currentUser;
    const text = form.querySelector("textarea").value.trim();
    if (!u || !text) return;
    const me = (await get(ref(db, `users/${u.uid}`))).val() || {};
    await push(ref(db, `guestbook/${key}`), { from: u.uid, name: me.screenName || "Someone", text: text.slice(0, 500), ts: serverTimestamp() });
    form.querySelector("textarea").value = "";
  };
}
