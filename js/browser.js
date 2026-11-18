// The DialedUp Browser: a web browser window inside DialedUp.
// Big sites (CNN, ESPN, NYT…) refuse to be shown inside other sites, so for those it shows a preview
// card with a button to open the real page in a new tab. Sites that allow it load right in the window.
import { openWindow, getWindow, setTitle, esc } from "./wm.js";
import { addFavorite } from "./extras.js";

// Sites known to load fine inside the window.
const frameFriendly = [
  /(^|\.)wikipedia\.org$/i, /(^|\.)wikimedia\.org$/i, /^www\.youtube-nocookie\.com$/i, /^www\.openstreetmap\.org$/i,
  /(^|\.)archive\.org$/i, /^dialed-up\.github\.io$/i, /^bandcamp\.com$/i, /^w\.soundcloud\.com$/i, /^player\.vimeo\.com$/i, /^player\.twitch\.tv$/i,
];

const startLinks = [
  ["📰", "CNN", "https://www.cnn.com"], ["📰", "NBC News", "https://www.nbcnews.com"], ["📰", "New York Times", "https://www.nytimes.com"],
  ["📻", "NPR", "https://www.npr.org"], ["🌍", "BBC", "https://www.bbc.com/news"], ["🏀", "ESPN", "https://www.espn.com"],
  ["▶️", "YouTube", "https://www.youtube.com/"], ["📚", "Wikipedia", "https://en.wikipedia.org/wiki/AOL"], ["🗺", "Maps", "https://www.openstreetmap.org"],
  ["🎵", "SoundCloud", "https://soundcloud.com"], ["🛒", "Amazon", "https://www.amazon.com"], ["🌤", "Weather.gov", "https://www.weather.gov"],
];

/** Official "embed" versions of sites that allow being shown inside DialedUp. Returns the embed address, or null. */
export function embedFor(url) {
  let u;
  try { u = new URL(url, location.href); } catch { return null; }
  const h = u.hostname.replace(/^www\.|^m\./, "");
  const parts = u.pathname.split("/").filter(Boolean);
  // YouTube videos, Shorts and youtu.be links
  const yt = h === "youtu.be" ? parts[0] : (/(^|\.)youtube\.com$/.test(h) ? (u.searchParams.get("v") || (["shorts", "embed", "live"].includes(parts[0]) ? parts[1] : null)) : null);
  if (yt && /^[\w-]{6,20}$/.test(yt)) return `https://www.youtube-nocookie.com/embed/${yt}?autoplay=1&playsinline=1&rel=0`;
  if (h === "open.spotify.com" && /^(track|album|playlist|episode|show|artist)$/.test(parts[0]) && parts[1]) return `https://open.spotify.com/embed/${parts[0]}/${parts[1]}`;
  if (h === "soundcloud.com" && parts.length >= 2) return `https://w.soundcloud.com/player/?url=${encodeURIComponent(u.origin + u.pathname)}&auto_play=true&visual=true`;
  if (h === "twitch.tv" && parts[0] && !["directory", "videos", "p", "settings"].includes(parts[0]))
    return parts[1] === "videos" || parts[0] === "videos" ? null : `https://player.twitch.tv/?channel=${encodeURIComponent(parts[0])}&parent=${location.hostname}`;
  if (h === "vimeo.com" && /^\d+$/.test(parts[0] || "")) return `https://player.vimeo.com/video/${parts[0]}?autoplay=1`;
  if (h === "tiktok.com" && parts[1] === "video" && /^\d+$/.test(parts[2] || "")) return `https://www.tiktok.com/embed/v2/${parts[2]}`;
  if (h === "instagram.com" && ["p", "reel", "tv"].includes(parts[0]) && parts[1]) return `https://www.instagram.com/${parts[0]}/${parts[1]}/embed`;
  if ((h === "google.com" || h === "maps.google.com") && (parts[0] === "maps" || h === "maps.google.com")) {
    const q = parts[1] === "place" || parts[1] === "search" ? decodeURIComponent(parts[2] || "").replace(/\+/g, " ") : u.searchParams.get("q");
    if (q) return `https://maps.google.com/maps?q=${encodeURIComponent(q)}&output=embed`;
  }
  // Wikipedia: the phone-friendly version
  if (/(^|\.)wikipedia\.org$/.test(u.hostname) && !u.hostname.includes(".m.")) {
    u.hostname = u.hostname.replace(".wikipedia.org", ".m.wikipedia.org");
    return u.toString();
  }
  return null;
}

const embeddable = (url) => embedFor(url) || url;

const canFrame = (url) => {
  try {
    const u = new URL(url, location.href);
    if (u.origin === location.origin) return true;
    if (embedFor(url)) return true;
    return frameFriendly.some((re) => re.test(u.hostname));
  } catch { return false; }
};

/** YouTube's home page and searches can't be shown inside other sites: send those to the DialedUp YouTube window. */
const isYouTubeHome = (url) => { try { const u = new URL(url); return /(^|\.)youtube\.com$/.test(u.hostname) && !embedFor(url); } catch { return false; } };

let count = 0;
export function openBrowser(url = "", meta = {}) {
  const full = url && !/^https?:\/\//i.test(url) && !url.startsWith("/") && !url.startsWith("home.html") ? "https://" + url : url;
  if (full && (isYouTubeHome(full) || /youtube-nocookie/.test(embedFor(full) || ""))) { import("./youtube.js").then((m) => m.openYouTube(full)); return; }
  const id = "browser"; // one browser window; new links load in it
  const existing = getWindow(id);
  if (existing) { existing.navigate(url, meta); existing.el.classList.remove("minimized"); return; }
  const hist = [];
  let pos = -1;
  openWindow(id, {
    title: "DialedUp Browser", icon: "🌍", width: 560, height: 520, keyword: "browser",
    render(body, win) {
      body.classList.add("browser-body");
      body.innerHTML = `
        <div class="br-bar">
          <button data-b="back" title="Back">◀<span>Back</span></button><button data-b="fwd" title="Forward">▶<span>Forward</span></button>
          <button data-b="reload" title="Reload">⟳<span>Reload</span></button><button data-b="home" title="Start Page">🏠<span>Start</span></button>
          <form class="br-form"><input class="br-url" placeholder="Type a web address" autocomplete="off" inputmode="url"><button class="btn small-btn">Go</button></form>
          <button data-b="fav" title="Add to Favorites">❤️<span>Save</span></button><button data-b="out" title="Open in a new tab">↗<span>New Tab</span></button>
        </div>
        <div class="br-view"></div>
        <div class="br-status small"><span class="br-msg">Done</span></div>`;
      const view = body.querySelector(".br-view");
      const urlBox = body.querySelector(".br-url");
      const msg = body.querySelector(".br-msg");

      const render = (entry) => {
        const { url, meta } = entry;
        urlBox.value = url || "";
        if (!url) {
          setTitle(id, "DialedUp Browser — Start Page");
          view.innerHTML = `<div class="br-start"><h3>🌍 DialedUp Start Page</h3><p class="small muted">Pick a site or type an address above.</p>
            <div class="br-tiles">${startLinks.map(([ic, n, u]) => `<button data-go="${u}"><span>${ic}</span>${esc(n)}</button>`).join("")}</div></div>`;
          view.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => navigate(b.dataset.go)));
          msg.textContent = "Done";
          return;
        }
        let host = "";
        try { host = new URL(url).hostname.replace(/^www\./, ""); } catch {}
        setTitle(id, `DialedUp Browser — ${meta?.title ? meta.title.slice(0, 40) : host}`);
        if (canFrame(url)) {
          msg.textContent = "Loading…";
          view.innerHTML = `<iframe src="${esc(embeddable(url))}" referrerpolicy="no-referrer-when-downgrade"
            allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowfullscreen></iframe>`;
          view.querySelector("iframe").onload = () => (msg.textContent = "Done");
        } else {
          msg.textContent = `${host} opens in its own tab`;
          view.innerHTML = `<div class="br-card">
            ${meta?.image ? `<img src="${esc(meta.image)}" alt="">` : `<div class="br-site">🌐</div>`}
            ${meta?.source ? `<span class="src-tag" style="background:#5b2a86">${esc(meta.source)}</span>` : ""}
            <h3>${esc(meta?.title || host)}</h3>
            <p class="small muted">${esc(host)} doesn't allow itself to be shown inside other websites, so it opens in a new tab.</p>
            <a class="btn primary" href="${esc(url)}" target="_blank" rel="noopener">Read it on ${esc(host)} ↗</a>
            <p class="small"><a href="#" data-try>Try loading it here anyway</a></p></div>`;
          view.querySelector("[data-try]").onclick = (e) => {
            e.preventDefault();
            view.innerHTML = `<iframe src="${esc(url)}"></iframe>`;
            msg.textContent = "If this stays blank, the site is blocking it — use ↗";
          };
        }
      };

      const navigate = (url, meta = {}) => {
        let u = (url || "").trim();
        if (isYouTubeHome(/^https?:/i.test(u) ? u : "https://" + u)) { import("./youtube.js").then((m) => m.openYouTube()); return; }
        if (u && !/^https?:\/\//i.test(u) && !u.startsWith("/") && !u.startsWith("home.html")) u = "https://" + u;
        // Easter egg: Wikipedia's front page opens to the article about the online service that started it all
        try { const w = new URL(u); if (/^(www\.|en\.)?(m\.)?wikipedia\.org$/i.test(w.hostname) && /^\/?(wiki\/Main_Page)?$/i.test(w.pathname)) u = "https://en.wikipedia.org/wiki/AOL"; } catch {}
        hist.splice(pos + 1);
        hist.push({ url: u, meta });
        pos = hist.length - 1;
        render(hist[pos]);
      };
      win.navigate = navigate;

      body.querySelector(".br-form").onsubmit = (e) => { e.preventDefault(); navigate(urlBox.value); urlBox.blur(); };
      body.querySelector("[data-b=back]").onclick = () => { if (pos > 0) render(hist[--pos]); };
      body.querySelector("[data-b=fwd]").onclick = () => { if (pos < hist.length - 1) render(hist[++pos]); };
      body.querySelector("[data-b=reload]").onclick = () => pos >= 0 && render(hist[pos]);
      body.querySelector("[data-b=home]").onclick = () => navigate("");
      body.querySelector("[data-b=out]").onclick = () => { const cur = hist[pos]?.url; if (cur) window.open(cur, "_blank", "noopener"); };
      body.querySelector("[data-b=fav]").onclick = () => {
        const cur = hist[pos]?.url;
        if (cur) { addFavorite(cur, hist[pos].meta?.title || cur.replace(/^https?:\/\/(www\.)?/, "").slice(0, 40)); msg.textContent = "Added to Favorite Places ❤️"; }
      };
      navigate(url, meta);
    },
  });
  count++;
}

// Any link marked data-browse opens in the DialedUp Browser instead of a new tab.
document.addEventListener("click", (e) => {
  // Links to videos, songs, streams and posts play inside DialedUp
  const any = e.target.closest("a[href]");
  if (any && !e.metaKey && !e.ctrlKey && !any.hasAttribute("download") && /^https?:/i.test(any.getAttribute("href") || "") && embedFor(any.href)
      && !/wikipedia\.org/i.test(any.href)) {
    e.preventDefault();
    if (/youtube-nocookie/.test(embedFor(any.href))) import("./youtube.js").then((m) => m.openYouTube(any.href));
    else openBrowser(any.href, { title: any.textContent.trim().slice(0, 60) });
    return;
  }
  const a = e.target.closest("a[data-browse]");
  if (!a || e.metaKey || e.ctrlKey) return;
  e.preventDefault();
  openBrowser(a.href, { title: a.dataset.title, source: a.dataset.source, image: a.dataset.image });
});
