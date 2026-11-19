// DialedUp social: permanent Posts (photos + text) that live on your Wall, the Homie Feed, likes & comments,
// Homie Updates (24-hour stories), Top 8, and Report buttons.
import { auth, db, ref, get, set, push, remove, update, onValue, off, query, orderByKey, orderByChild, limitToLast, serverTimestamp } from "./firebase.js";
import { openWindow, closeWindow, getWindow, esc, img64, contextMenu } from "./wm.js";
import { me, userName, iconHTML, buddyList, openInfo, openIM } from "./chat.js";
import { pickEmoji } from "./emoji.js";
import { gifHTML } from "./gif.js";
import * as sfx from "./sounds.js";

export const OWNER = "Dh35JEPVTiWIB96X03RGeiVmQN03";
/** Whose posts show in your feed: you, your homies, and the site owner's posts (shared with every member). */
const feedPeople = () => [...new Set([uid(), OWNER, ...buddyList()])];
const FILES = "https://dialedup-push.stickyarcadecloud.workers.dev";
const uid = () => auth.currentUser.uid;
const ago = (ts) => {
  const m = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.floor(m / 60)}h`;
  if (m < 10080) return `${Math.floor(m / 1440)}d`;
  return new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" });
};
const linkify = (t) => esc(t).replace(/(https?:\/\/[^\s<]+)/g, (u) => `<a href="${esc(u)}" target="_blank" rel="noopener">${u}</a>`).replace(/\n/g, "<br>");

async function shrink(file, max = 960, q = 0.72) {
  let img;
  try { img = await createImageBitmap(file); }
  catch {   // some phones' photo formats: fall back to an <img>
    img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error("That photo type can't be opened. Try a JPG or PNG.")); i.src = URL.createObjectURL(file); });
  }
  const w = img.width || img.naturalWidth, h = img.height || img.naturalHeight;
  // Keep shrinking until it fits the database's size limit for one photo
  for (const [m, qq] of [[max, q], [800, 0.65], [640, 0.6], [480, 0.55]]) {
    const sc = Math.min(1, m / Math.max(w, h));
    const c = document.createElement("canvas");
    c.width = Math.round(w * sc); c.height = Math.round(h * sc);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    const b64 = c.toDataURL("image/jpeg", qq).split(",")[1];
    if (b64.length <= 250000) return b64;
  }
  throw new Error("That photo is too big. Try a smaller one.");
}

// =================== Posts ===================
/** Write a post on someone's Wall (your own Wall = a normal post). */
export async function createPost(owner, text, file, { pub = false } = {}) {
  const notifyAfter = (pid) => import("./notifs.js").then((m) => {
    if (owner !== uid() && !owner.startsWith("g_")) m.notify(owner, "wall", { owner, pid, text });
    m.notifyMentions(text, { owner, pid });
  });
  const pid = push(ref(db, `posts/${owner}`)).key;
  if (file) await set(ref(db, `postimgs/${owner}/${pid}`), await shrink(file));
  const isPublic = pub && owner === uid();   // only your own posts can be public
  await set(ref(db, `posts/${owner}/${pid}`), { by: uid(), n: me().screenName, text: String(text || "").slice(0, 1000), img: !!file, ts: serverTimestamp(), ...(isPublic ? { pub: true } : {}) });
  if (isPublic) await set(ref(db, `pubfeed/${owner}_${pid}`), { owner, pid, ts: serverTimestamp() }).catch(() => {});
  notifyAfter(pid);
  return pid;
}

// Your own posts can be edited for 2 minutes after posting
const EDIT_POST_MS = 2 * 60000;
async function editPost(owner, pid, p) {
  if (Date.now() - (p.ts || 0) > EDIT_POST_MS) { alert("Posts can only be edited for 2 minutes after posting."); return; }
  const t = prompt("Edit your post:", p.text || "");
  if (t === null || t.trim() === (p.text || "")) return;
  if (!t.trim() && !p.img) { alert("A post needs some words or a photo."); return; }
  update(ref(db, `posts/${owner}/${pid}`), { text: t.trim().slice(0, 1000), edited: true })
    .catch(() => alert("Couldn't edit it. The 2 minutes may be up."));
}

async function deletePost(owner, pid) {
  await remove(ref(db, `pubfeed/${owner}_${pid}`)).catch(() => {});
  await remove(ref(db, `postcomments/${owner}/${pid}`)).catch(() => {});
  await remove(ref(db, `postlikes/${owner}/${pid}`)).catch(() => {});
  await remove(ref(db, `postimgs/${owner}/${pid}`)).catch(() => {});
  await remove(ref(db, `posts/${owner}/${pid}`));
}

export function report(what, path, owner, preview) {
  const why = prompt(`Report this ${what}? Tell us what's wrong (optional):`, "");
  if (why === null) return;
  push(ref(db, "reports"), { by: uid(), byName: me().screenName, what, path, owner, preview: String(preview || "").slice(0, 200), why: why.slice(0, 200), ts: serverTimestamp() })
    .then(() => alert("Thanks — it's been reported. 🛡")).catch(() => alert("Couldn't send the report right now."));
}

/** One post card (live likes & comments). Returns a cleanup function. */
function postCard(el, owner, pid, p, label = null) {
  const refs = [];
  const mine = p.by === uid(), myWall = owner === uid() || (owner.startsWith("g_") && groupOwner[owner] === uid());
  el.className = "post";
  el.innerHTML = `<div class="post-head">${iconHTML(p.by, 34)}<div><b class="post-who" data-u="${esc(p.by)}">${esc(p.n || userName(p.by))}</b>
      ${p.by === OWNER && owner === OWNER ? `<span class="owner-tag" title="From the creator of DialedUp">⭐ DialedUp</span>` : ""}
      ${p.pub ? `<span class="aud-tag" title="Public: anyone on DialedUp can see this">🌍</span>` : p.by === owner && owner === uid() ? `<span class="aud-tag" title="Homies only">👥</span>` : ""}
      ${p.by !== owner && !label ? `<span class="small muted"> ▸ ${esc(userName(owner))}'s Wall</span>` : ""}<br><span class="small muted">${p.ts ? ago(p.ts) : ""}</span></div>
      <button class="post-more" title="More">⋯</button></div>
    ${p.text ? `<div class="post-text">${linkify(p.text)}${p.edited ? ` <span class="small muted">(edited)</span>` : ""}</div>` : ""}
    ${p.img ? `<div class="post-img"><span class="small muted">📷 Loading photo…</span></div>` : ""}
    <div class="post-bar"><button class="like">🤍 <span>0</span></button><button class="cmt">💬 <span>0</span></button></div>
    <div class="post-comments" hidden><ul class="clist"></ul>
      <form class="cform"><input placeholder="Write a comment…" maxlength="300"><button type="button" class="btn small-btn cgif" hidden title="Add a GIF"><b style="font-size:10px">GIF</b></button><button class="btn small-btn">Post</button></form></div>`;
  el.querySelector(".post-who").onclick = () => openInfo(p.by);
  if (p.img) get(ref(db, `postimgs/${owner}/${pid}`)).then((s) => {
    const box = el.querySelector(".post-img");
    if (!s.val()) { box.innerHTML = ""; return; }
    box.innerHTML = `<img src="${img64(s.val())}" alt="">`;
    box.querySelector("img").onclick = (e) => { const v = document.createElement("div"); v.className = "media-viewer"; v.innerHTML = `<img src="${esc(e.target.src)}" alt=""><button>✕</button>`; v.onclick = () => v.remove(); document.body.appendChild(v); };
    box.querySelector("img").ondblclick = () => toggleLike(true);
  }).catch(() => {});
  // likes
  let liked = false;
  const lr = ref(db, `postlikes/${owner}/${pid}`);
  onValue(lr, (s) => {
    const v = s.val() || {};
    liked = !!v[uid()];
    el.querySelector(".like").innerHTML = `${liked ? "❤️" : "🤍"} <span>${Object.keys(v).length}</span>`;
    el.querySelector(".like").title = Object.keys(v).map((u) => userName(u)).join(", ");
  }, () => {});
  refs.push(lr);
  const toggleLike = (only = false) => {
    if (liked && only) return;
    const r = ref(db, `postlikes/${owner}/${pid}/${uid()}`);
    (liked ? remove(r) : set(r, true)).catch(() => {});
    if (!liked) { sfx.alertBlip?.(); import("./notifs.js").then((m) => m.notify(p.by, "like", { owner, pid, text: p.text })); }
  };
  el.querySelector(".like").onclick = () => toggleLike();
  // comments
  const cr = query(ref(db, `postcomments/${owner}/${pid}`), orderByKey(), limitToLast(50));
  onValue(cr, (s) => {
    const list = [];
    s.forEach((c) => { list.push([c.key, c.val()]); });
    el.querySelector(".cmt span").textContent = list.length;
    el.querySelector(".clist").innerHTML = list.map(([cid, c]) => `<li><b data-u="${esc(c.by)}">${esc(c.n || userName(c.by))}</b> ${c.gif ? gifHTML(c.gif) : linkify(c.text)}
      <span class="small muted">${c.ts ? ago(c.ts) : ""}</span>${c.by === uid() || myWall || uid() === OWNER ? ` <a href="#" class="small" data-delc="${esc(cid)}">delete</a>` : ` <a href="#" class="small" data-repc="${esc(cid)}">report</a>`}</li>`).join("");
    el.querySelectorAll("[data-delc]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); remove(ref(db, `postcomments/${owner}/${pid}/${a.dataset.delc}`)).catch(() => {}); }));
    el.querySelectorAll("[data-repc]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); const c = list.find(([k]) => k === a.dataset.repc)?.[1]; report("comment", `postcomments/${owner}/${pid}/${a.dataset.repc}`, owner, c?.text); }));
    el.querySelectorAll(".clist [data-u]").forEach((b) => (b.onclick = () => openInfo(b.dataset.u)));
  }, () => {});
  refs.push(cr);
  el.querySelector(".cmt").onclick = () => { const c = el.querySelector(".post-comments"); c.hidden = !c.hidden; if (!c.hidden) c.querySelector("input").focus(); };
  import("./gif.js").then((g) => {
    const b = el.querySelector(".cgif");
    if (!b || !g.gifsOn()) return;
    b.hidden = false;
    b.onclick = () => g.pickGif(b, (gif) => push(ref(db, `postcomments/${owner}/${pid}`), { by: uid(), n: me().screenName, text: "🎞 GIF", gif, ts: serverTimestamp() })
      .then(() => import("./notifs.js").then((m) => m.notify(p.by, "comment", { owner, pid, text: "sent a GIF" }))).catch(() => alert("Couldn't post the GIF.")));
  });
  el.querySelector(".cform").onsubmit = (e) => {
    e.preventDefault();
    const inp = e.target.querySelector("input"), t = inp.value.trim();
    if (!t) return;
    inp.value = "";
    push(ref(db, `postcomments/${owner}/${pid}`), { by: uid(), n: me().screenName, text: t, ts: serverTimestamp() }).then(() => import("./notifs.js").then((m) => {
      m.notify(p.by, "comment", { owner, pid, text: t });
      if (owner !== p.by && !owner.startsWith("g_")) m.notify(owner, "comment", { owner, pid, text: t });
      m.notifyMentions(t, { owner, pid });
    })).catch(() => alert("Couldn't post your comment."));
  };
  el.querySelector(".post-more").onclick = (e) => {
    const r = e.target.getBoundingClientRect();
    contextMenu(r.left - 120, r.bottom, [
      { label: "🪪 View " + (p.n || "profile"), action: () => openInfo(p.by) },
      ...(mine ? [] : [{ label: "💬 Send IM", action: () => openIM(p.by) }]),
      ...(mine && p.ts && Date.now() - p.ts < EDIT_POST_MS ? [{ label: "✏️ Edit Post", action: () => editPost(owner, pid, p) }] : []),
      "-",
      ...(mine || myWall || uid() === OWNER ? [{ label: "🗑 Delete Post", danger: true, action: () => { if (confirm("Delete this post?")) deletePost(owner, pid).catch(() => alert("Couldn't delete it.")); } }]
        : [{ label: "🚩 Report Post", danger: true, action: () => report("post", `posts/${owner}/${pid}`, owner, p.text) }]),
    ]);
  };
  return () => refs.forEach((r) => off(r));
}

/** A composer box: post to your own Wall or (as a homie) on someone else's. */
function composer(owner, onDone, label = null) {
  const box = document.createElement("form");
  box.className = "composer";
  const self = owner === uid();
  box.innerHTML = `<textarea placeholder="${self ? "What's on your mind?" : label ? `Post to ${esc(label)}…` : `Write something on ${esc(userName(owner))}'s Wall…`}" maxlength="1000" rows="2"></textarea>
    <div class="row"><span><label class="btn small-btn" style="margin:0;font-weight:normal">📷 Photo<input type="file" accept="image/*" hidden></label>
      <button type="button" class="btn small-btn" data-emo>😀</button> <span class="small muted pf-name"></span></span>
      <span class="post-go">${self ? `<select class="post-aud" title="Who can see this post">
        <option value="homies" ${localStorage.getItem("du.postPub") === "1" ? "" : "selected"}>👥 Homies only</option>
        <option value="public" ${localStorage.getItem("du.postPub") === "1" ? "selected" : ""}>🌍 Public</option></select>` : ""}
      <button class="btn primary small-btn">Post</button></span></div>`;
  box.querySelector(".post-aud")?.addEventListener("change", (e) => localStorage.setItem("du.postPub", e.target.value === "public" ? "1" : "0"));
  let file = null;
  const ta = box.querySelector("textarea");
  box.querySelector("input[type=file]").onchange = (e) => { file = e.target.files[0] || null; box.querySelector(".pf-name").textContent = file ? "📷 " + file.name.slice(0, 24) : ""; };
  box.querySelector("[data-emo]").onclick = (e) => pickEmoji(e.target, (emo) => { ta.value += emo; });
  box.onsubmit = async (e) => {
    e.preventDefault();
    if (!ta.value.trim() && !file) return;
    const btn = box.querySelector(".btn.primary");
    btn.disabled = true; btn.textContent = "Posting…";
    try { await createPost(owner, ta.value.trim(), file, { pub: box.querySelector(".post-aud")?.value === "public" }); ta.value = ""; file = null; box.querySelector(".pf-name").textContent = ""; onDone?.(); }
    catch (err) {
      const denied = /permission/i.test(String(err?.code || err?.message));
      alert(denied && !self && !label ? `Couldn't post on ${userName(owner)}'s Wall. Only people they've added as a homie can write there.`
        : denied ? "Couldn't post: the database said no (PERMISSION DENIED). The newest database rules probably aren't published yet."
        : "Couldn't post: " + (err?.message || err));
    }
    btn.disabled = false; btn.textContent = "Post";
  };
  return box;
}

/** Renders a person's Wall (their posts + homies' notes) into el. */
const groupOwner = {};
export function renderWall(el, owner, { label = null, groupOwnerUid = null } = {}) {
  if (groupOwnerUid) groupOwner[owner] = groupOwnerUid;
  el.innerHTML = `<div class="panel wall"><h3>📝 Wall</h3><div class="wall-compose"></div><div class="wall-posts"><p class="small muted">Loading posts…</p></div></div>`;
  el.querySelector(".wall-compose").appendChild(composer(owner, null, label));
  const list = el.querySelector(".wall-posts");
  const cleanups = new Map();
  const r = query(ref(db, `posts/${owner}`), orderByKey(), limitToLast(30));
  onValue(r, (s) => {
    if (!el.isConnected && el.dataset.drawn) { off(r); cleanups.forEach((fn) => fn()); return; }
    el.dataset.drawn = "1";
    const posts = [];
    s.forEach((c) => { posts.push([c.key, c.val()]); });
    posts.reverse();
    if (!posts.length) { list.innerHTML = `<p class="small muted">No posts yet.</p>`; return; }
    const keep = new Set(posts.map(([k]) => k));
    for (const [k, fn] of cleanups) if (!keep.has(k)) { fn(); cleanups.delete(k); }
    list.innerHTML = "";
    posts.forEach(([pid, p]) => { const d = document.createElement("div"); list.appendChild(d); cleanups.get(pid)?.(); cleanups.set(pid, postCard(d, owner, pid, p, label)); });
  }, () => (list.innerHTML = label ? `<p class="small muted">🔒 Join the group to see its Wall.</p>` : `<p class="small muted">🔒 Their Wall is only for their homies.</p>`));
  return () => { off(r); cleanups.forEach((fn) => fn()); };
}

// =================== The Homie Feed ===================
const feedSeenKey = () => "du.feedSeen." + uid();
/** The feed itself (stories bar, post box, posts). Used by the Feed window and the Welcome screen. Returns a cleanup function. */
export function mountFeed(body, { limit = 60, more = null } = {}) {
  const refs = [], cards = [];
  let tab = localStorage.getItem("du.feedTab") === "public" ? "public" : "homies";
  body.innerHTML = `<div class="stories-bar"></div><div class="feed-compose"></div>
    <div class="feed-tabs" role="tablist"><button data-tab="homies">👥 Homies</button><button data-tab="public">🌍 Public</button></div>
    <div class="feed-list"><p class="muted">Loading posts…</p></div>`;
  paintStoriesBar(body.querySelector(".stories-bar"));
  body.querySelector(".feed-compose").appendChild(composer(uid()));
  const items = { homies: {}, public: [] };   // homies: posts by person · public: the newest public posts
  const paint = () => {
    const list = body.querySelector(".feed-list");
    if (!list) return;
    body.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
    const sorted = (tab === "homies" ? Object.entries(items.homies).flatMap(([owner, posts]) => posts.map(([pid, p]) => ({ owner, pid, p }))) : items.public)
      .sort((a, b) => (b.p.ts || 0) - (a.p.ts || 0));
    const all = sorted.slice(0, limit);
    cards.forEach((fn) => fn()); cards.length = 0;
    if (!all.length) {
      list.innerHTML = `<div class="panel small">${tab === "homies" ? "No posts from your homies yet. Be the first! Share a photo or what you're up to above. 👆"
        : "No public posts yet. Pick 🌍 Public before you post to share with everyone on DialedUp."}</div>`;
      return;
    }
    list.innerHTML = "";
    all.forEach(({ owner, pid, p }) => { const d = document.createElement("div"); list.appendChild(d); cards.push(postCard(d, owner, pid, p)); });
    if (more && sorted.length > limit) { const a = document.createElement("button"); a.className = "btn small-btn feed-more"; a.textContent = "See more in the Homie Feed ›"; a.onclick = more; list.appendChild(a); }
    if (tab === "homies") { try { localStorage.setItem(feedSeenKey(), String(Date.now())); } catch {} paintFeedBadge(0); }
  };
  let timer = null;
  const later = () => { clearTimeout(timer); timer = setTimeout(paint, 250); };
  // 👥 Homies: you, your homies and the owner's posts (only people's own posts; Wall notes stay on profiles)
  feedPeople().forEach((u) => {
    const r = query(ref(db, `posts/${u}`), orderByKey(), limitToLast(15));
    onValue(r, (s) => { const posts = []; s.forEach((c) => { if (c.val()?.by === u) posts.push([c.key, c.val()]); }); items.homies[u] = posts; if (tab === "homies") later(); }, () => {});
    refs.push(r);
  });
  // 🌍 Public: the newest public posts from everyone
  const pr = query(ref(db, "pubfeed"), orderByChild("ts"), limitToLast(40));
  const cache = {};
  onValue(pr, async (s) => {
    const rows = [];
    s.forEach((c) => { const v = c.val(); if (v?.owner && v?.pid) rows.push(v); });
    const blocked = new Set(JSON.parse(localStorage.getItem("du.ignored") || "[]"));
    const got = await Promise.all(rows.filter((v) => !blocked.has(v.owner)).map(async (v) => {
      const k = v.owner + "/" + v.pid;
      if (!(k in cache)) cache[k] = (await get(ref(db, `posts/${k}`)).catch(() => null))?.val() || null;
      return cache[k] ? { owner: v.owner, pid: v.pid, p: cache[k] } : null;
    }));
    items.public = got.filter(Boolean);
    if (tab === "public") later();
  }, () => { items.public = []; if (tab === "public") later(); });
  refs.push(pr);
  body.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => {
    tab = b.dataset.tab;
    try { localStorage.setItem("du.feedTab", tab); } catch {}
    paint();
  }));
  paint();
  return () => { refs.forEach((r) => off(r)); cards.forEach((fn) => fn()); };
}

export function openFeed() {
  let cleanup = null;
  openWindow("feed", {
    title: "Homie Feed", icon: "📰", width: 440, height: 600, keyword: "feed",
    onClose: () => cleanup?.(),
    render(body) { cleanup = mountFeed(body); },
  });
}

/** Counts new posts since you last opened the Feed (shown on the toolbar's Feed button). */
export async function checkFeed({ popUp = false } = {}) {
  const since = Number(localStorage.getItem(feedSeenKey()) || 0);
  let n = 0;
  await Promise.all(feedPeople().filter((u) => u !== uid()).map(async (u) => {
    try {
      const s = await get(query(ref(db, `posts/${u}`), orderByKey(), limitToLast(10)));
      s.forEach((c) => { const p = c.val(); if ((p.ts || 0) > since && p.by === u) n++; });
    } catch {}
  }));
  paintFeedBadge(n);
  if (popUp && n && since) setTimeout(openFeed, 2500);
  return n;
}
function paintFeedBadge(n) {
  const btn = document.querySelector('#toolbar [data-open="feed"]');
  const b = btn?.querySelector(".badge");
  if (b) { b.textContent = n > 99 ? "99+" : n || ""; b.hidden = !n; }
}

// =================== Homie Updates (24-hour stories) ===================
const DAY = 86400000;
const storyCache = {};   // uid → [[sid, story], …] (only unexpired)
const seenKey = () => "du.storySeen." + uid();
const seen = () => { try { return new Set(JSON.parse(localStorage.getItem(seenKey()) || "[]")); } catch { return new Set(); } };
const markSeen = (sid) => { const s = seen(); s.add(sid); try { localStorage.setItem(seenKey(), JSON.stringify([...s].slice(-400))); } catch {} };
export const hasNewStory = (u) => (storyCache[u] || []).some(([sid]) => !seen().has(sid));
export const hasStory = (u) => (storyCache[u] || []).length > 0;

/** Keeps the story list for a person up to date (used by the Homies window rings and the Feed). */
export function watchStories(u, onChange) {
  const r = ref(db, `stories/${u}`);
  onValue(r, (s) => {
    const list = Object.entries(s.val() || {}).filter(([, st]) => Date.now() - (st.ts || 0) < DAY).sort((a, b) => (a[1].ts || 0) - (b[1].ts || 0));
    storyCache[u] = list;
    onChange?.();
  }, () => {});
  return r;
}

function paintStoriesBar(el) {
  const people = [uid(), ...buddyList()];
  const draw = () => {
    const withStories = people.filter((u) => u !== uid() && hasStory(u)).sort((a, b) => Number(hasNewStory(b)) - Number(hasNewStory(a)));
    el.innerHTML = `<button class="story-bubble add ${hasStory(uid()) ? "mine" : ""}" data-add>${iconHTML(uid(), 52)}<b>＋</b><span>${hasStory(uid()) ? "Your Update" : "Add Update"}</span></button>
      ${withStories.map((u) => `<button class="story-bubble ${hasNewStory(u) ? "new" : ""}" data-s="${esc(u)}">${iconHTML(u, 52)}<span>${esc(userName(u))}</span></button>`).join("")}`;
    el.querySelector("[data-add]").onclick = () => (hasStory(uid()) ? contextMenu(...pos(el), [
      { label: "👀 View My Update", action: () => viewStories(uid()) }, { label: "➕ Add Another", action: newStory }]) : newStory());
    el.querySelectorAll("[data-s]").forEach((b) => (b.onclick = () => viewStories(b.dataset.s, () => draw())));
  };
  const pos = (n) => { const r = n.getBoundingClientRect(); return [r.left + 10, r.top + 70]; };
  people.forEach((u) => { if (!storyCache[u]) watchStories(u, draw); });
  draw();
  document.addEventListener("du:stories", draw);
}

const BGS = ["linear-gradient(135deg,#8a4dff,#ff5ec4)", "linear-gradient(135deg,#21a0fd,#5b2a86)", "linear-gradient(135deg,#ffb300,#ff5e8a)", "linear-gradient(135deg,#00a68c,#21d4fd)", "#111"];
export function newStory() {
  openWindow("story.new", {
    title: "New Homie Update", icon: "✨", width: 340, height: 430,
    render(body) {
      let bg = 0, file = null;
      body.innerHTML = `<p class="small" style="margin-top:0">Share a photo, video or a quick thought. It disappears after 24 hours.</p>
        <div class="story-preview" style="background:${BGS[0]}"><textarea maxlength="200" placeholder="Type something…"></textarea></div>
        <div class="row" style="gap:4px;margin-top:6px;flex-wrap:wrap"><label class="btn small-btn" style="margin:0;font-weight:normal">📷 Photo / Video<input type="file" accept="image/*,video/*" hidden></label>
          <button type="button" class="btn small-btn" data-bg>🎨 Color</button><span class="small muted st-file"></span></div>
        <div class="row" style="margin-top:8px"><span class="small muted st-msg"></span><button class="btn primary" data-share>Share Update</button></div>`;
      const pv = body.querySelector(".story-preview");
      body.querySelector("[data-bg]").onclick = () => { bg = (bg + 1) % BGS.length; pv.style.background = BGS[bg]; };
      body.querySelector("input[type=file]").onchange = (e) => {
        file = e.target.files[0] || null;
        body.querySelector(".st-file").textContent = file ? file.name.slice(0, 22) : "";
        if (file && file.type.startsWith("image/")) { pv.style.background = `center/cover url(${URL.createObjectURL(file)})`; }
      };
      body.querySelector("[data-share]").onclick = async (e) => {
        const text = body.querySelector("textarea").value.trim();
        if (!text && !file) return;
        e.target.disabled = true;
        const msg = body.querySelector(".st-msg");
        try {
          const story = { text: text.slice(0, 200), bg, ts: serverTimestamp(), kind: "text" };
          if (file) {
            if (file.size > 25 * 1024 * 1024) throw new Error("That file is over 25 MB.");
            const blob = file.type.startsWith("image/") ? await (await fetch("data:image/jpeg;base64," + await shrink(file, 1280, 0.8))).blob() : file;
            msg.textContent = "Uploading…";
            const token = await auth.currentUser.getIdToken();
            const r = await fetch(FILES + "/upload", { method: "POST", body: blob, headers: { "x-du-token": token, "x-du-appcheck": await (await import("./firebase.js")).appCheckToken(), "x-du-conv": "story", "x-du-name": encodeURIComponent(file.name), "content-type": blob.type || file.type } });
            const j = await r.json();
            if (!j.ok) throw new Error("Upload failed.");
            story.url = j.url; story.kind = file.type.startsWith("video/") ? "video" : "photo";
          }
          await push(ref(db, `stories/${uid()}`), story);
          // tidy up your expired updates
          get(ref(db, `stories/${uid()}`)).then((s) => Object.entries(s.val() || {}).forEach(([sid, st]) => Date.now() - (st.ts || 0) > DAY && remove(ref(db, `stories/${uid()}/${sid}`)).catch(() => {}))).catch(() => {});
          closeWindow("story.new");
          setTimeout(() => viewStories(uid()), 400);   // show it right away so you know it's live
        } catch (err) { msg.textContent = err.message || "Couldn't share it."; e.target.disabled = false; }
      };
    },
  });
}

/** Full-screen story viewer: tap to go forward, auto-advances. */
export function viewStories(owner, onDone) {
  const list = storyCache[owner] || [];
  if (!list.length) return;
  let i = Math.max(0, list.findIndex(([sid]) => !seen().has(sid)));
  if (i < 0) i = 0;
  const v = document.createElement("div");
  v.className = "story-viewer";
  document.body.appendChild(v);
  let timer = null;
  const close = () => { clearTimeout(timer); v.remove(); document.dispatchEvent(new CustomEvent("du:stories")); onDone?.(); };
  const show = () => {
    clearTimeout(timer);
    if (i >= list.length) return close();
    const [sid, st] = list[i];
    markSeen(sid);
    if (owner !== uid()) set(ref(db, `storyviews/${owner}/${sid}/${uid()}`), Date.now()).catch(() => {});
    v.innerHTML = `<div class="sv-bars">${list.map((_, k) => `<i class="${k < i ? "done" : k === i ? "on" : ""}"></i>`).join("")}</div>
      <div class="sv-head">${iconHTML(owner, 32)}<b>${esc(userName(owner))}</b><span>${ago(st.ts || Date.now())}</span><button class="sv-x">✕</button></div>
      <div class="sv-body" style="background:${st.url && st.kind === "photo" ? "#000" : BGS[st.bg || 0]}">
        ${st.kind === "photo" ? `<img src="${esc(st.url)}" alt="">` : st.kind === "video" ? `<video src="${esc(st.url)}" autoplay playsinline controls></video>` : ""}
        ${st.text ? `<div class="sv-text ${st.url ? "over" : ""}">${linkify(st.text)}</div>` : ""}</div>
      <div class="sv-foot">${owner === uid() ? `<button class="btn small-btn" data-views>👀 Views</button><button class="btn danger small-btn" data-del>Delete</button>`
        : `<button class="btn small-btn" data-reply>💬 Reply</button><button class="btn small-btn" data-rep>🚩</button>`}</div>`;
    v.querySelector(".sv-x").onclick = (e) => { e.stopPropagation(); close(); };
    v.querySelector(".sv-body").onclick = (e) => { if (e.target.tagName !== "VIDEO") { i++; show(); } };
    v.querySelector("[data-reply]")?.addEventListener("click", () => { close(); openIM(owner); });
    v.querySelector("[data-rep]")?.addEventListener("click", () => report("Homie Update", `stories/${owner}/${sid}`, owner, st.text));
    v.querySelector("[data-del]")?.addEventListener("click", () => { if (confirm("Delete this update?")) { remove(ref(db, `stories/${owner}/${sid}`)).catch(() => {}); list.splice(i, 1); show(); } });
    v.querySelector("[data-views]")?.addEventListener("click", async () => {
      clearTimeout(timer);
      const s = (await get(ref(db, `storyviews/${owner}/${sid}`)).catch(() => null))?.val() || {};
      alert(Object.keys(s).length ? `👀 Seen by:\n${Object.keys(s).map((u) => userName(u)).join("\n")}` : "No views yet.");
    });
    if (st.kind !== "video") timer = setTimeout(() => { i++; show(); }, 6000);
    else v.querySelector("video").onended = () => { i++; show(); };
  };
  show();
}

// =================== Top 8 ===================
export function renderTop8(el, u, top8) {
  const list = (Array.isArray(top8) ? top8 : []).filter(Boolean).slice(0, 8);
  if (!list.length) { el.innerHTML = ""; return; }
  el.innerHTML = `<div class="panel"><h3>⭐ ${esc(userName(u))}'s Top ${list.length}</h3><div class="top8">${list.map((b, i) =>
    `<button class="top8-tile" data-u="${esc(b)}">${iconHTML(b, 56)}<span>${i + 1}. ${esc(userName(b))}</span></button>`).join("")}</div></div>`;
  el.querySelectorAll("[data-u]").forEach((b) => (b.onclick = () => openInfo(b.dataset.u)));
}

/** Top 8 picker for My Profile. Returns the current list via getter. */
export function top8Editor(el, current = []) {
  let picks = (Array.isArray(current) ? current : []).filter(Boolean).slice(0, 8);
  const paint = () => {
    const buddies = buddyList().filter((b) => !picks.includes(b)).sort((a, b) => userName(a).localeCompare(userName(b)));
    el.innerHTML = `<p class="small" style="margin-top:0">Pick up to 8 favorite homies to show on your profile. Use ⬆️ to change the order.</p>
      <ol class="t8-list">${picks.map((b, i) => `<li><span>${iconHTML(b, 22)} ${esc(userName(b))}</span><span><button class="btn small-btn" data-up="${esc(i)}" ${i ? "" : "disabled"}>⬆️</button><button class="btn small-btn" data-rm="${esc(i)}">✖</button></span></li>`).join("")}</ol>
      ${picks.length < 8 ? `<label>Add a homie <select data-add><option value="">Choose…</option>${buddies.map((b) => `<option value="${esc(b)}">${esc(userName(b))}</option>`).join("")}</select></label>` : `<p class="small muted">Your Top 8 is full!</p>`}`;
    el.querySelectorAll("[data-up]").forEach((b) => (b.onclick = () => { const i = Number(b.dataset.up); [picks[i - 1], picks[i]] = [picks[i], picks[i - 1]]; paint(); }));
    el.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = () => { picks.splice(Number(b.dataset.rm), 1); paint(); }));
    el.querySelector("[data-add]")?.addEventListener("change", (e) => { if (e.target.value) { picks.push(e.target.value); paint(); } });
  };
  paint();
  return () => picks;
}

// =================== Owner moderation ===================
export function openReports() {
  if (uid() !== OWNER) return;
  let r = null;
  openWindow("reports", {
    title: "Reports (owner)", icon: "🛡", width: 420, height: 480, onClose: () => r && off(r),
    render(body) {
      r = ref(db, "reports");
      onValue(r, (s) => {
        const list = Object.entries(s.val() || {}).sort((a, b) => (b[1].ts || 0) - (a[1].ts || 0));
        body.innerHTML = list.length ? list.map(([id, x]) => `<div class="panel small">
            <b>🚩 ${esc(x.what)}</b> by ${esc(userName(x.owner) || "someone")} · reported by ${esc(x.byName || "")} · ${x.ts ? ago(x.ts) : ""}<br>
            ${x.preview ? `“${esc(x.preview)}”<br>` : ""}${x.why ? `<i>Why: ${esc(x.why)}</i><br>` : ""}
            <div class="row" style="justify-content:flex-start;gap:4px;margin-top:4px"><button class="btn danger small-btn" data-del="${esc(id)}">Remove it</button>
            <button class="btn small-btn" data-ok="${esc(id)}">Dismiss</button><button class="btn small-btn" data-who="${esc(x.owner)}">View person</button></div></div>`).join("")
          : `<p class="muted">No reports. All quiet. 🛡</p>`;
        body.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => {
          const x = list.find(([id]) => id === b.dataset.del)[1];
          if (!/^(posts|postcomments|stories|guestbook|groups)\/[-_A-Za-z0-9/]{1,160}$/.test(String(x.path || ""))) { alert("This report points somewhere unexpected, so it wasn't removed. Dismiss it instead."); return; }
          if (!confirm("Remove the reported content?")) return;
          if (x.path.startsWith("posts/")) { const [, owner, pid] = x.path.split("/"); await deletePost(owner, pid).catch(() => {}); }
          else await remove(ref(db, x.path)).catch(() => {});
          await remove(ref(db, `reports/${b.dataset.del}`)).catch(() => {});
        }));
        body.querySelectorAll("[data-ok]").forEach((b) => (b.onclick = () => remove(ref(db, `reports/${b.dataset.ok}`)).catch(() => {})));
        body.querySelectorAll("[data-who]").forEach((b) => (b.onclick = () => openInfo(b.dataset.who)));
      }, () => (body.innerHTML = `<p class="muted">Publish the latest database rules to see reports.</p>`));
    },
  });
}
