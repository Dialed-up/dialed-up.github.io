// Real, live content from free public sources: headlines, scores and space news.
const cacheGet = (k, maxAgeMs) => {
  try {
    const v = JSON.parse(sessionStorage.getItem(k) || "null");
    return v && Date.now() - v.t < maxAgeMs ? v.d : null;
  } catch { return null; }
};
const cacheSet = (k, d) => { try { sessionStorage.setItem(k, JSON.stringify({ t: Date.now(), d })); } catch {} };

async function getJSON(url, ms = 8000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error(r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

const strip = (html) => String(html || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

// ---------- Headlines ----------
async function wikipediaNews() {
  // Today's list can be missing early in the day, so fall back to yesterday and the day before.
  for (let back = 0; back < 3; back++) {
    const d = new Date(Date.now() - back * 86400000);
    const y = d.getUTCFullYear(), m = String(d.getUTCMonth() + 1).padStart(2, "0"), day = String(d.getUTCDate()).padStart(2, "0");
    try {
      const j = await getJSON(`https://api.wikimedia.org/feed/v1/wikipedia/en/featured/${y}/${m}/${day}`);
      if (j.news?.length) {
        return j.news.slice(0, 8).map((n) => {
          const link = n.links?.[0];
          return { title: strip(n.story), url: link?.content_urls?.desktop?.page, image: link?.thumbnail?.source,
            source: "World", color: "#e53935" };
        });
      }
    } catch {}
  }
  return [];
}

const espnLeagues = [
  ["basketball/nba", "NBA", "#ff8a3d"], ["football/nfl", "NFL", "#2e7d32"], ["baseball/mlb", "MLB", "#1565c0"],
  ["hockey/nhl", "NHL", "#37474f"], ["soccer/eng.1", "Soccer", "#6a1b9a"], ["football/college-football", "College", "#8d6e63"],
];

async function espnNews() {
  const lists = await Promise.allSettled(espnLeagues.map(async ([path, label, color]) => {
    const j = await getJSON(`https://site.api.espn.com/apis/site/v2/sports/${path}/news?limit=6`);
    return (j.articles || [])
      .filter((a) => a.type !== "Media" && !/highlights?$/i.test(a.headline || ""))
      .slice(0, 4)
      .map((a) => ({ title: a.headline, url: a.links?.web?.href, image: a.images?.[0]?.url, source: label, color,
        ts: Date.parse(a.published) || 0, blurb: a.description }));
  }));
  return lists.flatMap((r) => (r.status === "fulfilled" ? r.value : [])).sort((a, b) => b.ts - a.ts);
}

async function techNews() {
  try {
    const ids = (await getJSON("https://hacker-news.firebaseio.com/v0/topstories.json")).slice(0, 10);
    const items = await Promise.all(ids.map((id) => getJSON(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).catch(() => null)));
    return items.filter(Boolean).map((s) => ({ title: s.title, url: s.url || `https://news.ycombinator.com/item?id=${s.id}`,
      source: "Tech", color: "#00a68c", ts: (s.time || 0) * 1000 }));
  } catch { return []; }
}

async function spaceNews() {
  try {
    const j = await getJSON("https://api.spaceflightnewsapi.net/v4/articles/?limit=8");
    return (j.results || []).map((a) => ({ title: a.title, url: a.url, image: a.image_url, source: "Space", color: "#3949ab",
      ts: Date.parse(a.published_at) || 0, blurb: a.summary }));
  } catch { return []; }
}

/** { world, sports, tech, space, top } — top mixes the best of each. */
export async function getHeadlines() {
  const cached = cacheGet("du.news", 10 * 60 * 1000);
  if (cached) return cached;
  const [world, sports, tech, space] = await Promise.all([wikipediaNews(), espnNews(), techNews(), spaceNews()]);
  const top = [];
  const pools = [world, sports, tech, space].map((p) => [...p]);
  while (top.length < 14 && pools.some((p) => p.length)) pools.forEach((p) => p.length && top.push(p.shift()));
  const out = { world, sports, tech, space, top };
  if (top.length) cacheSet("du.news", out);
  return out;
}

// ---------- Scores ----------
export async function getScores() {
  const cached = cacheGet("du.scores", 2 * 60 * 1000);
  if (cached) return cached;
  const leagues = [["basketball/nba", "NBA"], ["football/nfl", "NFL"], ["hockey/nhl", "NHL"], ["baseball/mlb", "MLB"]];
  const res = await Promise.allSettled(leagues.map(async ([path, label]) => {
    const j = await getJSON(`https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard`);
    return (j.events || []).map((ev) => {
      const c = ev.competitions[0];
      const home = c.competitors.find((x) => x.homeAway === "home"), away = c.competitors.find((x) => x.homeAway === "away");
      const state = ev.status.type.state;   // pre | in | post
      return { league: label, state, away: away.team.abbreviation, home: home.team.abbreviation,
        as: away.score, hs: home.score, detail: ev.status.type.shortDetail };
    });
  }));
  const games = res.flatMap((r) => (r.status === "fulfilled" ? r.value : []))
    .sort((a, b) => ({ in: 0, post: 1, pre: 2 }[a.state] - { in: 0, post: 1, pre: 2 }[b.state]));
  cacheSet("du.scores", games);
  return games;
}

export const scoreText = (g) => g.state === "pre"
  ? `${g.league}: ${g.away} @ ${g.home} · ${g.detail}`
  : `${g.league}: ${g.away} ${g.as} – ${g.home} ${g.hs} · ${g.state === "in" ? "🔴 " : ""}${g.detail}`;

export function timeAgo(ts) {
  if (!ts) return "";
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
}
