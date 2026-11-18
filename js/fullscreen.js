// Full Screen mode for computers: hides the browser's tabs and address bar.
const supported = () => !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
const isFull = () => !!(document.fullscreenElement || document.webkitFullscreenElement);

export async function toggleFullscreen() {
  try {
    if (isFull()) await (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    else await (document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen).call(document.documentElement);
  } catch { alert("Your browser didn't allow full screen. Try pressing F11 (Windows) or Ctrl+Cmd+F (Mac)."); }
}

function paint() {
  document.querySelectorAll(".fs-btn").forEach((b) => {
    b.hidden = !supported() || matchMedia("(pointer: coarse) and (max-width: 900px)").matches;   // phones can't do it
    b.innerHTML = isFull() ? "🗗 Exit Full Screen" : "⛶ Full Screen";
    b.title = isFull() ? "Exit full screen (Esc)" : "Full screen (F11)";
  });
}
document.addEventListener("fullscreenchange", paint);
document.addEventListener("webkitfullscreenchange", paint);
document.addEventListener("click", (e) => { if (e.target.closest(".fs-btn")) toggleFullscreen(); });
paint();
