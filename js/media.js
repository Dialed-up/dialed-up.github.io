// Photos, videos and voice notes that show right inside an IM.
// Stored in media/{conv}/{mid} (details) and mediachunks/{conv}/{mid}/{i} (the file, in pieces).
import { db, ref, get, set, remove } from "./firebase.js";
import { esc } from "./wm.js";

const CHUNK = 192 * 1024;
export const MAX_VIDEO = 8 * 1024 * 1024;
const cache = new Map();   // mid → object URL

const sizeLabel = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB");
export const isMedia = (file) => /^(image|video|audio)\//.test(file.type || "");

function toB64(bytes) {
  let bin = "";
  for (let j = 0; j < bytes.length; j += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(j, j + 0x8000));
  return btoa(bin);
}

/** Shrinks photos so they send fast and don't fill up the server. */
async function shrinkImage(file) {
  if (file.type === "image/gif" && file.size < 3 * 1024 * 1024) return { blob: file };
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = url; });
    const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise((ok) => c.toBlob(ok, "image/jpeg", 0.82));
    return { blob, w: c.width, h: c.height };
  } finally { URL.revokeObjectURL(url); }
}

/** Uploads a photo / video / voice note. Returns the details to put on the IM. onProgress(0..1). */
export async function uploadMedia(conv, from, file, { kind, dur = 0, name = "" } = {}, onProgress = () => {}) {
  kind = kind || (file.type.startsWith("image/") ? "photo" : file.type.startsWith("video/") ? "video" : "audio");
  let blob = file, w = 0, h = 0;
  if (kind === "photo") ({ blob, w = 0, h = 0 } = await shrinkImage(file));
  if (kind === "video" && blob.size > MAX_VIDEO) throw new Error(`Videos can be up to ${sizeLabel(MAX_VIDEO)}. That one is ${sizeLabel(blob.size)}.`);
  if (blob.size > 10 * 1024 * 1024) throw new Error("That's over 10 MB.");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const n = Math.max(1, Math.ceil(bytes.length / CHUNK));
  const mid = "m" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const mime = blob.type || file.type || "application/octet-stream";
  const info = { mid, kind, mime, size: bytes.length, n, ...(w ? { w, h } : {}), ...(dur ? { dur: Math.round(dur) } : {}), ...(name ? { name: name.slice(0, 80) } : {}) };
  await set(ref(db, `media/${conv}/${mid}`), { ...info, from, done: false });
  for (let i = 0; i < n; i++) {
    await set(ref(db, `mediachunks/${conv}/${mid}/${i}`), toB64(bytes.subarray(i * CHUNK, (i + 1) * CHUNK)));
    onProgress((i + 1) / n);
  }
  await set(ref(db, `media/${conv}/${mid}/done`), true);
  cache.set(mid, URL.createObjectURL(new Blob([bytes], { type: mime })));
  return info;
}

async function load(conv, info) {
  if (cache.has(info.mid)) return cache.get(info.mid);
  const chunks = (await get(ref(db, `mediachunks/${conv}/${info.mid}`))).val();
  if (!chunks) throw new Error("gone");
  const list = Array.isArray(chunks) ? chunks : Object.keys(chunks).sort((a, b) => a - b).map((k) => chunks[k]);
  const parts = list.map((b64) => { const bin = atob(b64); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; });
  const url = URL.createObjectURL(new Blob(parts, { type: info.mime }));
  cache.set(info.mid, url);
  return url;
}

const fmtDur = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

/** Fills a placeholder element in the transcript with the photo / video / voice note. */
export async function paintMedia(el, conv) {
  if (el.dataset.painted) return;
  el.dataset.painted = "1";
  const info = JSON.parse(el.dataset.media);
  const show = async () => {
    el.innerHTML = `<span class="small muted">${info.kind === "photo" ? "📷 Loading photo…" : info.kind === "video" ? "🎬 Loading video…" : "🎙 Loading voice note…"}</span>`;
    try {
      const url = await load(conv, info);
      if (info.kind === "photo") {
        el.innerHTML = `<img src="${url}" alt="Photo" class="im-photo" ${info.w ? `width="${info.w}" height="${info.h}"` : ""}>`;
        el.querySelector("img").onclick = () => openViewer(url, "photo");
      } else if (info.kind === "video") {
        el.innerHTML = `<video src="${url}" controls playsinline preload="metadata" class="im-video"></video>`;
      } else {
        el.innerHTML = `<div class="voice-note">🎙 <audio src="${url}" controls preload="metadata"></audio>${info.dur ? `<span class="small muted">${fmtDur(info.dur)}</span>` : ""}</div>`;
      }
      el.insertAdjacentHTML("beforeend", `<a class="small media-save" href="${url}" download="${esc(info.name || (info.kind === "photo" ? "photo.jpg" : info.kind === "video" ? "video" : "voice-note"))}">💾 Save</a>`);
    } catch { el.innerHTML = `<span class="small muted">This ${info.kind === "audio" ? "voice note" : info.kind} isn't available anymore.</span>`; }
  };
  if (info.kind === "video" && !cache.has(info.mid)) {
    el.innerHTML = `<button class="media-tap">🎬 Tap to play video <span class="small muted">(${sizeLabel(info.size)})</span></button>`;
    el.querySelector("button").onclick = show;
  } else show();
}

function openViewer(url) {
  const v = document.createElement("div");
  v.className = "media-viewer";
  v.innerHTML = `<img src="${url}" alt=""><button aria-label="Close">✕</button>`;
  v.onclick = () => v.remove();
  document.body.appendChild(v);
}

export async function deleteMedia(conv, mid) {
  await remove(ref(db, `mediachunks/${conv}/${mid}`)).catch(() => {});
  await remove(ref(db, `media/${conv}/${mid}`)).catch(() => {});
}

// ---------- Voice notes ----------
/** Starts recording; returns { stop() → Promise<{blob, dur}>, cancel() }. */
export async function startRecording(onTick = () => {}) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const type = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg"].find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || "";
  const rec = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 48000 } : undefined);
  const parts = [];
  const started = Date.now();
  rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
  rec.start(250);
  const timer = setInterval(() => {
    const s = (Date.now() - started) / 1000;
    onTick(s);
    if (s >= 120) result.stop();   // 2 minute limit
  }, 250);
  let finished = null;
  const end = () => { clearInterval(timer); stream.getTracks().forEach((t) => t.stop()); };
  const result = {
    stop() {
      if (finished) return finished;
      finished = new Promise((ok) => {
        rec.onstop = () => { end(); ok({ blob: new Blob(parts, { type: rec.mimeType || type || "audio/webm" }), dur: (Date.now() - started) / 1000 }); };
        rec.stop();
      });
      return finished;
    },
    cancel() { rec.onstop = null; try { rec.stop(); } catch {} end(); },
  };
  return result;
}
