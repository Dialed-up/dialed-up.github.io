// GIF picker (GIPHY) for IMs and comments.
// GIPHY keys are made for use in web pages and are visible to anyone, like the Firebase key.
import { esc } from "./wm.js";

export const GIF_KEY = "";   // free key from developers.giphy.com; the GIF buttons stay hidden until this is set
export const gifsOn = () => !!GIF_KEY;

/** Only GIPHY's own image servers are shown (anything else in a message is ignored). */
export const safeGif = (url) => (/^https:\/\/media[0-9]?\.giphy\.com\/media\/[A-Za-z0-9]+\/[A-Za-z0-9_.-]+\.(gif|webp)(\?[A-Za-z0-9=&_.-]*)?$/.test(String(url || "")) ? String(url) : "");
export const gifHTML = (g) => (safeGif(g?.url) ? `<img class="gif" src="${esc(g.url)}" alt="GIF" loading="lazy"${g.w ? ` width="${Number(g.w) | 0}" height="${Number(g.h) | 0}"` : ""}>` : "");

let pop = null;
/** Opens the picker next to a button; onPick({ url, w, h }). */
export function pickGif(anchor, onPick) {
  pop?.remove();
  pop = document.createElement("div");
  pop.className = "gif-pop glossy";
  pop.innerHTML = `<div class="row" style="gap:4px"><input placeholder="Search GIFs" class="gif-q" autocomplete="off" data-no-altcaps style="flex:1"><button class="btn small-btn gif-x">✕</button></div>
    <div class="gif-grid"><p class="small muted">Loading…</p></div><div class="small muted gif-by">Powered by GIPHY</div>`;
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect(), w = Math.min(320, innerWidth - 12), h = Math.min(380, innerHeight - 20);
  Object.assign(pop.style, { width: w + "px", height: h + "px", left: Math.max(6, Math.min(r.left, innerWidth - w - 6)) + "px",
    top: (r.top - h - 6 > 6 ? r.top - h - 6 : Math.min(r.bottom + 6, innerHeight - h - 6)) + "px" });
  const grid = pop.querySelector(".gif-grid"), q = pop.querySelector(".gif-q");
  const close = () => { pop?.remove(); pop = null; document.removeEventListener("pointerdown", away, true); };
  const away = (e) => { if (pop && !pop.contains(e.target) && e.target !== anchor) close(); };
  setTimeout(() => document.addEventListener("pointerdown", away, true), 0);
  pop.querySelector(".gif-x").onclick = close;
  let timer = null, seq = 0;
  const load = async () => {
    const my = ++seq, term = q.value.trim();
    const url = term ? `https://api.giphy.com/v1/gifs/search?api_key=${GIF_KEY}&q=${encodeURIComponent(term)}&limit=24&rating=pg-13`
      : `https://api.giphy.com/v1/gifs/trending?api_key=${GIF_KEY}&limit=24&rating=pg-13`;
    try {
      const data = (await (await fetch(url)).json()).data || [];
      if (my !== seq || !pop) return;
      const items = data.map((d) => d.images?.fixed_width).filter((i) => safeGif(i?.url));
      grid.innerHTML = items.length ? items.map((i, n) => `<button data-n="${n}"><img src="${esc(i.url)}" alt="" loading="lazy"></button>`).join("") : `<p class="small muted">No GIFs found.</p>`;
      grid.querySelectorAll("[data-n]").forEach((b) => (b.onclick = () => { const i = items[b.dataset.n]; close(); onPick({ url: i.url, w: Number(i.width) || 0, h: Number(i.height) || 0 }); }));
    } catch { if (my === seq && pop) grid.innerHTML = `<p class="small muted">Couldn't load GIFs right now.</p>`; }
  };
  q.oninput = () => { clearTimeout(timer); timer = setTimeout(load, 300); };
  load();
  q.focus();
}
