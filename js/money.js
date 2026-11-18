// Stocks & Finance: market numbers collected by the news robot every 20 minutes.
import { openWindow, esc } from "./wm.js";

const URL_ = "https://raw.githubusercontent.com/dialed-up/dialed-up.github.io/news-data/news.json";

export function openStocks() {
  openWindow("stocks", {
    title: "Stocks & Finance", icon: "📈", width: 380, height: 500, keyword: "stocks",
    async render(body) {
      body.innerHTML = `<p class="muted">📡 Getting the latest numbers…</p>`;
      let d;
      try { d = await (await fetch(URL_ + "?t=" + Math.floor(Date.now() / 300000))).json(); } catch {}
      const list = d?.markets || [];
      if (!list.length) { body.innerHTML = `<p class="muted">Market numbers aren't available yet. Check back in a few minutes.</p>`; return; }
      const watch = new Set(JSON.parse(localStorage.getItem("du.watch") || "[]"));
      const row = (q) => `<tr><td><button class="star" data-s="${esc(q.symbol)}">${watch.has(q.symbol) ? "⭐" : "☆"}</button></td>
        <td><b>${esc(q.name)}</b><div class="small muted">${esc(q.symbol)}</div></td>
        <td style="text-align:right">${q.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
        <td style="text-align:right;color:${q.change >= 0 ? "#2e7d32" : "#c62828"}">${q.change >= 0 ? "▲" : "▼"} ${Math.abs(q.pct).toFixed(2)}%</td></tr>`;
      const paint = () => {
        const mine = list.filter((q) => watch.has(q.symbol));
        body.innerHTML = `<p class="small muted">Updated ${new Date(d.updated).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · prices may be delayed</p>
          ${mine.length ? `<div class="panel"><h3>⭐ My Watch List</h3><table class="stocks">${mine.map(row).join("")}</table></div>` : ""}
          <div class="panel"><h3>📈 Markets</h3><table class="stocks">${list.map(row).join("")}</table></div>
          <p class="small muted">Tap ☆ to add to your Watch List.</p>`;
        body.querySelectorAll("[data-s]").forEach((b) => (b.onclick = () => {
          watch.has(b.dataset.s) ? watch.delete(b.dataset.s) : watch.add(b.dataset.s);
          localStorage.setItem("du.watch", JSON.stringify([...watch]));
          paint();
        }));
      };
      paint();
    },
  });
}
