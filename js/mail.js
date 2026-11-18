// DialedUp Mail: send mail to any screen name. Inbox, Old Mail and Sent.
import { auth, db, ref, get, set, push, remove, update, onValue, off, serverTimestamp, normalize } from "./firebase.js";
import { openWindow, closeWindow, getWindow, esc } from "./wm.js";
import * as sfx from "./sounds.js";
import { me, userName } from "./chat.js";

let mailRef = null;
let mail = {};
let loaded = false;
const badge = () => document.querySelector('#toolbar [data-open="mail"] .badge');

export function watchMail() {
  const uid = auth.currentUser.uid;
  mailRef = ref(db, `mail/${uid}`);
  onValue(mailRef, (s) => {
    const next = s.val() || {};
    const newOnes = Object.keys(next).filter((k) => !mail[k] && !next[k].read);
    if (loaded && newOnes.length) mailsHere();
    mail = next;
    if (!loaded && unreadCount()) setTimeout(mailsHere, 2500);   // after the welcome chime
    loaded = true;
    paintBadge();
    if (getWindow("mail")) renderMailbox(getWindow("mail").body);
  });
}

export function stopMail() { if (mailRef) off(mailRef); mailRef = null; mail = {}; loaded = false; }

const unreadCount = () => Object.values(mail).filter((m) => !m.read).length;

function paintBadge() {
  const b = badge();
  if (!b) return;
  const n = unreadCount();
  b.textContent = n || "";
  b.hidden = !n;
}

function mailsHere() {
  sfx.alertBlip();
  try {
    if (!localStorage.getItem("du.muted") || localStorage.getItem("du.muted") === "0") {
      const u = new SpeechSynthesisUtterance("Mail's here!");
      u.rate = 1.05; u.pitch = 1.2;
      speechSynthesis.speak(u);
    }
  } catch {}
}

let tab = "new";
export function openMail() {
  openWindow("mail", { title: "DialedUp Mail", icon: "📬", width: 420, height: 480, render: (body) => renderMailbox(body) });
}

function renderMailbox(body) {
  const all = Object.entries(mail).sort((a, b) => (b[1].ts || 0) - (a[1].ts || 0));
  const list = tab === "new" ? all.filter(([, m]) => !m.read) : tab === "old" ? all.filter(([, m]) => m.read) : null;
  body.innerHTML = `<div class="row" style="justify-content:flex-start;margin-bottom:8px">
      <button class="btn small-btn ${tab === "new" ? "primary" : ""}" data-t="new">New Mail (${unreadCount()})</button>
      <button class="btn small-btn ${tab === "old" ? "primary" : ""}" data-t="old">Old Mail</button>
      <button class="btn small-btn ${tab === "sent" ? "primary" : ""}" data-t="sent">Sent</button>
      <button class="btn small-btn" data-t="write">✏️ Write</button></div>
    <div id="mlist"></div>`;
  body.querySelectorAll("[data-t]").forEach((b) => (b.onclick = () => {
    if (b.dataset.t === "write") return writeMail();
    tab = b.dataset.t; renderMailbox(body);
  }));
  const out = body.querySelector("#mlist");
  if (tab === "sent") {
    get(ref(db, `mailsent/${auth.currentUser.uid}`)).then((s) => {
      const sent = Object.entries(s.val() || {}).sort((a, b) => (b[1].ts || 0) - (a[1].ts || 0));
      out.innerHTML = sent.length ? `<ul class="list">${sent.map(([, m]) =>
        `<li><b>To ${esc(m.toName)}</b> — ${esc(m.subject || "(no subject)")}<div class="small muted">${new Date(m.ts).toLocaleString()}</div></li>`).join("")}</ul>`
        : `<p class="muted">Nothing sent yet.</p>`;
    });
    return;
  }
  out.innerHTML = list.length ? `<ul class="list">${list.map(([id, m]) =>
    `<li><a href="#" data-m="${id}"><b>${esc(m.fromName)}</b> — ${esc(m.subject || "(no subject)")}</a>
     <div class="small muted">${m.ts ? new Date(m.ts).toLocaleString() : ""}</div></li>`).join("")}</ul>`
    : `<p class="muted">${tab === "new" ? "No new mail. Your mailbox is all caught up!" : "No old mail."}</p>`;
  out.querySelectorAll("[data-m]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); readMail(a.dataset.m); }));
}

function readMail(id) {
  const m = mail[id];
  if (!m) return;
  const uid = auth.currentUser.uid;
  if (!m.read) update(ref(db, `mail/${uid}/${id}`), { read: true }).catch(() => {});
  openWindow("mail." + id, {
    title: m.subject || "(no subject)", icon: "✉️", width: 380, height: 400,
    render(body) {
      body.innerHTML = `<div class="small"><b>From:</b> ${esc(m.fromName)}<br><b>Sent:</b> ${m.ts ? new Date(m.ts).toLocaleString() : ""}</div>
        <div class="panel" style="margin-top:8px;white-space:pre-wrap">${esc(m.body)}</div>
        <div class="row"><button class="btn danger small-btn" data-x="del">Delete</button>
          <button class="btn primary small-btn" data-x="reply">Reply</button></div>`;
      body.querySelector("[data-x=reply]").onclick = () => writeMail(m.fromName, "Re: " + (m.subject || "").replace(/^Re: /, ""),
        "\n\n----- " + m.fromName + " wrote -----\n" + m.body);
      body.querySelector("[data-x=del]").onclick = async () => { await remove(ref(db, `mail/${uid}/${id}`)); closeWindow("mail." + id); };
    },
  });
}

export function writeMail(to = "", subject = "", text = "") {
  openWindow("mail.write", {
    title: "Write Mail", icon: "✏️", width: 380, height: 440,
    render(body) {
      body.innerHTML = `<form id="wm">
        <label>To (screen name) <input id="to" value="${esc(to)}" required></label>
        <label>Subject <input id="subj" value="${esc(subject)}"></label>
        <label>Message <textarea id="mbody" rows="8">${esc(text)}</textarea></label>
        <p class="error" id="werr"></p>
        <div class="row"><span></span><button class="btn primary">Send Now</button></div></form>`;
      body.querySelector("#wm").onsubmit = async (e) => {
        e.preventDefault();
        const err = body.querySelector("#werr");
        const toName = body.querySelector("#to").value.trim();
        const target = (await get(ref(db, `screennames/${normalize(toName)}`))).val();
        if (!target) { err.textContent = `No one has the screen name "${toName}".`; return; }
        const uid = auth.currentUser.uid;
        const msg = { from: uid, fromName: me().screenName, subject: body.querySelector("#subj").value.slice(0, 120),
          body: body.querySelector("#mbody").value.slice(0, 5000), ts: serverTimestamp(), read: false };
        try {
          await push(ref(db, `mail/${target}`), msg);
          await push(ref(db, `mailsent/${uid}`), { to: target, toName: userName(target) || toName, subject: msg.subject, ts: serverTimestamp() });
          sfx.imOut();
          closeWindow("mail.write");
        } catch { err.textContent = "Couldn't send. They may have blocked you, or the site's rules need updating."; }
      };
    },
  });
}
