// Full Screen mode for computers: hides the browser's tabs and address bar.
const supported = () => !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
const isFull = () => !!(document.fullscreenElement || document.webkitFullscreenElement);

const inOverlay = () => { try { return window.self !== window.top; } catch { return true; } };
let parentFull = false;   // when DIM/DialedUp is shown on top of the other page, the page underneath owns full screen

export async function toggleFullscreen() {
  if (inOverlay()) { window.parent.postMessage({ type: "du:toggleFs" }, location.origin); return; }
  try {
    if (isFull()) await (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    else await (document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen).call(document.documentElement);
  } catch { alert("Your browser didn't allow full screen. Try pressing F11 (Windows) or Ctrl+Cmd+F (Mac)."); }
}

function paint() {
  document.querySelectorAll(".fs-btn").forEach((b) => {
    b.hidden = !supported() || matchMedia("(pointer: coarse) and (max-width: 900px)").matches;   // phones can't do it
    const full = inOverlay() ? parentFull : isFull();
    b.innerHTML = full ? "🗗 Exit Full Screen" : "⛶ Full Screen";
    b.title = full ? "Exit full screen (Esc)" : "Full screen (F11)";
  });
}
document.addEventListener("fullscreenchange", paint);
document.addEventListener("webkitfullscreenchange", paint);
document.addEventListener("click", (e) => { if (e.target.closest(".fs-btn")) toggleFullscreen(); });
paint();

// Talking between a page and the other layout shown on top of it
const tellOverlay = () => document.getElementById("du-overlay")?.contentWindow?.postMessage({ type: "du:fsState", full: isFull() }, location.origin);
document.addEventListener("fullscreenchange", tellOverlay);
document.addEventListener("webkitfullscreenchange", tellOverlay);
window.addEventListener("message", (e) => {
  if (e.origin !== location.origin) return;
  const t = e.data?.type;
  if (t === "du:closeOverlay") import("./switcher.js").then((m) => m.hideOverlay());
  else if (t === "du:toggleFs") toggleFullscreen().then(tellOverlay);
  else if (t === "du:fsState") { parentFull = !!e.data.full; paint(); }
});
// When full screen ends, bring the page underneath back (the overlay only exists to keep full screen)
document.addEventListener("fullscreenchange", () => { if (!isFull()) import("./switcher.js").then((m) => m.hideOverlay()); });
if (inOverlay()) window.parent.postMessage({ type: "du:askFs" }, location.origin);
window.addEventListener("message", (e) => { if (e.origin === location.origin && e.data?.type === "du:askFs") tellOverlay(); });
