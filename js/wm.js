// A tiny window manager: draggable, resizable windows with a taskbar.
const desk = () => document.getElementById("desk");
const bar = () => document.getElementById("taskbar-windows");
const wins = new Map();
let z = 10;
let cascade = 0;

export function openWindow(id, { title, icon = "🗔", width = 360, height = 420, x, y, render, onClose, className = "" }) {
  if (wins.has(id)) { focus(id); const w = wins.get(id); w.el.classList.remove("minimized"); return w; }
  const el = document.createElement("section");
  el.className = "win " + className;
  el.dataset.id = id;
  const dw = desk().clientWidth, dh = desk().clientHeight;
  const w = Math.min(width, dw - 12), h = Math.min(height, dh - 12);
  const step = (cascade++ % 6) * 26;
  el.style.width = w + "px";
  el.style.height = h + "px";
  el.style.left = (x ?? Math.min(10 + step, dw - w - 6)) + "px";
  el.style.top = (y ?? Math.min(10 + step, dh - h - 6)) + "px";
  el.innerHTML = `
    <header class="win-title">
      <span class="win-icon">${icon}</span><span class="win-name"></span>
      <span class="win-buttons">
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
  w.el.remove();
  w.tb.remove();
  wins.delete(id);
}

export function closeAll() { [...wins.keys()].forEach(closeWindow); cascade = 0; }
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
    const up = () => { handle.removeEventListener("pointermove", move); handle.removeEventListener("pointerup", up); };
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
    const up = () => { grip.removeEventListener("pointermove", move); grip.removeEventListener("pointerup", up); };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up);
  });
}

/** Safe text → HTML. */
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
