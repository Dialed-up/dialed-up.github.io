// DialedUp Radio: real free internet radio stations from the public Radio Browser directory.
import { openWindow, getWindow, esc } from "./wm.js";

const API = "https://de1.api.radio-browser.info/json";
const genres = [
  ["Hip Hop", "hiphop"], ["House", "house"], ["Dance", "dance"], ["R&B", "rnb"], ["Pop", "pop"], ["Top 40", "top 40"],
  ["Rock", "rock"], ["Jazz", "jazz"], ["Reggae", "reggae"], ["Latin", "latin"], ["Old School", "oldies"], ["80s", "80s"],
  ["90s", "90s"], ["Classical", "classical"], ["Lo-Fi", "lofi"], ["Talk & News", "news"],
];

const audio = new Audio();
audio.preload = "none";
let nowPlaying = null;
export const getNowPlaying = () => nowPlaying;

function setNowPlaying(st) {
  nowPlaying = st;
  document.querySelectorAll(".radio-now").forEach((el) => paintNow(el));
  const mini = document.getElementById("radio-mini");
  if (mini) {
    mini.hidden = !st;
    mini.querySelector(".rm-name").textContent = st ? st.name : "";
    mini.querySelector(".rm-play").textContent = audio.paused ? "▶" : "⏸";
  }
}

function paintNow(el) {
  el.innerHTML = nowPlaying
    ? `<div class="row"><span>🎶 <b>${esc(nowPlaying.name)}</b> <span class="small muted">${esc(nowPlaying.country || "")}</span></span>
       <span><button class="btn small-btn" data-r="toggle">${audio.paused ? "▶ Play" : "⏸ Pause"}</button>
       <button class="btn small-btn" data-r="stop">⏹ Stop</button></span></div>
       <label class="small" style="margin:6px 0 0;display:flex;gap:6px;align-items:center">🔊 <input type="range" min="0" max="1" step="0.05" value="${esc(audio.volume)}" data-r="vol" style="flex:1"></label>`
    : `<span class="muted small">Pick a station to start listening. Music keeps playing while you chat.</span>`;
  el.querySelector("[data-r=toggle]")?.addEventListener("click", toggle);
  el.querySelector("[data-r=stop]")?.addEventListener("click", stop);
  el.querySelector("[data-r=vol]")?.addEventListener("input", (e) => (audio.volume = Number(e.target.value)));
}

export function play(st) {
  audio.src = st.url;
  audio.play().catch(() => alert("That station isn't answering right now — try another one."));
  setNowPlaying(st);
}
function toggle() { audio.paused ? audio.play().catch(() => {}) : audio.pause(); setNowPlaying(nowPlaying); }
export function stop() { audio.pause(); audio.removeAttribute("src"); audio.load(); setNowPlaying(null); }
audio.addEventListener("play", () => setNowPlaying(nowPlaying));
audio.addEventListener("pause", () => setNowPlaying(nowPlaying));

async function stations(path) {
  const r = await fetch(`${API}/stations/${path}${path.includes("?") ? "&" : "?"}hidebroken=true&order=clickcount&reverse=true&limit=40`);
  const list = await r.json();
  const seen = new Set();
  return list.filter((s) => s.url_resolved?.startsWith("https://") && !seen.has(s.name.trim()) && seen.add(s.name.trim()))
    .map((s) => ({ name: s.name.trim(), url: s.url_resolved, country: s.countrycode, tags: s.tags, favicon: s.favicon }));
}

export function openRadio() {
  openWindow("radio", {
    title: "DialedUp Radio", icon: "📻", width: 400, height: 500, keyword: "radio",
    render(body) {
      body.innerHTML = `<div class="panel radio-now"></div>
        <div class="row" style="justify-content:flex-start;gap:4px;margin-bottom:8px">
          ${genres.map(([n, t], i) => `<button class="btn small-btn ${i ? "" : "primary"}" data-g="${esc(t)}">${esc(n)}</button>`).join("")}
          <button class="btn small-btn" data-g="__nyc">🗽 NYC</button></div>
        <form class="row" id="rs" style="margin-bottom:8px"><input placeholder="Search stations…" style="flex:1"><button class="btn small-btn">Search</button></form>
        <ul class="list" id="rl"><li class="muted">Tuning in…</li></ul>`;
      paintNow(body.querySelector(".radio-now"));
      const list = body.querySelector("#rl");
      const load = async (path, label) => {
        list.innerHTML = `<li class="muted">📡 Tuning in to ${esc(label)}…</li>`;
        try {
          const items = await stations(path);
          list.innerHTML = items.length ? items.map((s, i) => `<li class="row"><a href="#" data-i="${esc(i)}">📻 ${esc(s.name)}</a>
            <span class="small muted">${esc(s.country || "")}</span></li>`).join("") : `<li class="muted">No stations found.</li>`;
          list.querySelectorAll("[data-i]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); play(items[a.dataset.i]); }));
        } catch { list.innerHTML = `<li class="muted">The radio directory isn't answering. Try again in a minute.</li>`; }
      };
      body.querySelectorAll("[data-g]").forEach((b) => (b.onclick = () => {
        body.querySelectorAll("[data-g]").forEach((x) => x.classList.toggle("primary", x === b));
        b.dataset.g === "__nyc" ? load("search?state=New%20York&countrycode=US", "New York") : load(`bytag/${encodeURIComponent(b.dataset.g)}`, b.textContent);
      }));
      body.querySelector("#rs").onsubmit = (e) => {
        e.preventDefault();
        const q = e.target.querySelector("input").value.trim();
        if (q) load(`byname/${encodeURIComponent(q)}`, `"${q}"`);
      };
      load("bytag/hiphop", "Hip Hop");
    },
  });
}

/** Little "now playing" control in the taskbar. */
export function mountMiniPlayer() {
  if (document.getElementById("radio-mini")) return;
  const el = document.createElement("span");
  el.id = "radio-mini";
  el.hidden = true;
  el.innerHTML = `<button class="rm-play" title="Play / Pause">▶</button><button class="rm-open rm-name" title="Open Radio"></button>`;
  document.getElementById("taskbar").insertBefore(el, document.getElementById("signoff"));
  el.querySelector(".rm-play").onclick = toggle;
  el.querySelector(".rm-open").onclick = openRadio;
}
