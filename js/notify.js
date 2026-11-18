// Notifications: real push alerts (even when DialedUp is closed) through our free Cloudflare sender,
// plus pop-ups while the app is open in the background.
import { auth } from "./firebase.js";

const PUSH = "";   // the push sender's address goes here once it's set up on DialedUp's own Cloudflare account
const VAPID_PUBLIC = "BFk3S49eezM1VA09c-2mfLO8Im1Qvew7PH1CdLkWNhlCbsQOrtd8O2VG0leGU9Kys6UF_tpHu_uke8nxsYlKfPw";
let reg = null;
const supported = () => "Notification" in window && "serviceWorker" in navigator;
export const notifyOn = () => supported() && Notification.permission === "granted" && localStorage.getItem("du.notify") !== "0";

async function registration() {
  if (reg) return reg;
  try { reg = await navigator.serviceWorker.register("sw.js"); await navigator.serviceWorker.ready; } catch { reg = null; }
  return reg;
}
if (supported() && Notification.permission === "granted") registration();

const b64ToBytes = (b64) => {
  const s = atob(b64.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

async function post(path, data) {
  if (!PUSH) return null;
  const user = auth.currentUser;
  if (!user) return null;
  const token = await user.getIdToken();
  const r = await fetch(PUSH + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...data, token }) });
  return r.json().catch(() => null);
}

/** Signs this phone/computer up for push alerts (safe to call often). */
export async function subscribePush() {
  if (!PUSH || !notifyOn()) return false;
  const r = await registration();
  if (!r?.pushManager) return false;
  try {
    let sub = await r.pushManager.getSubscription();
    if (!sub) sub = await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID_PUBLIC) });
    const res = await post("/subscribe", { sub: sub.toJSON() });
    return !!res?.ok;
  } catch { return false; }
}

/** Tells the sender to alert someone about an IM or mail we just sent. */
export function pushTo(to, kind, extra = {}) {
  post("/notify", { to, kind, ...extra }).catch(() => {});
}

export async function enableNotifications() {
  if (!supported()) {
    alert("This browser can't show notifications. On iPhone, add DialedUp to your Home Screen first, then open it from there and try again.");
    return false;
  }
  const p = await Notification.requestPermission();
  if (p !== "granted") { alert("Notifications are blocked. You can turn them on in your phone or browser settings."); return false; }
  localStorage.setItem("du.notify", "1");
  await registration();
  const pushed = await subscribePush();
  notify("🔔 Notifications are on", pushed ? "You'll get alerts for new IMs and mail, even when DialedUp is closed." : "You'll get pop-ups for new IMs and mail while DialedUp is open.", { force: true });
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
