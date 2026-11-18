// DialBot: an always-online homie you can IM. Runs entirely in the browser, so it's free.
// Knows weather, scores, headlines, horoscopes, definitions, jokes, trivia and a few games.
import { openWindow, getWindow, esc } from "./wm.js";
import { me } from "./chat.js";
import * as sfx from "./sounds.js";

const BOT = "DialBot";
const histKey = () => "du.bot." + (me().screenName || "me").toLowerCase();
const history = () => { try { return JSON.parse(localStorage.getItem(histKey()) || "[]"); } catch { return []; } };
const saveHistory = (h) => { try { localStorage.setItem(histKey(), JSON.stringify(h.slice(-120))); } catch {} };
const pick = (a) => a[Math.floor(Math.random() * a.length)];

async function getJSON(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 9000);
  try { const r = await fetch(url, { signal: ctl.signal }); if (!r.ok) throw 0; return await r.json(); } finally { clearTimeout(t); }
}

// ---------- Original material ----------
const jokes = [
  "Why did the DJ break up with the calendar? Too many dates, not enough beats.",
  "My Wi-Fi and I have a lot in common. We both drop out when things get serious.",
  "I tried to download some patience. It's still buffering.",
  "Why don't robots ever panic? We have nerves of steel… and a good antivirus.",
  "I told my modem a joke. It laughed in 56k — eeeeee-krrrrr-haha.",
  "Why was the computer cold? It left its Windows open.",
  "I'd tell you a UDP joke, but you might not get it.",
  "What do you call a sleepy bull? A bulldozer.",
  "Why did the scarecrow win an award? He was outstanding in his field.",
  "I asked the speaker for a favor. It said it'd sound it out.",
  "Why did the playlist go to therapy? It had too many unresolved tracks.",
  "Parallel lines have so much in common. It's a shame they'll never meet.",
  "Why are elevator jokes so good? They work on many levels.",
  "I'm reading a book about anti-gravity. I can't put it down.",
  "Why did the cookie go to the doctor? It felt crummy.",
];
const trivia = [
  ["How many keys does a standard piano have?", ["88"]],
  ["What planet is known as the Red Planet?", ["mars"]],
  ["How many minutes are in a full day?", ["1440", "1,440"]],
  ["What's the largest ocean on Earth?", ["pacific"]],
  ["How many players are on the court for one basketball team?", ["5", "five"]],
  ["What's the chemical symbol for gold?", ["au"]],
  ["Which borough of New York City is the most populated?", ["brooklyn"]],
  ["How many strings does a standard guitar have?", ["6", "six"]],
  ["What's the freezing point of water in Fahrenheit?", ["32"]],
  ["How many sides does a hexagon have?", ["6", "six"]],
  ["What's the tallest animal in the world?", ["giraffe"]],
  ["What color do you get mixing blue and yellow?", ["green"]],
  ["How many continents are there?", ["7", "seven"]],
  ["What instrument has a slide, a mouthpiece and a bell?", ["trombone"]],
  ["In what decade did the first iPhone come out?", ["2000s", "2000", "00s", "2007"]],
  ["What's the largest planet in our solar system?", ["jupiter"]],
];
const eightBall = ["Signs point to yes. 🎱", "Totally. 💯", "Ask again after you've had a snack.", "Hmm… don't count on it.",
  "The modem says yes.", "My sources (the cloud) say no.", "Absolutely, no doubt.", "It's a maybe, leaning yes.",
  "Reply hazy. Try turning it off and on again.", "Not today. Tomorrow's looking better though."];
const djFirst = ["DJ", "MC", "Lil", "Big", "Young", "Sir", "Dr.", "Captain"];
const djLast = ["Bass Drop", "Vinyl", "Crossfade", "Subwoofer", "Midnight", "Turntable", "Echo", "Static", "Neon", "Groove", "Fader", "Sample"];
const hellos = ["Hey hey! 👋 What's up?", "Yo! DialBot here, always online. 😎", "Hi! Need something? Type 'help' to see what I can do.", "Wassup! 🤖"];
const fallbacks = ["Hmm, I'm not sure about that one. Type 'help' to see what I can do. 🤖", "I'm just a little bot, but I'm learning! Try 'help'.",
  "Ooh, good question. I don't know that one yet. Want a joke instead? Type 'joke'.", "Beep boop… that went over my antenna. 📡 Try 'help'."];

const HELP = `Here's what I can do — just type it:
☀️ weather (or "weather Miami")
🏀 scores (or "nba scores", "nfl scores")
📰 news
🔮 horoscope leo
📖 define serendipity
😂 joke
❓ trivia
🎱 8ball will I win?
🪙 flip a coin · 🎲 roll a die
🎧 dj name
⏰ time
…or just chat with me!`;

let pendingTrivia = null;

async function reply(text) {
  const t = text.trim();
  const low = t.toLowerCase().replace(/[!?.]+$/g, "").trim();

  if (pendingTrivia) {
    const [q, answers] = pendingTrivia;
    if (!/^(skip|give up|idk|pass)$/.test(low) && !/^(trivia|help|joke)/.test(low)) {
      pendingTrivia = null;
      return answers.some((a) => low.includes(a)) ? pick(["✅ Correct! You're a genius. 🧠", "✅ Nailed it!", "✅ Yes! Big brain energy."])
        : `❌ Nope — it's ${answers[0]}. Type 'trivia' for another!`;
    }
    if (/^(skip|give up|idk|pass)$/.test(low)) { pendingTrivia = null; return `The answer was ${answers[0]}. Type 'trivia' for another!`; }
    pendingTrivia = null;
  }

  if (/^(hi|hey|hello|yo|sup|wassup|what'?s up|hiya|howdy)\b/.test(low)) return pick(hellos);
  if (/^(help|commands|menu|\?)$/.test(low) || /what can you do/.test(low)) return HELP;
  if (/how are (you|u)|how r u|hru|wyd/.test(low)) return pick(["I'm great! Running at full bandwidth. 😄 How about you?", "Chillin' in the cloud. You?", "Living my best bot life. What's up with you?"]);
  if (/^(good|great|fine|ok|okay|not bad|chillin|chilling)/.test(low)) return pick(["Love that. 😎", "Nice! Anything I can help with?", "Glad to hear it!"]);
  if (/\b(thanks|thank you|thx|ty)\b/.test(low)) return pick(["Anytime! 🤖", "You got it!", "Happy to help. 👍"]);
  if (/\b(bye|later|gn|good ?night|ttyl|brb)\b/.test(low)) return pick(["Later! I'll be right here. 👋", "Bye! I never sign off. 😄", "Catch you later!"]);
  if (/who are you|what are you|your name/.test(low)) return "I'm DialBot 🤖 — DialedUp's always-online homie. I never go idle, never go away, and I never get tired of your messages.";
  if (/\b(lol|lmao|haha|😂)\b/.test(low)) return pick(["😂😂", "Ha! I'm hilarious, I know.", "LOL 🤣"]);
  if (/love you|ily/.test(low)) return "Aww 🥹 I appreciate you too! (Strictly platonic, I'm a robot.)";

  if (/\bjoke\b/.test(low)) return pick(jokes);
  if (/\b(8 ?ball|magic ball)\b/.test(low)) return pick(eightBall);
  if (/flip|coin/.test(low)) return `🪙 ${Math.random() < 0.5 ? "Heads!" : "Tails!"}`;
  if (/\broll\b|\bdice?\b/.test(low)) return `🎲 You rolled a ${1 + Math.floor(Math.random() * 6)}!`;
  if (/dj name|rapper name|stage name/.test(low)) return `🎧 Your DJ name is… **${pick(djFirst)} ${pick(djLast)}**!`.replace(/\*\*/g, "");
  if (/\btime\b|what day|date/.test(low)) return `⏰ It's ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} on ${new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}.`;

  if (/\btrivia\b|quiz/.test(low)) { pendingTrivia = pick(trivia); return `❓ ${pendingTrivia[0]}\n(Type your answer, or 'skip')`; }

  if (/\bweather\b|forecast|temperature|\btemp\b/.test(low)) {
    const place = t.replace(/.*?(weather|forecast|temperature|temp)\s*(in|for)?\s*/i, "").trim();
    try {
      let lat, lon, label;
      if (place) {
        const g = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=1`);
        if (!g.results?.length) return `I couldn't find "${place}". Try a city name like "weather Chicago".`;
        ({ latitude: lat, longitude: lon } = g.results[0]); label = `${g.results[0].name}${g.results[0].admin1 ? ", " + g.results[0].admin1 : ""}`;
      } else {
        const c = JSON.parse(localStorage.getItem("du.city") || "null") || { name: "New York", lat: 40.71, lon: -74.01 };
        ({ lat, lon } = c); label = c.name;
      }
      const w = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=1`);
      const c = w.current.weather_code;
      const sky = c === 0 ? "☀️ clear" : c <= 2 ? "🌤 partly cloudy" : c === 3 ? "☁️ cloudy" : c < 50 ? "🌫 foggy" : c < 70 ? "🌧 rainy" : c < 80 ? "❄️ snowy" : c < 90 ? "🌦 showery" : "⛈ stormy";
      return `${label}: ${Math.round(w.current.temperature_2m)}°F and ${sky}. High ${Math.round(w.daily.temperature_2m_max[0])}°, low ${Math.round(w.daily.temperature_2m_min[0])}°. Wind ${Math.round(w.current.wind_speed_10m)} mph.`;
    } catch { return "The weather service isn't answering right now. Try again in a minute. 🌦"; }
  }

  if (/score|game|nba|nfl|nhl|mlb|knicks|nets|yankees|mets|giants|jets|rangers|lakers|celtics/.test(low)) {
    try {
      const { getScores, scoreText } = await import("./live.js");
      let games = await getScores();
      const league = (low.match(/\b(nba|nfl|nhl|mlb)\b/) || [])[1];
      if (league) games = games.filter((g) => g.league.toLowerCase() === league);
      const team = low.match(/knicks|nets|yankees|mets|giants|jets|rangers|lakers|celtics/)?.[0];
      const abbr = { knicks: "NY", nets: "BKN", yankees: "NYY", mets: "NYM", giants: "NYG", jets: "NYJ", rangers: "NYR", lakers: "LAL", celtics: "BOS" }[team];
      if (abbr) games = games.filter((g) => g.home === abbr || g.away === abbr);
      return games.length ? "🏟 " + games.slice(0, 8).map(scoreText).join("\n") : "No games on right now for that. 🏀";
    } catch { return "The scoreboard isn't answering right now. 🏟"; }
  }

  if (/\bnews\b|headlines|what'?s happening/.test(low)) {
    try {
      const { getHeadlines } = await import("./live.js");
      const h = await getHeadlines();
      return "📰 Top stories:\n" + (h.top || []).slice(0, 5).map((x, i) => `${i + 1}. ${x.title} (${x.source})`).join("\n");
    } catch { return "The news robot is on a coffee break. Try again soon. 📰"; }
  }

  if (/horoscope|zodiac|\b(aries|taurus|gemini|cancer|leo|virgo|libra|scorpio|sagittarius|capricorn|aquarius|pisces)\b/.test(low)) {
    const { signs, horoscopeFor } = await import("./portal.js");
    const i = signs.findIndex(([n]) => low.includes(n.toLowerCase()));
    if (i < 0) return "Which sign? Try 'horoscope leo'. 🔮";
    return `${signs[i][1]} ${signs[i][0]}: ${horoscopeFor(i)}`;
  }

  const def = low.match(/^(define|definition of|what does|meaning of)\s+(.+?)(\s+mean)?$/);
  if (def) {
    const word = def[2].replace(/^(the word\s+)/, "").trim();
    try {
      const j = await getJSON(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
      const m = j[0].meanings[0];
      return `📖 ${j[0].word} (${m.partOfSpeech}): ${m.definitions[0].definition}`;
    } catch { return `I couldn't find a definition for "${word}". 📖`; }
  }

  if (/\?$/.test(t)) return pick(["Great question! I'm not sure. 🤔 Type 'help' to see what I know.", ...fallbacks]);
  return pick(fallbacks);
}

// ---------- The IM window ----------
export function openBot() {
  openWindow("im.__bot", {
    title: `${BOT} — Instant Message`, icon: "🤖", width: 340, height: 430,
    render(body) {
      body.innerHTML = `<div class="im">
        <div class="im-head"><span class="im-who" style="cursor:default"><span class="bot-ic">🤖</span><b class="im-name">${BOT}</b></span><span class="st">🟢 Always online</span></div>
        <div class="transcript"></div><div class="typing"></div>
        <div class="compose"><textarea placeholder="Say hi to ${BOT}…"></textarea><button class="btn primary">Send</button></div></div>`;
      const tx = body.querySelector(".transcript"), ta = body.querySelector("textarea"), typing = body.querySelector(".typing");
      const line = (who, text, ts) => `<div class="msg"><span class="who ${who === BOT ? "them" : "me"}">${esc(who)}</span>
        <time>(${new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })})</time>: <span style="white-space:pre-wrap">${esc(text)}</span></div>`;
      const paint = () => { tx.innerHTML = history().map((m) => line(m.who, m.text, m.ts)).join(""); tx.scrollTop = tx.scrollHeight; };
      const add = (who, text) => { const h = history(); h.push({ who, text, ts: Date.now() }); saveHistory(h); paint(); };
      if (!history().length) add(BOT, `Hi ${me().screenName}! 👋 I'm ${BOT}, your always-online homie.\n\n${HELP}`);
      else paint();
      const send = async () => {
        const text = ta.value.trim();
        if (!text) return;
        ta.value = "";
        add(me().screenName, text);
        sfx.imOut();
        typing.textContent = `${BOT} is typing…`;
        const [answer] = await Promise.all([reply(text).catch(() => pick(fallbacks)), new Promise((r) => setTimeout(r, 500 + Math.random() * 700))]);
        typing.textContent = "";
        if (!getWindow("im.__bot")) return;
        add(BOT, answer);
        sfx.imIn();
      };
      body.querySelector(".compose .btn").onclick = send;
      ta.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } };
      ta.focus();
    },
  });
}
