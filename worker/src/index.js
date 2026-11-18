// DialedUp push sender (Cloudflare Worker).
// Phones register here; when someone sends an IM or mail, their app asks this Worker to alert the
// recipient. Every request is checked against the DialedUp database with the sender's own sign-in,
// so nobody can send fake or spam alerts.
import { buildPushPayload } from "@block65/webcrypto-web-push";

const DB = "https://buddychat-48c0b-default-rtdb.firebaseio.com";
const ORIGINS = ["https://dialedup.lol", "https://www.dialedup.lol", "https://dialed-up.github.io"];
// File types that may be shown directly in the browser. Everything else downloads as a plain file.
const INLINE_TYPES = /^(image\/(jpeg|png|gif|webp|heic|heif)|video\/(mp4|webm|quicktime)|audio\/[a-z0-9.+-]+)$/;
const DAILY_FILES = 60, DAILY_BYTES = 300 * 1024 * 1024;   // per person, to stop storage abuse

const cors = (req) => {
  const o = req.headers.get("origin") || "";
  return {
    "access-control-allow-origin": ORIGINS.includes(o) ? o : ORIGINS[0],
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type, x-du-token, x-du-name, x-du-conv, range",
    "access-control-expose-headers": "content-length, content-range, accept-ranges",
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
async function dbGet(path, token, query = "") {
  try {
    const r = await fetch(`${DB}/${path}.json?${query}${query ? "&" : ""}auth=${encodeURIComponent(token)}`);
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

    // ----- Files people send in IMs (up to 25 MB, kept 24 hours) -----
    if (req.method === "GET" && url.pathname.startsWith("/f/")) {
      const id = url.pathname.slice(3);
      if (!/^[a-f0-9]{32}$/.test(id)) return new Response("not found", { status: 404, headers: cors(req) });
      const { value, metadata } = await env.SUBS.getWithMetadata(`file:${id}`, "arrayBuffer");
      if (!value) return new Response("This file has expired.", { status: 404, headers: cors(req) });
      const raw = String(metadata?.type || "").toLowerCase();
      const inline = INLINE_TYPES.test(raw);
      const base = { ...cors(req), "content-type": inline ? raw : "application/octet-stream", "accept-ranges": "bytes", "cache-control": "private, max-age=86400",
        "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(metadata?.name || "file")}`,
        "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox", "referrer-policy": "no-referrer" };
      const range = req.headers.get("range")?.match(/bytes=(\d*)-(\d*)/);
      if (range) {   // videos on iPhone need this
        const size = value.byteLength;
        const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
        const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
        if (start >= size || start > end) return new Response(null, { status: 416, headers: { ...base, "content-range": `bytes */${size}` } });
        return new Response(value.slice(start, end + 1), { status: 206, headers: { ...base, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) } });
      }
      return new Response(value, { headers: { ...base, "content-length": String(value.byteLength) } });
    }
    if (req.method === "POST" && url.pathname === "/upload") {
      const token = req.headers.get("x-du-token") || "";
      const me = uidOf(token);
      const conv = req.headers.get("x-du-conv") || "";
      const okConv = conv === "story" || (/^[A-Za-z0-9]{10,40}_[A-Za-z0-9]{10,40}$/.test(conv) && conv.split("_").includes(me));
      if (!me || !okConv) return json(req, { error: "not allowed" }, 403);
      const len = Number(req.headers.get("content-length") || 0);
      if (len > 25 * 1024 * 1024) return json(req, { error: "too big" }, 413);
      const check = await dbGet(`users/${me}/screenName`, token);
      if (!check.ok) return json(req, { error: "not signed in" }, 401);
      // daily allowance per person
      const qKey = `quota:${me}:${new Date().toISOString().slice(0, 10)}`;
      const q = (await env.SUBS.get(qKey, "json")) || { n: 0, b: 0 };
      if (q.n >= DAILY_FILES || q.b + len > DAILY_BYTES) return json(req, { error: "daily limit reached" }, 429);
      const buf = await req.arrayBuffer();
      if (buf.byteLength > 25 * 1024 * 1024) return json(req, { error: "too big" }, 413);
      await env.SUBS.put(qKey, JSON.stringify({ n: q.n + 1, b: q.b + buf.byteLength }), { expirationTtl: 60 * 60 * 26 });
      const id = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
      const name = decodeURIComponent(req.headers.get("x-du-name") || "file").slice(0, 100);
      await env.SUBS.put(`file:${id}`, buf, { expirationTtl: 60 * 60 * 24,
        metadata: { type: (req.headers.get("content-type") || "application/octet-stream").slice(0, 100), name, from: me, conv, size: buf.byteLength } });
      return json(req, { ok: true, url: `${url.origin}/f/${id}`, size: buf.byteLength });
    }
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
        // Check the real conversation: the newest message must be from the sender and brand new.
        // (Writing there already passes the database's block check, so blocked people can't send alerts.)
        const conv = [me, to].sort().join("_");
        const last = await dbGet(`messages/${conv}`, token, 'orderBy=%22%24key%22&limitToLast=1');
        const msg = last.ok && last.val ? Object.values(last.val)[0] : null;
        if (!msg || msg.from !== me || !fresh(msg.ts)) return json(req, { error: "no such message" }, 403);
        const name = (await dbGet(`names/${me}`, token)).val || "A homie";
        const preview = msg.media ? { photo: "📷 Photo", video: "🎬 Video", audio: "🎵 Audio" }[msg.media.kind] || "📎 File" : msg.text;
        note = { title: `💬 ${clip(name, 24)}`, body: clip(preview, 120) || "New Instant Message", tag: `im-${me}`, url: "./" };
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
