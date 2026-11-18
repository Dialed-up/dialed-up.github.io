// The main window's chrome: status strip, menu bar, navigation bar, Favorites and Window menus.
import { contextMenu, listWindows, restore, cascade, tile, closeAll, closeWindow, frontWindowId } from "./wm.js";
import { favorites, addFavorite, openFavorites, onlineFor, openClock } from "./extras.js";
import { openBrowser } from "./browser.js";

const looksLikeURL = (v) => /^(https?:\/\/|www\.)\S+\.\S+/i.test(v) || /^[\w-]+(\.[\w-]+)*\.(com|net|org|io|co|edu|gov|tv|me|us|uk|fm|app)(\/\S*)?$/i.test(v);

let run = () => {};
const history = [];
let pos = -1;
let skipHistory = false;

/** Keywords go through here so Back / Forward work. */
export function go(keyword) {
  const k = String(keyword || "").trim();
  if (!k) return;
  if (!skipHistory) {
    history.splice(pos + 1);
    history.push(k);
    pos = history.length - 1;
  }
  skipHistory = false;
  if ((looksLikeURL(k) || k.startsWith("home.html")) && document.body.classList.contains("kid-mode")) { alert("The web browser is turned off by Kid-Safe Mode."); return; }
  if (looksLikeURL(k) || k.startsWith("home.html")) openBrowser(k);
  else run(k);
}

export function setupChrome({ runKeyword, screenName, signOff, actions, switchScreenName }) {
  run = runKeyword;
  const $ = (id) => document.getElementById(id);
  $("status-text").textContent = `DialedUp — Connected · Signed on as ${screenName}`;
  const tick = () => ($("online-for").textContent = `Online ${onlineFor()}`);
  tick();
  clearInterval(window.__duTick);
  window.__duTick = setInterval(tick, 30000);

  // Menu bar
  const menus = {
    File: [["📲 Add to Home Screen", () => import("./install.js").then((m) => m.addToHomeScreen())], ["Open Keyword…", () => $("keyword").focus()], ["Favorite Places", () => openFavorites(go)], ["Preferences…", () => go("preferences")], ["🔔 Turn On Notifications", () => import("./notify.js").then((m) => m.enableNotifications())], ["⛶ Full Screen", () => import("./fullscreen.js").then((m) => m.toggleFullscreen())],
      "-", ["Switch Screen Name…", switchScreenName], ["Sign Off", signOff]],
    Edit: [["Copy", () => document.execCommand("copy")], ["Paste into Keyword", async () => { try { $("keyword").value = await navigator.clipboard.readText(); } catch {} }]],
    Mail: [["Read Mail", () => go("mail")], ["Write Mail", () => go("write")], ["Mail Signature…", () => import("./mail.js").then((m) => m.editSignature())], ["Send an E-Greeting", () => go("greetings")], ["Address Book", () => go("addressbook")]],
    People: [["Buddy List", () => go("buddies")], ["🛠 Manage Buddy List", () => go("managebuddies")], ["🔎 Get Member Info", () => go("getinfo")], ["People Plaza (Chat)", () => go("chat")], ["Member Directory", () => go("people")],
      ["My Profile & Buddy Icon", () => go("profile")], ["Away Message", () => go("away")], ["Photo Albums", () => go("albums")], ["Address Book", () => go("addressbook")], "-",
      ["Locate a Member Online", () => go("locate")], ["🤖 IM DialBot", () => go("dialbot")], ["Live Events", () => go("events")], ["Polls", () => go("polls")], ["Classifieds", () => go("classifieds")]],
    Channels: [["All Channels", () => go("channels")], ["News", () => go("news")], ["Weather", () => go("weather")], ["Sports", () => go("sports")],
      ["Tech", () => go("tech")], ["Stocks & Finance", () => go("stocks")], ["Radio", () => go("radio")], ["Maps", () => go("maps")],
      ["Horoscopes", () => go("horoscopes")], ["NYC", () => go("nyc")], ["Message Boards", () => go("boards")], "-",
      ["Today in History", () => go("today")], ["Movies", () => go("movies")], ["TV Listings", () => go("tv")], ["Recipes", () => go("recipes")],
      ["Dictionary", () => go("dictionary")], ["Podcasts", () => go("podcasts")], ["Lottery", () => go("lottery")], ["Reminders", () => go("reminders")]],
    Games: [["Games Arcade", () => go("games")], ["Trivia Night", () => go("games")], ["Byte Snake", () => go("snake")]],
    Internet: [["DialedUp Browser", () => openBrowser()], ["CNN", () => go("cnn.com")], ["ESPN", () => go("espn.com")],
      ["YouTube", () => go("youtube")], ["Wikipedia", () => go("https://en.wikipedia.org/wiki/AOL")]],
    Window: null,   // built when opened
    Keyword: [["Go to Keyword…", () => $("keyword").focus()], ["Keyword List", () => go("help")]],
    "Sign Off": [["Switch Screen Name…", switchScreenName], ["Sign Off", signOff]],
    Help: [["Preferences (Themes)", () => go("preferences")], ["🔊 Sounds", () => go("sounds")], ["Kid-Safe Mode", () => go("kids")], ["Keyword Help", () => go("help")], ["Online Clock", openClock], ["About DialedUp", () => go("about")]],
  };
  const holder = $("menus");
  holder.innerHTML = Object.keys(menus).map((m) => `<button class="menu-item" data-menu="${m}">${m}</button>`).join("");
  holder.querySelectorAll("[data-menu]").forEach((b) => (b.onclick = () => {
    const r = b.getBoundingClientRect();
    const items = b.dataset.menu === "Window" ? windowMenu() : menus[b.dataset.menu];
    contextMenu(r.left, r.bottom + 2, items.map((it) => (it === "-" ? "-" : { label: it[0], action: it[1] })));
  }));
  // The menu row (File, Edit, Mail…) stays open unless you close it.
  $("menubar").classList.toggle("open", localStorage.getItem("du.menuOpen") !== "0");
  $("menu-toggle").onclick = () => localStorage.setItem("du.menuOpen", $("menubar").classList.toggle("open") ? "1" : "0");

  // Navigation bar
  $("nav-welcome").onclick = () => go("home");
  $("nav-home").onclick = () => go("home");
  $("nav-back").onclick = () => { if (pos > 0) { pos--; skipHistory = true; go(history[pos]); } };
  $("nav-fwd").onclick = () => { if (pos < history.length - 1) { pos++; skipHistory = true; go(history[pos]); } };
  $("nav-stop").onclick = () => { const id = frontWindowId(); if (id && id !== "buddies") closeWindow(id); };
  $("nav-reload").onclick = () => {
    const id = frontWindowId();
    const kw = { welcome: "home", weather: "weather", news: "news", tech: "tech", sports: "sports", mail: "mail" }[id];
    if (kw) { closeWindow(id); skipHistory = true; go(kw); }
  };
  $("keyword-form").onsubmit = (e) => {
    e.preventDefault();
    const v = $("keyword").value.trim();
    $("keyword").value = "";
    $("keyword").blur();
    go(v);
  };
  $("search-form").onsubmit = (e) => {
    e.preventDefault();
    const q = $("search").value.trim();
    if (q) window.open("https://duckduckgo.com/?q=" + encodeURIComponent(q), "_blank", "noopener");
    $("search").value = "";
  };
  $("fav-menu").onclick = () => {
    const r = $("fav-menu").getBoundingClientRect();
    const f = favorites();
    contextMenu(r.left, r.bottom + 2, [
      ...f.slice(0, 15).map((x) => ({ label: "❤️ " + x.label, action: () => go(x.keyword) })),
      ...(f.length ? ["-"] : []),
      { label: "Edit Favorite Places…", action: () => openFavorites(go) },
    ]);
  };
  document.addEventListener("du:favorite", (e) => addFavorite(e.detail.keyword, e.detail.label));

  // Toolbar
  document.querySelectorAll("#toolbar [data-open]").forEach((b) => (b.onclick = () => (actions[b.dataset.open] || (() => go(b.dataset.open)))()));
}

function windowMenu() {
  const wins = listWindows();
  return [
    ["Cascade", cascade], ["Tile", tile], "-",
    ...wins.map((w) => [(w.minimized ? "▫️ " : "▪️ ") + w.title, () => restore(w.id)]),
    ...(wins.length ? ["-"] : []),
    ["Close All Windows", () => listWindows().forEach((w) => w.id !== "buddies" && closeWindow(w.id))],
  ];
}
