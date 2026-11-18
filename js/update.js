// Checks for a newer version of the site and offers a one-tap update (phones love to hold on to old copies).
const page = location.pathname.split("/").pop() || "index.html";
const mine = (document.querySelector('script[src*="main.js"], script[src*="dim.js"]')?.src.match(/v=(\d+)/) || [])[1];
let shown = false;

async function check() {
  if (shown || !mine || document.visibilityState !== "visible") return;
  try {
    const html = await (await fetch(`${page}?check=${Date.now()}`, { cache: "no-store" })).text();
    const latest = (html.match(/(?:main|dim)\.js\?v=(\d+)/) || [])[1];
    if (latest && latest !== mine && Number(latest) > Number(mine)) offer(latest);
  } catch {}
}

function offer(v) {
  shown = true;
  const bar = document.createElement("button");
  bar.className = "update-bar";
  bar.innerHTML = "✨ A new version is ready — <b>tap to update</b>";
  bar.onclick = () => location.replace(`${page}?v=${v}`);
  document.body.appendChild(bar);
}

setTimeout(check, 4000);
setInterval(check, 5 * 60 * 1000);
document.addEventListener("visibilitychange", check);
