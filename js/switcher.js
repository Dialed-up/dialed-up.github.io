// Switching between DialedUp and DIM: same site, same sign-on, same homies and messages.
const standalone = () => window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;
const isFull = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
export const embedded = () => { try { return window.self !== window.top; } catch { return true; } };

/** Shows the other layout on top of this page (used in full screen, which a page change would end). */
export function showOverlay(page) {
  let f = document.getElementById("du-overlay");
  if (!f) {
    f = document.createElement("iframe");
    f.id = "du-overlay";
    f.setAttribute("allow", "autoplay; microphone; camera; fullscreen; clipboard-write");
    f.src = page;
    document.body.appendChild(f);
  }
  f.hidden = false;
  window.__duQuiet = true;                               // the page underneath goes quiet
  try { f.contentWindow.__duQuiet = false; } catch {}
  f.focus();
}
export function hideOverlay() {
  const f = document.getElementById("du-overlay");
  if (f) { f.hidden = true; try { f.contentWindow.__duQuiet = true; } catch {} }
  window.__duQuiet = false;
}

/** Go to the other layout. */
export function switchTo(page, name) {
  // Inside the overlay: just slide back to the page underneath
  if (embedded()) { window.parent.postMessage({ type: "du:closeOverlay" }, location.origin); return; }
  // Full screen: open the other layout on top so the browser stays full screen
  if (isFull()) { showOverlay(page); return; }
  // Home Screen app: same window (a new tab would open Safari, which keeps a separate sign-on)
  if (standalone()) { location.href = page; return; }
  // Browser: open or reuse its own tab
  let w = null;
  try { w = window.open("", name); } catch {}
  if (!w) { location.href = page; return; }
  try {
    if (w.location.href === "about:blank" || !w.location.pathname.endsWith(page)) w.location.href = page;
  } catch { w.location.href = page; }
  w.focus();
}
