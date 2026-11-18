// Podcasts: the top shows and their newest episodes, gathered by the news robot from each show's public feed.
import { openWindow, esc } from "./wm.js";

const URL_ = "https://raw.githubusercontent.com/dialed-up/dialed-up.github.io/news-data/news.json";
const player = new Audio();
player.preload = "none";
let current = null;

export function openPodcasts() {
  openWindow("podcasts", {
    title: "Podcasts", icon: "🎙", width: 420, height: 540, keyword: "podcasts",
    render(body) {
      body.innerHTML = `<div class="panel pod-now small muted">Pick an episode to start listening. It keeps playing while you chat.</div>
        <div class="row" id="pod-tabs" style="justify-content:flex-start;gap:4px;margin:6px 0;flex-wrap:wrap"></div>
        <div id="pod-list"><p class="muted">🎙 Tuning in…</p></div>`;
      const list = body.querySelector("#pod-list"), tabs = body.querySelector("#pod-tabs"), now = body.querySelector(".pod-now");
      const paintNow = () => {
        if (!current) return;
        now.classList.remove("muted");
        now.innerHTML = `<div class="row"><span>🎙 <b>${esc(current.title)}</b><br><span class="muted">${esc(current.show)}</span></span>
          <button class="btn small-btn" data-p="toggle">${player.paused ? "▶ Play" : "⏸ Pause"}</button></div>
          <div class="row small" style="gap:6px;margin-top:4px"><button class="btn small-btn" data-p="back">⏪ 15s</button>
          <input type="range" min="0" max="1000" value="${player.duration ? Math.round((player.currentTime / player.duration) * 1000) : 0}" data-p="seek" style="flex:1">
          <button class="btn small-btn" data-p="fwd">30s ⏩</button></div>`;
        now.querySelector("[data-p=toggle]").onclick = () => (player.paused ? player.play().catch(() => {}) : player.pause());
        now.querySelector("[data-p=back]").onclick = () => (player.currentTime = Math.max(0, player.currentTime - 15));
        now.querySelector("[data-p=fwd]").onclick = () => (player.currentTime += 30);
        now.querySelector("[data-p=seek]").oninput = (e) => player.duration && (player.currentTime = (e.target.value / 1000) * player.duration);
      };
      ["play", "pause", "loadedmetadata"].forEach((ev) => player.addEventListener(ev, paintNow));
      paintNow();
      fetch(URL_ + "?t=" + Math.floor(Date.now() / 600000)).then((r) => r.json()).then((j) => {
        const sections = j.podcasts || {};
        const names = Object.keys(sections);
        if (!names.length) { list.innerHTML = `<p class="muted">Podcasts are still loading on our end. Check back in a few minutes.</p>`; return; }
        const show = (name) => {
          tabs.querySelectorAll("button").forEach((b) => b.classList.toggle("primary", b.dataset.s === name));
          list.innerHTML = sections[name].map((s, si) => `<div class="panel pod-show">
            <div class="row" style="justify-content:flex-start;gap:8px">${s.art ? `<img src="${esc(s.art)}" alt="" width="48" height="48" style="border-radius:8px">` : "🎙"}<b>${esc(s.show)}</b></div>
            <ul class="list">${s.episodes.map((e, ei) => `<li class="row"><a href="#" data-ep="${si}:${ei}">▶ ${esc(e.title)}</a>
              <span class="small muted">${e.ts ? new Date(e.ts).toLocaleDateString([], { month: "short", day: "numeric" }) : ""}</span></li>`).join("")}</ul></div>`).join("");
          list.querySelectorAll("[data-ep]").forEach((a) => (a.onclick = (ev) => {
            ev.preventDefault();
            const [si, ei] = a.dataset.ep.split(":").map(Number);
            current = sections[name][si].episodes[ei];
            player.src = current.audio;
            player.play().catch(() => alert("That episode isn't playing right now. Try another one."));
            paintNow();
          }));
        };
        tabs.innerHTML = names.map((n) => `<button class="btn small-btn" data-s="${esc(n)}">${esc(n)}</button>`).join("");
        tabs.querySelectorAll("button").forEach((b) => (b.onclick = () => show(b.dataset.s)));
        show(names[0]);
      }).catch(() => (list.innerHTML = `<p class="muted">Podcasts aren't answering right now. Try again in a minute.</p>`));
    },
  });
}
