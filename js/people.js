// People Plaza: browse chat rooms by category, see who's inside, make your own room.
import { auth, db, ref, get, set, push, remove, update, onValue, off, serverTimestamp, query, orderByKey, limitToLast, normalize } from "./firebase.js";
import { openWindow, closeWindow, getWindow, esc, contextMenu } from "./wm.js";
import * as sfx from "./sounds.js";
import { me, openIM, openInfo, buddyList, userName, sendFileTo } from "./chat.js";

export const ROOM_LIMIT = 23;

export const categories = {
  "Town Square": ["Lobby", "Newbies Welcome", "Night Owls", "Coffee Shop", "The Porch"],
  "Friends & Flirts": ["Just Friends", "Thirty Something", "Singles Mixer", "Late Night Talk", "Best Buds"],
  "Music": ["Hip Hop Corner", "House & Techno", "DJ Booth", "R&B Lounge", "Rock Room", "Throwback Jams"],
  "Sports": ["Hoops Talk", "Gridiron", "Baseball Bench", "Hockey Rink", "Fantasy Leagues", "Sneakerheads"],
  "Entertainment": ["Movie Night", "TV Talk", "Reality Check", "Anime Club", "Comedy Club"],
  "Tech & Games": ["Gamers Hangout", "Tech Help Desk", "Coders Cafe", "Retro Gaming", "Phone Talk"],
  "Places": ["NYC", "Brooklyn", "The Bronx", "Queens", "Jersey", "LA", "Miami", "Chicago", "Atlanta", "Texas"],
  "Life": ["Parents Place", "Foodies", "Fitness", "Pet Lovers", "Money Talk", "Car Talk"],
  "Special Interests": ["Astrology", "Fashion", "Travel", "Book Club", "Art Studio", "Paranormal"],
};

const roomKey = (name) => normalize(name);
const listeners = [];

// ---------- Room browser ----------
export function openPeoplePlaza() {
  openWindow("plaza", {
    title: "People Plaza — Chat", icon: "💬", width: 380, height: 500,
    onClose: () => { listeners.forEach((r) => off(r)); listeners.length = 0; },
    render(body) {
      body.innerHTML = `
        <p class="small" style="margin-top:0">Pick a category, then a room. Rooms hold up to ${ROOM_LIMIT} people.</p>
        <div class="row" style="justify-content:flex-start;gap:4px;margin-bottom:8px" id="cats">
          ${Object.keys(categories).map((c, i) => `<button class="btn small-btn${i === 0 ? " primary" : ""}" data-cat="${esc(c)}">${esc(c)}</button>`).join("")}
          <button class="btn small-btn" data-cat="__member">Member Rooms</button>
        </div>
        <div id="rooms"></div>
        <div class="panel" style="margin-top:8px"><h3>Start or join a room by name</h3>
          <form id="mk" class="row"><input id="mk-name" placeholder="Room name" style="flex:1">
            <label class="check" style="margin:0"><input type="checkbox" id="mk-private"> Private</label>
            <button class="btn primary small-btn">Go</button></form>
          <p class="small muted" style="margin:4px 0 0">Private rooms don't show up in Member Rooms — share the name with friends.</p></div>`;
      const roomsEl = body.querySelector("#rooms");
      const showCategory = (cat) => {
        listeners.forEach((r) => off(r)); listeners.length = 0;
        body.querySelectorAll("[data-cat]").forEach((b) => b.classList.toggle("primary", b.dataset.cat === cat));
        if (cat === "__member") return showMemberRooms(roomsEl);
        const names = categories[cat];
        roomsEl.innerHTML = `<ul class="list">${names.map((n) =>
          `<li class="row"><a href="#" data-room="${esc(n)}">💬 ${esc(n)}</a><span class="small muted" data-count="${roomKey(n)}">…</span></li>`).join("")}</ul>`;
        roomsEl.querySelectorAll("[data-room]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); openRoom(a.dataset.room, cat); }));
        names.forEach((n) => watchCount(roomKey(n), roomsEl));
      };
      body.querySelectorAll("[data-cat]").forEach((b) => (b.onclick = () => showCategory(b.dataset.cat)));
      body.querySelector("#mk").onsubmit = async (e) => {
        e.preventDefault();
        const name = body.querySelector("#mk-name").value.trim();
        if (!normalize(name)) return;
        const isPrivate = body.querySelector("#mk-private").checked;
        const key = roomKey(name);
        const existing = (await get(ref(db, `rooms/${key}/info`))).val();
        if (!existing) {
          await set(ref(db, `rooms/${key}/info`), { name, category: "Member Rooms", private: isPrivate, creator: auth.currentUser.uid, created: serverTimestamp() }).catch(() => {});
        }
        openRoom(existing?.name || name, "Member Rooms");
      };
      showCategory(Object.keys(categories)[0]);
    },
  });
}

function watchCount(key, container) {
  const r = ref(db, `rooms/${key}/members`);
  onValue(r, (s) => {
    const n = Object.values(s.val() || {}).filter((t) => Date.now() - t < 120000).length;
    const el = container.querySelector(`[data-count="${key}"]`);
    if (el) el.textContent = n >= ROOM_LIMIT ? "FULL" : `${n} ${n === 1 ? "person" : "people"}`;
  });
  listeners.push(r);
}

async function showMemberRooms(el) {
  el.innerHTML = `<p class="muted small">Loading member rooms…</p>`;
  const r = ref(db, "roomlist");
  onValue(r, (s) => {
    const rooms = Object.entries(s.val() || {}).filter(([, v]) => !v.private && Date.now() - (v.active || 0) < 86400000);
    el.innerHTML = rooms.length ? `<ul class="list">${rooms.map(([k, v]) =>
      `<li class="row"><a href="#" data-room="${esc(v.name)}">💬 ${esc(v.name)}</a><span class="small muted" data-count="${k}">…</span></li>`).join("")}</ul>`
      : `<p class="muted small">No member rooms right now. Start one below!</p>`;
    el.querySelectorAll("[data-room]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); openRoom(a.dataset.room, "Member Rooms"); }));
    rooms.forEach(([k]) => watchCount(k, el));
  });
  listeners.push(r);
}

// ---------- A chat room ----------
export async function openRoom(displayName, category = "") {
  const key = roomKey(displayName);
  const id = "room." + key;
  if (getWindow(id)) return openWindow(id, {});
  const uid = auth.currentUser.uid;
  const members = (await get(ref(db, `rooms/${key}/members`))).val() || {};
  const here = Object.entries(members).filter(([, t]) => Date.now() - t < 120000).map(([u]) => u);
  if (here.length >= ROOM_LIMIT && !here.includes(uid)) {
    alert(`"${displayName}" is full (${ROOM_LIMIT} people). Try another room or start your own.`);
    return;
  }
  const info = (await get(ref(db, `rooms/${key}/info`))).val();
  if (!info) set(ref(db, `rooms/${key}/info`), { name: displayName, category, private: false }).catch(() => {});
  const isPrivate = !!info?.private;
  const refs = [];
  let beat;
  const ignored = new Set(JSON.parse(localStorage.getItem("du.ignored") || "[]"));
  const say = (text, type) => push(ref(db, `rooms/${key}/messages`), { from: uid, name: me().screenName, text, type: type || null, ts: serverTimestamp() });

  openWindow(id, {
    title: `${displayName}${category ? " — " + category : ""}`, icon: "💬", width: 400, height: 460,
    onClose: () => {
      refs.forEach((r) => off(r));
      clearInterval(beat);
      say(`${me().screenName} has left the room.`, "leave").catch(() => {});
      remove(ref(db, `rooms/${key}/members/${uid}`)).catch(() => {});
    },
    render(body) {
      body.innerHTML = `<div class="room">
        <div class="room-main">
          <div class="small room-topic"><b>Topic:</b> <span id="topic">—</span> <a href="#" id="set-topic" class="small">change</a></div>
          <div class="transcript"></div>
          <div class="compose"><textarea placeholder="Say something to the room…"></textarea><button class="btn primary">Send</button></div>
        </div>
        <aside class="room-people">
          <div class="small"><b id="count">0</b> in room</div>
          <ul class="list" id="people"></ul>
          <button class="btn small-btn" id="invite">Invite a Buddy</button>
        </aside></div>`;
      const tx = body.querySelector(".transcript");
      const ta = body.querySelector("textarea");
      const memRef = ref(db, `rooms/${key}/members/${uid}`);
      const touch = () => {
        set(memRef, serverTimestamp()).catch(() => {});
        if (category === "Member Rooms" && !isPrivate) set(ref(db, `roomlist/${key}`), { name: displayName, private: false, active: serverTimestamp() }).catch(() => {});
      };
      touch();
      beat = setInterval(touch, 45000);
      say(`${me().screenName} has entered the room.`, "enter").catch(() => {});

      const q = query(ref(db, `rooms/${key}/messages`), orderByKey(), limitToLast(80));
      let first = true;
      onValue(q, (snap) => {
        const rows = [];
        snap.forEach((c) => {
          const m = c.val();
          if (ignored.has(m.from)) return;
          if (m.type === "enter" || m.type === "leave") rows.push(`<div class="msg small muted"><i>${esc(m.text)}</i></div>`);
          else rows.push(`<div class="msg"><span class="who ${m.from === uid ? "me" : "them"}">${esc(m.name || "…")}</span>: ${esc(m.text)}</div>`);
        });
        tx.innerHTML = rows.join("");
        tx.scrollTop = tx.scrollHeight;
        if (!first) sfx.imIn();
        first = false;
      });
      refs.push(q);

      const topicRef = ref(db, `rooms/${key}/info/topic`);
      onValue(topicRef, (s) => (body.querySelector("#topic").textContent = s.val() || "Anything goes"));
      refs.push(topicRef);
      body.querySelector("#set-topic").onclick = (e) => {
        e.preventDefault();
        const t = prompt("New room topic:");
        if (t != null) set(topicRef, t.slice(0, 120)).catch(() => alert("Couldn't change the topic."));
      };

      const allRef = ref(db, `rooms/${key}/members`);
      onValue(allRef, (s) => {
        const people = Object.entries(s.val() || {}).filter(([, t]) => Date.now() - t < 120000).map(([u]) => u);
        body.querySelector("#count").textContent = people.length;
        body.querySelector("#people").innerHTML = people.map((p) =>
          `<li><a href="#" data-p="${p}" class="${ignored.has(p) ? "muted" : ""}">${esc(userName(p))}</a></li>`).join("");
        body.querySelectorAll("[data-p]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); personMenu(a.dataset.p, e.clientX, e.clientY); }));
      });
      refs.push(allRef);

      const personMenu = (p, x, y) => {
        if (p === uid) return openInfo(p);
        contextMenu(x, y, [
          { label: "💬 Send Instant Message", action: () => openIM(p) },
          { label: "📎 Send File…", action: () => sendFileTo(p) },
          { label: "🪪 Get Info", action: () => openInfo(p) },
          "-",
          { label: ignored.has(p) ? "🔊 Stop Ignoring" : "🔇 Ignore", danger: !ignored.has(p), action: () => {
            ignored.has(p) ? ignored.delete(p) : ignored.add(p);
            localStorage.setItem("du.ignored", JSON.stringify([...ignored]));
          } },
        ]);
      };

      body.querySelector("#invite").onclick = () => inviteBuddy(displayName);
      const send = () => {
        const t = ta.value.trim();
        if (!t) return;
        ta.value = "";
        say(t).catch(() => alert("Couldn't send to the room."));
      };
      body.querySelector(".compose .btn").onclick = send;
      ta.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } };
    },
  });
}

function inviteBuddy(room) {
  const buddies = buddyList();
  if (!buddies.length) { alert("Add some buddies first!"); return; }
  openWindow("invite", {
    title: "Invite to Chat", icon: "✉️", width: 300, height: 360,
    render(body) {
      body.innerHTML = `<p class="small">Invite buddies to <b>${esc(room)}</b>:</p>
        <ul class="list">${buddies.map((b) => `<li><label class="check"><input type="checkbox" value="${b}"> ${esc(userName(b))}</label></li>`).join("")}</ul>
        <label>Message <input id="inv-msg" value="Come chat with me!"></label>
        <div class="row"><span></span><button class="btn primary" id="inv-go">Send Invites</button></div>`;
      body.querySelector("#inv-go").onclick = async () => {
        const picked = [...body.querySelectorAll("input[type=checkbox]:checked")].map((c) => c.value);
        const msg = body.querySelector("#inv-msg").value;
        await Promise.all(picked.map((b) => push(ref(db, `invites/${b}`), { from: auth.currentUser.uid, room, message: msg, ts: serverTimestamp() }).catch(() => {})));
        closeWindow("invite");
      };
    },
  });
}

// ---------- Incoming invitations ----------
let invitesRef = null;
export function watchInvites() {
  const uid = auth.currentUser.uid;
  invitesRef = ref(db, `invites/${uid}`);
  let first = true;
  onValue(invitesRef, (s) => {
    const all = Object.entries(s.val() || {});
    if (!first && all.length) sfx.alertBlip();
    first = false;
    all.forEach(([id, inv]) => {
      openWindow("inv." + id, {
        title: "Chat Invitation", icon: "✉️", width: 280, height: 220,
        render(body) {
          body.innerHTML = `<p><b>${esc(userName(inv.from))}</b> invited you to <b>${esc(inv.room)}</b>.</p>
            ${inv.message ? `<p class="small">"${esc(inv.message)}"</p>` : ""}
            <div class="row"><button class="btn" data-x="no">Decline</button><button class="btn primary" data-x="yes">Join</button></div>`;
          const done = () => { remove(ref(db, `invites/${uid}/${id}`)).catch(() => {}); closeWindow("inv." + id); };
          body.querySelector("[data-x=no]").onclick = done;
          body.querySelector("[data-x=yes]").onclick = () => { done(); openRoom(inv.room); };
        },
      });
    });
  });
}
export function stopInvites() { if (invitesRef) off(invitesRef); invitesRef = null; }
