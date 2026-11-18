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
  if (el.closest(".altcaps") || el.dataset.noAltcaps != null) return false;
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

function paintAll() { document.querySelectorAll(".altcaps input").forEach((c) => (c.checked = isOn())); }

function addBox(el) {
  if (el.dataset.altcapsDone) return;
  el.dataset.altcapsDone = "1";
  const label = document.createElement("label");
  label.className = "altcaps";
  label.title = "Type lIkE tHiS — every other letter";
  label.innerHTML = `<input type="checkbox" ${isOn() ? "checked" : ""}> aLt CaPs`;
  label.querySelector("input").onchange = (ev) => {
    try { localStorage.setItem(KEY, ev.target.checked ? "1" : "0"); } catch {}
    paintAll();
    if (ev.target.checked) { apply(el); el.focus(); }
  };
  // Put it where it fits: above a chat box, under a comment box, or right under the text box
  const compose = el.closest(".compose");
  const form = el.closest(".cform");
  if (compose) compose.before(label);
  else if (form) form.after(label);
  else if (el.parentElement?.classList.contains("story-preview")) el.parentElement.after(label);
  else el.after(label);
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
