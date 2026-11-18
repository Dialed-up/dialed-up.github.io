// "What if it never logged off?": Locate Member, Polls, Movies, TV, Dictionary, Recipes, Reminders,
// Classifieds, Live Events, Today in History, Lottery. All free sources, no keys.
import { auth, db, ref, get, set, push, remove, onValue, off, serverTimestamp, normalize } from "./firebase.js";
import { openWindow, closeWindow, getWindow, esc } from "./wm.js";
import { me, userName, presence, openIM, buddyList } from "./chat.js";
import { openRoom } from "./people.js";
import { writeMail } from "./mail.js";
import { openBrowser } from "./browser.js";
import { getHeadlines, timeAgo } from "./live.js";
import * as sfx from "./sounds.js";

const uid = () => auth.currentUser.uid;
const pad = (n) => String(n).padStart(2, "0");
const todayKey = (d = new Date()) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;

async function getJSON(url, ms = 9000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error(r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}
const oops = (what) => `<p class="muted small">${what} isn't answering right now. Try again in a minute.</p>`;

// ======================= Locate a Member =======================
export function openLocate(prefill = "") {
  openWindow("locate", {
    title: "Locate a Member Online", icon: "🔎", width: 320, height: 280, keyword: "locate",
    render(body) {
      body.innerHTML = `<form class="row" id="lf"><input placeholder="Screen name" value="${esc(prefill)}" style="flex:1" autocapitalize="off"><button class="btn primary small-btn">Locate</button></form>
        <div id="lr" style="margin-top:10px"></div>
        <p class="small muted">Shows if someone is online and which public chat room they're in. Only your homies can see your full status.</p>`;
      const out = body.querySelector("#lr");
      const find = async (n) => {
        out.innerHTML = `<p class="muted">🔎 Looking for ${esc(n)}…</p>`;
        const target = (await get(ref(db, `screennames/${normalize(n)}`)).catch(() => null))?.val();
        if (!target) { out.innerHTML = `<p>No one has the screen name <b>${esc(n)}</b>.</p>`; return; }
        if (target === uid()) { out.innerHTML = `<p>That's you! 😄</p>`; return; }
        const who = userName(target) || n;
        let status = null;
        try { status = presence((await get(ref(db, `users/${target}`))).val()); } catch {}
        // Look through public chat rooms for them
        const rooms = [];
        try {
          const list = (await get(ref(db, "roomlist"))).val() || {};
          const { categories } = await import("./people.js");
          const keys = new Map(Object.values(categories).flat().map((r) => [normalize(r), r]));
          Object.entries(list).forEach(([k, v]) => !v.private && keys.set(k, v.name));
          await Promise.all([...keys].map(async ([k, label]) => {
            const v = (await get(ref(db, `rooms/${k}/members/${target}`)).catch(() => null))?.val();
            const t = v && (typeof v === "object" ? v.t : v);
            if (t && Date.now() - t < 120000) rooms.push(label);
          }));
        } catch {}
        const online = rooms.length || (status && status !== "offline");
        out.innerHTML = `<div class="panel">
          <p style="margin:0 0 6px"><b>${esc(who)}</b> ${online ? `is <b style="color:#2e7d32">online</b>` : status === "offline" ? "is <b>not signed on</b> right now." : "can't be located right now."}
          ${status === "away" ? " (away)" : status === "idle" ? " (idle)" : ""}</p>
          ${rooms.length ? `<p class="small" style="margin:0 0 6px">💬 In chat room: ${rooms.map((r) => `<a href="#" data-room="${esc(r)}">${esc(r)}</a>`).join(", ")}</p>` : ""}
          ${!online && status === null ? `<p class="small muted" style="margin:0 0 6px">They're not your homie and not in a public chat room, so their status is private.</p>` : ""}
          <div class="row" style="justify-content:flex-start;gap:4px"><button class="btn small-btn" data-x="im">💬 Send IM</button><button class="btn small-btn" data-x="mail">✉️ Mail</button></div></div>`;
        out.querySelectorAll("[data-room]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); openRoom(a.dataset.room); }));
        out.querySelector("[data-x=im]").onclick = () => openIM(target);
        out.querySelector("[data-x=mail]").onclick = () => writeMail(who);
      };
      body.querySelector("#lf").onsubmit = (e) => { e.preventDefault(); const n = e.target.querySelector("input").value.trim(); if (n) find(n); };
      if (prefill) find(prefill);
    },
  });
}

// ======================= Polls & Question of the Day =======================
const qotd = [
  ["Best decade for music?", ["80s", "90s", "2000s", "Right now"]],
  ["Pizza: NYC slice or Chicago deep dish?", ["NYC slice", "Deep dish", "Both, I'm not picky"]],
  ["How do you listen to music most?", ["Streaming", "Radio", "Vinyl", "Live DJ sets"]],
  ["Morning person or night owl?", ["Morning", "Night owl", "Depends on the coffee"]],
  ["Best way to spend a Saturday?", ["Out with friends", "On the couch", "Outdoors", "Online right here"]],
  ["Texting or calling?", ["Texting", "Calling", "Voice notes", "IMs, obviously"]],
  ["Which season wins?", ["Spring", "Summer", "Fall", "Winter"]],
  ["Cats or dogs?", ["Cats", "Dogs", "Both", "Neither"]],
  ["Would you rather time-travel to the…", ["Past", "Future"]],
  ["Best snack for movie night?", ["Popcorn", "Candy", "Nachos", "Pizza"]],
  ["How many tabs do you have open right now?", ["1–5", "6–20", "21–50", "I've lost count"]],
  ["Go-to karaoke vibe?", ["Power ballad", "Hip hop", "Rock anthem", "I just watch"]],
  ["Best sneaker color?", ["All white", "All black", "Loud colors", "Whatever's clean"]],
  ["Coffee or tea?", ["Coffee", "Tea", "Energy drink", "Water, I'm healthy"]],
  ["Where would you rather live?", ["Big city", "Suburbs", "Beach town", "Mountains"]],
  ["Best sport to watch live?", ["Basketball", "Football", "Baseball", "Hockey"]],
  ["Superpower of choice?", ["Flying", "Invisibility", "Teleporting", "Mind reading"]],
  ["Breakfast for dinner?", ["Always", "Sometimes", "Never"]],
  ["Ideal vacation?", ["Beach", "City trip", "Road trip", "Staycation"]],
  ["Phone battery right now?", ["Under 20%", "20–50%", "50–80%", "Full"]],
  ["Best decade for movies?", ["80s", "90s", "2000s", "2010s+"]],
  ["Pineapple on pizza?", ["Yes", "No", "Only if someone else orders"]],
  ["Biggest guilty pleasure?", ["Reality TV", "Junk food", "Online shopping", "Sleeping in"]],
  ["What's your away message style?", ["Song lyrics", "Inside jokes", "Plain 'brb'", "Deep quotes"]],
  ["Would you go to space if you could?", ["Absolutely", "Maybe", "No way"]],
  ["How do you like your music loud?", ["Headphones", "Car speakers", "Club system", "Quiet please"]],
  ["Best holiday?", ["Halloween", "Thanksgiving", "New Year's Eve", "Fourth of July"]],
  ["Sweet or salty?", ["Sweet", "Salty", "Sweet AND salty"]],
  ["Which would you give up for a month?", ["Social media", "Streaming TV", "Takeout", "Coffee"]],
  ["Best place to hear new music?", ["Friends", "Radio", "Playlists", "Clubs & parties"]],
];
const qotdFor = (d = new Date()) => {
  const n = Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 86400000);
  return qotd[n % qotd.length];
};

function pollCard(el, pid, q, options, extra = "") {
  const r = ref(db, `pollvotes/${pid}`);
  onValue(r, (s) => {
    const votes = s.val() || {};
    const mine = votes[uid()];
    const counts = options.map((_, i) => Object.values(votes).filter((v) => v === i).length);
    const total = counts.reduce((a, b) => a + b, 0);
    el.innerHTML = `<div class="poll"><p style="margin:0 0 6px"><b>${esc(q)}</b></p>
      ${options.map((o, i) => mine === undefined
        ? `<button class="btn small-btn poll-opt" data-v="${i}">${esc(o)}</button>`
        : `<div class="poll-bar ${mine === i ? "mine" : ""}"><span style="width:${total ? Math.round((counts[i] / total) * 100) : 0}%"></span>
             <em>${esc(o)}</em><b>${total ? Math.round((counts[i] / total) * 100) : 0}%</b></div>`).join("")}
      <p class="small muted" style="margin:6px 0 0">${total} vote${total === 1 ? "" : "s"}${mine !== undefined ? " · you voted" : ""}${extra}</p></div>`;
    el.querySelectorAll("[data-v]").forEach((b) => (b.onclick = () => set(ref(db, `pollvotes/${pid}/${uid()}`), Number(b.dataset.v)).catch(() => alert("Couldn't vote right now."))));
    el.querySelector("[data-del]")?.addEventListener("click", async () => {
      if (!confirm("Delete this poll?")) return;
      await remove(ref(db, `polls/${pid}`)).catch(() => {});
    });
  });
  return r;
}

export function openPolls() {
  const refs = [];
  openWindow("polls", {
    title: "Polls & Question of the Day", icon: "📊", width: 380, height: 520, keyword: "polls",
    onClose: () => refs.forEach((r) => off(r)),
    render(body) {
      const [q, opts] = qotdFor();
      body.innerHTML = `<h3 style="margin:0 0 6px">❓ Question of the Day</h3><div class="panel" id="qotd"></div>
        <div class="row" style="margin:12px 0 6px"><h3 style="margin:0">📊 Member Polls</h3><button class="btn primary small-btn" id="newpoll">+ New Poll</button></div>
        <div id="plist"><p class="muted small">Loading polls…</p></div>`;
      refs.push(pollCard(body.querySelector("#qotd"), "qotd-" + todayKey(), q, opts));
      const pr = ref(db, "polls");
      onValue(pr, (s) => {
        const list = Object.entries(s.val() || {}).filter(([, p]) => Date.now() - (p.ts || 0) < 14 * 86400000).sort((a, b) => (b[1].ts || 0) - (a[1].ts || 0)).slice(0, 25);
        const el = body.querySelector("#plist");
        el.innerHTML = list.length ? list.map(([id]) => `<div class="panel" data-poll="${id}"></div>`).join("") : `<p class="muted small">No polls yet. Start one!</p>`;
        list.forEach(([id, p]) => refs.push(pollCard(el.querySelector(`[data-poll="${id}"]`), id, p.q, p.options || [],
          ` · by ${esc(p.fromName || "someone")} · ${timeAgo(p.ts)}${p.from === uid() ? ` · <a href="#" data-del>delete</a>` : ""}`)));
      });
      refs.push(pr);
      body.querySelector("#newpoll").onclick = () => newPoll();
    },
  });
}

function newPoll() {
  openWindow("polls.new", {
    title: "New Poll", icon: "📊", width: 320, height: 380,
    render(body) {
      body.innerHTML = `<form id="np"><label>Question <input id="pq" maxlength="120" required></label>
        ${[1, 2, 3, 4].map((i) => `<label>Choice ${i}${i > 2 ? " (optional)" : ""} <input data-o maxlength="50" ${i <= 2 ? "required" : ""}></label>`).join("")}
        <div class="row"><span class="small muted">Polls last 2 weeks.</span><button class="btn primary">Post Poll</button></div></form>`;
      body.querySelector("#np").onsubmit = async (e) => {
        e.preventDefault();
        const options = [...body.querySelectorAll("[data-o]")].map((i) => i.value.trim()).filter(Boolean);
        try {
          await push(ref(db, "polls"), { q: body.querySelector("#pq").value.trim(), options, from: uid(), fromName: me().screenName, ts: serverTimestamp() });
          closeWindow("polls.new");
        } catch { alert("Couldn't post the poll right now."); }
      };
    },
  });
}

/** Little Question of the Day box for the Welcome window. */
export function mountQotd(el) {
  const [q, opts] = qotdFor();
  return pollCard(el, "qotd-" + todayKey(), q, opts);
}

// ======================= Movies =======================
export function openMovies() {
  openWindow("movies", {
    title: "Movies", icon: "🎬", width: 420, height: 500, keyword: "movies",
    render(body) {
      body.innerHTML = `<div class="row" style="justify-content:flex-start;gap:4px;margin-bottom:8px">
          <button class="btn primary small-btn" data-m="showtimes">🎟 Showtimes Near Me</button>
          <button class="btn small-btn" data-m="trailers">▶️ Trailers</button></div>
        <h3 style="margin:4px 0">🎬 Movie News & Reviews</h3><ul class="list" id="ml"><li class="muted">Loading the latest…</li></ul>`;
      body.querySelector("[data-m=showtimes]").onclick = () => window.open("https://www.google.com/search?q=movie+showtimes+near+me", "_blank", "noopener");
      body.querySelector("[data-m=trailers]").onclick = () => openBrowser("https://www.youtube.com/results?search_query=new+movie+trailers+this+week");
      getHeadlines().then((h) => {
        const items = (h.movies?.length ? h.movies : (h.entertainment || []).filter((x) => /film|movie|box office|trailer|oscar|director|cast/i.test(x.title))).slice(0, 25);
        body.querySelector("#ml").innerHTML = items.length ? items.map((x) =>
          `<li><a href="${esc(x.url)}" data-browse data-title="${esc(x.title)}" data-source="${esc(x.source)}" data-image="${esc(x.image || "")}">${esc(x.title)}</a>
           <span class="small muted"> · ${esc(x.source)} ${timeAgo(x.ts)}</span></li>`).join("") : `<li class="muted">No movie stories right now.</li>`;
      }).catch(() => (body.querySelector("#ml").innerHTML = oops("Movie news")));
    },
  });
}

// ======================= TV Listings (TVmaze) =======================
export function openTV() {
  openWindow("tv", {
    title: "TV Listings", icon: "📺", width: 420, height: 520, keyword: "tv",
    render(body) {
      const d = new Date();
      const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      body.innerHTML = `<div class="row" style="justify-content:flex-start;gap:4px;margin-bottom:8px">
          <button class="btn primary small-btn" data-t="prime">📺 Tonight</button><button class="btn small-btn" data-t="all">🕐 All Day</button>
          <button class="btn small-btn" data-t="web">📱 Streaming</button></div><div id="tl"><p class="muted">Loading tonight's lineup…</p></div>`;
      const el = body.querySelector("#tl");
      let cache = {};
      const show = async (mode) => {
        body.querySelectorAll("[data-t]").forEach((b) => b.classList.toggle("primary", b.dataset.t === mode));
        el.innerHTML = `<p class="muted">Loading…</p>`;
        try {
          const key = mode === "web" ? "web" : "tv";
          cache[key] = cache[key] || await getJSON(mode === "web" ? `https://api.tvmaze.com/schedule/web?date=${date}&country=US` : `https://api.tvmaze.com/schedule?country=US&date=${date}`);
          let eps = cache[key].map((e) => {
            const s = e.show || e._embedded?.show || {};
            return { time: e.airtime || "", stamp: e.airstamp, show: s.name, ep: e.name, se: e.season && e.number ? `S${e.season} E${e.number}` : "",
              net: s.network?.name || s.webChannel?.name || "", img: s.image?.medium, url: s.url };
          }).filter((e) => e.show);
          if (mode === "prime") eps = eps.filter((e) => e.time >= "19:00" && e.time <= "23:30");
          const seen = new Set();
          eps = eps.filter((e) => { const k = e.show + e.time; return !seen.has(k) && seen.add(k); }).sort((a, b) => a.time.localeCompare(b.time)).slice(0, 80);
          const groups = {};
          eps.forEach((e) => (groups[e.time || "Anytime"] ||= []).push(e));
          const fmt = (t) => { if (!/^\d\d:\d\d$/.test(t)) return t; const [h, m] = t.split(":").map(Number); return `${(h % 12) || 12}:${pad(m)} ${h < 12 ? "AM" : "PM"}`; };
          el.innerHTML = eps.length ? Object.entries(groups).map(([t, list]) => `<h4 class="tv-time">${fmt(t)}</h4><ul class="list">${list.map((e) =>
            `<li class="row"><span><b>${esc(e.show)}</b> <span class="small muted">${esc(e.se)} ${e.ep && e.ep !== e.show ? "· " + esc(e.ep) : ""}</span></span>
             <span class="small muted">${esc(e.net)}</span></li>`).join("")}</ul>`).join("")
            : `<p class="muted">Nothing listed for that time.</p>`;
        } catch { el.innerHTML = oops("The TV guide"); }
      };
      body.querySelectorAll("[data-t]").forEach((b) => (b.onclick = () => show(b.dataset.t)));
      show("prime");
    },
  });
}

// ======================= Dictionary & Thesaurus =======================
const wotd = ["serendipity", "ephemeral", "nostalgia", "eloquent", "resilient", "ubiquitous", "zeitgeist", "quintessential", "euphoria", "candor",
  "gregarious", "luminous", "meander", "panache", "reverie", "sonorous", "tenacious", "vivacious", "whimsical", "zenith", "ambivalent", "benevolent",
  "cacophony", "dapper", "effervescent", "flamboyant", "gusto", "halcyon", "idyllic", "jubilant", "kinetic", "labyrinth", "mellifluous", "nonchalant",
  "oblivious", "paradox", "quixotic", "rhapsody", "solace", "trepidation", "uncanny", "verve", "wanderlust", "yearn", "zealous", "aplomb", "bravado", "cadence"];

export function openDictionary(word = "") {
  openWindow("dictionary", {
    title: "Dictionary & Thesaurus", icon: "📖", width: 380, height: 480, keyword: "dictionary",
    render(body) {
      const today = wotd[Math.floor(Date.now() / 86400000) % wotd.length];
      body.innerHTML = `<form class="row" id="df"><input placeholder="Look up a word…" value="${esc(word)}" style="flex:1" autocapitalize="off"><button class="btn primary small-btn">Define</button></form>
        <p class="small" style="margin:6px 0">📅 Word of the Day: <a href="#" id="wotd"><b>${today}</b></a></p><div id="dr"></div>`;
      const out = body.querySelector("#dr");
      const look = async (w) => {
        body.querySelector("input").value = w;
        out.innerHTML = `<p class="muted">📖 Looking up "${esc(w)}"…</p>`;
        const [def, syn] = await Promise.allSettled([
          getJSON(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(w)}`),
          getJSON(`https://api.datamuse.com/words?rel_syn=${encodeURIComponent(w)}&max=16`),
        ]);
        const entry = def.status === "fulfilled" ? def.value[0] : null;
        const syns = syn.status === "fulfilled" ? syn.value.map((x) => x.word) : [];
        if (!entry && !syns.length) {
          let sug = [];
          try { sug = (await getJSON(`https://api.datamuse.com/sug?s=${encodeURIComponent(w)}&max=5`)).map((x) => x.word); } catch {}
          out.innerHTML = `<p>No definition found for <b>${esc(w)}</b>.</p>${sug.length ? `<p class="small">Did you mean: ${sug.map((s) => `<a href="#" data-w="${esc(s)}">${esc(s)}</a>`).join(", ")}?</p>` : ""}`;
        } else {
          const audio = entry?.phonetics?.find((p) => p.audio)?.audio;
          out.innerHTML = `${entry ? `<h3 style="margin:4px 0">${esc(entry.word)} <span class="small muted">${esc(entry.phonetic || "")}</span>
              ${audio ? `<button class="btn small-btn" id="say">🔊</button>` : ""}</h3>
            ${entry.meanings.slice(0, 4).map((m) => `<p style="margin:6px 0 2px"><i>${esc(m.partOfSpeech)}</i></p><ol class="small" style="margin:0;padding-left:20px">${m.definitions.slice(0, 3).map((d) =>
              `<li>${esc(d.definition)}${d.example ? `<br><span class="muted">"${esc(d.example)}"</span>` : ""}</li>`).join("")}</ol>`).join("")}` : ""}
            ${syns.length ? `<p style="margin:10px 0 4px"><b>Thesaurus</b> <span class="small muted">(words that mean the same)</span></p>
              <p class="small">${syns.map((s) => `<a href="#" data-w="${esc(s)}">${esc(s)}</a>`).join(" · ")}</p>` : ""}`;
          out.querySelector("#say")?.addEventListener("click", () => new Audio(audio).play().catch(() => {}));
        }
        out.querySelectorAll("[data-w]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); look(a.dataset.w); }));
      };
      body.querySelector("#df").onsubmit = (e) => { e.preventDefault(); const w = e.target.querySelector("input").value.trim().toLowerCase(); if (w) look(w); };
      body.querySelector("#wotd").onclick = (e) => { e.preventDefault(); look(today); };
      look(word || today);
    },
  });
}

// ======================= Recipes (TheMealDB) =======================
const MEAL = "https://www.themealdb.com/api/json/v1/1";
export function openRecipes() {
  openWindow("recipes", {
    title: "Recipes", icon: "🍳", width: 420, height: 520, keyword: "recipes",
    render(body) {
      const cats = ["Chicken", "Beef", "Seafood", "Pasta", "Vegetarian", "Breakfast", "Dessert", "Pork", "Side"];
      body.innerHTML = `<form class="row" id="rf"><input placeholder="Search recipes (tacos, wings…)" style="flex:1"><button class="btn primary small-btn">Search</button></form>
        <div class="row" style="justify-content:flex-start;gap:4px;margin:6px 0;flex-wrap:wrap">
          <button class="btn small-btn" data-r="__random">🎲 Surprise Me</button>
          ${cats.map((c) => `<button class="btn small-btn" data-r="${c}">${c}</button>`).join("")}</div>
        <div id="rr"></div>`;
      const out = body.querySelector("#rr");
      const grid = (meals) => {
        out.innerHTML = meals?.length ? `<div class="recipe-grid">${meals.slice(0, 24).map((m) =>
          `<button class="recipe-tile" data-id="${m.idMeal}"><img src="${esc(m.strMealThumb)}/preview" alt="" loading="lazy"><span>${esc(m.strMeal)}</span></button>`).join("")}</div>`
          : `<p class="muted">No recipes found. Try another word.</p>`;
        out.querySelectorAll("[data-id]").forEach((b) => (b.onclick = () => showRecipe(b.dataset.id)));
      };
      const load = async (url) => {
        out.innerHTML = `<p class="muted">🍳 Cooking up results…</p>`;
        try { grid((await getJSON(url)).meals); } catch { out.innerHTML = oops("The recipe box"); }
      };
      body.querySelector("#rf").onsubmit = (e) => { e.preventDefault(); const q = e.target.querySelector("input").value.trim(); if (q) load(`${MEAL}/search.php?s=${encodeURIComponent(q)}`); };
      body.querySelectorAll("[data-r]").forEach((b) => (b.onclick = async () => {
        if (b.dataset.r === "__random") {
          try { const m = (await getJSON(`${MEAL}/random.php`)).meals[0]; showRecipe(m.idMeal, m); } catch { out.innerHTML = oops("The recipe box"); }
        } else load(`${MEAL}/filter.php?c=${encodeURIComponent(b.dataset.r)}`);
      }));
      load(`${MEAL}/filter.php?c=Chicken`);
    },
  });
}

async function showRecipe(id, meal = null) {
  try { meal = meal || (await getJSON(`${MEAL}/lookup.php?i=${id}`)).meals[0]; } catch { alert("Couldn't load that recipe."); return; }
  const ingredients = [];
  for (let i = 1; i <= 20; i++) {
    const ing = (meal["strIngredient" + i] || "").trim();
    if (ing) ingredients.push(`${(meal["strMeasure" + i] || "").trim()} ${ing}`.trim());
  }
  openWindow("recipe." + meal.idMeal, {
    title: meal.strMeal, icon: "🍽", width: 400, height: 520,
    render(body) {
      body.innerHTML = `<img src="${esc(meal.strMealThumb)}" alt="" style="width:100%;max-height:200px;object-fit:cover;border-radius:10px">
        <p class="small muted">${esc([meal.strArea, meal.strCategory].filter(Boolean).join(" · "))}</p>
        <h4 style="margin:6px 0">🛒 Ingredients</h4><ul class="small" style="margin:0;padding-left:18px">${ingredients.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
        <h4 style="margin:10px 0 4px">👩‍🍳 Directions</h4><div class="small" style="white-space:pre-wrap">${esc(meal.strInstructions || "")}</div>
        <div class="row" style="margin-top:10px;justify-content:flex-start;gap:4px">
          ${meal.strYoutube ? `<button class="btn small-btn" data-x="vid">▶️ Watch Video</button>` : ""}
          <button class="btn small-btn" data-x="mail">✉️ Mail to a Friend</button></div>`;
      body.querySelector("[data-x=vid]")?.addEventListener("click", () => openBrowser(meal.strYoutube));
      body.querySelector("[data-x=mail]").onclick = () => writeMail("", "Recipe: " + meal.strMeal,
        `Check out this recipe!\n\n${meal.strMeal}\n\nIngredients:\n${ingredients.map((x) => "• " + x).join("\n")}\n\n${meal.strInstructions || ""}`);
    },
  });
}

// ======================= Reminders =======================
function nthWeekday(y, m, weekday, n) {   // n = 1..4, or -1 for last
  if (n > 0) { const d = new Date(y, m, 1); d.setDate(1 + ((weekday - d.getDay() + 7) % 7) + (n - 1) * 7); return d; }
  const d = new Date(y, m + 1, 0); d.setDate(d.getDate() - ((d.getDay() - weekday + 7) % 7)); return d;
}
function holidays(y) {
  const f = (m, d) => new Date(y, m, d);
  return [
    ["🎆 New Year's Day", f(0, 1)], ["✊ MLK Day", nthWeekday(y, 0, 1, 3)], ["💘 Valentine's Day", f(1, 14)], ["🍀 St. Patrick's Day", f(2, 17)],
    ["🃏 April Fools' Day", f(3, 1)], ["💐 Mother's Day", nthWeekday(y, 4, 0, 2)], ["🇺🇸 Memorial Day", nthWeekday(y, 4, 1, -1)],
    ["👔 Father's Day", nthWeekday(y, 5, 0, 3)], ["✊🏿 Juneteenth", f(5, 19)], ["🎇 Fourth of July", f(6, 4)], ["🛠 Labor Day", nthWeekday(y, 8, 1, 1)],
    ["🎃 Halloween", f(9, 31)], ["🎖 Veterans Day", f(10, 11)], ["🦃 Thanksgiving", nthWeekday(y, 10, 4, 4)], ["🎄 Christmas", f(11, 25)], ["🥂 New Year's Eve", f(11, 31)],
  ];
}
const daysUntil = (date) => Math.round((new Date(date.getFullYear(), date.getMonth(), date.getDate()) - new Date(new Date().toDateString())) / 86400000);
function nextDate(month, day) {
  const now = new Date();
  let d = new Date(now.getFullYear(), month - 1, day);
  if (daysUntil(d) < 0) d = new Date(now.getFullYear() + 1, month - 1, day);
  return d;
}
const whenText = (n) => (n === 0 ? "<b>today!</b>" : n === 1 ? "<b>tomorrow</b>" : `in ${n} days`);
let reminders = {};
let remRef = null;

function upcoming(maxDays) {
  const y = new Date().getFullYear();
  const mine = Object.entries(reminders).map(([id, r]) => {
    const d = nextDate(r.month, r.day);
    return { id, label: `${r.kind === "birthday" ? "🎂" : r.kind === "anniversary" ? "💍" : "📌"} ${r.title}`, date: d, n: daysUntil(d), mine: true };
  });
  const hol = [...holidays(y), ...holidays(y + 1)].map(([label, date]) => ({ label, date, n: daysUntil(date) })).filter((h) => h.n >= 0);
  return [...mine, ...hol].filter((x) => x.n <= maxDays).sort((a, b) => a.n - b.n);
}

export function watchReminders() {
  remRef = ref(db, `reminders/${uid()}`);
  let first = true;
  onValue(remRef, (s) => {
    reminders = s.val() || {};
    if (getWindow("reminders")) paintReminders(getWindow("reminders").body);
    if (!first) return;
    first = false;
    const soon = upcoming(7).filter((x) => x.mine || x.n <= 2);
    const shownKey = "du.reminded." + uid();
    if (soon.length && localStorage.getItem(shownKey) !== todayKey()) {
      localStorage.setItem(shownKey, todayKey());
      setTimeout(() => {
        sfx.alertBlip();
        openWindow("remind.alert", {
          title: "Reminder", icon: "⏰", width: 300, height: 240,
          render(body) {
            body.innerHTML = `<p style="margin-top:0"><b>⏰ Coming up:</b></p><ul class="list">${soon.map((x) => `<li>${esc(x.label)} — ${whenText(x.n)}</li>`).join("")}</ul>
              <div class="row" style="margin-top:8px"><button class="btn small-btn" data-x="card">💌 Send a Card</button><button class="btn primary small-btn" data-x="ok">OK</button></div>`;
            body.querySelector("[data-x=ok]").onclick = () => closeWindow("remind.alert");
            body.querySelector("[data-x=card]").onclick = () => { closeWindow("remind.alert"); import("./portal.js").then((m) => m.runKeyword("greetings")); };
          },
        });
      }, 4000);
    }
  });
}
export function stopReminders() { if (remRef) off(remRef); remRef = null; reminders = {}; }

export function openReminders() {
  openWindow("reminders", {
    title: "Reminders", icon: "⏰", width: 360, height: 500, keyword: "reminders",
    render: (body) => paintReminders(body),
  });
}

function paintReminders(body) {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const list = upcoming(400);
  body.innerHTML = `<p class="small" style="margin-top:0">Never forget a birthday. You'll get a pop-up when you sign on in the week before.</p>
    <form id="remf" class="panel">
      <label>What? <input id="rt" placeholder="Jerry's birthday" maxlength="60" required></label>
      <div class="row" style="gap:4px">
        <select id="rk"><option value="birthday">🎂 Birthday</option><option value="anniversary">💍 Anniversary</option><option value="other">📌 Other</option></select>
        <select id="rm">${months.map((m, i) => `<option value="${i + 1}">${m}</option>`).join("")}</select>
        <select id="rd">${Array.from({ length: 31 }, (_, i) => `<option>${i + 1}</option>`).join("")}</select>
        <button class="btn primary small-btn">Add</button></div></form>
    <h4 style="margin:10px 0 4px">📅 Coming Up</h4>
    <ul class="list">${list.slice(0, 30).map((x) => `<li class="row"><span>${esc(x.label)} <span class="small muted">${x.date.toLocaleDateString([], { month: "short", day: "numeric" })}</span></span>
      <span class="small">${x.n === 0 ? "Today!" : x.n === 1 ? "Tomorrow" : `${x.n} days`} ${x.mine ? `<a href="#" data-del="${x.id}" title="Delete">✖</a>` : ""}</span></li>`).join("")}</ul>`;
  const now = new Date();
  body.querySelector("#rm").value = now.getMonth() + 1;
  body.querySelector("#rd").value = now.getDate();
  body.querySelector("#remf").onsubmit = async (e) => {
    e.preventDefault();
    try {
      await push(ref(db, `reminders/${uid()}`), { title: body.querySelector("#rt").value.trim(), kind: body.querySelector("#rk").value,
        month: Number(body.querySelector("#rm").value), day: Number(body.querySelector("#rd").value) });
    } catch { alert("Couldn't save the reminder."); }
  };
  body.querySelectorAll("[data-del]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); remove(ref(db, `reminders/${uid()}/${a.dataset.del}`)); }));
}

// ======================= Classifieds =======================
const adCats = ["For Sale", "Wanted", "Music Gear", "Tickets", "Gigs & Jobs", "Services", "Housing", "Free Stuff"];
export function openClassifieds() {
  let r = null;
  let cat = "All";
  openWindow("classifieds", {
    title: "Classifieds", icon: "🏷", width: 420, height: 520, keyword: "classifieds",
    onClose: () => r && off(r),
    render(body) {
      body.innerHTML = `<div class="row" style="justify-content:flex-start;gap:4px;flex-wrap:wrap;margin-bottom:6px">
          ${["All", ...adCats].map((c) => `<button class="btn small-btn ${c === "All" ? "primary" : ""}" data-c="${c}">${c}</button>`).join("")}</div>
        <div class="row" style="margin-bottom:6px"><span class="small muted">Ads stay up for 30 days. Meet in public, never send money ahead.</span>
          <button class="btn primary small-btn" id="postad">+ Post an Ad</button></div><div id="ads"><p class="muted">Loading ads…</p></div>`;
      let all = {};
      const paint = () => {
        const list = Object.entries(all).filter(([, a]) => Date.now() - (a.ts || 0) < 30 * 86400000 && (cat === "All" || a.cat === cat))
          .sort((a, b) => (b[1].ts || 0) - (a[1].ts || 0));
        const el = body.querySelector("#ads");
        el.innerHTML = list.length ? list.map(([id, a]) => `<div class="panel ad">
            <div class="row"><b>${esc(a.title)}</b>${a.price ? `<span class="ad-price">${esc(a.price)}</span>` : ""}</div>
            <p class="small" style="white-space:pre-wrap;margin:4px 0">${esc(a.body)}</p>
            <div class="row small"><span class="muted">${esc(a.cat)} · ${esc(a.fromName)} · ${timeAgo(a.ts)}</span>
              <span>${a.from === uid() ? `<a href="#" data-del="${id}">Delete</a>` : `<a href="#" data-im="${a.from}">💬 IM</a> · <a href="#" data-mail="${esc(a.fromName)}" data-t="${esc(a.title)}">✉️ Mail</a>`}</span></div></div>`).join("")
          : `<p class="muted">No ads here yet. Be the first!</p>`;
        el.querySelectorAll("[data-del]").forEach((x) => (x.onclick = (e) => { e.preventDefault(); if (confirm("Delete your ad?")) remove(ref(db, `classifieds/${x.dataset.del}`)); }));
        el.querySelectorAll("[data-im]").forEach((x) => (x.onclick = (e) => { e.preventDefault(); openIM(x.dataset.im); }));
        el.querySelectorAll("[data-mail]").forEach((x) => (x.onclick = (e) => { e.preventDefault(); writeMail(x.dataset.mail, "Re: your ad — " + x.dataset.t); }));
      };
      r = ref(db, "classifieds");
      onValue(r, (s) => { all = s.val() || {}; paint(); });
      body.querySelectorAll("[data-c]").forEach((b) => (b.onclick = () => {
        cat = b.dataset.c;
        body.querySelectorAll("[data-c]").forEach((x) => x.classList.toggle("primary", x === b));
        paint();
      }));
      body.querySelector("#postad").onclick = postAd;
    },
  });
}

function postAd() {
  openWindow("classifieds.new", {
    title: "Post an Ad", icon: "🏷", width: 340, height: 420,
    render(body) {
      body.innerHTML = `<form id="af"><label>Category <select id="ac">${adCats.map((c) => `<option>${c}</option>`).join("")}</select></label>
        <label>Title <input id="at" maxlength="80" required placeholder="Pioneer DJ controller, barely used"></label>
        <label>Price (optional) <input id="ap" maxlength="20" placeholder="$250"></label>
        <label>Details <textarea id="ab" rows="5" maxlength="1000" required></textarea></label>
        <div class="row"><span class="small muted">People reply by IM or Mail.</span><button class="btn primary">Post Ad</button></div></form>`;
      body.querySelector("#af").onsubmit = async (e) => {
        e.preventDefault();
        const v = (id) => body.querySelector(id).value.trim();
        try {
          await push(ref(db, "classifieds"), { cat: v("#ac"), title: v("#at"), price: v("#ap"), body: v("#ab"), from: uid(), fromName: me().screenName, ts: serverTimestamp() });
          closeWindow("classifieds.new");
        } catch { alert("Couldn't post your ad right now."); }
      };
    },
  });
}

// ======================= Live Events (Auditorium) =======================
let eventsRef = null, events = {}, eventTimer = null;
const rsvpKey = () => "du.rsvp." + uid();
const myRsvps = () => new Set(JSON.parse(localStorage.getItem(rsvpKey()) || "[]"));
const roomFor = (ev) => "Live " + ev.title.replace(/[^\w ]/g, "").slice(0, 30);
const isLive = (ev) => Date.now() >= ev.start - 10 * 60000 && Date.now() <= ev.start + (ev.hours || 2) * 3600000;

export function watchEvents() {
  eventsRef = ref(db, "events");
  onValue(eventsRef, (s) => { events = s.val() || {}; const w = getWindow("events"); if (w) paintEvents(w.body); });
  clearInterval(eventTimer);
  eventTimer = setInterval(() => {
    const told = JSON.parse(sessionStorage.getItem("du.evtold") || "[]");
    for (const id of myRsvps()) {
      const ev = events[id];
      if (!ev || told.includes(id) || Date.now() < ev.start - 5 * 60000 || Date.now() > ev.start + 3600000) continue;
      told.push(id);
      sessionStorage.setItem("du.evtold", JSON.stringify(told));
      sfx.alertBlip();
      openWindow("event.alert." + id, {
        title: "Live Event Starting", icon: "🎤", width: 300, height: 200,
        render(body) {
          body.innerHTML = `<p style="margin-top:0">🎤 <b>${esc(ev.title)}</b> is starting now, hosted by ${esc(ev.hostName)}.</p>
            <div class="row"><button class="btn small-btn" data-x="no">Later</button><button class="btn primary small-btn" data-x="go">Join Now</button></div>`;
          body.querySelector("[data-x=no]").onclick = () => closeWindow("event.alert." + id);
          body.querySelector("[data-x=go]").onclick = () => { closeWindow("event.alert." + id); openRoom(roomFor(ev), "Live Events"); };
        },
      });
    }
  }, 30000);
}
export function stopEvents() { if (eventsRef) off(eventsRef); eventsRef = null; clearInterval(eventTimer); }

export function openEvents() {
  openWindow("events", {
    title: "Live Events", icon: "🎤", width: 400, height: 500, keyword: "events",
    render: (body) => paintEvents(body),
  });
}

function paintEvents(body) {
  const rs = myRsvps();
  const list = Object.entries(events).filter(([, e]) => e.start + (e.hours || 2) * 3600000 > Date.now()).sort((a, b) => a[1].start - b[1].start);
  body.innerHTML = `<div class="row" style="margin-bottom:6px"><span class="small">Scheduled live chats: DJ sets, watch parties, Q&As and game nights.</span>
      <button class="btn primary small-btn" id="newev">+ Host an Event</button></div>
    ${list.length ? list.map(([id, e]) => `<div class="panel ev ${isLive(e) ? "live" : ""}">
      <div class="row"><b>${isLive(e) ? "🔴 LIVE · " : "🎤 "}${esc(e.title)}</b></div>
      <p class="small" style="margin:2px 0">${new Date(e.start).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · hosted by ${esc(e.hostName)}</p>
      ${e.desc ? `<p class="small" style="margin:2px 0;white-space:pre-wrap">${esc(e.desc)}</p>` : ""}
      <div class="row small" style="justify-content:flex-start;gap:4px;margin-top:4px">
        ${isLive(e) ? `<button class="btn primary small-btn" data-join="${id}">Join Now</button>` : `<button class="btn small-btn" data-rsvp="${id}">${rs.has(id) ? "✅ I'm Going" : "🔔 Remind Me"}</button>`}
        ${e.host === uid() ? `<a href="#" data-del="${id}">Cancel event</a>` : ""}</div></div>`).join("")
      : `<p class="muted">No events scheduled yet. Host one and invite everybody!</p>`}`;
  body.querySelector("#newev").onclick = newEvent;
  body.querySelectorAll("[data-join]").forEach((b) => (b.onclick = () => openRoom(roomFor(events[b.dataset.join]), "Live Events")));
  body.querySelectorAll("[data-rsvp]").forEach((b) => (b.onclick = () => {
    const s = myRsvps();
    s.has(b.dataset.rsvp) ? s.delete(b.dataset.rsvp) : s.add(b.dataset.rsvp);
    localStorage.setItem(rsvpKey(), JSON.stringify([...s]));
    paintEvents(body);
  }));
  body.querySelectorAll("[data-del]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); if (confirm("Cancel this event?")) remove(ref(db, `events/${a.dataset.del}`)); }));
}

function newEvent() {
  openWindow("events.new", {
    title: "Host a Live Event", icon: "🎤", width: 340, height: 430,
    render(body) {
      const d = new Date(Date.now() + 3600000);
      d.setMinutes(0, 0, 0);
      const local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
      body.innerHTML = `<form id="ef"><label>Event name <input id="et" maxlength="60" required placeholder="Friday Night Mix Session"></label>
        <label>When <input id="ew" type="datetime-local" value="${local}" required></label>
        <label>How long <select id="eh"><option value="1">1 hour</option><option value="2" selected>2 hours</option><option value="3">3 hours</option></select></label>
        <label>What's it about? <textarea id="ed" rows="4" maxlength="400"></textarea></label>
        <div class="row"><span class="small muted">Everyone on DialedUp can see it.</span><button class="btn primary">Schedule</button></div></form>`;
      body.querySelector("#ef").onsubmit = async (e) => {
        e.preventDefault();
        const start = new Date(body.querySelector("#ew").value).getTime();
        if (!start || start < Date.now() - 3600000) { alert("Pick a time in the future."); return; }
        try {
          const r = await push(ref(db, "events"), { title: body.querySelector("#et").value.trim(), desc: body.querySelector("#ed").value.trim(), start,
            hours: Number(body.querySelector("#eh").value), host: uid(), hostName: me().screenName, ts: serverTimestamp() });
          const s = myRsvps(); s.add(r.key); localStorage.setItem(rsvpKey(), JSON.stringify([...s]));
          closeWindow("events.new");
        } catch { alert("Couldn't schedule the event right now."); }
      };
    },
  });
}

// ======================= Today (history + picture of the day) =======================
export function openToday() {
  openWindow("today", {
    title: "Today on DialedUp", icon: "📅", width: 420, height: 520, keyword: "today",
    render(body) {
      const d = new Date();
      body.innerHTML = `<h3 style="margin:0">${d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</h3>
        <div id="tp"></div><h4 style="margin:10px 0 4px">📜 Today in History</h4><ul class="list" id="th"><li class="muted">Loading…</li></ul>`;
      const y = d.getUTCFullYear(), m = pad(d.getUTCMonth() + 1), day = pad(d.getUTCDate());
      getJSON(`https://api.wikimedia.org/feed/v1/wikipedia/en/featured/${y}/${m}/${day}`).then((j) => {
        if (j.image?.thumbnail?.source) {
          body.querySelector("#tp").innerHTML = `<h4 style="margin:10px 0 4px">📷 Picture of the Day</h4>
            <img src="${esc(j.image.thumbnail.source)}" alt="" style="width:100%;max-height:240px;object-fit:cover;border-radius:10px">
            <p class="small muted" style="margin:2px 0">${esc((j.image.description?.text || "").replace(/<[^>]+>/g, "").slice(0, 220))}</p>`;
        }
        const events = (j.onthisday || []).slice(0, 15);
        body.querySelector("#th").innerHTML = events.length ? events.map((e) => {
          const page = e.pages?.[0]?.content_urls?.desktop?.page;
          return `<li><b>${e.year}</b> — ${esc(e.text)}${page ? ` <a href="${esc(page)}" data-browse class="small">more</a>` : ""}</li>`;
        }).join("") : `<li class="muted">Nothing found for today.</li>`;
      }).catch(() => (body.querySelector("#th").innerHTML = `<li>${oops("Today in History")}</li>`));
    },
  });
}

// ======================= Lottery (NY Open Data) =======================
export function openLottery() {
  openWindow("lottery", {
    title: "Lottery Results", icon: "🎰", width: 360, height: 460, keyword: "lottery",
    render(body) {
      body.innerHTML = `<div id="lp"><p class="muted">Checking the latest drawings…</p></div>
        <p class="small muted">Official numbers come from the New York Lottery's open data. Always double-check your ticket with the lottery.</p>`;
      const games = [
        ["🔴 Powerball", "https://data.ny.gov/resource/d6yy-54nr.json?$order=draw_date%20DESC&$limit=5", (r) => r.winning_numbers, (r) => r.multiplier ? `Power Play ${r.multiplier}x` : ""],
        ["🟡 Mega Millions", "https://data.ny.gov/resource/5xaw-6ayf.json?$order=draw_date%20DESC&$limit=5", (r) => `${r.winning_numbers} ${r.mega_ball || ""}`, (r) => r.multiplier ? `Megaplier ${r.multiplier}x` : ""],
      ];
      Promise.all(games.map(async ([label, url, nums, extra]) => {
        try {
          const rows = await getJSON(url);
          return `<h4 style="margin:8px 0 4px">${label}</h4>${rows.map((r, i) => {
            const balls = String(nums(r)).trim().split(/\s+/);
            return `<div class="lotto-row ${i ? "" : "latest"}"><span class="small">${new Date(r.draw_date).toLocaleDateString([], { month: "short", day: "numeric" })}</span>
              <span>${balls.map((b, k) => `<i class="ball ${k === balls.length - 1 ? "bonus" : ""}">${esc(b)}</i>`).join("")}</span><span class="small muted">${esc(extra(r))}</span></div>`;
          }).join("")}`;
        } catch { return `<h4 style="margin:8px 0 4px">${label}</h4>${oops("The lottery feed")}`; }
      })).then((parts) => (body.querySelector("#lp").innerHTML = parts.join("")));
    },
  });
}
