// Address Book: keep screen names, real names and notes for people you know.
import { auth, db, ref, set, remove, onValue, off, push } from "./firebase.js";
import { openWindow, esc } from "./wm.js";

let book = {};
let bookRef = null;
export function watchAddressBook() {
  bookRef = ref(db, `addressbook/${auth.currentUser.uid}`);
  onValue(bookRef, (s) => { book = s.val() || {}; document.dispatchEvent(new CustomEvent("du:book")); });
}
export function stopAddressBook() { if (bookRef) off(bookRef); bookRef = null; book = {}; }
export const contacts = () => Object.entries(book).map(([id, c]) => ({ id, ...c })).sort((a, b) => (a.name || a.screenName).localeCompare(b.name || b.screenName));

export function openAddressBook({ pick = null } = {}) {
  openWindow(pick ? "addressbook.pick" : "addressbook", {
    title: pick ? "Pick from Address Book" : "Address Book", icon: "📇", width: 380, height: 460, keyword: pick ? null : "addressbook",
    render(body) {
      const paint = () => {
        const list = contacts();
        body.innerHTML = `${pick ? "" : `<form id="ab-new" class="panel"><h3>Add someone</h3>
            <div class="grid2"><label>Name <input id="ab-n" placeholder="Jerry"></label><label>Screen Name <input id="ab-s" placeholder="jerrypowerhouse"></label></div>
            <label>Notes <input id="ab-o" placeholder="Birthday, phone, anything"></label>
            <div class="row"><span></span><button class="btn primary small-btn">Save</button></div></form>`}
          <ul class="list">${list.map((c) => `<li class="row"><span><b>${esc(c.name || c.screenName)}</b> <span class="small muted">${esc(c.screenName || "")}</span>
            ${c.notes ? `<div class="small">${esc(c.notes)}</div>` : ""}</span>
            ${pick ? `<button class="btn primary small-btn" data-pick="${esc(c.screenName)}">Pick</button>` : `<button class="btn small-btn" data-del="${esc(c.id)}">🗑</button>`}</li>`).join("")
            || `<li class="muted small">Your Address Book is empty.</li>`}</ul>`;
        body.querySelector("#ab-new")?.addEventListener("submit", async (e) => {
          e.preventDefault();
          const entry = { name: body.querySelector("#ab-n").value.trim(), screenName: body.querySelector("#ab-s").value.trim(), notes: body.querySelector("#ab-o").value.trim() };
          if (!entry.name && !entry.screenName) return;
          await push(ref(db, `addressbook/${auth.currentUser.uid}`), entry);
        });
        body.querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => remove(ref(db, `addressbook/${auth.currentUser.uid}/${b.dataset.del}`))));
        body.querySelectorAll("[data-pick]").forEach((b) => (b.onclick = () => { pick(b.dataset.pick); body.closest(".win").querySelector(".close").click(); }));
      };
      paint();
      document.addEventListener("du:book", () => document.body.contains(body) && paint());
    },
  });
}
