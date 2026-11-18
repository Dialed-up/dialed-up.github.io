// Switching between DialedUp and DIM: same site, same sign-on, same buddies and messages.
const standalone = () => window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;

/** Go to the other layout. In a Home Screen app we stay in the same window (a new tab would open
 *  Safari, which keeps a separate sign-on). In a browser it opens or reuses its own tab. */
export function switchTo(page, name) {
  if (standalone()) { location.href = page; return; }
  let w = null;
  try { w = window.open("", name); } catch {}
  if (!w) { location.href = page; return; }
  try {
    if (w.location.href === "about:blank" || !w.location.pathname.endsWith(page)) w.location.href = page;
  } catch { w.location.href = page; }
  w.focus();
}
