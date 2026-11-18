// Photos, videos and voice notes that show right inside an IM.
// Stored in media/{conv}/{mid} (details) and mediachunks/{conv}/{mid}/{i} (the file, in pieces).
import { auth, db, ref, get, set, remove } from "./firebase.js";
import { esc } from "./wm.js";

const CHUNK = 192 * 1024;
const FILES = "https://dialedup-push.stickyarcadecloud.workers.dev";   // free Cloudflare file storage (files kept 24 hours)
export const MAX_FILE = 25 * 1024 * 1024;
export const MAX_VIDEO = MAX_FILE;
const cache = new Map();   // mid → object URL

const sizeLabel = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB");
export const isMedia = (file) => /^(image|video|audio)\//.test(file.type || "");

/** Sends a file to the Cloudflare file storage, with progress. Returns its web address. */
async function uploadToStorage(conv, blob, name, onProgress) {
  const token = await auth.currentUser.getIdToken();
  return new Promise((ok, bad) => {
    const x = new XMLHttpRequest();
    x.open("POST", FILES + "/upload");
    x.setRequestHeader("x-du-token", token);
    x.setRequestHeader("x-du-conv", conv);
    x.setRequestHeader("x-du-name", encodeURIComponent(name || "file"));
    x.setRequestHeader("content-type", blob.type || "application/octet-stream");
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    x.onload = () => { try { const j = JSON.parse(x.responseText); j.ok ? ok(j.url) : bad(new Error(j.error === "too big" ? "That file is over 25 MB." : "Upload failed.")); } catch { bad(new Error("Upload failed.")); } };
    x.onerror = () => bad(new Error("Upload failed. Check your connection."));
    x.send(blob);
  });
}

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
  kind = kind || (file.type.startsWith("image/") ? "photo" : file.type.startsWith("video/") ? "video" : file.type.startsWith("audio/") ? "audio" : "file");
  let blob = file, w = 0, h = 0;
  if (kind === "photo") ({ blob, w = 0, h = 0 } = await shrinkImage(file));
  if (blob.size > MAX_FILE) throw new Error(`Files can be up to ${sizeLabel(MAX_FILE)}. That one is ${sizeLabel(blob.size)}.`);
  // New way: Cloudflare file storage (bigger files, doesn't use up the database)
  try {
    const url = await uploadToStorage(conv, blob, name || (kind === "audio" ? "voice-note" : "file"), onProgress);
    const mime = blob.type || file.type || "application/octet-stream";
    return { mid: url.split("/").pop(), url, kind, mime, size: blob.size, ...(w ? { w, h } : {}), ...(dur ? { dur: Math.round(dur) } : {}), ...(name ? { name: name.slice(0, 80) } : {}) };
  } catch (e) {
    if (/25 MB/.test(e.message) || blob.size > 10 * 1024 * 1024 || kind === "file") throw e;
  }
  // Fallback for small photos / clips / voice notes: store in the database
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
  if (info.url && /^https:\/\/[^/]+\/f\/[a-f0-9]{32}$/.test(info.url)) { paintStored(el, info); return; }
  const show = async () => {
    el.innerHTML = `<span class="small muted">${info.kind === "photo" ? "📷 Loading photo…" : info.kind === "video" ? "🎬 Loading video…" : info.name ? `🎵 Loading ${esc(info.name)}…` : "🎙 Loading voice note…"}</span>`;
    try {
      const url = await load(conv, info);
      if (info.kind === "photo") {
        el.innerHTML = `<img src="${url}" alt="Photo" class="im-photo" ${info.w ? `width="${info.w}" height="${info.h}"` : ""}>`;
        el.querySelector("img").onclick = () => openViewer(url, "photo");
      } else if (info.kind === "video") {
        el.innerHTML = `${info.name ? `<div class="media-name small">🎬 <b>${esc(info.name)}</b> <span class="muted">${sizeLabel(info.size)}</span></div>` : ""}<video src="${url}" controls playsinline preload="metadata" class="im-video"></video>`;
      } else {
        const label = info.name ? `🎵 <b>${esc(info.name)}</b> <span class="muted">${sizeLabel(info.size)}</span>`
          : `🎙 <b>Voice note</b>${info.dur ? ` <span class="muted">${fmtDur(info.dur)}</span>` : ""}`;
        el.innerHTML = `<div class="media-name small">${label}</div><div class="voice-note"><audio src="${url}" controls preload="metadata"></audio></div>`;
      }
      el.insertAdjacentHTML("beforeend", `<a class="small media-save" href="${url}" download="${esc(info.name || (info.kind === "photo" ? "photo.jpg" : info.kind === "video" ? "video" : "voice-note"))}">💾 Save</a>`);
    } catch { el.innerHTML = `<span class="small muted">This ${info.kind === "audio" ? "voice note" : info.kind} isn't available anymore.</span>`; }
  };
  if (info.kind === "video" && !cache.has(info.mid)) {
    el.innerHTML = `<button class="media-tap">🎬 Tap to play ${info.name ? `<b>${esc(info.name)}</b>` : "video"} <span class="small muted">(${sizeLabel(info.size)})</span></button>`;
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

/** Files kept in Cloudflare storage: shown straight from their web address. */
function paintStored(el, info) {
  const url = info.url;
  const nameLine = info.name ? `<div class="media-name small">${{ video: "🎬", audio: "🎵", file: "📄", photo: "📷" }[info.kind] || "📄"} <b>${esc(info.name)}</b> <span class="muted">${sizeLabel(info.size)}</span></div>` : "";
  const gone = () => (el.innerHTML = `<span class="small muted">This ${info.kind === "audio" ? (info.name ? "audio file" : "voice note") : info.kind} has expired (files are kept 24 hours).</span>`);
  if (info.kind === "photo") {
    el.innerHTML = `<img src="${esc(url)}" alt="Photo" class="im-photo" ${info.w ? `width="${info.w}" height="${info.h}"` : ""}>`;
    const img = el.querySelector("img");
    img.onerror = gone;
    img.onclick = () => openViewer(url);
  } else if (info.kind === "video") {
    el.innerHTML = `${nameLine}<video src="${esc(url)}" controls playsinline preload="metadata" class="im-video"></video>`;
    el.querySelector("video").onerror = gone;
  } else if (info.kind === "audio") {
    el.innerHTML = (info.name ? nameLine : `<div class="media-name small">🎙 <b>Voice note</b>${info.dur ? ` <span class="muted">${fmtDur(info.dur)}</span>` : ""}</div>`)
      + `<div class="voice-note"><audio src="${esc(url)}" controls preload="metadata"></audio></div>`;
    el.querySelector("audio").onerror = gone;
  } else {
    el.innerHTML = `<div class="file-card">📄 <b>${esc(info.name || "File")}</b> <span class="small muted">${sizeLabel(info.size)}</span>
      <a class="btn small-btn" href="${esc(url)}" target="_blank" rel="noopener">⬇ Open / Save</a></div>`;
    return;
  }
  el.insertAdjacentHTML("beforeend", `<a class="small media-save" href="${esc(url)}" target="_blank" rel="noopener">💾 Save</a>`);
}
