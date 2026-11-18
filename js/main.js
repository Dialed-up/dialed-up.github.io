import { auth, onAuthStateChanged, signOn, signUp, signOff } from "./firebase.js";
import * as sfx from "./sounds.js";
import { closeAll } from "./wm.js";
import { openWelcome, openChannels, runKeyword } from "./portal.js";
import { startChat, stopChat, openBuddyList, openChatRooms, openAway } from "./chat.js";
import { openMyPage } from "./homepage.js";
import { openMail, watchMail, stopMail } from "./mail.js";
import { openBoards } from "./boards.js";
import { watchInvites, stopInvites } from "./people.js";
import { openFavorites, startClock, openClock, watchWarnings, stopWarnings } from "./extras.js";

const $ = (id) => document.getElementById(id);
const show = (id) => ["signon", "connecting", "app"].forEach((s) => ($(s).hidden = s !== id));

let connectingNow = false;   // true while the dial-up show is running for a fresh sign-on
let started = false;

$("mute").checked = sfx.isMuted();
$("mute").onchange = (e) => sfx.setMuted(e.target.checked);

$("new-user").onclick = () => { $("signon-form").hidden = true; $("signup-form").hidden = false; $("su-sn").focus(); };
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
    enterDesktop(true);
  } catch (err) {
    $("signon-error").textContent = err.message;
  }
};

$("signup-form").onsubmit = async (e) => {
  e.preventDefault();
  $("signup-error").textContent = "";
  if ($("su-pw").value !== $("su-pw2").value) { $("signup-error").textContent = "The passwords don't match."; return; }
  try {
    await dialUpWhile(() => signUp($("su-sn").value, $("su-pw").value));
    enterDesktop(true);
  } catch (err) {
    $("signup-form").hidden = false;
    $("signon-form").hidden = true;
    $("signup-error").textContent = err.message;
  }
};

async function enterDesktop(fresh) {
  if (started) return;
  started = true;
  show("app");
  await startChat();
  startClock();
  watchMail();
  watchInvites();
  watchWarnings();
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
  closeAll();
  $("pw").value = "";
  $("signup-form").hidden = true;
  $("signon-form").hidden = false;
  show("signon");
}

$("signoff").onclick = async () => {
  sfx.goodbye();
  stopChat();
  await signOff();
  leaveDesktop();
};

const actions = {
  welcome: openWelcome,
  buddies: openBuddyList,
  chatrooms: openChatRooms,
  channels: openChannels,
  mypage: openMyPage,
  away: openAway,
  mail: openMail,
  boards: openBoards,
  favorites: () => openFavorites(runKeyword),
};
document.querySelectorAll("#toolbar [data-open]").forEach((b) => (b.onclick = () => actions[b.dataset.open]()));
$("start").onclick = openWelcome;
$("clock").onclick = openClock;
$("clock").style.cursor = "pointer";

$("keyword-form").onsubmit = (e) => {
  e.preventDefault();
  runKeyword($("keyword").value);
  $("keyword").value = "";
  $("keyword").blur();
};

const tick = () => ($("clock").textContent = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
tick();
setInterval(tick, 15000);
