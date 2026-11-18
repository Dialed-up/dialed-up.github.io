// The DialedUp Browser: a web browser window inside DialedUp.
// Big sites (CNN, ESPN, NYT…) refuse to be shown inside other sites, so for those it shows a preview
// card with a button to open the real page in a new tab. Sites that allow it load right in the window.
import { openWindow, getWindow, setTitle, esc } from "./wm.js";
import { addFavorite } from "./extras.js";

// Sites known to load fine inside the window.
const frameFriendly = [
  /(^|\.)wikipedia\.org$/i, /(^|\.)wikimedia\.org$/i, /^www\.youtube(-nocookie)?\.com$/i, /^www\.openstreetmap\.org$/i,
  /(^|\.)archive\.org$/i, /^dialed-up\.github\.io$/i, /^bandcamp\.com$/i, /^open\.spotify\.com$/i, /^w\.soundcloud\.com$/i,
];

const startLinks = [
  ["📰", "CNN", "https://www.cnn.com"], ["📰", "NBC News", "https://www.nbcnews.com"], ["📰", "New York Times", "https://www.nytimes.com"],
  ["📻", "NPR", "https://www.npr.org"], ["🌍", "BBC", "https://www.bbc.com/news"], ["🏀", "ESPN", "https://www.espn.com"],
  ["▶️", "YouTube", "https://www.youtube.com"], ["📚", "Wikipedia", "https://en.wikipedia.org"], ["🗺", "Maps", "https://www.openstreetmap.org"],
  ["🎵", "SoundCloud", "https://soundcloud.com"], ["🛒", "Amazon", "https://www.amazon.com"], ["🌤", "Weather.gov", "https://www.weather.gov"],
];

/** Turn normal links into embeddable ones where the site offers that. */
function embeddable(url) {
  try {
    const u = new URL(url);
    if (/(^|\.)youtube\.com$/.test(u.hostname) && u.searchParams.get("v")) return `https://www.youtube.com/embed/${u.searchParams.get("v")}`;
    if (u.hostname === "youtu.be") return `https://www.youtube.com/embed${u.pathname}`;
    if (/(^|\.)wikipedia\.org$/.test(u.hostname) && !u.hostname.includes(".m.")) {
      u.hostname = u.hostname.replace(".wikipedia.org", ".m.wikipedia.org");   // phone-friendly version
      return u.toString();
    }
    return url;
  } catch { return url; }
}

const canFrame = (url) => {
  try {
    const u = new URL(url, location.href);
    if (u.origin === location.origin) return true;
    return frameFriendly.some((re) => re.test(u.hostname));
  } catch { return false; }
};

let count = 0;
export function openBrowser(url = "", meta = {}) {
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
          <button data-b="back" title="Back">◀</button><button data-b="fwd" title="Forward">▶</button>
          <button data-b="reload" title="Reload">⟳</button><button data-b="home" title="Start Page">🏠</button>
          <form class="br-form"><input class="br-url" placeholder="Type a web address" autocomplete="off" inputmode="url"><button class="btn small-btn">Go</button></form>
          <button data-b="fav" title="Add to Favorites">❤️</button><button data-b="out" title="Open in a new tab">↗</button>
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
        if (u && !/^https?:\/\//i.test(u) && !u.startsWith("/") && !u.startsWith("home.html")) u = "https://" + u;
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
  const a = e.target.closest("a[data-browse]");
  if (!a || e.metaKey || e.ctrlKey) return;
  e.preventDefault();
  openBrowser(a.href, { title: a.dataset.title, source: a.dataset.source, image: a.dataset.image });
});
