// Notifications: real push alerts (even when DialedUp is closed) through our free Cloudflare sender,
// plus pop-ups while the app is open in the background.
import { auth, db, ref, update, serverTimestamp } from "./firebase.js";

const PUSH = "https://dialedup-push.stickyarcadecloud.workers.dev";   // free Cloudflare Worker (see worker/)
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
  const r = await fetch(PUSH + path, { method: "POST", headers: { "content-type": "application/json", "x-du-appcheck": await (await import("./firebase.js")).appCheckToken() }, body: JSON.stringify({ ...data, token }) });
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
    const standaloneApp = window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;
    const device = `${standaloneApp ? "app" : "browser"}-${/iPhone|iPad/.test(navigator.userAgent) ? "ios" : /Android/.test(navigator.userAgent) ? "android" : "computer"}`;
    const res = await post("/subscribe", { sub: sub.toJSON(), device });
    startOnScreen();
    return !!res?.ok;
  } catch { return false; }
}

/** Tells the sender to alert someone about an IM or mail we just sent. */
export function pushTo(to, kind, extra = {}) {
  post("/notify", { to, kind, ...extra }).catch(() => {});
}

const onIPhone = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
const inApp = () => window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;

export async function enableNotifications() {
  if (onIPhone() && !inApp()) {
    alert("On iPhone, notifications only work in the DialedUp app on your Home Screen.\n\n1. In Safari tap Share → Add to Home Screen\n2. Make sure \"Open as Web App\" is ON\n3. Tap Add, open DialedUp from the new icon, and try again.");
    return false;
  }
  if (!supported()) {
    alert("This browser can't show notifications.");
    return false;
  }
  if (Notification.permission === "denied") {
    alert(onIPhone()
      ? "Notifications were turned off for DialedUp.\n\nGo to iPhone Settings → Notifications → DialedUp and turn on Allow Notifications. (If DialedUp isn't listed there, delete the DialedUp icon, add it again from dialedup.lol, and tap Turn On Notifications.)"
      : "Notifications are blocked for this site. Click the 🔒 next to the web address, allow Notifications, then try again.");
    return false;
  }
  const p = await Notification.requestPermission();   // asked right away, on the tap (iPhone requires that)
  if (p !== "granted") { alert("No problem — you can turn alerts on later from File → 🔔 Turn On Notifications."); return false; }
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

// ---------- Red number on the app icon ----------
// The Home Screen app works on its own: the bubble counts alerts that came in while it was closed,
// and opening the app (only the app, never a browser tab) clears it.
const isApp = () => window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;
async function clearBadge() {
  if (!isApp() || document.visibilityState !== "visible") return;
  try { await navigator.clearAppBadge?.(); } catch {}
  try {
    const r = await navigator.serviceWorker?.getRegistration();
    r?.active?.postMessage({ type: "badge", count: 0 });
    (await r?.getNotifications?.())?.forEach((n) => n.close());
  } catch {}
}
clearBadge();
document.addEventListener("visibilitychange", clearBadge);
/** Kept so other parts of DialedUp can report unread counts; the app bubble only clears when the app is opened. */
export function setBadgePart() {}

// ---------- "This device has DialedUp on screen" (so only this device skips the alert) ----------
let myDev = null, markedHere = false, beat = null;
async function deviceId() {
  if (myDev !== null) return myDev;
  try {
    const r = await navigator.serviceWorker?.getRegistration();
    const sub = await r?.pushManager?.getSubscription();
    if (!sub) return (myDev = "");
    const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sub.endpoint));
    myDev = [...new Uint8Array(d)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch { myDev = ""; }
  return myDev;
}
async function markOnScreen() {
  const user = auth.currentUser;
  if (!user || !PUSH) return;
  const dev = await deviceId();
  if (document.visibilityState === "visible" && dev) {
    markedHere = true;
    update(ref(db, `users/${user.uid}`), { fgDev: dev, fgAt: serverTimestamp() }).catch(() => {});
    clearInterval(beat);
    beat = setInterval(() => document.visibilityState === "visible" && auth.currentUser && update(ref(db, `users/${auth.currentUser.uid}`), { fgAt: serverTimestamp() }).catch(() => {}), 60000);
  } else if (markedHere) {
    markedHere = false;
    clearInterval(beat);
    update(ref(db, `users/${user.uid}`), { fgDev: null }).catch(() => {});
  }
}
document.addEventListener("visibilitychange", markOnScreen);
window.addEventListener("pagehide", () => { if (markedHere && auth.currentUser) update(ref(db, `users/${auth.currentUser.uid}`), { fgDev: null }).catch(() => {}); });
export const startOnScreen = () => { myDev = null; markOnScreen(); };

/** Sends a test alert to your own phone(s) 10 seconds from now. */
export async function sendTestAlert() {
  if (!notifyOn()) { alert("Turn on notifications first (🔔 Turn On Notifications), then try the test."); return; }
  await subscribePush();
  const res = await post("/test", {});
  if (!res?.ok) { alert("Couldn't reach the alert sender. Check your connection and try again."); return; }
  alert(res.phones
    ? `✅ Test alert on its way!\n\nClose DialedUp now (swipe it away or lock your phone). It arrives in about 10 seconds.`
    : "This device isn't signed up for alerts yet. Open DialedUp from the Home Screen icon and tap 🔔 Turn On Notifications.");
}
