// DialedUp YouTube: plays videos right inside DialedUp with YouTube's official embedded player.
// Search uses the free YouTube Data API once a key is added below (about 100 searches a day for the whole site).
import { openWindow, esc } from "./wm.js";
import { embedFor } from "./browser.js";

const YT_KEY = "";   // free key from Google Cloud (YouTube Data API v3). Leave empty to turn search off.
const recentKey = "du.ytRecent";
const recent = () => { try { return JSON.parse(localStorage.getItem(recentKey) || "[]"); } catch { return []; } };
const remember = (v) => { try { localStorage.setItem(recentKey, JSON.stringify([v, ...recent().filter((x) => x.id !== v.id)].slice(0, 12))); } catch {} };
const idFrom = (text) => { const e = embedFor(String(text).trim()); const m = e && e.match(/youtube-nocookie\.com\/embed\/([\w-]+)/); return m ? m[1] : /^[\w-]{11}$/.test(String(text).trim()) ? String(text).trim() : null; };

export function openYouTube(start = "") {
  openWindow("youtube", {
    title: "DialedUp YouTube", icon: "▶️", width: 560, height: 560, keyword: "youtube",
    render(body) {
      body.innerHTML = `<form class="row yt-bar" style="gap:4px"><input id="yt-q" placeholder="${YT_KEY ? "Search YouTube or paste a link…" : "Paste a YouTube link…"}" style="flex:1" autocomplete="off">
          <button class="btn primary small-btn">${YT_KEY ? "🔎 Search" : "▶ Play"}</button></form>
        <div class="yt-player"></div>
        <div class="yt-list"></div>`;
      const player = body.querySelector(".yt-player"), list = body.querySelector(".yt-list"), q = body.querySelector("#yt-q");
      const play = (v) => {
        player.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${v.id}?autoplay=1&playsinline=1&rel=0" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowfullscreen></iframe>
          ${v.title ? `<p class="small" style="margin:4px 0"><b>${esc(v.title)}</b>${v.channel ? ` <span class="muted">· ${esc(v.channel)}</span>` : ""}</p>` : ""}`;
        remember(v);
        body.scrollTop = 0;
      };
      const grid = (items, heading) => {
        list.innerHTML = items.length ? `<h4 style="margin:8px 0 4px">${heading}</h4><div class="yt-grid">${items.map((v, i) =>
          `<button class="yt-tile" data-i="${i}"><img src="https://i.ytimg.com/vi/${v.id}/mqdefault.jpg" alt="" loading="lazy"><span>${esc(v.title || "Video")}</span>${v.channel ? `<small>${esc(v.channel)}</small>` : ""}</button>`).join("")}</div>` : "";
        list.querySelectorAll("[data-i]").forEach((b) => (b.onclick = () => play(items[b.dataset.i])));
      };
      const showHome = () => {
        const r = recent();
        if (r.length) grid(r, "🕘 Recently watched");
        else list.innerHTML = `<div class="panel small">${YT_KEY ? "Search for anything above." : `<b>How to watch:</b> copy a video's link in the YouTube app (Share → Copy link), paste it above and tap ▶ Play. Links in IMs, mail and boards play here too.`}</div>`;
      };
      const search = async (text) => {
        list.innerHTML = `<p class="muted">🔎 Searching…</p>`;
        try {
          const r = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoEmbeddable=true&safeSearch=moderate&maxResults=20&q=${encodeURIComponent(text)}&key=${YT_KEY}`);
          const j = await r.json();
          if (j.error) throw new Error(j.error.message);
          grid((j.items || []).map((it) => ({ id: it.id.videoId, title: it.snippet.title.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&"), channel: it.snippet.channelTitle })), `Results for "${esc(text)}"`);
        } catch { list.innerHTML = `<p class="muted">Search isn't available right now (the daily limit may be used up). You can still paste a link.</p>`; }
      };
      body.querySelector(".yt-bar").onsubmit = (e) => {
        e.preventDefault();
        const text = q.value.trim();
        if (!text) return;
        const id = idFrom(text);
        if (id) { play({ id, title: "" }); q.value = ""; return; }
        if (YT_KEY) search(text);
        else list.innerHTML = `<p class="muted">That doesn't look like a YouTube link. Copy the link from YouTube (Share → Copy link) and paste it here.</p>`;
      };
      const id = idFrom(start);
      if (id) play({ id, title: "" });
      showHome();
    },
  });
}
