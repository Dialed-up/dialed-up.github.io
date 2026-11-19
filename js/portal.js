import { openWindow, getWindow, esc } from "./wm.js";
import { getHeadlines, getScores, scoreText, timeAgo } from "./live.js";
import { openBrowser } from "./browser.js";
import { openRadio } from "./radio.js";
import { openAddressBook } from "./addressbook.js";
import { openPreferences } from "./prefs.js";
import { openGreetings } from "./greetings.js";
import { sendCard } from "./mail.js";
import { openMaps } from "./maps.js";
import { openAlbums } from "./albums.js";
import { openStocks } from "./money.js";
import { openKidSafe, isBlockedForKids } from "./kids.js";
import { openArcade } from "./games.js";
import { db, ref, get, off } from "./firebase.js";
import { me, openBuddyList, openChatRooms, openAway, openDirectory, openProfile, openAddBuddy, onlineMembers, userName, openIM, memberCount } from "./chat.js";
import { openMyPage } from "./homepage.js";
import { openGame } from "./game.js";
import { openMail, writeMail } from "./mail.js";
import { openBoards } from "./boards.js";
import { openPeoplePlaza } from "./people.js";
import { openFavorites, openClock, onlineFor } from "./extras.js";
import { enableNotifications, sendTestAlert, notifyOn } from "./notify.js";
import { mountQotd, openLocate, openPolls, openMovies, openTV, openDictionary, openRecipes, openReminders, openClassifieds, openEvents, openToday, openLottery } from "./more.js";

const city = () => JSON.parse(localStorage.getItem("du.city") || "null") || { name: "New York", lat: 40.71, lon: -74.01 };

// ---------- Welcome window ----------
/** Show the "Turn On Alerts" bar in the Home Screen app until alerts are on. */
const alertsAsk = () => ("Notification" in window) && Notification.permission === "default" && localStorage.getItem("du.alertsAskOff") !== "1"
  && (window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true || !/iPhone|iPad/.test(navigator.userAgent));
let qotdRef = null;
let welcomeFeed = null;
export function openWelcome() {
  openWindow("welcome", {
    title: "Welcome to DialedUp", icon: "🏠", keyword: "home",
    onClose: () => { if (qotdRef) off(qotdRef); qotdRef = null; welcomeFeed?.(); welcomeFeed = null; },
    // in landscape, fill the space left of the Homies window
    ...(() => {
      const d = document.getElementById("desk");
      const wide = d.clientWidth > d.clientHeight && d.clientHeight < 500;
      if (d.clientWidth >= 1000 && d.clientHeight >= 560) {
        return { x: 24, y: 16, width: 640, height: Math.min(560, d.clientHeight - 40) };
      }
      return wide ? { x: 6, y: 4, width: Math.round(d.clientWidth * 0.62), height: d.clientHeight - 10 } : { width: 460, height: 560 };
    })(),
    render(body) {
      const hour = new Date().getHours();
      const hello = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
      body.innerHTML = `
        <div class="welcome-head">
          <img src="img/logo.png" alt="">
          <div><h2>${hello}, ${esc(me().screenName)}!</h2>
          <div class="small muted">${new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })} · online ${onlineFor()}</div></div>
        </div>
        ${alertsAsk() ? `<div class="alerts-ask"><span>🔔 <b>Get alerts</b> for new IMs and mail, even when DialedUp is closed.</span><button class="btn primary small-btn" id="w-alerts">Turn On Alerts</button><button class="alerts-x" id="w-alerts-x" title="Don't show this again" aria-label="Close">✕</button></div>` : ""}
        <div class="panel w-feed"><h3>📰 Homie Feed <a href="#" data-kw="feed" class="small" style="float:right">Open Feed ›</a></h3><div id="w-feed"></div></div>
        <div id="w-top" class="top-story"><div class="muted small" style="padding:30px;text-align:center">📡 Getting today's top story…</div></div>
        <div class="grid2">
          <div class="panel" id="w-online"><h3>🟢 Homies Online</h3><span class="muted small">Checking…</span></div>
          <div class="panel" id="w-rooms"><h3>🔥 Hot Rooms Right Now</h3><span class="muted small">Checking…</span></div>
        </div>
        <div class="panel"><h3>📰 Today's Headlines <a href="#" data-kw="news" class="small" style="float:right">More news ›</a></h3><ul class="list headlines" id="w-news"><li class="muted small">Loading…</li></ul></div>
        <div class="panel"><h3>🏟 Live Scores <a href="#" data-kw="sports" class="small" style="float:right">All scores ›</a></h3><ul class="list" id="w-scores"><li class="muted small">Loading…</li></ul></div>
        <div class="grid2">
          <div class="panel" id="w-weather"><h3>🌤 Weather</h3><span class="muted small">Loading…</span></div>
          <div class="panel" id="w-horo"><h3>🔮 Your Horoscope</h3></div>
        </div>
        <div class="panel"><h3>❓ Question of the Day <a href="#" data-kw="polls" class="small" style="float:right">More polls ›</a></h3><div id="w-qotd"></div></div>
        <div class="panel"><h3>✨ Today's Hot Spots</h3>
          <div class="grid2">
            ${tile("💬 People Plaza", "Chat rooms by category", "#ff5ec4", "chat")}
            ${tile("📬 Mail", "Check your mailbox", "#00a68c", "mail")}
            ${tile("📌 Message Boards", "Post & reply", "#e53935", "boards")}
            ${tile("🌐 Home Pages", "Build yours — glitter included", "#8a4dff", "homepage")}
            ${tile("🎤 Live Events", "Scheduled live chats", "#d81b60", "events")}
            ${tile("📺 TV Tonight", "What's on", "#3949ab", "tv")}
            ${tile("🎬 Movies", "News & showtimes", "#c62828", "movies")}
            ${tile("🎮 Games", "Trivia, Tic-Tac-Toe & more", "#21a0fd", "games")}
          </div>
        </div>
        <p class="small muted">Tip: type a word in the <b>Keyword</b> box up top — try <i>weather</i>, <i>news</i>, <i>chat</i> or <i>help</i>.</p>`;
      body.querySelectorAll("[data-kw]").forEach((b) => (b.onclick = (e) => { e.preventDefault(); runKeyword(b.dataset.kw); }));
      body.querySelector("#w-alerts")?.addEventListener("click", async () => { if (await enableNotifications()) body.querySelector(".alerts-ask")?.remove(); });
      body.querySelector("#w-alerts-x")?.addEventListener("click", () => { try { localStorage.setItem("du.alertsAskOff", "1"); } catch {} body.querySelector(".alerts-ask")?.remove(); });
      loadWeather(body.querySelector("#w-weather"), true);
      renderHoroscope(body.querySelector("#w-horo"), true);
      if (qotdRef) off(qotdRef);
      qotdRef = mountQotd(body.querySelector("#w-qotd"));
      fillWelcomeLive(body);
      welcomeFeed?.();
      import("./social.js").then((m) => { if (body.querySelector("#w-feed")) welcomeFeed = m.mountFeed(body.querySelector("#w-feed"), { limit: 5, more: m.openFeed }); });
    },
  });
}

// ---------- Live pieces of the Welcome screen ----------
const tag = (h) => `<span class="src-tag" style="background:${h.color}">${esc(h.source)}</span>`;
const headlineItem = (h) =>
  `<li>${tag(h)} <a href="${esc(h.url || "#")}" target="_blank" rel="noopener" data-browse data-title="${esc(h.title)}" data-source="${esc(h.source)}" data-image="${esc(h.image || "")}">${esc(h.title)}</a>${h.ts ? ` <span class="small muted">${timeAgo(h.ts)}</span>` : ""}</li>`;

async function fillWelcomeLive(body) {
  paintOnline(body);
  paintRooms(body);
  try {
    const news = await getHeadlines();
    const lead = news.top.find((h) => h.image) || [...news.sports, ...news.space].find((h) => h.image) || news.top[0];
    const topEl = body.querySelector("#w-top");
    if (lead && topEl) {
      topEl.innerHTML = `<a href="${esc(lead.url || "#")}" target="_blank" rel="noopener" class="top-story-link" data-browse data-title="${esc(lead.title)}" data-source="${esc(lead.source)}" data-image="${esc(lead.image || "")}">
        ${lead.image ? `<img src="${esc(lead.image)}" alt="" loading="lazy">` : ""}
        <div class="top-story-text">${tag(lead)}<b>${esc(lead.title)}</b></div></a>`;
    } else if (topEl) topEl.remove();
    const list = news.top.filter((h) => h !== lead).slice(0, 8);
    const el = body.querySelector("#w-news");
    if (el) el.innerHTML = list.map(headlineItem).join("") || `<li class="muted small">Headlines are on their way — try again in a minute.</li>`;
  } catch {}
  try {
    const games = (await getScores()).slice(0, 6);
    const el = body.querySelector("#w-scores");
    if (el) el.innerHTML = games.map((g) => `<li class="small">${esc(scoreText(g))}</li>`).join("") || `<li class="muted small">No games on the schedule right now.</li>`;
  } catch {}
}

document.addEventListener("du:users", () => { const w = getWindow("welcome"); if (w) paintOnline(w.body); });

function paintOnline(body) {
  const el = body.querySelector("#w-online");
  if (!el) return;
  const on = onlineMembers();
  el.innerHTML = `<h3>🟢 Homies Online</h3>
    <div class="big-temp" style="font-size:24px">${on.length}</div>
    <div class="small muted">of ${memberCount()} ${memberCount() === 1 ? "homie" : "homies"} signed on now</div>
    <div class="small" style="margin-top:4px">${on.slice(0, 8).map((u) => `<a href="#" data-im="${esc(u)}">${esc(userName(u))}</a>`).join(", ")
      || (memberCount() ? "None of your homies are on right now." : "Add homies to see who's on!")}</div>`;
  el.querySelectorAll("[data-im]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); openIM(a.dataset.im); }));
}

const hotRooms = ["Lobby", "NYC", "DJ Booth", "Late Night Talk", "Hoops Talk", "Gamers Hangout", "Hip Hop Corner"];
async function paintRooms(body) {
  const el = body.querySelector("#w-rooms");
  if (!el) return;
  const counts = await Promise.all(hotRooms.map(async (r) => {
    try {
      const m = (await get(ref(db, `rooms/${r.toLowerCase().replace(/[^a-z0-9]/g, "")}/members`))).val() || {};
      return [r, Object.values(m).filter((v) => Date.now() - (typeof v === "object" ? v.t : v) < 120000).length];
    } catch { return [r, 0]; }
  }));
  counts.sort((a, b) => b[1] - a[1]);
  el.innerHTML = `<h3>🔥 Hot Rooms Right Now</h3><ul class="list">${counts.slice(0, 5).map(([r, n]) =>
    `<li class="row"><a href="#" data-room="${esc(r)}">💬 ${esc(r)}</a><span class="small muted">${n ? `${n} here` : "be first!"}</span></li>`).join("")}</ul>`;
  el.querySelectorAll("[data-room]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); openChatRooms(a.dataset.room); }));
}

// ---------- Ticker ----------
let tickerTimer = null;
export function startTicker() {
  const paint = async () => {
    const parts = [];
    try {
      const news = await getHeadlines();
      parts.push(...news.top.slice(0, 10).map((h) => `<span class="tick"><b style="color:${h.color}">${esc(h.source.toUpperCase())}</b> ${esc(h.title)}</span>`));
    } catch {}
    try {
      const games = (await getScores()).filter((g) => g.state !== "pre").slice(0, 8);
      parts.push(...games.map((g) => `<span class="tick">🏟 ${esc(scoreText(g))}</span>`));
    } catch {}
    parts.push(`<span class="tick">🟢 ${onlineMembers().length + 1} members online now</span>`);
    const t = document.getElementById("ticker-text");
    if (t) {
      t.innerHTML = parts.join('<span class="tick-sep">◆</span>');
      t.style.animationDuration = Math.max(40, parts.length * 7) + "s";
    }
  };
  paint();
  clearInterval(tickerTimer);
  tickerTimer = setInterval(paint, 5 * 60 * 1000);
}
export function stopTicker() { clearInterval(tickerTimer); }

const tile = (title, sub, color, kw) =>
  `<button class="tile" style="background:linear-gradient(135deg, ${color}, #5b2a86)" data-kw="${esc(kw)}">${title}<small>${sub}</small></button>`;

// ---------- Channels ----------
export function openChannels() {
  openWindow("channels", {
    title: "Channels", icon: "📺", width: 420, height: 480,
    render(body) {
      body.innerHTML = `<div class="grid2">
        ${tile("📰 News", "What's happening", "#e53935", "news")}
        ${tile("🌤 Weather", "Forecast for your city", "#21a0fd", "weather")}
        ${tile("🏀 Sports", "NBA · NFL · MLB · NHL", "#ff8a3d", "sports")}
        ${tile("💻 Tech", "Top tech links", "#00a68c", "tech")}
        ${tile("🔮 Horoscopes", "All 12 signs", "#8a4dff", "horoscopes")}
        ${tile("🎮 Games", "Byte Snake", "#2b59ff", "games")}
        ${tile("🗽 NYC", "The city, DialedUp style", "#ffb300", "nyc")}
        ${tile("👥 People", "Member Directory", "#ff5ec4", "people")}
        ${tile("💬 People Plaza", "Chat rooms", "#d81b60", "chat")}
        ${tile("📬 Mail", "Your mailbox", "#00a68c", "mail")}
        ${tile("📌 Boards", "Message boards", "#e53935", "boards")}
        ${tile("🌐 Home Pages", "Make your own", "#5b2a86", "homepage")}
        ${tile("📻 Radio", "Free stations by genre", "#00897b", "radio")}
        ${tile("📈 Stocks", "Markets & watch list", "#2e7d32", "stocks")}
        ${tile("💌 E-Greetings", "Send a card", "#ff5e8a", "greetings")}
        ${tile("🗺 Maps", "Find places", "#3949ab", "maps")}
        ${tile("📸 Photo Albums", "Share your pics", "#ff8a3d", "albums")}
        ${tile("🌍 Web", "DialedUp Browser", "#21a0fd", "browser")}
        ${tile("📊 Polls", "Question of the Day", "#ff5ec4", "polls")}
        ${tile("🎬 Movies", "News, reviews, showtimes", "#c62828", "movies")}
        ${tile("📺 TV Listings", "What's on tonight", "#3949ab", "tv")}
        ${tile("🎤 Live Events", "Scheduled live chats", "#d81b60", "events")}
        ${tile("🏷 Classifieds", "Buy, sell, trade", "#ff8a3d", "classifieds")}
        ${tile("🍳 Recipes", "What's for dinner", "#2e7d32", "recipes")}
        ${tile("📖 Dictionary", "Words & thesaurus", "#5b2a86", "dictionary")}
        ${tile("⏰ Reminders", "Birthdays & holidays", "#00897b", "reminders")}
        ${tile("📅 Today", "History & photo of the day", "#21a0fd", "today")}
        ${tile("🎰 Lottery", "Powerball & Mega Millions", "#ffb300", "lottery")}
        ${tile("🔎 Locate", "Find a member online", "#00a68c", "locate")}
        ${tile("🎙 Podcasts", "Top shows, new episodes", "#7b1fa2", "podcasts")}
        ${tile("▶️ YouTube", "Watch right here", "#e53935", "youtube")}
        ${tile("🤖 DialBot", "Always-online chat homie", "#21a0fd", "dialbot")}
      </div>`;
      body.querySelectorAll("[data-kw]").forEach((b) => (b.onclick = () => runKeyword(b.dataset.kw)));
    },
  });
}

// ---------- Keyword ----------
const keywords = {
  home: openWelcome, welcome: openWelcome, channels: openChannels,
  news: openNews, weather: openWeather, sports: openSports, scores: openSports, tech: openTech,
  horoscope: openHoroscopes, horoscopes: openHoroscopes, stars: openHoroscopes,
  games: openArcade, game: openArcade, arcade: openArcade, play: openArcade, snake: openGame, trivia: openArcade,
  radio: openRadio, music: openRadio, addressbook: () => openAddressBook(), contacts: () => openAddressBook(),
  preferences: openPreferences, prefs: openPreferences, themes: openPreferences, settings: openPreferences, wallpaper: openPreferences,
  greetings: () => openGreetings(sendCard), cards: () => openGreetings(sendCard), ecard: () => openGreetings(sendCard),
  maps: () => openMaps(), directions: () => openMaps(), map: () => openMaps(),
  albums: () => openAlbums(), photos: () => openAlbums(), pictures: () => openAlbums(),
  stocks: openStocks, finance: openStocks, money: openStocks, markets: openStocks,
  kids: openKidSafe, kidsafe: openKidSafe, parental: openKidSafe, parentalcontrols: openKidSafe,
  nyc: openNYC, newyork: openNYC,
  chat: openChatRooms, rooms: openChatRooms, lobby: openChatRooms,
  managebuddies: () => import("./chat.js").then((m) => m.openEditGroups()), managebuddylist: () => import("./chat.js").then((m) => m.openEditGroups()),
  getinfo: () => import("./chat.js").then((m) => m.openGetInfo()), memberinfo: () => import("./chat.js").then((m) => m.openGetInfo()), lookup: () => import("./chat.js").then((m) => m.openGetInfo()),
  unread: () => import("./chat.js").then((m) => m.openUnreadIMs()), missed: () => import("./chat.js").then((m) => m.openUnreadIMs()), unreadims: () => import("./chat.js").then((m) => m.openUnreadIMs()),
  feed: () => import("./social.js").then((m) => m.openFeed()), buddyfeed: () => import("./social.js").then((m) => m.openFeed()), wall: () => import("./social.js").then((m) => m.openFeed()),
  updates: () => import("./social.js").then((m) => m.newStory()), story: () => import("./social.js").then((m) => m.newStory()), stories: () => import("./social.js").then((m) => m.openFeed()),
  reports: () => import("./social.js").then((m) => m.openReports()),
  admin: () => import("./admin.js").then((m) => m.openAdmin()),
  bell: () => import("./notifs.js").then((m) => m.openNotifs()), notifs: () => import("./notifs.js").then((m) => m.openNotifs()),
  myemail: () => import("./engage.js").then((m) => m.openMyEmail()), changeemail: () => import("./engage.js").then((m) => m.openMyEmail()),
  groups: () => import("./engage.js").then((m) => m.openGroups()), clubs: () => import("./engage.js").then((m) => m.openGroups()), communities: () => import("./engage.js").then((m) => m.openGroups()),
  leaderboards: () => import("./engage.js").then((m) => m.openLeaderboards()), leaderboard: () => import("./engage.js").then((m) => m.openLeaderboards()), scores: () => import("./engage.js").then((m) => m.openLeaderboards()), trivianight: () => import("./engage.js").then((m) => m.openLeaderboards()),
  trending: () => import("./engage.js").then((m) => m.openTrending()), hot: () => import("./engage.js").then((m) => m.openTrending()), whatshot: () => import("./engage.js").then((m) => m.openTrending()),
  pymk: () => import("./engage.js").then((m) => m.openPYMK()), peopleyoumayknow: () => import("./engage.js").then((m) => m.openPYMK()), suggestions: () => import("./engage.js").then((m) => m.openPYMK()),
  invite: () => import("./engage.js").then((m) => m.openInvite()), invitefriends: () => import("./engage.js").then((m) => m.openInvite()),
  buddy: openBuddyList, buddies: openBuddyList, homie: openBuddyList, homies: openBuddyList, homieslist: openBuddyList, im: openBuddyList, add: openAddBuddy,
  away: openAway, profile: openProfile, people: openDirectory, directory: openDirectory, members: openDirectory,
  homepage: openMyPage, mypage: openMyPage, page: openMyPage,
  mail: openMail, inbox: openMail, write: () => writeMail(), email: openMail,
  boards: openBoards, forums: openBoards, messageboards: openBoards,
  plaza: openPeoplePlaza, peopleplaza: openPeoplePlaza, chatrooms: openPeoplePlaza,
  favorites: () => openFavorites(runKeyword), favs: () => openFavorites(runKeyword),
  clock: openClock, time: openClock,
  about: openAbout,
  browser: () => openBrowser(), web: () => openBrowser(), internet: () => openBrowser(), www: () => openBrowser(),
  cnn: () => openBrowser("https://www.cnn.com"), espn: () => openBrowser("https://www.espn.com"),
  youtube: () => import("./youtube.js").then((m) => m.openYouTube()), videos: () => import("./youtube.js").then((m) => m.openYouTube()), wikipedia: () => openBrowser("https://en.wikipedia.org/wiki/AOL"),
  locate: () => openLocate(), find: () => openLocate(), whereis: () => openLocate(),
  polls: openPolls, poll: openPolls, vote: openPolls, qotd: openPolls, question: openPolls,
  movies: openMovies, movie: openMovies, showtimes: openMovies, film: openMovies,
  tv: openTV, tvlistings: openTV, listings: openTV, television: openTV,
  dictionary: () => openDictionary(), define: () => openDictionary(), thesaurus: () => openDictionary(), words: () => openDictionary(), wordoftheday: () => openDictionary(),
  recipes: openRecipes, recipe: openRecipes, food: openRecipes, cooking: openRecipes,
  reminders: openReminders, reminder: openReminders, birthdays: openReminders, holidays: openReminders, calendar: openReminders,
  classifieds: openClassifieds, forsale: openClassifieds, ads: openClassifieds, buyandsell: openClassifieds,
  events: openEvents, live: openEvents, liveevents: openEvents, auditorium: openEvents,
  today: openToday, history: openToday, todayinhistory: openToday, potd: openToday,
  podcasts: () => import("./podcasts.js").then((m) => m.openPodcasts()), podcast: () => import("./podcasts.js").then((m) => m.openPodcasts()),
  bot: () => import("./bot.js").then((m) => m.openBot()), dialbot: () => import("./bot.js").then((m) => m.openBot()),
  notifications: () => enableNotifications(),
  testalert: () => sendTestAlert(), pushtest: () => sendTestAlert(),
  sounds: openSounds, sound: openSounds, voices: openSounds,
  lottery: openLottery, lotto: openLottery, powerball: openLottery, megamillions: openLottery,
  help: openHelp,
};

function openSounds() {
  import("./sounds.js").then((sfx) => openWindow("sounds", {
    title: "Sounds", icon: "🔊", width: 300, height: 340, keyword: "sounds",
    render(body) {
      const list = [["👋 \"Welcome!\" (signing on)", "welcome"], ["📬 \"You have mail!\"", "youHaveMail"], ["🚪 Door opens (homie signs on)", "doorOpen"],
        ["🚪 Door closes (homie signs off)", "doorClose"], ["💬 IM received", "imIn"], ["👋 Goodbye (signing off)", "goodbye"]];
      body.innerHTML = `<ul class="list">${list.map(([l, f]) => `<li class="row"><span>${l}</span><button class="btn small-btn" data-s="${esc(f)}">▶ Play</button></li>`).join("")}</ul>
        <label class="check" style="margin-top:8px"><input type="checkbox" id="snd-mute" ${sfx.isMuted() ? "checked" : ""}> Mute all sounds</label>
        <p class="small muted">The voice is your phone or computer's built-in voice. Turn your ringer on (iPhone side switch) to hear sounds.</p>`;
      body.querySelectorAll("[data-s]").forEach((b) => (b.onclick = () => { sfx.unlock(); sfx[b.dataset.s](); }));
      body.querySelector("#snd-mute").onchange = (e) => sfx.setMuted(e.target.checked);
    },
  }));
}

function openAbout() {
  openWindow("about", {
    title: "About DialedUp", icon: "💿", width: 320, height: 330,
    render(body) {
      body.innerHTML = `<div style="text-align:center"><img src="img/wordmark.png" width="170" alt="DialedUp">
        <h2 class="brand" style="font-size:26px">Dialed<span>Up</span></h2>
        <p class="tagline">The online service that never logged off.</p>
        <p class="small">Version 26.0 (build 1119.0113) · Still connecting since '96.</p>
        <p class="small muted">DialedUp is an independent, fan-made throwback. Not affiliated with, endorsed by, or connected to AOL, AIM, Yahoo or Bending Spoons. All trademarks belong to their owners.</p></div>`;
    },
  });
}

export function runKeyword(raw) {
  const k = String(raw || "").toLowerCase().replace(/[^a-z]/g, "");
  if (!k) return;
  if (isBlockedForKids(k)) { alert("That area is turned off by Kid-Safe Mode."); return; }
  (keywords[k] || (() => openHelp(k)))();
}

function openHelp(missing) {
  openWindow("help", {
    title: "Keyword Help", icon: "❓", width: 340, height: 380,
    render(body) {
      body.innerHTML = `${typeof missing === "string" ? `<p class="error">No keyword "${esc(missing)}". Try one of these:</p>` : ""}
        <ul class="list">${Object.keys(keywords).filter((k, i, a) => a.indexOf(k) === i).map((k) =>
          `<li><a href="#" data-k="${esc(k)}">${k}</a></li>`).join("")}</ul>`;
      body.querySelectorAll("[data-k]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); runKeyword(a.dataset.k); }));
    },
  });
}

// ---------- Weather (Open-Meteo, free, no key) ----------
const wmo = (c) => c === 0 ? ["☀️", "Clear"] : c <= 2 ? ["🌤", "Partly cloudy"] : c === 3 ? ["☁️", "Cloudy"]
  : c <= 48 ? ["🌫", "Foggy"] : c <= 57 ? ["🌦", "Drizzle"] : c <= 67 ? ["🌧", "Rain"] : c <= 77 ? ["🌨", "Snow"]
  : c <= 82 ? ["🌧", "Showers"] : c <= 86 ? ["🌨", "Snow showers"] : ["⛈", "Thunderstorms"];

async function loadWeather(el, compact) {
  const c = city();
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${c.lat}&longitude=${c.lon}&current=temperature_2m,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=5`);
    const d = await r.json();
    const [icon, text] = wmo(d.current.weather_code);
    const days = d.daily.time.map((t, i) => {
      const [ic] = wmo(d.daily.weather_code[i]);
      const name = new Date(t + "T12:00").toLocaleDateString([], { weekday: "short" });
      return `<li class="score"><span>${name} ${ic}</span><span>${Math.round(d.daily.temperature_2m_max[i])}° / ${Math.round(d.daily.temperature_2m_min[i])}°</span></li>`;
    }).join("");
    el.innerHTML = `<h3>🌤 Weather — ${esc(c.name)}</h3>
      <div class="big-temp">${icon} ${Math.round(d.current.temperature_2m)}°F</div>
      <div class="small">${text} · wind ${Math.round(d.current.wind_speed_10m)} mph</div>
      ${compact ? "" : `<ul class="list" style="margin-top:8px">${days}</ul>`}`;
  } catch {
    el.innerHTML = `<h3>🌤 Weather</h3><span class="small muted">Weather is taking a coffee break. Try again soon.</span>`;
  }
}

function openWeather() {
  openWindow("weather", {
    title: "Weather", icon: "🌤", width: 340, height: 440,
    render(body) {
      body.innerHTML = `<form class="row" id="city-form" style="margin-bottom:10px">
          <input id="city-q" placeholder="City or town" style="flex:1"><button class="btn small-btn">Set</button></form>
        <div class="panel" id="wx"></div>`;
      const wx = body.querySelector("#wx");
      loadWeather(wx, false);
      body.querySelector("#city-form").onsubmit = async (e) => {
        e.preventDefault();
        const q = body.querySelector("#city-q").value.trim();
        if (!q) return;
        try {
          const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(q)}`);
          const g = (await r.json()).results?.[0];
          if (!g) { wx.innerHTML = `<span class="error">Couldn't find "${esc(q)}".</span>`; return; }
          localStorage.setItem("du.city", JSON.stringify({ name: g.name, lat: g.latitude, lon: g.longitude }));
          loadWeather(wx, false);
        } catch { wx.innerHTML = `<span class="error">Couldn't look that up right now.</span>`; }
      };
    },
  });
}

// ---------- News (Wikipedia "In the news", free) ----------
async function loadNews(el, max = 10) {
  try {
    const t = new Date();
    const url = `https://api.wikimedia.org/feed/v1/wikipedia/en/featured/${t.getFullYear()}/${String(t.getMonth() + 1).padStart(2, "0")}/${String(t.getDate()).padStart(2, "0")}`;
    const d = await (await fetch(url)).json();
    const items = (d.news || []).slice(0, max).map((n) => {
      const text = n.story.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
      const link = n.links?.[0]?.content_urls?.desktop?.page;
      return `<li>${esc(text)} ${link ? `<a href="${esc(link)}" target="_blank" rel="noopener">more</a>` : ""}</li>`;
    });
    el.innerHTML = (items.join("") || `<li class="muted small">No headlines right now.</li>`)
      + `<li class="small muted">Headlines via Wikipedia.</li>`;
  } catch {
    el.innerHTML = `<li class="small muted">The news wire is down. Check back soon.</li>`;
  }
}

function openNews() {
  openWindow("news", {
    title: "DialedUp News", icon: "📰", width: 480, height: 520, keyword: "news",
    render(body) {
      const tabs = [["top", "Top Stories"], ["us", "U.S."], ["world", "World"], ["nyc", "NYC"], ["business", "Business"],
        ["entertainment", "Entertainment"], ["sports", "Sports"], ["tech", "Tech"], ["space", "Space"]];
      body.innerHTML = `<div class="mb-tabs">${tabs.map(([k, l], i) => `<button class="mtab ${i ? "" : "on"}" data-t="${esc(k)}">${l}</button>`).join("")}</div>
        <div id="n-out" style="margin-top:8px"><p class="muted">📡 Loading the latest…</p></div>`;
      let news = null;
      const show = (k) => {
        body.querySelectorAll("[data-t]").forEach((b) => b.classList.toggle("on", b.dataset.t === k));
        const list = (news?.[k] || []).slice(0, 20);
        body.querySelector("#n-out").innerHTML = list.length ? list.map((h) => `<a class="news-card" href="${esc(h.url || "#")}" target="_blank" rel="noopener" data-browse data-title="${esc(h.title)}" data-source="${esc(h.source)}" data-image="${esc(h.image || "")}">
            ${h.image ? `<img src="${esc(h.image)}" alt="" loading="lazy">` : ""}
            <div>${tag(h)} <b>${esc(h.title)}</b>${h.ts ? `<div class="small muted">${timeAgo(h.ts)}</div>` : ""}</div></a>`).join("")
          : `<p class="muted">Nothing here right now — check back soon.</p>`;
      };
      body.querySelectorAll("[data-t]").forEach((b) => (b.onclick = () => show(b.dataset.t)));
      getHeadlines().then((n) => { news = n; show("top"); }).catch(() => (body.querySelector("#n-out").innerHTML = `<p class="muted">The news wire is down. Try again soon.</p>`));
    },
  });
}

// ---------- Tech (Hacker News, free) ----------
function openTech() {
  openWindow("tech", {
    title: "Tech Channel", icon: "💻", width: 420, height: 480,
    async render(body) {
      body.innerHTML = `<div class="panel"><h3>💻 Top Tech Links</h3><ul class="list" id="t-list"><li class="muted">Loading…</li></ul></div>`;
      const list = body.querySelector("#t-list");
      try {
        const ids = (await (await fetch("https://hacker-news.firebaseio.com/v0/topstories.json")).json()).slice(0, 15);
        const items = await Promise.all(ids.map((id) => fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).then((r) => r.json())));
        list.innerHTML = items.filter(Boolean).map((s) =>
          `<li><a href="${esc(s.url || `https://news.ycombinator.com/item?id=${s.id}`)}" target="_blank" rel="noopener">${esc(s.title)}</a>
           <div class="small muted">${s.score} points · ${s.descendants || 0} comments</div></li>`).join("")
          + `<li class="small muted">Links via Hacker News.</li>`;
      } catch { list.innerHTML = `<li class="muted">Couldn't load tech links right now.</li>`; }
    },
  });
}

// ---------- Sports (ESPN public scoreboard) ----------
const leagues = { NBA: "basketball/nba", NFL: "football/nfl", MLB: "baseball/mlb", NHL: "hockey/nhl" };

function openSports() {
  openWindow("sports", {
    title: "Sports", icon: "🏀", width: 380, height: 500,
    render(body) {
      body.innerHTML = `<div class="row" style="justify-content:flex-start;margin-bottom:8px">${Object.keys(leagues).map((l) =>
        `<button class="btn small-btn" data-l="${esc(l)}">${l}</button>`).join("")}</div><div id="s-out"></div>`;
      const out = body.querySelector("#s-out");
      const load = async (l) => {
        out.innerHTML = `<p class="muted">Loading ${l}…</p>`;
        try {
          const d = await (await fetch(`https://site.api.espn.com/apis/site/v2/sports/${leagues[l]}/scoreboard`)).json();
          const games = (d.events || []).map((ev) => {
            const c = ev.competitions[0];
            const [home, away] = [c.competitors.find((x) => x.homeAway === "home"), c.competitors.find((x) => x.homeAway === "away")];
            return `<div class="panel"><div class="score"><b>${esc(away.team.shortDisplayName)}</b><b>${esc(away.score ?? "")}</b></div>
              <div class="score"><b>${esc(home.team.shortDisplayName)}</b><b>${esc(home.score ?? "")}</b></div>
              <div class="small muted">${esc(ev.status.type.shortDetail)}</div></div>`;
          });
          out.innerHTML = games.join("") || `<p class="muted">No ${l} games today.</p>`;
        } catch { out.innerHTML = `<p class="muted">Scores are unavailable right now.</p>`; }
      };
      body.querySelectorAll("[data-l]").forEach((b) => (b.onclick = () => load(b.dataset.l)));
      load("NBA");
    },
  });
}

// ---------- Horoscopes (written fresh each day by a little randomizer) ----------
export const signs = [
  ["Aries", "♈", [3, 21]], ["Taurus", "♉", [4, 20]], ["Gemini", "♊", [5, 21]], ["Cancer", "♋", [6, 21]],
  ["Leo", "♌", [7, 23]], ["Virgo", "♍", [8, 23]], ["Libra", "♎", [9, 23]], ["Scorpio", "♏", [10, 23]],
  ["Sagittarius", "♐", [11, 22]], ["Capricorn", "♑", [12, 22]], ["Aquarius", "♒", [1, 20]], ["Pisces", "♓", [2, 19]],
];
const openers = ["The stars are buffering in your favor today.", "Your aura is running at full bandwidth.", "Mercury is fine, actually — no excuses.",
  "The universe left you an away message.", "Today's signal strength: five bars.", "A cosmic pop-up is heading your way.",
  "Your vibe just got a firmware update.", "The moon is reading your profile."];
const middles = ["One of your homies is thinking about you", "a surprise IM brings good news", "a playlist will fix your mood",
  "an old friend signs back on", "your best idea arrives around lunchtime", "a small risk pays off big", "a group chat gets legendary",
  "a stranger's compliment makes your day"];
const advice = ["Say yes to the late-night plan.", "Drink some water, superstar.", "Update your away message — it's time.",
  "Don't trust the first price you see.", "Text back the person you've been ignoring.", "Take the long way home.",
  "Wear the loud outfit.", "Save something for tomorrow."];
const lucky = ["56", "7", "1999", "404", "23", "88", "3", "11"];

function seeded(seed) { let s = seed; return () => (s = (s * 9301 + 49297) % 233280) / 233280; }

export function horoscopeFor(signIndex, date = new Date()) {
  const r = seeded(signIndex * 1000 + date.getFullYear() * 400 + date.getMonth() * 31 + date.getDate());
  const pick = (a) => a[Math.floor(r() * a.length)];
  return `${pick(openers)} ${pick(middles)}. ${pick(advice)} Lucky number: ${pick(lucky)}.`;
}

function renderHoroscope(el, compact) {
  const saved = Number(localStorage.getItem("du.sign") ?? "-1");
  const options = signs.map(([n, s], i) => `<option value="${esc(i)}" ${i === saved ? "selected" : ""}>${s} ${n}</option>`).join("");
  el.innerHTML = `<h3>🔮 Your Horoscope</h3>
    <select id="sign-pick"><option value="-1">Pick your sign…</option>${options}</select>
    <p class="small" id="horo-text">${saved >= 0 ? esc(horoscopeFor(saved)) : "Choose your sign to see today's reading."}</p>
    ${compact ? "" : ""}`;
  el.querySelector("#sign-pick").onchange = (e) => {
    localStorage.setItem("du.sign", e.target.value);
    renderHoroscope(el, compact);
  };
}

function openHoroscopes() {
  openWindow("horoscopes", {
    title: "Horoscopes", icon: "🔮", width: 380, height: 520,
    render(body) {
      body.innerHTML = signs.map(([n, s], i) =>
        `<div class="panel"><h3>${s} ${n}</h3><p class="small" style="margin:0">${esc(horoscopeFor(i))}</p></div>`).join("")
        + `<p class="small muted">For entertainment only. The stars are not responsible for your choices.</p>`;
    },
  });
}

// ---------- NYC ----------
function openNYC() {
  openWindow("nyc", {
    title: "NYC Channel", icon: "🗽", width: 400, height: 480,
    render(body) {
      const tips = ["Stand right, walk left on escalators.", "The express train is only express until it isn't.",
        "Every bodega cat is the main character.", "A real slice folds.", "If the train is empty, there's a reason.",
        "Brunch lines are a lifestyle.", "Never call it Manhattan Island at a party."];
      const tip = tips[new Date().getDate() % tips.length];
      body.innerHTML = `
        <div class="panel" id="nyc-wx"></div>
        <div class="panel"><h3>🗽 New Yorker Tip of the Day</h3><p style="margin:0">${tip}</p></div>
        <div class="panel"><h3>🔗 Handy Links</h3><ul class="list">
          <li><a href="https://new.mta.info/" target="_blank" rel="noopener">Subway &amp; bus status (MTA)</a></li>
          <li><a href="https://portal.311.nyc.gov/" target="_blank" rel="noopener">NYC 311</a></li>
          <li><a href="https://www.nycgovparks.org/events" target="_blank" rel="noopener">Free events in the parks</a></li>
        </ul></div>
        <div class="panel"><h3>💬 Talk NYC</h3><button class="btn" id="nyc-room">Join the NYC chat room</button></div>`;
      const wxCity = localStorage.getItem("du.city");
      localStorage.setItem("du.city", JSON.stringify({ name: "New York", lat: 40.71, lon: -74.01 }));
      loadWeather(body.querySelector("#nyc-wx"), true).finally(() => wxCity ? localStorage.setItem("du.city", wxCity) : localStorage.removeItem("du.city"));
      body.querySelector("#nyc-room").onclick = () => openChatRooms("nyc");
    },
  });
}
