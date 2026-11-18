// Photo Albums: share pictures with your homies.
import { auth, db, ref, get, set, push, remove, onValue, off, serverTimestamp } from "./firebase.js";
import { openWindow, closeWindow, esc, img64 } from "./wm.js";
import { userName } from "./chat.js";

async function shrink(file, max = 1280) {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.72).split(",")[1];
}

/** Albums belonging to `owner` (yours if not given). */
export function openAlbums(owner) {
  const me = auth.currentUser.uid;
  owner = owner || me;
  const mine = owner === me;
  let r;
  openWindow("albums." + owner, {
    title: mine ? "My Photo Albums" : `${userName(owner)}'s Photo Albums`, icon: "📸", width: 440, height: 500, keyword: mine ? "albums" : null,
    onClose: () => r && off(r),
    render(body) {
      r = ref(db, `albumlist/${owner}`);
      onValue(r, (s) => {
        const albums = Object.entries(s.val() || {}).sort((a, b) => (b[1].ts || 0) - (a[1].ts || 0));
        body.innerHTML = `${mine ? `<form id="na" class="row" style="margin-bottom:8px"><input id="na-n" placeholder="New album name (e.g. Summer 2026)" style="flex:1"><button class="btn primary small-btn">Create</button></form>` : ""}
          <div class="album-grid">${albums.map(([id, a]) => `<button class="album" data-a="${esc(id)}">
            ${a.cover ? `<img src="${img64(a.cover)}" alt="">` : `<span class="album-empty">📸</span>`}
            <b>${esc(a.name)}</b><span class="small muted">${Number(a.count) || 0} photo${a.count === 1 ? "" : "s"}</span></button>`).join("")
            || `<p class="muted">${mine ? "No albums yet. Make your first one above!" : "No albums yet."}</p>`}</div>`;
        body.querySelector("#na")?.addEventListener("submit", async (e) => {
          e.preventDefault();
          const n = body.querySelector("#na-n").value.trim();
          if (n) await push(ref(db, `albumlist/${me}`), { name: n.slice(0, 60), count: 0, ts: serverTimestamp() });
        });
        body.querySelectorAll("[data-a]").forEach((b) => (b.onclick = () => openAlbum(owner, b.dataset.a, albums.find(([id]) => id === b.dataset.a)[1])));
      });
    },
  });
}

function openAlbum(owner, id, info) {
  const me = auth.currentUser.uid;
  const mine = owner === me;
  let r;
  openWindow(`album.${owner}.${id}`, {
    title: `📸 ${info.name}`, icon: "📸", width: 480, height: 520, onClose: () => r && off(r),
    render(body) {
      r = ref(db, `photos/${owner}/${id}`);
      onValue(r, (s) => {
        const photos = Object.entries(s.val() || {}).sort((a, b) => (a[1].ts || 0) - (b[1].ts || 0));
        body.innerHTML = `${mine ? `<div class="row" style="margin-bottom:8px"><label class="btn primary small-btn" style="margin:0;font-weight:normal">➕ Add Photos<input type="file" accept="image/*" multiple id="ap" hidden></label>
            <span class="small muted" id="ap-msg"></span><button class="btn danger small-btn" id="del-album">Delete Album</button></div>` : ""}
          <div class="photo-grid">${photos.map(([pid, p]) => `<figure data-p="${esc(pid)}"><img src="${img64(p.data)}" alt="" loading="lazy">
            ${p.caption ? `<figcaption>${esc(p.caption)}</figcaption>` : ""}</figure>`).join("") || `<p class="muted">No photos yet.</p>`}</div>`;
        body.querySelectorAll("[data-p]").forEach((f) => (f.onclick = () => viewPhoto(owner, id, f.dataset.p, photos.find(([p]) => p === f.dataset.p)[1], mine)));
        body.querySelector("#ap")?.addEventListener("change", async (e) => {
          const files = [...e.target.files].slice(0, 20);
          const msg = body.querySelector("#ap-msg");
          let n = photos.length;
          for (const [i, f] of files.entries()) {
            msg.textContent = `Uploading ${i + 1} of ${files.length}…`;
            try {
              const data = await shrink(f);
              await push(ref(db, `photos/${me}/${id}`), { data, caption: "", ts: serverTimestamp() });
              n++;
              await set(ref(db, `albumlist/${me}/${id}`), { ...info, count: n, cover: info.cover || (await shrink(f, 240)), ts: serverTimestamp() });
              info.cover = info.cover || true;
            } catch { msg.textContent = "One photo couldn't be uploaded."; }
          }
          msg.textContent = "Done!";
        });
        body.querySelector("#del-album")?.addEventListener("click", async () => {
          if (!confirm(`Delete the album "${info.name}" and all its photos?`)) return;
          await remove(ref(db, `photos/${me}/${id}`));
          await remove(ref(db, `albumlist/${me}/${id}`));
          closeWindow(`album.${owner}.${id}`);
        });
      });
    },
  });
}

function viewPhoto(owner, album, pid, p, mine) {
  openWindow("photo." + pid, {
    title: p.caption || "Photo", icon: "🖼", width: 520, height: 520,
    render(body) {
      body.innerHTML = `<img src="${img64(p.data)}" alt="" style="width:100%;border-radius:8px">
        ${mine ? `<div class="row" style="margin-top:6px"><input id="cap" value="${esc(p.caption || "")}" placeholder="Add a caption" style="flex:1">
          <button class="btn small-btn" id="cap-s">Save</button><button class="btn danger small-btn" id="ph-d">Delete</button></div>` : `<p>${esc(p.caption || "")}</p>`}`;
      body.querySelector("#cap-s")?.addEventListener("click", () => set(ref(db, `photos/${owner}/${album}/${pid}/caption`), body.querySelector("#cap").value.slice(0, 140)));
      body.querySelector("#ph-d")?.addEventListener("click", async () => { await remove(ref(db, `photos/${owner}/${album}/${pid}`)); closeWindow("photo." + pid); });
    },
  });
}
