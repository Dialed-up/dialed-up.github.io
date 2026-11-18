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

// ---------- Talking ----------
let voice = null;
function pickVoice() {
  const vs = speechSynthesis.getVoices();
  if (!vs.length) return null;
  const en = vs.filter((v) => /^en(-|_)US/i.test(v.lang));
  return en.find((v) => /samantha|ava|allison|google us english|zira|aria/i.test(v.name)) || en[0] || vs.find((v) => /^en/i.test(v.lang)) || null;
}
try { speechSynthesis.onvoiceschanged = () => (voice = pickVoice()); } catch {}

/** Says something out loud with the phone or computer's built-in voice. */
export function say(text, { rate = 1, pitch = 1.05, delay = 0 } = {}) {
  if (muted || !("speechSynthesis" in window)) return;
  const go = () => {
    try {
      const u = new SpeechSynthesisUtterance(text);
      voice = voice || pickVoice();
      if (voice) u.voice = voice;
      u.rate = rate; u.pitch = pitch; u.volume = 1;
      speechSynthesis.speak(u);
    } catch {}
  };
  delay ? setTimeout(go, delay) : go();
}

export function welcome() {
  if (muted) return;
  [523, 659, 784, 1046].forEach((f, i) => tone(f, i * 0.12, 0.35, { type: "triangle", vol: 0.12 }));
  say("Welcome!", { delay: 550, pitch: 1.1 });
}

/** Spoken mail alert. */
export function youHaveMail() { say("You have mail!", { pitch: 1.1 }); }

// ---------- Doors (made from scratch: a creaky hinge, a latch click and a thump) ----------
function latch(start, vol = 0.18) {
  const c = ac();
  const t = c.currentTime + start;
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * 0.03), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
  const src = c.createBufferSource(); src.buffer = buf;
  const f = c.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 1800;
  const g = c.createGain(); g.gain.value = vol;
  src.connect(f).connect(g).connect(c.destination);
  src.start(t);
}
function creak(start, dur, fromHz, toHz, vol = 0.07) {
  const c = ac();
  const t = c.currentTime + start;
  const o = c.createOscillator(); o.type = "sawtooth";
  o.frequency.setValueAtTime(fromHz, t);
  o.frequency.linearRampToValueAtTime((fromHz + toHz) / 2 + 40, t + dur * 0.55);
  o.frequency.linearRampToValueAtTime(toHz, t + dur);
  // stick-slip: the hinge "catches" many times a second, which is what makes a creak
  const lfo = c.createOscillator(); lfo.type = "square";
  lfo.frequency.setValueAtTime(22, t); lfo.frequency.linearRampToValueAtTime(48, t + dur);
  const lfoGain = c.createGain(); lfoGain.gain.value = vol * 0.9;
  const g = c.createGain();
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.05);
  g.gain.setValueAtTime(vol, t + dur - 0.08); g.gain.linearRampToValueAtTime(0, t + dur);
  lfo.connect(lfoGain).connect(g.gain);
  const bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 900; bp.Q.value = 3;
  o.connect(bp).connect(g).connect(c.destination);
  o.start(t); lfo.start(t); o.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
}
function thump(start, vol = 0.5) {
  const c = ac();
  const t = c.currentTime + start;
  const o = c.createOscillator(); o.type = "sine";
  o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.25);
  const g = c.createGain();
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
  o.connect(g).connect(c.destination);
  o.start(t); o.stop(t + 0.35);
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * 0.15), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
  const src = c.createBufferSource(); src.buffer = buf;
  const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 400;
  const g2 = c.createGain(); g2.gain.value = vol * 0.6;
  src.connect(lp).connect(g2).connect(c.destination);
  src.start(t);
}
/** A buddy signed on: latch click, then the door creaks open. */
export function doorOpen() { if (muted) return; latch(0); creak(0.06, 0.75, 260, 520); }
/** A buddy signed off: a short creak, then the door shuts. */
export function doorClose() { if (muted) return; creak(0, 0.4, 480, 300, 0.06); thump(0.42); latch(0.44, 0.22); }

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
