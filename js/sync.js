// Settings that follow your account: wallpaper, theme, favorites, signature, saved away messages,
// window spots, DIM backdrop, game high scores and more. Saved to settings/{uid} so they come with you
// to a new phone, a new browser, or a new web address.
import { db, ref, get, update } from "./firebase.js";

const KEEP = ["du.wallpaper", "du.wallpaperImg", "du.theme", "du.imbg", "du.city", "du.mailBuddiesOnly", "du.snake.best", "du.scramble.best",
  "du.trivia.best", "du.names", "du.muted", "du.awaySaved", "du.watch", "du.style", "du.sign", "du.show", "du.menuOpen", "du.listed.",
  "du.knock", "du.ignored", "du.alerts", "dim.backdrop", "du.favorites", "du.sig.", "du.emojiRecent", "du.accepted.", "du.rsvp.", "du.bot.",
  "du.win3.", "du.dimwin"];
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

Storage.prototype.setItem = function (k, v) { rawSet.call(this, k, v); if (this === window.localStorage) queue(k, v); };
Storage.prototype.removeItem = function (k) { rawRemove.call(this, k); if (this === window.localStorage) queue(k, null); };

/** Call after signing on. Brings saved settings onto this device, then keeps them in sync. Returns true if anything was restored. */
export async function startSync(id) {
  uid = id;
  let restored = false;
  try {
    const remote = (await get(ref(db, `settings/${uid}`))).val() || {};
    quiet = true;
    for (const [k, v] of Object.entries(remote)) {
      const key = dec(k);
      if (wanted(key) && localStorage.getItem(key) === null && typeof v === "string") { localStorage.setItem(key, v); restored = true; }
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
