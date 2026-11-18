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
    const n = Object.values(s.val() || {}).filter((v) => Date.now() - (typeof v === "object" ? v.t : v) < 120000).length;
    const el = container.querySelector(`[data-count="${esc(key)}"]`);
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
      `<li class="row"><a href="#" data-room="${esc(v.name)}">💬 ${esc(v.name)}</a><span class="small muted" data-count="${esc(k)}">…</span></li>`).join("")}</ul>`
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
  const here = Object.entries(members).filter(([, v]) => Date.now() - (typeof v === "object" ? v.t : v) < 120000).map(([u]) => u);
  if (here.length >= ROOM_LIMIT && !here.includes(uid)) {
    alert(`"${displayName}" is full (${ROOM_LIMIT} people). Try another room or start your own.`);
    return;
  }
  const kick = (await get(ref(db, `rooms/${key}/kicks/${uid}`)).catch(() => null))?.val();
  if (kick && kick.until > Date.now()) {
    alert(`You were kicked from "${displayName}" by ⚡${kick.byName || "the moderator"}. You can come back in ${Math.ceil((kick.until - Date.now()) / 60000)} min.`);
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
          <div class="party-bar" hidden></div>
          <div class="transcript"></div>
          <div class="compose"><textarea placeholder="Say something to the room…"></textarea><button class="btn primary">Send</button></div>
        </div>
        <aside class="room-people">
          <div class="small"><b id="count">0</b> in room</div>
          <ul class="list" id="people"></ul>
          <button class="btn small-btn" id="invite">Invite a Homie</button>
          <button class="btn small-btn" id="party">🎉 Party</button>
        </aside></div>`;
      const tx = body.querySelector(".transcript");
      const ta = body.querySelector("textarea");
      const memRef = ref(db, `rooms/${key}/members/${uid}`);
      const joinedAt = Date.now();
      const touch = () => {
        set(memRef, { t: serverTimestamp(), n: me().screenName, j: joinedAt }).catch(() => {});
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
      let mod = null, names = {};
      onValue(allRef, (s) => {
        const raw = s.val() || {};
        const people = Object.entries(raw).filter(([, v]) => Date.now() - (typeof v === "object" ? v.t : v) < 120000).map(([u]) => u);
        const roomName = (u) => (typeof raw[u] === "object" && raw[u].n) || userName(u);
        // ⚡ Moderator = whoever has been in the room the longest
        const joined = (u) => (typeof raw[u] === "object" && (raw[u].j || raw[u].t)) || Date.now();
        const before = mod;
        mod = [...people].sort((a, b) => joined(a) - joined(b))[0] || null;
        if (mod === uid && before && before !== uid) body.querySelector(".transcript").insertAdjacentHTML("beforeend", `<div class="msg small muted"><i>⚡ You're now the moderator of this room.</i></div>`);
        people.forEach((p) => (names[p] = roomName(p)));
        body.querySelector("#count").textContent = people.length;
        body.querySelector("#people").innerHTML = people.sort((a, b) => joined(a) - joined(b)).map((p) =>
          `<li><a href="#" data-p="${esc(p)}" class="${ignored.has(p) ? "muted" : ""}">${p === mod ? `<span class="mod-bolt" title="Room moderator">⚡</span>` : ""}${esc(roomName(p))}</a></li>`).join("");
        body.querySelectorAll("[data-p]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); personMenu(a.dataset.p, e.clientX, e.clientY); }));
      });
      refs.push(allRef);

      // Kicked? Leave right away.
      const myKick = ref(db, `rooms/${key}/kicks/${uid}`);
      onValue(myKick, (s) => {
        const k = s.val();
        if (k && k.until > Date.now()) {
          closeWindow(id);
          alert(`⚡${k.byName || "The moderator"} kicked you from "${displayName}". You can come back in ${Math.ceil((k.until - Date.now()) / 60000)} min.`);
        }
      }, () => {});
      refs.push(myKick);

      const personMenu = (p, x, y) => {
        if (p === uid) return openInfo(p);
        contextMenu(x, y, [
          ...(mod === uid ? [{ label: "👢 Kick from room (10 min)", danger: true, action: async () => {
            if (!confirm(`Kick ${names[p] || userName(p)} from the room for 10 minutes?`)) return;
            try {
              await set(ref(db, `rooms/${key}/kicks/${p}`), { until: Date.now() + 10 * 60000, by: uid, byName: me().screenName });
              say(`${names[p] || userName(p)} was kicked from the room by ⚡${me().screenName}.`, "leave").catch(() => {});
              remove(ref(db, `rooms/${key}/members/${p}`)).catch(() => {});
            } catch { alert("Couldn't kick right now."); }
          } }, "-"] : []),
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
      refs.push(roomParty(body, key, say, () => mod));
      const send = () => {
        const t = ta.value.trim();
        if (!t) return;
        ta.value = "";
        say(t).then(() => import("./engage.js").then((m) => m.countUp("room"))).catch(() => alert("Couldn't send to the room."));
      };
      body.querySelector(".compose .btn").onclick = send;
      ta.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } };
    },
  });
}

// ---------- Listening Parties & Watch Parties ----------
const PARTY = { listen: ["🎧", "Listening Party"], watch: ["🎬", "Watch Party"] };
function roomParty(body, key, say, getMod) {
  const uid = auth.currentUser.uid;
  const bar = body.querySelector(".party-bar");
  const pr = ref(db, `rooms/${key}/party`);
  let party = null, tunedIn = null;
  const tuneOut = () => {
    if (tunedIn === "radio") import("./radio.js").then((r) => r.stop());
    bar.querySelector(".party-player")?.remove();
    tunedIn = null;
  };
  const tuneIn = async () => {
    if (!party) return;
    if (party.station) { (await import("./radio.js")).play(party.station); tunedIn = "radio"; draw(); return; }
    const { embedFor } = await import("./browser.js");
    let src = embedFor(party.url);
    if (!src) { if (/^https:\/\//i.test(party.url || "")) window.open(party.url, "_blank", "noopener"); return; }
    // Everyone watches the same moment: start YouTube where the host is now
    if (/youtube-nocookie/.test(src)) src += `&start=${Math.max(0, Math.floor((Date.now() - party.at) / 1000))}`;
    tunedIn = "embed"; draw();
    bar.insertAdjacentHTML("beforeend", `<div class="party-player ${party.kind}"><iframe src="${esc(src)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div>`);
  };
  const draw = () => {
    bar.hidden = !party;
    if (!party) { bar.innerHTML = ""; return; }
    const [emo, label] = PARTY[party.kind] || PARTY.listen;
    const canEnd = party.host === uid || getMod() === uid;
    const player = bar.querySelector(".party-player");
    bar.innerHTML = `<div class="party-head"><span>${emo} <b>${label}</b> · ${esc(party.title || "")}<br><span class="small">Hosted by ${esc(party.hostName || "…")}</span></span>
      <span>${tunedIn ? `<button class="btn small-btn" data-pt="out">🔇 Tune Out</button>` : `<button class="btn primary small-btn" data-pt="in">▶ Tune In</button>`}
      ${canEnd ? `<button class="btn small-btn" data-pt="end">End</button>` : ""}</span></div>`;
    if (player) bar.appendChild(player);
    bar.querySelector("[data-pt=in]")?.addEventListener("click", tuneIn);
    bar.querySelector("[data-pt=out]")?.addEventListener("click", () => { tuneOut(); draw(); });
    bar.querySelector("[data-pt=end]")?.addEventListener("click", () => {
      remove(pr).then(() => say(`🎉 ${me().screenName} ended the ${label}.`, "enter")).catch(() => alert("Couldn't end the party."));
    });
  };
  onValue(pr, (s) => {
    const was = party;
    party = s.val();
    if (!party || (was && (was.url !== party.url || was.station?.url !== party.station?.url))) tuneOut();
    draw();
  }, () => {});
  body.querySelector("#party").onclick = (e) => {
    if (party && party.host !== uid && getMod() !== uid) { alert(`There's already a ${PARTY[party.kind]?.[1] || "party"} going on. Hit ▶ Tune In to join!`); return; }
    const r = e.target.getBoundingClientRect();
    contextMenu(r.left, r.bottom, [
      { label: "🎧 Listening Party: song or playlist link…", action: () => start("listen") },
      { label: "📻 Listening Party: my Radio station", action: async () => {
        const st = (await import("./radio.js")).getNowPlaying();
        if (!st) { alert("Open DialedUp Radio and start a station first, then come back here."); import("./radio.js").then((m) => m.openRadio()); return; }
        start("listen", { station: { name: st.name, url: st.url }, title: "📻 " + st.name });
      } },
      { label: "🎬 Watch Party: YouTube / Twitch / Vimeo link…", action: () => start("watch") },
    ]);
  };
  const start = (kind, extra = null) => {
    let data = extra;
    if (!data) {
      const url = prompt(kind === "watch" ? "Paste a YouTube, Twitch or Vimeo link to watch together:" : "Paste a Spotify, SoundCloud or YouTube link to listen to together:");
      if (!url) return;
      if (!/^https:\/\//i.test(url.trim())) { alert("That needs to be a full link starting with https://"); return; }
      const title = prompt("Give it a name (optional):", "") || "";
      data = { url: url.trim().slice(0, 500), title: title.slice(0, 80) || (kind === "watch" ? "Now showing" : "Now playing") };
    }
    set(pr, { kind, ...data, host: uid, hostName: me().screenName, at: Date.now() }).then(() => {
      say(`🎉 ${me().screenName} started a ${PARTY[kind][1]}: ${data.title}. Hit ▶ Tune In at the top!`, "enter");
      import("./engage.js").then((m) => m.awardBadge("host"));
      tuneIn();
    }).catch(() => alert("Couldn't start the party right now."));
  };
  const origOff = pr;
  return origOff;
}

function inviteBuddy(room) {
  const buddies = buddyList();
  if (!buddies.length) { alert("Add some homies first!"); return; }
  openWindow("invite", {
    title: "Invite to Chat", icon: "✉️", width: 300, height: 360,
    render(body) {
      body.innerHTML = `<p class="small">Invite homies to <b>${esc(room)}</b>:</p>
        <ul class="list">${buddies.map((b) => `<li><label class="check"><input type="checkbox" value="${esc(b)}"> ${esc(userName(b))}</label></li>`).join("")}</ul>
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
    // Anti-spam: one invitation per person (the newest), nothing older than a day, at most 3 on screen
    const blocked = new Set(JSON.parse(localStorage.getItem("du.ignored") || "[]"));
    const newest = new Map();
    Object.entries(s.val() || {}).forEach(([id, inv]) => {
      const old = !inv || Date.now() - (inv.ts || 0) > 86400000 || blocked.has(inv.from) || typeof inv.room !== "string";
      const prev = newest.get(inv?.from);
      if (old || (prev && (prev[1].ts || 0) >= (inv.ts || 0))) { remove(ref(db, `invites/${uid}/${id}`)).catch(() => {}); return; }
      if (prev) remove(ref(db, `invites/${uid}/${prev[0]}`)).catch(() => {});
      newest.set(inv.from, [id, inv]);
    });
    const all = [...newest.values()].slice(0, 3);
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
