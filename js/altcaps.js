// aLt CaPs: a little checkbox under every place you type. When it's on, your typing comes out
// aLtErNaTiNg like 1999. One setting for the whole site (it follows your account).
const KEY = "du.altcaps";
const isOn = () => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } };

/** "hello world" → "hElLo WoRlD" (only letters count, so spaces and punctuation don't break the pattern). */
export function altCaps(text) {
  let i = 0;
  return String(text).replace(/\p{L}/gu, (c) => (i++ % 2 ? c.toUpperCase() : c.toLowerCase()));
}

// Which boxes get it: every multi-line box, plus one-line boxes where you write to people.
const SKIP_TYPES = new Set(["password", "email", "url", "number", "search", "color", "file", "range", "checkbox", "radio", "date", "time", "datetime-local", "hidden"]);
function wants(el) {
  if (el.dataset.noAltcaps != null) return false;
  if (el.tagName === "TEXTAREA") return !el.readOnly;
  if (el.tagName !== "INPUT" || el.readOnly || SKIP_TYPES.has(el.type)) return false;
  return !!el.closest(".cform, .compose, [data-altcaps]");   // comment boxes and chat boxes
}

function apply(el) {
  if (!isOn()) return;
  const before = el.value, after = altCaps(before);
  if (before === after) return;
  const s = el.selectionStart, e = el.selectionEnd;
  el.value = after;   // same length, so the cursor stays put
  try { el.setSelectionRange(s, e); } catch {}
}

const label = (on) => `${on ? "☑" : "☐"} aLt CaPs <b>${on ? "ON" : "OFF"}</b>`;
function paintAll() {
  document.querySelectorAll("button.altcaps").forEach((b) => { b.innerHTML = label(isOn()); b.setAttribute("aria-pressed", String(isOn())); b.classList.toggle("on", isOn()); });
}

function addBox(el) {
  if (el.dataset.altcapsDone) return;
  el.dataset.altcapsDone = "1";
  // A plain button (not a tick box) so it toggles reliably on every phone
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "altcaps" + (isOn() ? " on" : "");
  toggle.title = "Type lIkE tHiS — every other letter";
  toggle.setAttribute("aria-pressed", String(isOn()));
  toggle.innerHTML = label(isOn());
  toggle.addEventListener("click", (ev) => {
    ev.preventDefault();
    const on = !isOn();
    try { localStorage.setItem(KEY, on ? "1" : "0"); } catch {}
    paintAll();
    if (on) apply(el);
  });
  // Put it where it fits: above a chat box, under a comment box, or right under the text box
  const compose = el.closest(".compose");
  const form = el.closest(".cform");
  if (compose) compose.before(toggle);
  else if (form) form.after(toggle);
  else if (el.parentElement?.classList.contains("story-preview")) el.parentElement.after(toggle);
  else el.after(toggle);
}

document.addEventListener("input", (e) => {
  const el = e.target;
  if (e.isComposing || !(el instanceof HTMLElement) || !wants(el)) return;
  apply(el);
}, true);
document.addEventListener("compositionend", (e) => { if (wants(e.target)) apply(e.target); }, true);

const scan = (root) => root.querySelectorAll?.("textarea, input").forEach((el) => wants(el) && addBox(el));
new MutationObserver((muts) => muts.forEach((m) => m.addedNodes.forEach((n) => n.nodeType === 1 && (wants(n) ? addBox(n) : scan(n))))).observe(document.documentElement, { childList: true, subtree: true });
scan(document);
window.addEventListener("storage", (e) => e.key === KEY && paintAll());
document.addEventListener("du:settings", paintAll);
