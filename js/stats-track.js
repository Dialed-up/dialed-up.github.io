// Counts for the owner's live stats page (dialedup.lol/stats.html). Only numbers and screen names, no messages.
import { db, ref, set, update, runTransaction, serverTimestamp, onDisconnect } from "./firebase.js";

const day = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const bump = (path) => runTransaction(ref(db, path), (n) => (n || 0) + 1).catch(() => {});
const device = () => {
  const app = window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;
  const phone = /iPhone|iPad|iPod|Android/.test(navigator.userAgent);
  return app ? "app" : phone ? "phonebrowser" : "computer";
};
let onlineRef = null;

/** Called once per sign-on. */
export function trackVisit(uid, screenName, page) {
  const d = day();
  bump(`stats/days/${d}/visits`);
  bump(`stats/days/${d}/devices/${device()}`);
  bump(`stats/days/${d}/pages/${page}`);
  set(ref(db, `stats/days/${d}/members/${uid}`), true).catch(() => {});
  // "Online now" list (only the owner can read it)
  onlineRef = ref(db, `online/${uid}`);
  const mark = () => set(onlineRef, { n: String(screenName || "").slice(0, 20), t: serverTimestamp(), d: device(), p: page }).catch(() => {});
  mark();
  try { onDisconnect(onlineRef).remove(); } catch {}
  setInterval(mark, 60000);
}
export const trackIM = () => bump(`stats/days/${day()}/ims`);
export const trackMail = () => bump(`stats/days/${day()}/mail`);
export const trackSignup = () => bump(`stats/days/${day()}/signups`);
