// "Add to Home Screen" button: real install prompt where the browser allows it, simple steps on iPhone.
import { openWindow, closeWindow } from "./wm.js";

let deferred = null;
export const isInstalled = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e; refreshButtons(); });
window.addEventListener("appinstalled", () => { deferred = null; refreshButtons(); });

export function refreshButtons() {
  document.querySelectorAll(".install-btn").forEach((b) => (b.hidden = isInstalled()));
}

export async function addToHomeScreen() {
  if (deferred) {
    deferred.prompt();
    await deferred.userChoice.catch(() => {});
    deferred = null;
    refreshButtons();
    return;
  }
  const notSafari = isIOS() && /crios|fxios|edgios/i.test(navigator.userAgent);
  const steps = isIOS()
    ? notSafari
      ? `<p><b>Open this page in Safari first</b> — iPhone only allows Home Screen apps from Safari.</p>
         <p class="small">Copy this address and paste it into Safari:<br><b>${location.host}</b></p>`
      : `<ol class="install-steps">
          <li>Tap the <b>Share</b> button <span class="share-ic">⬆︎</span> — at the bottom of Safari (or top right on iPad).
            If you don't see it, tap the <b>···</b> button first.</li>
          <li>Scroll down and tap <b>Add to Home Screen</b> <span class="share-ic">➕</span></li>
          <li>Tap <b>Add</b>.</li>
        </ol>
        <p class="small muted">Then open DialedUp from your Home Screen — it runs full screen like a real app.</p>`
    : `<ol class="install-steps">
        <li>In Chrome or Edge, click the <b>install</b> icon <span class="share-ic">⊕</span> at the right end of the address bar,
          or open the browser menu <b>⋮</b> → <b>Install DialedUp</b> / <b>Add to Home screen</b>.</li>
        <li>Confirm with <b>Install</b>.</li>
      </ol>`;
  const html = `<div style="text-align:center"><img src="img/icon-192-d1794979108.png" onerror="this.src='img/logo.png'" alt=""
      style="width:72px;height:72px;border-radius:16px;box-shadow:0 4px 12px rgba(0,0,0,.25)"></div>
    ${steps}
    <div class="row"><span></span><button class="btn primary small-btn" data-x="ok">Got it</button></div>
    ${isIOS() && !notSafari ? `<div class="install-arrow">⬇︎</div>` : ""}`;
  // Signed on: open as a desktop window. On the sign-on screen: a pop-up box.
  if (!document.getElementById("app").hidden) {
    openWindow("install", {
      title: "Turn DialedUp into an App", icon: "📲", width: 340, height: 380,
      render(body) { body.innerHTML = html; body.querySelector("[data-x=ok]").onclick = () => closeWindow("install"); },
    });
    return;
  }
  const overlay = document.createElement("div");
  overlay.className = "install-overlay";
  overlay.innerHTML = `<div class="install-box glossy"><h3>📲 Turn DialedUp into an App</h3>${html}</div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector("[data-x=ok]").onclick = close;
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
}
