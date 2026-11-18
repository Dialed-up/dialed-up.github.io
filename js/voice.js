// Talk: live voice between two people, browser to browser (WebRTC), set up through the database.
import { auth, db, ref, get, set, push, remove, onValue, off, serverTimestamp, conversationID } from "./firebase.js";
import { openWindow, closeWindow, esc } from "./wm.js";
import * as sfx from "./sounds.js";

const ICE = { iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }] };
let active = null;   // { pc, stream, refs, conv }

function hangUp(note) {
  if (!active) return;
  const { pc, stream, refs, conv } = active;
  refs.forEach((r) => off(r));
  stream?.getTracks().forEach((t) => t.stop());
  pc.close();
  remove(ref(db, `calls/${conv}`)).catch(() => {});
  const other = conv.replace(auth.currentUser?.uid || "", "").replace("_", "");
  remove(ref(db, `callring/${other}/${conv}`)).catch(() => {});
  remove(ref(db, `callring/${auth.currentUser?.uid}/${conv}`)).catch(() => {});
  active = null;
  const w = document.querySelector('[data-id="call"] .call-status');
  if (w) w.textContent = note || "Call ended.";
  setTimeout(() => closeWindow("call"), 1500);
}

function callWindow(who, status, video = false) {
  openWindow("call", {
    title: `${video ? "Video Chat" : "Talk"} — ${who}`, icon: video ? "📹" : "📞", width: video ? 360 : 280, height: video ? 480 : 230,
    onClose: () => hangUp(),
    render(body) {
      body.innerHTML = video
        ? `<div class="vc">
            <video class="vc-remote" autoplay playsinline></video>
            <video class="vc-local" autoplay playsinline muted></video>
            <div class="vc-status call-status">${esc(status)}</div>
            <div class="vc-controls">
              <button class="btn small-btn" data-x="mute">🎙 Mute</button>
              <button class="btn small-btn" data-x="cam">📷 Camera Off</button>
              <button class="btn small-btn" data-x="flip">🔄 Flip</button>
              <button class="btn danger small-btn" data-x="end">Hang Up</button>
            </div></div>`
        : `<div style="text-align:center"><div style="font-size:44px">📞</div><b>${esc(who)}</b>
            <p class="small call-status">${esc(status)}</p><audio autoplay playsinline></audio>
            <div class="row" style="justify-content:center;gap:8px"><button class="btn small-btn" data-x="mute">🎙 Mute</button>
            <button class="btn danger small-btn" data-x="end">Hang Up</button></div></div>`;
      body.querySelector("[data-x=end]").onclick = () => hangUp();
      body.querySelector("[data-x=mute]").onclick = (e) => {
        const t = active?.stream?.getAudioTracks()[0];
        if (!t) return;
        t.enabled = !t.enabled;
        e.target.textContent = t.enabled ? "🎙 Mute" : "🔇 Unmute";
      };
      body.querySelector("[data-x=cam]")?.addEventListener("click", (e) => {
        const t = active?.stream?.getVideoTracks()[0];
        if (!t) return;
        t.enabled = !t.enabled;
        e.target.textContent = t.enabled ? "📷 Camera Off" : "📷 Camera On";
      });
      body.querySelector("[data-x=flip]")?.addEventListener("click", flipCamera);
    },
  });
}

async function flipCamera() {
  if (!active?.stream) return;
  active.facing = active.facing === "user" ? "environment" : "user";
  try {
    const fresh = await navigator.mediaDevices.getUserMedia({ video: { facingMode: active.facing } });
    const newTrack = fresh.getVideoTracks()[0];
    const sender = active.pc.getSenders().find((x) => x.track && x.track.kind === "video");
    await sender?.replaceTrack(newTrack);
    const old = active.stream.getVideoTracks()[0];
    active.stream.removeTrack(old); old.stop();
    active.stream.addTrack(newTrack);
    const local = document.querySelector('[data-id="call"] .vc-local');
    if (local) local.srcObject = active.stream;
  } catch { setStatus("This device has only one camera."); }
}

const setStatus = (t) => { const el = document.querySelector('[data-id="call"] .call-status'); if (el) el.textContent = t; };

async function setupPeer(conv, role, video = false) {
  const stream = await navigator.mediaDevices.getUserMedia(video
    ? { audio: true, video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } } }
    : { audio: true });
  const local = document.querySelector('[data-id="call"] .vc-local');
  if (local) local.srcObject = stream;
  const pc = new RTCPeerConnection(ICE);
  stream.getTracks().forEach((t) => pc.addTrack(t, stream));
  pc.ontrack = (e) => {
    const el = document.querySelector('[data-id="call"] .vc-remote') || document.querySelector('[data-id="call"] audio');
    if (el && el.srcObject !== e.streams[0]) el.srcObject = e.streams[0];
  };
  pc.onicecandidate = (e) => e.candidate && push(ref(db, `calls/${conv}/${role}Candidates`), e.candidate.toJSON());
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "connected") { setStatus("🟢 Connected — talk away!"); sfx.buddyIn(); }
    if (["failed", "disconnected"].includes(pc.connectionState)) hangUp("Connection lost. (Some networks block calls.)");
  };
  const other = role === "caller" ? "callee" : "caller";
  const candRef = ref(db, `calls/${conv}/${other}Candidates`);
  onValue(candRef, (s) => Object.values(s.val() || {}).forEach((c) => pc.addIceCandidate(c).catch(() => {})));
  active = { pc, stream, refs: [candRef], conv, facing: "user" };
  return pc;
}

export async function startCall(uid, who, { video = false } = {}) {
  if (active) return alert("You're already on a call.");
  const me = auth.currentUser.uid;
  const conv = conversationID(me, uid);
  callWindow(who, video ? "Calling… (allow the camera and microphone)" : "Calling… (allow the microphone if asked)", video);
  try {
    const pc = await setupPeer(conv, "caller", video);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await set(ref(db, `calls/${conv}`), { from: me, to: uid, video, offer: { type: offer.type, sdp: offer.sdp }, ts: serverTimestamp() });
    await set(ref(db, `callring/${uid}/${conv}`), serverTimestamp());
    setStatus(`Ringing ${who}…`);
    const ansRef = ref(db, `calls/${conv}/answer`);
    onValue(ansRef, async (s) => {
      const a = s.val();
      if (a && !pc.currentRemoteDescription) await pc.setRemoteDescription(a);
    });
    const endRef = ref(db, `calls/${conv}/declined`);
    onValue(endRef, (s) => s.val() && hangUp(`${who} can't talk right now.`));
    active.refs.push(ansRef, endRef);
  } catch {
    hangUp(video ? "Couldn't start video — the camera or microphone may be blocked." : "Couldn't start the call — the microphone may be blocked.");
  }
}

let ringRef = null;
export function watchCalls(nameOf) {
  const me = auth.currentUser.uid;
  ringRef = ref(db, `callring/${me}`);
  onValue(ringRef, (s) => {
    Object.keys(s.val() || {}).forEach(async (conv) => {
      if (active || document.querySelector(`[data-id="ring.${conv}"]`)) return;
      const c = (await get(ref(db, `calls/${conv}`))).val();
      if (!c || c.to !== me || c.answer || c.declined || Date.now() - (c.ts || 0) > 60000) return;
      sfx.alertBlip();
      openWindow("ring." + conv, {
        title: c.video ? "Incoming Video Call" : "Incoming Call", icon: c.video ? "📹" : "📞", width: 290, height: 200,
        render(body) {
          body.innerHTML = `<p style="text-align:center">${c.video ? "📹" : "📞"} <b>${esc(nameOf(c.from))}</b> wants to ${c.video ? "video chat" : "talk"}!</p>
            <div class="row"><button class="btn danger small-btn" data-x="no">Decline</button>
            ${c.video ? `<button class="btn small-btn" data-x="audio">Audio Only</button>` : ""}
            <button class="btn primary small-btn" data-x="yes">${c.video ? "Answer with Video" : "Answer"}</button></div>`;
          body.querySelector("[data-x=no]").onclick = () => {
            set(ref(db, `calls/${conv}/declined`), true);
            remove(ref(db, `callring/${me}/${conv}`));
            closeWindow("ring." + conv);
          };
          const answer_ = async (withVideo) => {
            closeWindow("ring." + conv);
            remove(ref(db, `callring/${me}/${conv}`));
            callWindow(nameOf(c.from), "Connecting…", !!c.video);
            try {
              const pc = await setupPeer(conv, "callee", withVideo);
              await pc.setRemoteDescription(c.offer);
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              await set(ref(db, `calls/${conv}/answer`), { type: answer.type, sdp: answer.sdp });
            } catch { hangUp("Couldn't answer — the camera or microphone may be blocked."); }
          };
          body.querySelector("[data-x=yes]").onclick = () => answer_(!!c.video);
          body.querySelector("[data-x=audio]")?.addEventListener("click", () => answer_(false));
        },
      });
    });
  });
}
export function stopCalls() { if (ringRef) off(ringRef); ringRef = null; hangUp(); }
