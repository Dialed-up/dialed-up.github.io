// Maps & Directions using OpenStreetMap (free, no account).
import { openWindow, esc } from "./wm.js";

export function openMaps(query = "") {
  openWindow("maps", {
    title: "Maps & Directions", icon: "🗺", width: 520, height: 520, keyword: "maps",
    render(body) {
      body.classList.add("browser-body");
      body.innerHTML = `<div class="br-bar" style="flex-wrap:wrap">
          <form class="br-form" id="m-find"><input class="br-url" id="m-q" placeholder="Find a place (e.g. Barclays Center)" value="${esc(query)}"><button class="btn small-btn">Find</button></form>
          <form class="br-form" id="m-dir" style="flex-basis:100%"><input class="br-url" id="m-from" placeholder="From"><input class="br-url" id="m-to" placeholder="To">
            <button class="btn small-btn">Directions ↗</button></form></div>
        <div class="br-view"><iframe src="https://www.openstreetmap.org/export/embed.html?bbox=-74.06,40.66,-73.88,40.80&layer=mapnik"></iframe></div>
        <div class="br-status small" id="m-msg">New York City · Map data © OpenStreetMap contributors</div>`;
      const frame = body.querySelector("iframe"), msg = body.querySelector("#m-msg");
      const find = async (q) => {
        msg.textContent = "Searching…";
        try {
          const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`);
          const p = (await r.json())[0];
          if (!p) { msg.textContent = `Couldn't find "${q}".`; return; }
          const [s, n, w, e] = p.boundingbox.map(Number);
          const pad = 0.004;
          frame.src = `https://www.openstreetmap.org/export/embed.html?bbox=${w - pad},${s - pad},${e + pad},${n + pad}&layer=mapnik&marker=${p.lat},${p.lon}`;
          msg.textContent = p.display_name + " · Map data © OpenStreetMap contributors";
        } catch { msg.textContent = "Map search isn't answering right now."; }
      };
      body.querySelector("#m-find").onsubmit = (e) => { e.preventDefault(); const q = body.querySelector("#m-q").value.trim(); if (q) find(q); };
      body.querySelector("#m-dir").onsubmit = (e) => {
        e.preventDefault();
        const from = body.querySelector("#m-from").value.trim(), to = body.querySelector("#m-to").value.trim();
        if (from && to) window.open(`https://www.google.com/maps/dir/${encodeURIComponent(from)}/${encodeURIComponent(to)}`, "_blank", "noopener");
      };
      if (query) find(query);
    },
  });
}
