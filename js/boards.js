// Message Boards: topics by category, with threads and replies.
import { auth, db, ref, get, set, push, update, onValue, off, serverTimestamp, query, orderByKey, limitToLast } from "./firebase.js";
import { openWindow, esc } from "./wm.js";
import { me } from "./chat.js";

export const boards = {
  lounge: "The Lounge (anything goes)",
  music: "Music & DJs",
  sports: "Sports Talk",
  tech: "Tech & Gadgets",
  games: "Video Games",
  movies: "Movies & TV",
  nyc: "NYC Talk",
  help: "Help Desk",
  throwback: "Throwback Thursday",
};

export function openBoards() {
  openWindow("boards", {
    title: "Message Boards", icon: "📌", width: 360, height: 440,
    render(body) {
      body.innerHTML = `<p class="small" style="margin-top:0">Pick a board to read and post.</p>
        <ul class="list">${Object.entries(boards).map(([k, n]) => `<li><a href="#" data-b="${esc(k)}">📌 ${esc(n)}</a></li>`).join("")}</ul>`;
      body.querySelectorAll("[data-b]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); openBoard(a.dataset.b); }));
    },
  });
}

function openBoard(key) {
  let r;
  openWindow("board." + key, {
    title: boards[key], icon: "📌", width: 400, height: 480, onClose: () => r && off(r),
    render(body) {
      body.innerHTML = `<div class="row" style="margin-bottom:8px"><b>Threads</b><button class="btn primary small-btn" id="newt">✏️ New Thread</button></div>
        <ul class="list" id="threads"><li class="muted">Loading…</li></ul>`;
      body.querySelector("#newt").onclick = () => newThread(key);
      r = query(ref(db, `boards/${key}/threads`), orderByKey(), limitToLast(100));
      onValue(r, (s) => {
        const list = Object.entries(s.val() || {}).sort((a, b) => (b[1].last || 0) - (a[1].last || 0));
        body.querySelector("#threads").innerHTML = list.length ? list.map(([id, t]) =>
          `<li><a href="#" data-t="${esc(id)}"><b>${esc(t.title)}</b></a>
           <div class="small muted">by ${esc(t.name)} · ${Number(t.replies) || 0} replies · ${t.last ? new Date(t.last).toLocaleDateString() : ""}</div></li>`).join("")
          : `<li class="muted">No threads yet. Start the first one!</li>`;
        body.querySelectorAll("[data-t]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); openThread(key, a.dataset.t); }));
      });
    },
  });
}

function newThread(board) {
  openWindow("newthread." + board, {
    title: "New Thread", icon: "✏️", width: 360, height: 400,
    render(body) {
      body.innerHTML = `<form id="nt"><label>Title <input id="nt-t" maxlength="120" required></label>
        <label>Message <textarea id="nt-b" rows="7" maxlength="4000" required></textarea></label>
        <p class="error" id="nt-e"></p><div class="row"><span></span><button class="btn primary">Post</button></div></form>`;
      body.querySelector("#nt").onsubmit = async (e) => {
        e.preventDefault();
        const uid = auth.currentUser.uid;
        try {
          const t = await push(ref(db, `boards/${board}/threads`), {
            title: body.querySelector("#nt-t").value.trim(), from: uid, name: me().screenName, ts: serverTimestamp(), last: serverTimestamp(), replies: 0,
          });
          await push(ref(db, `boards/${board}/posts/${t.key}`), { from: uid, name: me().screenName, text: body.querySelector("#nt-b").value, ts: serverTimestamp() });
          body.closest(".win").querySelector(".close").click();
          openThread(board, t.key);
        } catch { body.querySelector("#nt-e").textContent = "Couldn't post (the site's rules may need updating)."; }
      };
    },
  });
}

function openThread(board, tid) {
  let r;
  openWindow(`thread.${board}.${tid}`, {
    title: "Thread", icon: "🧵", width: 420, height: 480, onClose: () => r && off(r),
    async render(body, win) {
      const t = (await get(ref(db, `boards/${board}/threads/${tid}`))).val() || {};
      body.innerHTML = `<h3 style="margin:0 0 8px;color:var(--grape)">${esc(t.title || "")}</h3><div id="posts"></div>
        <form id="rp" class="panel"><label>Reply <textarea id="rp-t" rows="3" maxlength="4000" required></textarea></label>
        <div class="row"><span></span><button class="btn primary small-btn">Post Reply</button></div></form>`;
      r = ref(db, `boards/${board}/posts/${tid}`);
      onValue(r, (s) => {
        body.querySelector("#posts").innerHTML = Object.values(s.val() || {}).sort((a, b) => (a.ts || 0) - (b.ts || 0)).map((p) =>
          `<div class="panel"><div class="small"><b>${esc(p.name)}</b> <span class="muted">${p.ts ? new Date(p.ts).toLocaleString() : ""}</span></div>
           <div style="white-space:pre-wrap;margin-top:4px">${esc(p.text)}</div></div>`).join("");
      });
      body.querySelector("#rp").onsubmit = async (e) => {
        e.preventDefault();
        const ta = body.querySelector("#rp-t");
        const text = ta.value.trim();
        if (!text) return;
        ta.value = "";
        await push(ref(db, `boards/${board}/posts/${tid}`), { from: auth.currentUser.uid, name: me().screenName, text, ts: serverTimestamp() });
        await update(ref(db, `boards/${board}/threads/${tid}`), { last: serverTimestamp(), replies: (t.replies || 0) + 1 }).catch(() => {});
        t.replies = (t.replies || 0) + 1;
      };
    },
  });
}
