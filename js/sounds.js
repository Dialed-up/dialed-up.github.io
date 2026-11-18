// Every DialedUp sound is synthesized live in the browser — nothing recorded or borrowed.
let ctx = null;
let muted = localStorage.getItem("du.muted") === "1";

function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

export const isMuted = () => muted;
export function setMuted(m) { muted = m; localStorage.setItem("du.muted", m ? "1" : "0"); }

function tone(freq, start, dur, { type = "sine", vol = 0.15, freq2 = null } = {}) {
  const c = ac();
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, c.currentTime + start);
  if (freq2) o.frequency.linearRampToValueAtTime(freq2, c.currentTime + start + dur);
  g.gain.setValueAtTime(0, c.currentTime + start);
  g.gain.linearRampToValueAtTime(vol, c.currentTime + start + 0.01);
  g.gain.setValueAtTime(vol, c.currentTime + start + dur - 0.02);
  g.gain.linearRampToValueAtTime(0, c.currentTime + start + dur);
  o.connect(g).connect(c.destination);
  o.start(c.currentTime + start);
  o.stop(c.currentTime + start + dur + 0.05);
}

function noise(start, dur, vol = 0.06, filterFreq = 2500) {
  const c = ac();
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.value = filterFreq;
  const g = c.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(c.destination);
  src.start(c.currentTime + start);
}

const DTMF = { 1: [697, 1209], 2: [697, 1336], 3: [697, 1477], 4: [770, 1209], 5: [770, 1336], 6: [770, 1477],
  7: [852, 1209], 8: [852, 1336], 9: [852, 1477], 0: [941, 1336] };

/** The whole "connecting" soundtrack. Returns its length in seconds. */
export function dialUp() {
  if (muted) return 0;
  let t = 0;
  tone(350, t, 1.1, { vol: 0.08 }); tone(440, t, 1.1, { vol: 0.08 }); t += 1.2;          // dial tone
  for (const d of "18005550199") {                                                     // made-up number
    const [a, b] = DTMF[d];
    tone(a, t, 0.09, { vol: 0.1 }); tone(b, t, 0.09, { vol: 0.1 }); t += 0.13;
  }
  t += 0.4;
  tone(440, t, 0.45, { vol: 0.08 }); tone(480, t, 0.45, { vol: 0.08 }); t += 0.9;         // ring
  // Our own handshake: a squeal sweep, some warbles, then hissing static
  tone(2100, t, 0.8, { vol: 0.06 }); t += 0.85;
  tone(1300, t, 0.25, { type: "square", vol: 0.04, freq2: 2400 }); t += 0.3;
  for (let i = 0; i < 6; i++) { tone(980 + i * 160, t, 0.12, { type: "triangle", vol: 0.05 }); t += 0.14; }
  noise(t, 1.6, 0.08, 1800); tone(1650, t, 1.6, { type: "sawtooth", vol: 0.015 }); t += 1.7;
  noise(t, 0.6, 0.05, 3200); t += 0.6;
  return t;
}

export function welcome() {
  if (muted) return;
  [523, 659, 784, 1046].forEach((f, i) => tone(f, i * 0.12, 0.35, { type: "triangle", vol: 0.12 }));
  try {
    const u = new SpeechSynthesisUtterance("Welcome! You're dialed up.");
    u.rate = 1.05; u.pitch = 1.1;
    setTimeout(() => speechSynthesis.speak(u), 600);
  } catch {}
}

export function buddyIn() { if (!muted) { tone(660, 0, 0.12, { type: "triangle" }); tone(990, 0.1, 0.18, { type: "triangle" }); } }
export function buddyOut() { if (!muted) { tone(880, 0, 0.12, { type: "triangle" }); tone(440, 0.1, 0.22, { type: "triangle" }); } }
export function imIn() { if (!muted) { tone(700, 0, 0.08, { vol: 0.12, freq2: 1000 }); tone(1100, 0.09, 0.12, { vol: 0.12, freq2: 1400 }); } }
export function imOut() { if (!muted) noise(0, 0.18, 0.05, 4000); }
export function alertBlip() { if (!muted) { tone(1200, 0, 0.07); tone(1200, 0.12, 0.07); } }
export function goodbye() {
  if (muted) return;
  [784, 659, 523].forEach((f, i) => tone(f, i * 0.12, 0.3, { type: "triangle", vol: 0.12 }));
}
export const unlock = () => ac();
