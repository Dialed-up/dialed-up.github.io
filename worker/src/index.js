// DialedUp push sender (Cloudflare Worker).
// Phones register here; when someone sends an IM or mail, their app asks this Worker to alert the
// recipient. Every request is checked against the DialedUp database with the sender's own sign-in,
// so nobody can send fake or spam alerts.
import { buildPushPayload } from "@block65/webcrypto-web-push";

const DB = "https://buddychat-48c0b-default-rtdb.firebaseio.com";
const ORIGINS = ["https://dialedup.lol", "https://www.dialedup.lol", "https://dialed-up.github.io", "http://localhost:8765"];

const cors = (req) => {
  const o = req.headers.get("origin") || "";
  return {
    "access-control-allow-origin": ORIGINS.includes(o) || o.endsWith(".dialed-up.github.io") ? o : ORIGINS[0],
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
  };
};
const json = (req, data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...cors(req) } });

/** Reads the uid out of a Firebase sign-in token (the database itself checks the token is real). */
function uidOf(token) {
  try {
    const p = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof p.user_id === "string" && /^[A-Za-z0-9]{10,40}$/.test(p.user_id) ? p.user_id : null;
  } catch { return null; }
}
async function dbGet(path, token) {
  try {
    const r = await fetch(`${DB}/${path}.json?auth=${encodeURIComponent(token)}`);
    if (!r.ok) return { ok: false, status: r.status };
    return { ok: true, val: await r.json() };
  } catch { return { ok: false, status: 502 }; }
}
const hash = async (s) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
const clip = (s, n) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);

async function sendTo(env, uid, note, skipDevice = null) {
  const list = await env.SUBS.list({ prefix: `sub:${uid}:` });
  const results = [];
  const vapid = { subject: "https://dialedup.lol", publicKey: env.VAPID_PUBLIC, privateKey: env.VAPID_PRIVATE };
  let sent = 0;
  await Promise.all(list.keys.map(async ({ name }) => {
    if (skipDevice && name.endsWith(":" + skipDevice)) { results.push("skipped: open on that device"); return; }
    const sub = await env.SUBS.get(name, "json");
    if (!sub) return;
    try {
      const payload = await buildPushPayload({ data: JSON.stringify(note), options: { ttl: 3600, urgency: "high", topic: note.tag?.slice(0, 32) } }, sub, vapid);
      const r = await fetch(sub.endpoint, payload);
      results.push(`${new URL(sub.endpoint).host}:${r.status}`);
      if (r.status === 404 || r.status === 410) await env.SUBS.delete(name);
      else if (r.ok) sent++;
    } catch (e) { results.push("error:" + String(e?.message || e).slice(0, 60)); }
  }));
  return { sent, phones: list.keys.length, results };
}

/** Simple per-sender limit: 30 alerts a minute. */
async function overLimit(env, uid) {
  const key = `rate:${uid}:${Math.floor(Date.now() / 60000)}`;
  const n = Number((await env.SUBS.get(key)) || 0);
  if (n >= 30) return true;
  await env.SUBS.put(key, String(n + 1), { expirationTtl: 120 });
  return false;
}

export default {
  async fetch(req, env, ctx) {
    if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/") return json(req, { ok: true, service: "DialedUp push" });
    if (req.method !== "POST") return json(req, { error: "not found" }, 404);
    let body;
    try { body = await req.json(); } catch { return json(req, { error: "bad request" }, 400); }
    const token = String(body.token || "");
    const me = uidOf(token);
    if (!me) return json(req, { error: "sign in first" }, 401);

    // ----- A phone signs up for alerts -----
    if (url.pathname === "/subscribe" || url.pathname === "/unsubscribe") {
      const sub = body.sub;
      if (!sub?.endpoint || !/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) return json(req, { error: "bad subscription" }, 400);
      const check = await dbGet(`users/${me}/screenName`, token);   // proves the token is real and theirs
      if (!check.ok) return json(req, { error: "not signed in" }, 401);
      const key = `sub:${me}:${await hash(sub.endpoint)}`;
      if (url.pathname === "/unsubscribe") { await env.SUBS.delete(key); return json(req, { ok: true }); }
      // One phone per site per person: drop older sign-ups from this same site (e.g. a deleted Home Screen app)
      const site = req.headers.get("origin") || "";
      const mine = await env.SUBS.list({ prefix: `sub:${me}:` });
      for (const k of mine.keys) if (k.name !== key && k.metadata?.site === site && k.metadata?.device === String(body.device || "")) await env.SUBS.delete(k.name);
      await env.SUBS.put(key, JSON.stringify({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }),
        { expirationTtl: 60 * 60 * 24 * 90, metadata: { site, device: String(body.device || "").slice(0, 40), at: Date.now() } });
      return json(req, { ok: true });
    }

    // ----- "Send me a test alert" (arrives 10 seconds later so there's time to close the app) -----
    if (url.pathname === "/test") {
      const check = await dbGet(`users/${me}/screenName`, token);
      if (!check.ok) return json(req, { error: "not signed in" }, 401);
      if (await overLimit(env, me)) return json(req, { error: "slow down" }, 429);
      const phones = (await env.SUBS.list({ prefix: `sub:${me}:` })).keys.length;
      ctx.waitUntil(new Promise((r) => setTimeout(r, 10000)).then(async () => {
        const out = await sendTo(env, me, { title: "🔔 DialedUp test alert", body: "It works! You'll get alerts like this for new IMs and mail.", tag: "test", url: "./" });
        await env.SUBS.put(`last:${me}`, JSON.stringify({ at: new Date().toISOString(), kind: "test", ...out }), { expirationTtl: 86400 * 3 });
      }));
      return json(req, { ok: true, phones });
    }

    // ----- Someone sent an IM or mail: alert the recipient -----
    if (url.pathname === "/notify") {
      const to = String(body.to || "");
      if (!/^[A-Za-z0-9]{10,40}$/.test(to) || to === me) return json(req, { error: "bad recipient" }, 400);
      if (await overLimit(env, me)) return json(req, { error: "slow down" }, 429);
      const fresh = (ts) => typeof ts === "number" && Math.abs(Date.now() - ts) < 120000;
      let note;
      if (body.kind === "im") {
        const conv = [me, to].sort().join("_");
        const entry = await dbGet(`inbox/${me}/${conv}`, token);
        if (!entry.ok || !entry.val || entry.val.from !== me || entry.val.with !== to || !fresh(entry.val.ts)) return json(req, { error: "no such message" }, 403);
        const name = (await dbGet(`names/${me}`, token)).val || "A buddy";
        note = { title: `💬 ${clip(name, 24)}`, body: clip(entry.val.preview, 120) || "New Instant Message", tag: `im-${me}`, url: "./" };
      } else if (body.kind === "mail") {
        const sentId = String(body.sentId || "");
        if (!/^[-_A-Za-z0-9]{10,40}$/.test(sentId)) return json(req, { error: "bad mail" }, 400);
        const item = await dbGet(`mailsent/${me}/${sentId}`, token);
        if (!item.ok || !item.val || item.val.to !== to || !fresh(item.val.ts)) return json(req, { error: "no such mail" }, 403);
        const name = (await dbGet(`names/${me}`, token)).val || "Someone";
        note = { title: "📬 You have mail!", body: `From ${clip(name, 24)}: ${clip(item.val.subject, 80) || "(no subject)"}`, tag: "mail", url: "./" };
      } else return json(req, { error: "bad kind" }, 400);

      // Don't buzz the one device that has DialedUp open on screen right now; every other device still gets it.
      const them = await dbGet(`users/${to}`, token);
      const v = them.ok && them.val ? them.val : {};
      const openDevice = v.fg === true && typeof v.fgDev === "string" && /^[0-9a-f]{24}$/.test(v.fgDev) && Date.now() - (v.fgAt || 0) < 150000 ? v.fgDev : null;
      const log = (o) => env.SUBS.put(`last:${to}`, JSON.stringify({ at: new Date().toISOString(), kind: body.kind, from: me.slice(0, 5), ...o }), { expirationTtl: 86400 * 3 });

      const out = await sendTo(env, to, note, openDevice);
      await log(out);
      return json(req, { ok: true, ...out });
    }
    return json(req, { error: "not found" }, 404);
  },
};
