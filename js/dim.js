import "./guard.js";
// Instant Messages (dim.html): Homies List, IMs and chat rooms on their own desktop, in their own tab.
import "./update.js";
import "./fullscreen.js";
import "./altcaps.js";
import { startSync, stopSync } from "./sync.js";
import { auth, onAuthStateChanged, signOff } from "./firebase.js";
import * as sfx from "./sounds.js";
import { closeAll, contextMenu, openWindow, closeWindow } from "./wm.js";
import { startChat, stopChat, openBuddyList, openChatRooms, openAway, openProfile, openDirectory, openAddBuddy, me } from "./chat.js";
import { watchInvites, stopInvites, openPeoplePlaza } from "./people.js";
import { watchWarnings, stopWarnings } from "./extras.js";
import { watchCalls, stopCalls } from "./voice.js";
import { userName } from "./chat.js";
import { watchMail, stopMail, openMail } from "./mail.js";
import { enableNotifications, sendTestAlert } from "./notify.js";

const $ = (id) => document.getElementById(id);
let started = false;

// ---------- No zooming (same as DialedUp) ----------
["gesturestart", "gesturechange", "gestureend"].forEach((ev) => document.addEventListener(ev, (e) => e.preventDefault(), { passive: false, capture: true }));
["touchstart", "touchmove"].forEach((ev) => document.addEventListener(ev, (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false, capture: true }));
let lastTouchEnd = 0;
document.addEventListener("touchend", (e) => {
  const now = Date.now();
  if (now - lastTouchEnd < 300 && !e.target.closest("input, textarea, select")) e.preventDefault();
  lastTouchEnd = now;
}, { passive: false });

// ---------- Backdrop ----------
const BACKDROP = "img/dim-backdrop-2.jpg";
function applyBackdrop() {
  let mine = null;
  try { mine = localStorage.getItem("dim.backdrop"); } catch {}
  $("desk").style.background = `center bottom / cover no-repeat url(${mine || BACKDROP}), #3d8fe6`;
}

function changeBackdrop() {
  openWindow("dim.backdrop", {
    title: "Change Backdrop", icon: "🖼", width: 300, height: 220,
    render(body) {
      body.innerHTML = `<p class="small" style="margin-top:0">Pick a picture from your phone. It's only saved on this device.</p>
        <div class="row" style="gap:6px;justify-content:flex-start">
          <label class="btn primary small-btn" style="margin:0">📷 Choose Picture<input type="file" accept="image/*" hidden></label>
          <button class="btn small-btn" data-x="reset">Use the Green Hill</button></div>`;
      body.querySelector("input").onchange = (e) => {
        const f = e.target.files[0];
        if (!f) return;
        const img = new Image();
        img.onload = () => {
          const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
          const c = document.createElement("canvas");
          c.width = img.width * scale; c.height = img.height * scale;
          c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
          try { localStorage.setItem("dim.backdrop", c.toDataURL("image/jpeg", 0.8)); } catch { alert("That picture is too big. Try a smaller one."); return; }
          applyBackdrop(); closeWindow("dim.backdrop");
        };
        img.src = URL.createObjectURL(f);
      };
      body.querySelector("[data-x=reset]").onclick = () => { try { localStorage.removeItem("dim.backdrop"); } catch {} applyBackdrop(); closeWindow("dim.backdrop"); };
    },
  });
}

// ---------- Sign on ----------
// One sign-on for everything: signed out here → the main DialedUp sign-on, which brings you back afterwards.
function toMainSignOn() {
  const target = "index.html?next=im";
  try { if (window.top !== window.self && window.top.location.origin === location.origin) { window.top.location.replace(target); return; } } catch {}
  location.replace(target);
}

onAuthStateChanged(auth, (user) => {
  if (user && !started) enter(!!sessionStorage.getItem("du.freshSignOn"));
  if (!user) { if (started) leave(); toMainSignOn(); }
});

async function enter(fresh) {
  if (started) return;
  started = true;
  $("signon").hidden = true;
  $("app").hidden = false;
  sessionStorage.removeItem("du.freshSignOn");
  applyBackdrop();
  await startChat();
  if (await startSync(auth.currentUser.uid)) applyBackdrop();
  document.title = `Instant Messages — ${me().screenName}`;
  import("./stats-track.js").then((m) => m.trackVisit(auth.currentUser.uid, me().screenName, "dim"));
  watchInvites();
  watchWarnings();
  watchCalls(userName);
  watchMail();
  import("./notify.js").then((m) => m.subscribePush());
  openBuddyList();
  if (fresh) sfx.welcome();
}

function leave() {
  started = false;
  stopChat(); stopInvites(); stopWarnings(); stopCalls(); stopMail(); stopSync();
  closeAll();
}

// ---------- Taskbar ----------
const tick = () => ($("clock").textContent = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
tick(); setInterval(tick, 15000);

window.name = "dim";
$("to-du").onclick = () => import("./switcher.js").then((m) => m.switchTo("index.html", "dialedup"));

$("start").onclick = () => {
  const r = $("start").getBoundingClientRect();
  contextMenu(r.left, r.top - 4, [
    { label: "👥 Homies List", action: openBuddyList },
    { label: "📰 Homie Feed", action: () => import("./social.js").then((m) => m.openFeed()) },
    { label: "🔥 Trending", action: () => import("./engage.js").then((m) => m.openTrending()) },
    { label: "🌍 Groups", action: () => import("./engage.js").then((m) => m.openGroups()) },
    { label: "👋 People You May Know", action: () => import("./engage.js").then((m) => m.openPYMK()) },
    { label: "🎟 Invite Friends", action: () => import("./engage.js").then((m) => m.openInvite()) },
    { label: "✨ New Homie Update", action: () => import("./social.js").then((m) => m.newStory()) },
    { label: "📨 Unread IMs", action: () => import("./chat.js").then((m) => m.openUnreadIMs()) },
    { label: "➕ Add a Homie", action: () => openAddBuddy() },
    { label: "🛠 Manage Homies List", action: () => import("./chat.js").then((m) => m.openEditGroups()) },
    { label: "🗨️ Chat Rooms", action: () => openPeoplePlaza() },
    { label: "📬 Mail", action: openMail },
    { label: "📝 Away Message", action: openAway },
    { label: "🪪 My Profile & Homie Icon", action: openProfile },
    { label: "📧 My Email", action: () => import("./engage.js").then((m) => m.openMyEmail()) },
    { label: "📇 Member Directory", action: openDirectory },
    { label: "🔎 Get Member Info", action: () => import("./chat.js").then((m) => m.openGetInfo()) },
    { label: "🔎 Locate a Member", action: () => import("./more.js").then((m) => m.openLocate()) },
    "-",
    { label: "🖼 Change Backdrop", action: changeBackdrop },
    { label: "🔔 Turn On Notifications", action: () => enableNotifications() },
    { label: "🔔 Send Me a Test Alert", action: () => sendTestAlert() },
    { label: "🎙 Podcasts", action: () => import("./podcasts.js").then((m) => m.openPodcasts()) },
    { label: sfx.isMuted() ? "🔈 Sounds On" : "🔇 Sounds Off", action: () => sfx.setMuted(!sfx.isMuted()) },
    "-",
    { label: "🌐 Switch to DialedUp", action: () => $("to-du").click() },
    { label: "🔌 Sign Off", action: async () => { sfx.goodbye(); await signOff(); } },
  ]);
};

// Background helper: keeps DialedUp's files fresh and handles notifications.
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
