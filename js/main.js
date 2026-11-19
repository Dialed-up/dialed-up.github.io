import "./guard.js";
import { auth, onAuthStateChanged, signOn, signUp, signOff, saveEmail, validEmail, linkEmail, sendPasswordReset } from "./firebase.js";
import * as sfx from "./sounds.js";
import { closeAll } from "./wm.js";
import { openWelcome, openChannels, runKeyword } from "./portal.js";
import { startChat, stopChat, openBuddyList, openChatRooms, openAway } from "./chat.js";
import { openMyPage } from "./homepage.js";
import { openMail, watchMail, stopMail } from "./mail.js";
import { openBoards } from "./boards.js";
import { watchInvites, stopInvites } from "./people.js";
import { startClock, openClock, watchWarnings, stopWarnings } from "./extras.js";
import { setupChrome, go } from "./chrome.js";
import { mountMiniPlayer, stop as stopRadio } from "./radio.js";
import { watchAddressBook, stopAddressBook } from "./addressbook.js";
import { watchGameInvites, stopGameInvites } from "./games.js";
import { watchCalls, stopCalls } from "./voice.js";
import { applyPrefs } from "./prefs.js";
import { applyKidMode } from "./kids.js";
import { userName } from "./chat.js";
import { addToHomeScreen, refreshButtons } from "./install.js";
import { me } from "./chat.js";
import { writeMail } from "./mail.js";
import "./update.js";
import "./fullscreen.js";
import "./altcaps.js";
import "./diag.js";
import { startSync, stopSync } from "./sync.js";
import { watchReminders, stopReminders, watchEvents, stopEvents } from "./more.js";

const $ = (id) => document.getElementById(id);
const show = (id) => ["signon", "connecting", "app"].forEach((s) => ($(s).hidden = s !== id));

applyPrefs();
applyKidMode();
document.querySelectorAll(".install-btn").forEach((b) => (b.onclick = addToHomeScreen));
window.name = "dialedup";
$("to-dim").onclick = () => import("./switcher.js").then((m) => m.switchTo("dim.html", "dim"));
refreshButtons();

// No zooming: block pinch and double-tap zoom (iPhone ignores the page setting on its own).
["gesturestart", "gesturechange", "gestureend"].forEach((ev) => {
  window.addEventListener(ev, (e) => e.preventDefault(), { passive: false, capture: true });
  document.addEventListener(ev, (e) => e.preventDefault(), { passive: false, capture: true });
});
// If the page ever gets zoomed anyway, snap it back.
if (window.visualViewport) {
  const vp = document.querySelector('meta[name="viewport"]');
  window.visualViewport.addEventListener("resize", () => {
    if (window.visualViewport.scale > 1.01) {
      vp.setAttribute("content", "width=device-width, initial-scale=1.0001, maximum-scale=1, user-scalable=no, viewport-fit=cover");
      setTimeout(() => vp.setAttribute("content", "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"), 50);
    }
  });
}
// A pinch begins when a second finger lands — stop it right there.
["touchstart", "touchmove"].forEach((ev) => {
  const stopPinch = (e) => { if (e.touches.length > 1 || (e.scale && e.scale !== 1)) e.preventDefault(); };
  window.addEventListener(ev, stopPinch, { passive: false, capture: true });
  document.addEventListener(ev, stopPinch, { passive: false, capture: true });
});
// (Double-tap zoom is turned off with CSS "touch-action: manipulation", so quick taps are never swallowed.)

let connectingNow = false;   // true while the dial-up show is running for a fresh sign-on
let started = false;

$("mute").checked = sfx.isMuted();
$("mute").onchange = (e) => sfx.setMuted(e.target.checked);

$("new-user").onclick = () => { $("signon-form").hidden = true; $("signup-form").hidden = false; $("su-sn").focus(); };
// Came from a friend's invite link: show "Get a Screen Name" right away
if (/[?&]invite=/.test(location.search)) setTimeout(() => { if ($("signup-form").hidden && !$("signon-form").hidden) $("new-user").click(); }, 0);
$("forgot").onclick = async (e) => {
  e.preventDefault();
  const name = prompt("Forgot your password? Type your screen name:", $("sn").value.trim());
  if (!name) return;
  try {
    await sendPasswordReset(name);
    alert("If that screen name has a confirmed email, a password reset link is on its way. Check your inbox (and spam folder) in a few minutes.");
  } catch (err) { alert(err.message); }
};
$("back-signon").onclick = () => { $("signup-form").hidden = true; $("signon-form").hidden = false; };

/** Plays the dial-up show while `work` runs; resolves when both are done. */
async function dialUpWhile(work) {
  connectingNow = true;
  sfx.unlock();
  show("connecting");
  const steps = [...document.querySelectorAll(".steps li")];
  steps.forEach((li) => li.classList.remove("active", "done"));
  const total = Math.max(sfx.dialUp(), 3.5) * 1000;
  const lines = ["Connecting at 14,400 bps", "Connecting at 28,800 bps", "Connecting at 56,000 bps", "Connecting at 5G 🚀", "Almost there…"];
  const timers = steps.map((li, i) => setTimeout(() => {
    steps.forEach((s, j) => { s.classList.toggle("done", j < i); s.classList.toggle("active", j === i); });
    $("meter-fill").style.width = ((i + 1) / steps.length) * 100 + "%";
    $("connect-line").textContent = lines[i];
  }, (total / steps.length) * i));
  try {
    const [result] = await Promise.all([work(), new Promise((r) => setTimeout(r, total))]);
    return result;
  } catch (e) {
    timers.forEach(clearTimeout);
    show("signon");
    throw e;
  } finally {
    connectingNow = false;
  }
}

$("signon-form").onsubmit = async (e) => {
  e.preventDefault();
  $("signon-error").textContent = "";
  try {
    await dialUpWhile(() => signOn($("sn").value, $("pw").value, $("remember").checked));
    sessionStorage.setItem("du.pwSignOn", "1");   // a fresh sign-on: OK to send an email confirmation
    enterDesktop(true);
  } catch (err) {
    $("signon-error").textContent = err.message;
  }
};

$("signup-form").onsubmit = async (e) => {
  e.preventDefault();
  $("signup-error").textContent = "";
  if ($("su-pw").value !== $("su-pw2").value) { $("signup-error").textContent = "The passwords don't match."; return; }
  const email = $("su-em").value.trim();
  if (!validEmail(email)) { $("signup-error").textContent = "Please enter a real email address."; return; }
  try {
    await dialUpWhile(() => signUp($("su-sn").value, $("su-pw").value));
    sessionStorage.setItem("du.justSignedUp", "1");
    saveEmail(email).then(() => linkEmail(email)).catch(() => {});
    enterDesktop("signup");
  } catch (err) {
    $("signup-form").hidden = false;
    $("signon-form").hidden = true;
    $("signup-error").textContent = err.message;
  }
};

function rememberName(n) {
  const names = JSON.parse(localStorage.getItem("du.names") || "[]").filter((x) => x.toLowerCase() !== n.toLowerCase());
  names.unshift(n);
  localStorage.setItem("du.names", JSON.stringify(names.slice(0, 7)));
}

/** Sign off, then show the sign-on box with another screen name filled in. */
export async function switchScreenName() {
  const names = JSON.parse(localStorage.getItem("du.names") || "[]").filter((n) => n !== me().screenName);
  const pick = prompt(`Switch to which screen name?${names.length ? "\n\nYour other screen names:\n" + names.join("\n") : ""}`, names[0] || "");
  if (pick === null) return;
  await doSignOff();
  $("sn").value = pick.trim();
  $("pw").focus();
}

// Came from Instantly (?next=im): after signing on, go back there instead of the DialedUp desktop.
const nextIM = new URLSearchParams(location.search).get("next") === "im";
if (nextIM) document.getElementById("signon-form")?.insertAdjacentHTML("afterbegin", `<p class="small" style="margin-top:0">💬 Sign on to open <b>Instantly</b>.</p>`);
async function enterDesktop(fresh) {
  if (nextIM) {
    if (fresh) sessionStorage.setItem("du.freshSignOn", "1");
    location.replace("dim.html");
    return;
  }
  if (started) return;
  started = true;
  show("app");
  // If the database can't be reached, say so instead of sitting on a blank screen
  const slow = setTimeout(() => signOnFailed({ message: "Can't reach the DialedUp database. Check your internet connection. (Owner: if App Check is set to Enforce for the Realtime Database in the Firebase console, switch it back to Unenforced.)" }), 15000);
  try { await startChat(); } catch (err) { clearTimeout(slow); signOnFailed(err); return; }   // suspended accounts are signed off
  clearTimeout(slow);
  if (await startSync(auth.currentUser.uid)) { applyPrefs(); applyKidMode(); }   // settings saved to the account come back here
  rememberName(me().screenName);
  import("./stats-track.js").then((m) => m.trackVisit(auth.currentUser.uid, me().screenName, "dialedup"));
  if (fresh === "signup") import("./stats-track.js").then((m) => m.trackSignup());
  startClock();
  setupChrome({
    runKeyword, screenName: me().screenName, signOff: () => document.getElementById("signoff").click(), switchScreenName,
    actions: { mail: openMail, write: () => writeMail(), buddies: openBuddyList, chatrooms: openChatRooms, boards: openBoards,
      channels: openChannels, mypage: openMyPage, away: openAway, welcome: openWelcome },
  });
  watchMail();
  watchInvites();
  watchWarnings();
  watchAddressBook();
  watchGameInvites();
  watchCalls(userName);
  watchReminders();
  import("./social.js").then((m) => { m.checkFeed({ popUp: true }); setInterval(() => m.checkFeed(), 120000); });
  import("./notify.js").then((m) => m.subscribePush());
  watchEvents();
  mountMiniPlayer();
  openWelcome();
  openBuddyList();
  if (fresh) sfx.welcome();
}

// Already signed on from last time? Skip straight in.
onAuthStateChanged(auth, (user) => {
  if (user && !connectingNow && !started) enterDesktop(false);
  if (!user && started) leaveDesktop();
});

function leaveDesktop() {
  started = false;
  stopChat();
  stopMail();
  stopInvites();
  stopWarnings();
  stopAddressBook();
  stopGameInvites();
  stopCalls();
  stopReminders();
  stopSync();
  stopEvents();
  stopRadio();
  closeAll();
  $("pw").value = "";
  $("signup-form").hidden = true;
  $("signon-form").hidden = false;
  show("signon");
}

async function doSignOff() {
  sfx.goodbye();
  stopChat();
  await signOff();
  leaveDesktop();
}
$("signoff").onclick = async () => {
  sfx.goodbye();
  stopChat();
  await signOff();
  leaveDesktop();
};

const tick = () => ($("clock").textContent = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
tick();
setInterval(tick, 15000);

// Background helper: keeps DialedUp's files fresh and handles notifications.
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

/** If signing on can't finish, say why (instead of a blank desktop) and offer to try again. */
function signOnFailed(err) {
  if (String(err?.message) === "suspended") return;
  const code = String(err?.code || err?.message || err || "unknown error");
  const box = document.createElement("div");
  box.className = "diag-bar";
  box.innerHTML = `<b>⚠️ Couldn't finish signing on.</b><br><span class="small"></span><br><button type="button" class="btn small-btn" style="float:none;margin-top:6px;background:#fff;color:#b00020">🔄 Try Again</button>`;
  box.querySelector(".small").textContent = /permission/i.test(code) ? "The database refused a request (permission denied): " + code : code;
  box.querySelector("button").onclick = () => location.reload();
  document.body.appendChild(box);
}
