// A tiny window manager: draggable, resizable windows with a taskbar.
const desk = () => document.getElementById("desk");
const bar = () => document.getElementById("taskbar-windows");
const wins = new Map();
let z = 10;
let cascadeCount = 0;

export function openWindow(id, { title, icon = "🗔", width = 360, height = 420, x, y, render, onClose, className = "", keyword = null }) {
  if (wins.has(id)) { focus(id); const w = wins.get(id); w.el.classList.remove("minimized"); return w; }
  const el = document.createElement("section");
  el.className = "win " + className;
  el.dataset.id = id;
  const dw = desk().clientWidth, dh = desk().clientHeight;
  const small = dw < 600;
  const shortScreen = dh < 420;
  let w = Math.min(width, small ? Math.round(dw * 0.86) : dw - 12);
  let h = Math.min(height, small ? Math.round(dh * 0.7) : shortScreen ? dh - 10 : dh - 12);
  const step = (cascadeCount++ % 6) * (small ? 18 : 26);
  let left = x ?? Math.min(8 + step, dw - w - 6);
  let top = y ?? Math.min(8 + step, dh - h - 6);
  const saved = savedGeometry(id);
  if (saved) {
    w = Math.min(saved.w, dw); h = Math.min(saved.h, dh);
    left = Math.min(Math.max(saved.x, 0), Math.max(0, dw - w)); top = Math.min(Math.max(saved.y, 0), Math.max(0, dh - 40));
  }
  el.style.width = w + "px";
  el.style.height = h + "px";
  el.style.left = left + "px";
  el.style.top = top + "px";
  el.classList.add("opening");
  el.addEventListener("animationend", () => el.classList.remove("opening"), { once: true });
  popSound();
  el.innerHTML = `
    <header class="win-title">
      <span class="win-icon">${icon}</span><span class="win-name"></span>
      <span class="win-buttons">
        ${keyword ? `<button class="wb fav" title="Add to Favorite Places">❤️</button>` : ""}
        <button class="wb min" title="Minimize">_</button>
        <button class="wb max" title="Maximize">□</button>
        <button class="wb close" title="Close">✕</button>
      </span>
    </header>
    <div class="win-body"></div>
    <div class="win-resize" title="Resize"></div>`;
  el.querySelector(".win-name").textContent = title;
  desk().appendChild(el);

  const tb = document.createElement("button");
  tb.className = "task";
  tb.innerHTML = `<span>${icon}</span> <span class="task-name"></span>`;
  tb.querySelector(".task-name").textContent = title;
  tb.onclick = () => {
    if (el.classList.contains("minimized") || !el.classList.contains("front")) { el.classList.remove("minimized"); focus(id); }
    else el.classList.add("minimized");
  };
  bar().appendChild(tb);

  const entry = { id, el, tb, body: el.querySelector(".win-body"), onClose };
  wins.set(id, entry);
  el.addEventListener("pointerdown", () => focus(id));
  el.querySelector(".fav")?.addEventListener("click", (e) => {
    e.stopPropagation();
    document.dispatchEvent(new CustomEvent("du:favorite", { detail: { keyword, label: title } }));
    e.target.textContent = "💖";
  });
  el.querySelector(".min").onclick = (e) => { e.stopPropagation(); el.classList.add("minimized"); el.classList.remove("front"); };
  el.querySelector(".max").onclick = () => el.classList.toggle("maximized");
  el.querySelector(".close").onclick = () => closeWindow(id);
  el.querySelector(".win-title").addEventListener("dblclick", () => el.classList.toggle("maximized"));
  makeDraggable(el, el.querySelector(".win-title"));
  makeResizable(el, el.querySelector(".win-resize"));
  if (render) render(entry.body, entry);
  focus(id);
  return entry;
}

export function setTitle(id, title) {
  const w = wins.get(id);
  if (!w) return;
  w.el.querySelector(".win-name").textContent = title;
  w.tb.querySelector(".task-name").textContent = title;
}

export function closeWindow(id) {
  const w = wins.get(id);
  if (!w) return;
  w.onClose?.();
  wins.delete(id);
  w.tb.remove();
  w.el.classList.add("closing");
  setTimeout(() => w.el.remove(), 140);
}

// ---------- remembering where windows were ----------
const geoKey = (id) => "du.win." + id.split(".")[0] + (id.startsWith("im.") || id === "buddies" ? "" : "." + id);
function savedGeometry(id) {
  try { return JSON.parse(localStorage.getItem(geoKey(id)) || "null"); } catch { return null; }
}
function saveGeometry(el) {
  const id = el.dataset.id;
  localStorage.setItem(geoKey(id), JSON.stringify({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight }));
}

// ---------- a soft "pop" when a window opens ----------
let popCtx = null;
function popSound() {
  if (localStorage.getItem("du.muted") === "1") return;
  try {
    popCtx = popCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = popCtx.createOscillator(), g = popCtx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(520, popCtx.currentTime);
    o.frequency.exponentialRampToValueAtTime(880, popCtx.currentTime + 0.06);
    g.gain.setValueAtTime(0.06, popCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, popCtx.currentTime + 0.09);
    o.connect(g).connect(popCtx.destination);
    o.start(); o.stop(popCtx.currentTime + 0.1);
  } catch {}
}

// ---------- right-click / long-press menus ----------
let menuEl = null;
export function contextMenu(x, y, items) {
  closeMenu();
  menuEl = document.createElement("div");
  menuEl.className = "ctx glossy";
  items.forEach((it) => {
    if (it === "-") { menuEl.appendChild(Object.assign(document.createElement("hr"), {})); return; }
    const b = document.createElement("button");
    b.textContent = it.label;
    if (it.danger) b.className = "danger";
    b.onclick = () => { closeMenu(); it.action(); };
    menuEl.appendChild(b);
  });
  document.body.appendChild(menuEl);
  const r = menuEl.getBoundingClientRect();
  menuEl.style.left = Math.min(x, innerWidth - r.width - 6) + "px";
  menuEl.style.top = Math.min(y, innerHeight - r.height - 6) + "px";
  setTimeout(() => document.addEventListener("pointerdown", outside, { once: true }), 0);
}
function outside(e) { if (menuEl && !menuEl.contains(e.target)) closeMenu(); else if (menuEl) document.addEventListener("pointerdown", outside, { once: true }); }
export function closeMenu() { menuEl?.remove(); menuEl = null; }

/** Calls `open(x, y)` on right-click or a long press (for phones). */
export function onMenu(el, open) {
  el.addEventListener("contextmenu", (e) => { e.preventDefault(); open(e.clientX, e.clientY); });
  let timer = null, moved = false;
  el.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse") return;
    moved = false;
    timer = setTimeout(() => { el.dataset.longpress = "1"; open(e.clientX, e.clientY); }, 500);
  });
  el.addEventListener("pointermove", () => { moved = true; clearTimeout(timer); });
  el.addEventListener("pointerup", () => clearTimeout(timer));
  el.addEventListener("click", (e) => { if (el.dataset.longpress) { e.stopImmediatePropagation(); e.preventDefault(); delete el.dataset.longpress; } }, true);
}

/** Every open window, front-most first. */
export function listWindows() {
  return [...wins.values()].sort((a, b) => Number(b.el.style.zIndex) - Number(a.el.style.zIndex))
    .map((w) => ({ id: w.id, title: w.el.querySelector(".win-name").textContent, minimized: w.el.classList.contains("minimized") }));
}

export function frontWindowId() {
  const open = listWindows().filter((w) => !w.minimized);
  return open[0]?.id ?? null;
}

export function restore(id) {
  const w = wins.get(id);
  if (!w) return;
  w.el.classList.remove("minimized");
  focus(id);
}

export function cascade() {
  let i = 0;
  [...wins.values()].filter((w) => w.id !== "buddies").forEach((w) => {
    w.el.classList.remove("minimized", "maximized");
    w.el.style.left = 10 + i * 24 + "px";
    w.el.style.top = 10 + i * 24 + "px";
    focus(w.id);
    i++;
  });
}

export function tile() {
  const list = [...wins.values()].filter((w) => !w.el.classList.contains("minimized"));
  if (!list.length) return;
  const d = desk();
  const cols = Math.ceil(Math.sqrt(list.length)), rows = Math.ceil(list.length / cols);
  const w = Math.floor(d.clientWidth / cols), h = Math.floor(d.clientHeight / rows);
  list.forEach((win, i) => {
    win.el.classList.remove("maximized");
    Object.assign(win.el.style, { left: (i % cols) * w + "px", top: Math.floor(i / cols) * h + "px", width: w - 4 + "px", height: h - 4 + "px" });
  });
}

export function closeAll() { [...wins.keys()].forEach(closeWindow); cascadeCount = 0; }
export const getWindow = (id) => wins.get(id);

export function focus(id) {
  const w = wins.get(id);
  if (!w) return;
  wins.forEach((o) => { o.el.classList.remove("front"); o.tb.classList.remove("active"); });
  w.el.style.zIndex = ++z;
  w.el.classList.add("front");
  w.tb.classList.add("active");
  w.tb.classList.remove("flash");
}

export function flash(id) {
  const w = wins.get(id);
  if (w && !w.el.classList.contains("front")) w.tb.classList.add("flash");
}

function makeDraggable(el, handle) {
  handle.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button") || el.classList.contains("maximized")) return;
    const sx = e.clientX, sy = e.clientY, ox = el.offsetLeft, oy = el.offsetTop;
    handle.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const d = desk();
      el.style.left = Math.min(Math.max(ox + ev.clientX - sx, 60 - el.offsetWidth), d.clientWidth - 60) + "px";
      el.style.top = Math.min(Math.max(oy + ev.clientY - sy, 0), d.clientHeight - 30) + "px";
    };
    const up = () => { handle.removeEventListener("pointermove", move); handle.removeEventListener("pointerup", up); saveGeometry(el); };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
  });
}

function makeResizable(el, grip) {
  grip.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    const sx = e.clientX, sy = e.clientY, ow = el.offsetWidth, oh = el.offsetHeight;
    grip.setPointerCapture(e.pointerId);
    const move = (ev) => {
      el.style.width = Math.max(220, ow + ev.clientX - sx) + "px";
      el.style.height = Math.max(160, oh + ev.clientY - sy) + "px";
    };
    const up = () => { grip.removeEventListener("pointermove", move); grip.removeEventListener("pointerup", up); saveGeometry(el); };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up);
  });
}

/** Safe text → HTML. */
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));


// ---------- keep windows on screen when the phone rotates or the window resizes ----------
export function refit() {
  const d = desk();
  if (!d) return;
  const dw = d.clientWidth, dh = d.clientHeight;
  if (!dw || !dh) return;
  wins.forEach((w) => {
    const el = w.el;
    if (w.id === "buddies") {
      // the Buddy List stays docked on the right, full height
      const bw = Math.min(Math.max(el.offsetWidth, 190), Math.round(dw * (dw > dh ? 0.32 : 0.5)), 260);
      Object.assign(el.style, { width: bw + "px", height: dh - 12 + "px", left: dw - bw - 6 + "px", top: "6px" });
      return;
    }
    const nw = Math.min(el.offsetWidth, dw - 8), nh = Math.min(el.offsetHeight, dh - 8);
    const nx = Math.min(Math.max(el.offsetLeft, 0), dw - nw - 4), ny = Math.min(Math.max(el.offsetTop, 0), dh - nh - 4);
    Object.assign(el.style, { width: nw + "px", height: nh + "px", left: Math.max(0, nx) + "px", top: Math.max(0, ny) + "px" });
  });
}
let refitTimer = null;
window.addEventListener("resize", () => { clearTimeout(refitTimer); refitTimer = setTimeout(refit, 120); });
window.addEventListener("orientationchange", () => setTimeout(refit, 300));
