// Stops other websites from showing DialedUp inside a hidden frame (clickjacking).
// DialedUp's own DIM ⇄ DialedUp switcher frames the site from the same origin, which is allowed.
try {
  if (window.top !== window.self && window.top.location.origin !== location.origin) throw new Error("framed");
} catch {
  document.documentElement.style.display = "none";
  try { window.top.location.replace(location.href); } catch {}
}
