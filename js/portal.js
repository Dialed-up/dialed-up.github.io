import { openWindow, esc } from "./wm.js";
import { me, openBuddyList, openChatRooms, openAway, openDirectory, openProfile, openAddBuddy } from "./chat.js";
import { openMyPage } from "./homepage.js";
import { openGame } from "./game.js";
import { openMail, writeMail } from "./mail.js";
import { openBoards } from "./boards.js";
import { openPeoplePlaza } from "./people.js";
import { openFavorites, openClock, onlineFor } from "./extras.js";

const city = () => JSON.parse(localStorage.getItem("du.city") || "null") || { name: "New York", lat: 40.71, lon: -74.01 };

// ---------- Welcome window ----------
export function openWelcome() {
  openWindow("welcome", {
    title: "Welcome to DialedUp", icon: "🏠", keyword: "home",
    // in landscape, fill the space left of the Buddy List
    ...(() => {
      const d = document.getElementById("desk");
      const wide = d.clientWidth > d.clientHeight && d.clientHeight < 500;
      return wide ? { x: 6, y: 4, width: Math.round(d.clientWidth * 0.62), height: d.clientHeight - 10 } : { width: 460, height: 560 };
    })(),
    render(body) {
      const hour = new Date().getHours();
      const hello = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
      body.innerHTML = `
        <div class="welcome-head">
          <img src="img/logo.svg" alt="">
          <div><h2>${hello}, ${esc(me().screenName)}!</h2>
          <div class="small muted">${new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })} · online ${onlineFor()}</div></div>
        </div>
        <div class="grid2">
          <div class="panel" id="w-weather"><h3>🌤 Weather</h3><span class="muted small">Loading…</span></div>
          <div class="panel" id="w-horo"><h3>🔮 Your Horoscope</h3></div>
        </div>
        <div class="panel"><h3>📰 In The News</h3><ul class="list" id="w-news"><li class="muted small">Loading…</li></ul></div>
        <div class="panel"><h3>🔥 Today's Hot Spots</h3>
          <div class="grid2">
            ${tile("💬 People Plaza", "Chat rooms by category", "#ff5ec4", "chat")}
            ${tile("📬 Mail", "Check your mailbox", "#00a68c", "mail")}
            ${tile("📌 Message Boards", "Post & reply", "#e53935", "boards")}
            ${tile("🌐 Home Pages", "Build yours — glitter included", "#8a4dff", "homepage")}
            ${tile("🏀 Sports", "Live scores", "#ff8a3d", "sports")}
            ${tile("🎮 Games", "Play Byte Snake", "#21a0fd", "games")}
          </div>
        </div>
        <p class="small muted">Tip: type a word in the <b>Keyword</b> box up top — try <i>weather</i>, <i>news</i>, <i>chat</i> or <i>help</i>.</p>`;
      body.querySelectorAll("[data-kw]").forEach((b) => (b.onclick = () => runKeyword(b.dataset.kw)));
      loadWeather(body.querySelector("#w-weather"), true);
      renderHoroscope(body.querySelector("#w-horo"), true);
      loadNews(body.querySelector("#w-news"), 5);
    },
  });
}

const tile = (title, sub, color, kw) =>
  `<button class="tile" style="background:linear-gradient(135deg, ${color}, #5b2a86)" data-kw="${kw}">${title}<small>${sub}</small></button>`;

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
  games: openGame, game: openGame, snake: openGame, play: openGame,
  nyc: openNYC, newyork: openNYC,
  chat: openChatRooms, rooms: openChatRooms, lobby: openChatRooms,
  buddy: openBuddyList, buddies: openBuddyList, im: openBuddyList, add: openAddBuddy,
  away: openAway, profile: openProfile, people: openDirectory, directory: openDirectory, members: openDirectory,
  homepage: openMyPage, mypage: openMyPage, page: openMyPage,
  mail: openMail, inbox: openMail, write: () => writeMail(), email: openMail,
  boards: openBoards, forums: openBoards, messageboards: openBoards,
  plaza: openPeoplePlaza, peopleplaza: openPeoplePlaza, chatrooms: openPeoplePlaza,
  favorites: () => openFavorites(runKeyword), favs: () => openFavorites(runKeyword),
  clock: openClock, time: openClock,
  about: openAbout,
  help: openHelp,
};

function openAbout() {
  openWindow("about", {
    title: "About DialedUp", icon: "💿", width: 320, height: 330,
    render(body) {
      body.innerHTML = `<div style="text-align:center"><img src="img/logo.svg" width="90" height="90" alt="">
        <h2 class="brand" style="font-size:26px">Dialed<span>Up</span></h2>
        <p class="tagline">The online service that never logged off.</p>
        <p class="small">Version 26.0 · Still connecting since '96.<br>Works with the BuddyChat iPhone app.</p>
        <p class="small muted">A fan-made throwback. Not affiliated with any real online service.</p></div>`;
    },
  });
}

export function runKeyword(raw) {
  const k = String(raw || "").toLowerCase().replace(/[^a-z]/g, "");
  if (!k) return;
  (keywords[k] || (() => openHelp(k)))();
}

function openHelp(missing) {
  openWindow("help", {
    title: "Keyword Help", icon: "❓", width: 340, height: 380,
    render(body) {
      body.innerHTML = `${typeof missing === "string" ? `<p class="error">No keyword "${esc(missing)}". Try one of these:</p>` : ""}
        <ul class="list">${Object.keys(keywords).filter((k, i, a) => a.indexOf(k) === i).map((k) =>
          `<li><a href="#" data-k="${k}">${k}</a></li>`).join("")}</ul>`;
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
    title: "News", icon: "📰", width: 420, height: 480,
    render(body) {
      body.innerHTML = `<div class="panel"><h3>📰 In The News</h3><ul class="list" id="n-list"><li class="muted">Loading…</li></ul></div>`;
      loadNews(body.querySelector("#n-list"), 12);
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
        `<button class="btn small-btn" data-l="${l}">${l}</button>`).join("")}</div><div id="s-out"></div>`;
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
const signs = [
  ["Aries", "♈", [3, 21]], ["Taurus", "♉", [4, 20]], ["Gemini", "♊", [5, 21]], ["Cancer", "♋", [6, 21]],
  ["Leo", "♌", [7, 23]], ["Virgo", "♍", [8, 23]], ["Libra", "♎", [9, 23]], ["Scorpio", "♏", [10, 23]],
  ["Sagittarius", "♐", [11, 22]], ["Capricorn", "♑", [12, 22]], ["Aquarius", "♒", [1, 20]], ["Pisces", "♓", [2, 19]],
];
const openers = ["The stars are buffering in your favor today.", "Your aura is running at full bandwidth.", "Mercury is fine, actually — no excuses.",
  "The universe left you an away message.", "Today's signal strength: five bars.", "A cosmic pop-up is heading your way.",
  "Your vibe just got a firmware update.", "The moon is reading your profile."];
const middles = ["Someone from your Buddy List is thinking about you", "a surprise IM brings good news", "a playlist will fix your mood",
  "an old friend signs back on", "your best idea arrives around lunchtime", "a small risk pays off big", "a group chat gets legendary",
  "a stranger's compliment makes your day"];
const advice = ["Say yes to the late-night plan.", "Drink some water, superstar.", "Update your away message — it's time.",
  "Don't trust the first price you see.", "Text back the person you've been ignoring.", "Take the long way home.",
  "Wear the loud outfit.", "Save something for tomorrow."];
const lucky = ["56", "7", "1999", "404", "23", "88", "3", "11"];

function seeded(seed) { let s = seed; return () => (s = (s * 9301 + 49297) % 233280) / 233280; }

function horoscopeFor(signIndex, date = new Date()) {
  const r = seeded(signIndex * 1000 + date.getFullYear() * 400 + date.getMonth() * 31 + date.getDate());
  const pick = (a) => a[Math.floor(r() * a.length)];
  return `${pick(openers)} ${pick(middles)}. ${pick(advice)} Lucky number: ${pick(lucky)}.`;
}

function renderHoroscope(el, compact) {
  const saved = Number(localStorage.getItem("du.sign") ?? "-1");
  const options = signs.map(([n, s], i) => `<option value="${i}" ${i === saved ? "selected" : ""}>${s} ${n}</option>`).join("");
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
