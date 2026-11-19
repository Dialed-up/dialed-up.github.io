// Owner-only error bar: if something on the page breaks, the owner sees exactly what, so it can be fixed.
import { auth } from "./firebase.js";

const OWNER = "Dh35JEPVTiWIB96X03RGeiVmQN03";
let bar = null;
const seen = new Set();
function show(msg) {
  if (auth.currentUser?.uid !== OWNER || !msg) return;
  const text = String(msg).slice(0, 300);
  if (seen.has(text)) return;
  seen.add(text);
  if (!bar) {
    bar = document.createElement("div");
    bar.className = "diag-bar";
    bar.innerHTML = `<b>⚠️ Owner error report</b> (screenshot this for support) <button type="button">✕</button><ol></ol>`;
    bar.querySelector("button").onclick = () => { bar.remove(); bar = null; seen.clear(); };
    document.body.appendChild(bar);
  }
  bar.querySelector("ol").insertAdjacentHTML("beforeend", `<li></li>`);
  bar.querySelector("ol li:last-child").textContent = `${new Date().toLocaleTimeString()} · ${text}`;
}
window.addEventListener("error", (e) => show(`${e.message} @ ${(e.filename || "").split("/").pop()}:${e.lineno}`));
window.addEventListener("unhandledrejection", (e) => show(`Unhandled: ${e.reason?.code || ""} ${e.reason?.message || e.reason}`));
