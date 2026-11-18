// Notifications: pop-up alerts for new IMs and mail while DialedUp or DIM is open in the background.
let reg = null;
const supported = () => "Notification" in window && "serviceWorker" in navigator;
export const notifyOn = () => supported() && Notification.permission === "granted" && localStorage.getItem("du.notify") !== "0";

async function registration() {
  if (reg) return reg;
  try { reg = await navigator.serviceWorker.register("sw.js"); await navigator.serviceWorker.ready; } catch { reg = null; }
  return reg;
}
if (supported() && Notification.permission === "granted") registration();

export async function enableNotifications() {
  if (!supported()) {
    alert("This browser can't show notifications. On iPhone, add DialedUp to your Home Screen first, then open it from there and try again.");
    return false;
  }
  const p = await Notification.requestPermission();
  if (p !== "granted") { alert("Notifications are blocked. You can turn them on in your phone or browser settings."); return false; }
  localStorage.setItem("du.notify", "1");
  await registration();
  notify("🔔 Notifications are on", "You'll get a pop-up for new IMs and mail while DialedUp is open.", { force: true });
  return true;
}
export function disableNotifications() { localStorage.setItem("du.notify", "0"); }

/** Shows a notification if the page is in the background (or force). */
export async function notify(title, body, { tag, force = false, url } = {}) {
  if (!notifyOn() || (!force && document.visibilityState === "visible")) return;
  const r = await registration();
  const opts = { body, tag, icon: "img/icon-192-d1794979108.png", data: { url: url || location.pathname.split("/").pop() || "./" } };
  try { r ? await r.showNotification(title, opts) : new Notification(title, opts); } catch {}
}
