// DialedUp Mail: a classic mailbox with folders, tabs, a mail list, Quick Find and read receipts.
import { auth, db, ref, get, set, push, remove, update, onValue, off, serverTimestamp, normalize } from "./firebase.js";
import { openWindow, closeWindow, getWindow, esc } from "./wm.js";
import * as sfx from "./sounds.js";
import { me, userName, buddyList } from "./chat.js";
import { renderCard } from "./greetings.js";
import { openAddressBook } from "./addressbook.js";

let mailRef = null, sentRef = null;
let mail = {}, sent = {};
let loaded = false;
let folder = "new";          // new | old | saved | deleted | sent | search
let selected = null;
let sortBy = { key: "ts", dir: -1 };
let findText = "";

const uid = () => auth.currentUser.uid;
const badge = () => document.querySelector('#toolbar [data-open="mail"] .badge');
const buddiesOnly = () => localStorage.getItem("du.mailBuddiesOnly") === "1";
const isSpam = (m) => !m.deleted && (m.spam || (buddiesOnly() && m.from && !buddyList().includes(m.from)));
const isNew = (m) => !m.read && !m.deleted && !isSpam(m);
const unreadCount = () => Object.values(mail).filter(isNew).length;

export function watchMail() {
  mailRef = ref(db, `mail/${uid()}`);
  onValue(mailRef, (s) => {
    const next = s.val() || {};
    const fresh = Object.keys(next).filter((k) => !mail[k] && isNew(next[k]));
    if (loaded && fresh.length) mailsHere();
    mail = next;
    if (!loaded && unreadCount()) setTimeout(mailsHere, 2500);
    loaded = true;
    paintBadge();
    refresh();
  });
  sentRef = ref(db, `mailsent/${uid()}`);
  onValue(sentRef, (s) => { sent = s.val() || {}; refresh(); });
}

export function stopMail() {
  if (mailRef) off(mailRef);
  if (sentRef) off(sentRef);
  mailRef = sentRef = null; mail = {}; sent = {}; loaded = false;
}

function paintBadge() {
  const b = badge();
  if (!b) return;
  const n = unreadCount();
  b.textContent = n > 99 ? "99+" : n || "";
  b.hidden = !n;
}

function mailsHere() {
  sfx.alertBlip();
  if (localStorage.getItem("du.muted") === "1") return;
  try {
    const u = new SpeechSynthesisUtterance("Mail's here!");
    u.rate = 1.05; u.pitch = 1.2;
    speechSynthesis.speak(u);
  } catch {}
}

const refresh = () => { const w = getWindow("mail"); if (w) renderMailbox(w.body); };

// ---------- The mailbox window ----------
export function openMail() {
  openWindow("mail", {
    title: `${me().screenName}'s Mailbox`, icon: "📬", width: 640, height: 470, keyword: "mail",
    render: (body) => renderMailbox(body),
  });
}

function rowsFor(f) {
  if (f === "sent") {
    return Object.entries(sent).map(([id, m]) => ({ id, sent: true, who: m.toName, subject: m.subject, ts: m.ts, read: !!m.readAt, readAt: m.readAt }));
  }
  const all = Object.entries(mail).map(([id, m]) => ({ id, who: m.fromName, subject: m.subject, ts: m.ts, read: m.read, saved: m.saved,
    deleted: m.deleted, body: m.body, card: !!m.card, spam: isSpam(m) }));
  const pick = {
    new: (m) => !m.read && !m.deleted && !m.spam,
    old: (m) => m.read && !m.deleted && !m.saved && !m.spam,
    saved: (m) => m.saved && !m.deleted,
    deleted: (m) => m.deleted,
    spam: (m) => m.spam,
    search: (m) => !m.deleted,
  }[f];
  return all.filter(pick);
}

function renderMailbox(body) {
  const counts = {
    new: rowsFor("new").length, old: rowsFor("old").length, saved: rowsFor("saved").length,
    deleted: rowsFor("deleted").length, spam: rowsFor("spam").length, sent: Object.keys(sent).length,
  };
  let rows = rowsFor(folder);
  const q = findText.toLowerCase();
  if (q) rows = rows.filter((r) => [r.who, r.subject, folder === "search" ? r.body : ""].some((x) => (x || "").toLowerCase().includes(q)));
  rows.sort((a, b) => {
    const A = a[sortBy.key] ?? "", B = b[sortBy.key] ?? "";
    return (typeof A === "number" ? A - B : String(A).localeCompare(String(B))) * sortBy.dir;
  });
  if (selected && !rows.some((r) => r.id === selected)) selected = null;

  const tab = (f, label) => `<button class="mtab ${folder === f ? "on" : ""}" data-f="${f}">${label}</button>`;
  const tree = (f, icon, label, n) =>
    `<li class="${folder === f ? "on" : ""}" data-f="${f}">${icon} ${label}${n ? ` <b>(${n})</b>` : ""}</li>`;
  const arrow = (k) => (sortBy.key === k ? (sortBy.dir > 0 ? " ▲" : " ▼") : "");
  const sentView = folder === "sent";

  body.innerHTML = `<div class="mailbox">
    <div class="mb-head">
      <span class="mb-icon">📬</span>
      <span class="small"><b>${esc(me().screenName)}</b>'s Mailbox · ${counts.new} new</span>
      <button class="btn primary small-btn" data-x="write">✏️ Write</button>
    </div>
    <div class="mb-tabs">
      ${tab("new", `New${counts.new ? ` <span class="pill">${counts.new}</span>` : ""}`)}${tab("old", "Old")}${tab("sent", "Sent")}
      ${tab("saved", "Mail Folders")}${tab("search", "Search Mail")}
    </div>
    <div class="mb-filter">
      <span class="small">${folder === "search" ? "Search every message:" : "Showing:"} <b>${
        { new: "New Mail", old: "Old Mail", sent: "Sent Mail", saved: "Saved", deleted: "Recently Deleted", spam: "Spam", search: "All Mail" }[folder]}</b></span>
      <label class="quickfind">${folder === "search" ? "Search" : "Quick Find"}: <input id="qf" value="${esc(findText)}"></label>
    </div>
    <div class="mb-main">
      <ul class="mb-tree">
        <li class="tree-head">My Mail Folders</li>
        ${tree("new", "📥", "Inbox", counts.new)}
        ${tree("old", "📂", "Old Mail", 0)}
        ${tree("sent", "📤", "Sent", 0)}
        ${tree("saved", "💾", "Saved", counts.saved)}
        ${tree("spam", "🚫", "Spam", counts.spam)}
        ${tree("deleted", "🗑", "Recently Deleted", counts.deleted)}
        <li class="tree-head" style="margin-top:8px">Mail Controls</li>
        <li><label class="check" style="margin:0;font-size:11px"><input type="checkbox" id="mc-buddies" ${buddiesOnly() ? "checked" : ""}> Only buddies can mail me</label></li>
      </ul>
      <div class="mb-list">
        <table>
          <thead><tr>
            <th data-sort="read">Type${arrow("read")}</th><th data-sort="ts">Date${arrow("ts")}</th>
            <th data-sort="who">${sentView ? "To" : "From"}${arrow("who")}</th><th data-sort="subject">Subject${arrow("subject")}</th>
          </tr></thead>
          <tbody>${rows.map((r) => `<tr data-id="${r.id}" class="${r.id === selected ? "sel" : ""} ${!r.read && !sentView ? "unread" : ""}">
            <td>${sentView ? (r.read ? "📖" : "📤") : r.card ? "💌" : r.read ? "✉️" : "📩"}</td>
            <td>${r.ts ? new Date(r.ts).toLocaleDateString([], { month: "numeric", day: "numeric", year: "2-digit" }) : ""}</td>
            <td>${esc(r.who || "")}</td><td>${esc(r.subject || "(no subject)")}</td></tr>`).join("")}</tbody>
        </table>
        ${rows.length ? "" : `<p class="muted small" style="padding:10px">${
          { new: "No new mail. You're all caught up!", old: "No old mail.", sent: "You haven't sent anything yet.",
            saved: "Nothing saved. Select a message and tap Save.", deleted: "Nothing in Recently Deleted.", spam: "No spam. Nice!", search: "Type above to search." }[folder]}</p>`}
      </div>
    </div>
    <div class="mb-actions">
      <button class="btn small-btn ${sentView ? "" : "primary"}" data-x="read" ${selected ? "" : "disabled"}>Read</button>
      ${sentView ? "" : `<button class="btn small-btn" data-x="save" ${selected ? "" : "disabled"}>Save</button>
      <button class="btn small-btn" data-x="keepnew" ${selected ? "" : "disabled"}>Keep As New</button>`}
      <button class="btn small-btn" data-x="status" ${selected ? "" : "disabled"}>Status</button>
      <span style="flex:1"></span>
      ${sentView || folder === "spam" ? "" : `<button class="btn small-btn" data-x="spam" ${selected ? "" : "disabled"}>Report Spam</button>`}
      ${folder === "spam" && selected ? `<button class="btn small-btn" data-x="notspam">Not Spam</button>` : ""}
      ${sentView ? "" : `<button class="btn danger small-btn" data-x="delete" ${selected ? "" : "disabled"}>${folder === "deleted" ? "Delete Forever" : "Delete"}</button>`}
      ${folder === "deleted" && selected ? `<button class="btn small-btn" data-x="undelete">Restore</button>` : ""}
    </div>
  </div>`;

  body.querySelectorAll("[data-f]").forEach((el) => (el.onclick = () => { folder = el.dataset.f === "saved" && el.classList.contains("mtab") ? "saved" : el.dataset.f; selected = null; renderMailbox(body); }));
  body.querySelectorAll("th[data-sort]").forEach((th) => (th.onclick = () => {
    const k = th.dataset.sort;
    sortBy = sortBy.key === k ? { key: k, dir: -sortBy.dir } : { key: k, dir: k === "ts" ? -1 : 1 };
    renderMailbox(body);
  }));
  body.querySelectorAll("tbody tr").forEach((tr) => {
    tr.onclick = () => { selected = tr.dataset.id; body.querySelectorAll("tbody tr").forEach((x) => x.classList.toggle("sel", x === tr)); enableActions(body); };
    tr.ondblclick = () => open(tr.dataset.id);
  });
  const qf = body.querySelector("#qf");
  qf.oninput = () => { findText = qf.value; const pos = qf.selectionStart; renderMailbox(body); const n = body.querySelector("#qf"); n.focus(); n.setSelectionRange(pos, pos); };

  const act = {
    write: () => writeMail(),
    read: () => open(selected),
    save: () => update(ref(db, `mail/${uid()}/${selected}`), { saved: true, read: true }),
    keepnew: () => update(ref(db, `mail/${uid()}/${selected}`), { read: false }),
    status: () => showStatus(selected),
    delete: async () => {
      if (folder === "deleted") { if (confirm("Delete this message forever?")) await remove(ref(db, `mail/${uid()}/${selected}`)); }
      else await update(ref(db, `mail/${uid()}/${selected}`), { deleted: true });
      selected = null;
    },
    undelete: () => update(ref(db, `mail/${uid()}/${selected}`), { deleted: false }),
    spam: async () => {
      const m = mail[selected];
      await update(ref(db, `mail/${uid()}/${selected}`), { spam: true, read: true });
      if (m?.from && confirm(`Also block ${m.fromName} from mailing and IMing you?`)) await set(ref(db, `blocks/${uid()}/${m.from}`), true);
      selected = null;
    },
    notspam: () => update(ref(db, `mail/${uid()}/${selected}`), { spam: false }),
  };
  body.querySelector("#mc-buddies")?.addEventListener("change", (e) => { localStorage.setItem("du.mailBuddiesOnly", e.target.checked ? "1" : "0"); paintBadge(); renderMailbox(body); });
  body.querySelectorAll("[data-x]").forEach((b) => (b.onclick = () => act[b.dataset.x]?.()));
}

function enableActions(body) {
  body.querySelectorAll(".mb-actions [data-x]").forEach((b) => (b.disabled = false));
}

function open(id) {
  if (!id) return;
  if (folder === "sent") return showStatus(id);
  readMail(id);
}

function showStatus(id) {
  const s = folder === "sent" ? sent[id] : null;
  const m = folder === "sent" ? null : mail[id];
  openWindow("mailstatus." + id, {
    title: "Mail Status", icon: "📊", width: 300, height: 220,
    render(body) {
      body.innerHTML = s
        ? `<p><b>To:</b> ${esc(s.toName)}<br><b>Subject:</b> ${esc(s.subject || "(no subject)")}<br><b>Sent:</b> ${s.ts ? new Date(s.ts).toLocaleString() : ""}</p>
           <p>${s.readAt ? `📖 <b>Read</b> on ${new Date(s.readAt).toLocaleString()}` : "📤 <b>Not read yet</b>"}</p>`
        : `<p><b>From:</b> ${esc(m?.fromName || "")}<br><b>Received:</b> ${m?.ts ? new Date(m.ts).toLocaleString() : ""}<br>
           <b>Status:</b> ${m?.deleted ? "Deleted" : m?.saved ? "Saved" : m?.read ? "Read" : "New"}</p>`;
    },
  });
}

function readMail(id) {
  const m = mail[id];
  if (!m) return;
  if (!m.read) {
    update(ref(db, `mail/${uid()}/${id}`), { read: true }).catch(() => {});
    if (m.from && m.sentId) set(ref(db, `mailsent/${m.from}/${m.sentId}/readAt`), serverTimestamp()).catch(() => {});
  }
  openWindow("mail." + id, {
    title: m.subject || "(no subject)", icon: "✉️", width: 420, height: 420,
    render(body) {
      body.innerHTML = `<div class="mail-read-head small">
          <div><b>From:</b> ${esc(m.fromName)}</div><div><b>To:</b> ${esc(me().screenName)}</div>
          <div><b>Date:</b> ${m.ts ? new Date(m.ts).toLocaleString() : ""}</div><div><b>Subject:</b> ${esc(m.subject || "(no subject)")}</div>
        </div>
        ${m.card ? `<div class="mail-card" style="margin-top:8px"></div>` : ""}
        <div class="panel" style="margin-top:8px;white-space:pre-wrap;min-height:${m.card ? 0 : 120}px">${esc(m.body)}</div>
        <div class="row">
          <span><button class="btn small-btn" data-x="save">💾 Save</button> <button class="btn danger small-btn" data-x="del">Delete</button></span>
          <span><button class="btn small-btn" data-x="fwd">Forward</button> <button class="btn primary small-btn" data-x="reply">Reply</button></span>
        </div>`;
      if (m.card) renderCard(body.querySelector(".mail-card"), { ...m.card, fromName: m.fromName });
      const quoted = "\n\n----- " + m.fromName + " wrote -----\n" + m.body;
      body.querySelector("[data-x=reply]").onclick = () => writeMail(m.fromName, "Re: " + (m.subject || "").replace(/^Re: /, ""), quoted);
      body.querySelector("[data-x=fwd]").onclick = () => writeMail("", "Fwd: " + (m.subject || ""), quoted);
      body.querySelector("[data-x=save]").onclick = () => update(ref(db, `mail/${uid()}/${id}`), { saved: true });
      body.querySelector("[data-x=del]").onclick = async () => { await update(ref(db, `mail/${uid()}/${id}`), { deleted: true }); closeWindow("mail." + id); };
    },
  });
}

export function writeMail(to = "", subject = "", text = "") {
  openWindow("mail.write", {
    title: "Write Mail", icon: "✏️", width: 420, height: 460, keyword: "write",
    render(body) {
      body.innerHTML = `<form id="wm">
        <label>Send To (screen names, separated by commas) <span style="display:flex;gap:4px"><input id="to" value="${esc(to)}" required>
          <button type="button" class="btn small-btn" id="pick-ab" title="Address Book">📇</button></span></label>
        <label>Subject <input id="subj" value="${esc(subject)}"></label>
        <label>Message <textarea id="mbody" rows="9">${esc(text)}</textarea></label>
        <p class="error" id="werr"></p>
        <div class="row"><span class="small muted">Mail goes to their DialedUp mailbox.</span><button class="btn primary">Send Now</button></div></form>`;
      body.querySelector("#pick-ab").onclick = () => openAddressBook({ pick: (sn) => {
        const box = body.querySelector("#to");
        box.value = box.value.trim() ? box.value.replace(/,?\s*$/, ", ") + sn : sn;
      } });
      body.querySelector("#wm").onsubmit = async (e) => {
        e.preventDefault();
        const err = body.querySelector("#werr");
        const names = body.querySelector("#to").value.split(",").map((x) => x.trim()).filter(Boolean);
        const subj = body.querySelector("#subj").value.slice(0, 120);
        const text_ = body.querySelector("#mbody").value.slice(0, 5000);
        const missing = [];
        let okCount = 0;
        for (const toName of names) {
          const target = (await get(ref(db, `screennames/${normalize(toName)}`))).val();
          if (!target) { missing.push(toName); continue; }
          try {
            const sentItem = await push(ref(db, `mailsent/${uid()}`), { to: target, toName: userName(target) || toName, subject: subj, ts: serverTimestamp() });
            await push(ref(db, `mail/${target}`), { from: uid(), fromName: me().screenName, subject: subj, body: text_,
              ts: serverTimestamp(), read: false, sentId: sentItem.key });
            okCount++;
          } catch { missing.push(toName + " (blocked?)"); }
        }
        if (missing.length) { err.textContent = `Couldn't send to: ${missing.join(", ")}`; if (!okCount) return; }
        sfx.imOut();
        if (!missing.length) closeWindow("mail.write");
      };
    },
  });
}

/** Sends an E-Greeting card to a screen name through Mail. */
export async function sendCard(toName, card) {
  const target = (await get(ref(db, `screennames/${normalize(toName)}`))).val();
  if (!target) throw new Error(`No one has the screen name "${toName}".`);
  const subject = "💌 " + card.headline;
  const sentItem = await push(ref(db, `mailsent/${uid()}`), { to: target, toName: userName(target) || toName, subject, ts: serverTimestamp() });
  try {
    await push(ref(db, `mail/${target}`), { from: uid(), fromName: me().screenName, subject, body: card.text ? "" : "(You got a card!)",
      card: { design: card.design, headline: card.headline, text: card.text }, ts: serverTimestamp(), read: false, sentId: sentItem.key });
  } catch { throw new Error("Couldn't send the card. They may have blocked you."); }
  sfx.imOut();
}
