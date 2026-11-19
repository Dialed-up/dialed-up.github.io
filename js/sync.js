// Settings that follow your account: wallpaper, theme, favorites, signature, saved away messages,
// window spots, DIM backdrop, game high scores and more. Saved to settings/{uid} so they come with you
// to a new phone, a new browser, or a new web address.
import { db, ref, get, update } from "./firebase.js";

const KEEP = ["du.altcaps", "du.npRadio", "du.wallpaper", "du.wallpaperImg", "du.theme", "du.imbg", "du.city", "du.mailBuddiesOnly", "du.snake.best", "du.scramble.best",
  "du.trivia.best", "du.names", "du.muted", "du.awaySaved", "du.watch", "du.style", "du.sign", "du.show", "du.menuOpen", "du.listed.",
  "du.knock", "du.ignored", "du.alerts", "dim.backdrop", "du.favorites", "du.sig.", "du.emojiRecent", "du.accepted.", "du.rsvp.", "du.bot.",
  "du.win3.", "du.dimwin", "du.alertsAskOff"];
// Never synced: Kid-Safe PIN (stays on that one device), notification permission, read markers, caches.
const SKIP = ["du.kidpin", "du.kidPrevMail", "du.notify", "du.read.", "du.buddyof.", "du.reminded.", "du.pv."];

const wanted = (k) => !SKIP.some((p) => k.startsWith(p)) && KEEP.some((p) => k === p || k.startsWith(p));
const enc = (k) => k.replace(/\./g, "~");
const dec = (k) => k.replace(/~/g, ".");
const MAX = 350000;

let uid = null, pending = {}, timer = null, quiet = false;
const rawSet = Storage.prototype.setItem, rawRemove = Storage.prototype.removeItem;

function queue(k, v) {
  if (!uid || quiet || !wanted(k)) return;
  if (v !== null && String(v).length > MAX) return;
  pending[enc(k)] = v === null ? null : String(v);
  clearTimeout(timer);
  timer = setTimeout(flush, 1500);
}
function flush() {
  if (!uid || !Object.keys(pending).length) return;
  const batch = pending; pending = {};
  update(ref(db, `settings/${uid}`), batch).catch(() => {});
}

// If this device's storage is full, saving a setting would fail and break things like sending an IM
// or turning aLt CaPs off. So: clear out old leftovers and try again, and as a last resort keep the
// value in memory for this visit instead of failing.
const rawGet = Storage.prototype.getItem;
const memory = new Map();
const LEFTOVERS = ["du.read.", "du.bday.", "du.reminded.", "du.pv.", "du.win3.", "du.feedSeen.", "du.notifSeen.", "du.bot.", "du.emojiRecent", "du.buddyof."];
function freeUpSpace(store, keep) {
  const keys = [];
  for (let i = 0; i < store.length; i++) keys.push(store.key(i));
  // oldest "read" markers first, then other leftovers
  const reads = keys.filter((k) => k.startsWith("du.read.") && k !== keep).sort((a, b) => Number(rawGet.call(store, a)) - Number(rawGet.call(store, b)));
  reads.slice(0, Math.ceil(reads.length / 2)).forEach((k) => rawRemove.call(store, k));
  keys.filter((k) => k !== keep && !k.startsWith("du.read.") && LEFTOVERS.some((p) => k.startsWith(p))).forEach((k) => rawRemove.call(store, k));
}
function safeSet(store, k, v) {
  try { rawSet.call(store, k, v); memory.delete(k); return; } catch {}
  try { freeUpSpace(store, k); rawSet.call(store, k, v); memory.delete(k); return; } catch {}
  memory.set(k, String(v));   // still full: remember it for this visit
}

Storage.prototype.setItem = function (k, v) {
  if (this !== window.localStorage) return rawSet.call(this, k, v);
  safeSet(this, k, v);
  queue(k, v);
};
Storage.prototype.getItem = function (k) {
  if (this === window.localStorage && memory.has(k)) return memory.get(k);
  return rawGet.call(this, k);
};
Storage.prototype.removeItem = function (k) { memory.delete(k); rawRemove.call(this, k); if (this === window.localStorage) queue(k, null); };

/** Call after signing on. Brings saved settings onto this device, then keeps them in sync. Returns true if anything was restored. */
export async function startSync(id) {
  uid = id;
  let restored = false;
  try {
    const remote = (await get(ref(db, `settings/${uid}`))).val() || {};
    quiet = true;
    for (const [k, v] of Object.entries(remote)) {
      const key = dec(k);
      if (wanted(key) && localStorage.getItem(key) === null && typeof v === "string") { safeSet(localStorage, key, v); restored = true; }
    }
    quiet = false;
    // Save anything this device has that the account doesn't yet.
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (wanted(key) && !(enc(key) in remote)) queue(key, localStorage.getItem(key));
    }
  } catch { quiet = false; }
  return restored;
}

export function stopSync() { flush(); uid = null; }
window.addEventListener("pagehide", flush);
document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flush());
