// Shared with BuddyChat: same accounts, homies, IMs and chat rooms.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut,
  setPersistence, browserLocalPersistence, browserSessionPersistence, deleteUser, verifyBeforeUpdateEmail,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getDatabase, ref, get, set, update, push, remove, onValue, off, serverTimestamp, onDisconnect,
  query, orderByKey, limitToLast, runTransaction,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";

const app = initializeApp({
  apiKey: "AIzaSyCXoMzDT9DxB6fEer3F-UuOQlChRhkUFYY",
  authDomain: "buddychat-48c0b.firebaseapp.com",
  databaseURL: "https://buddychat-48c0b-default-rtdb.firebaseio.com",
  projectId: "buddychat-48c0b",
});

// Anti-bot protection (Firebase App Check with reCAPTCHA v3). Off until a site key is set here and App Check is set up in the Firebase console.
const APP_CHECK_SITE_KEY = "";
let appCheck = null, appCheckGetToken = null;
if (APP_CHECK_SITE_KEY && location.hostname !== "localhost") {
  try {
    const m = await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-app-check.js");
    appCheck = m.initializeAppCheck(app, { provider: new m.ReCaptchaV3Provider(APP_CHECK_SITE_KEY), isTokenAutoRefreshEnabled: true });
    appCheckGetToken = m.getToken;
  } catch {}
}
/** The anti-bot pass to hand to DialedUp's own server, so it can talk to Firebase too ("" when App Check is off). */
export async function appCheckToken() {
  if (!appCheck) return "";
  try { return (await appCheckGetToken(appCheck)).token || ""; } catch { return ""; }
}

export const auth = getAuth(app);
export const db = getDatabase(app);
export {
  ref, get, set, update, push, remove, onValue, off, serverTimestamp, onDisconnect, query, orderByKey, limitToLast,
  runTransaction, onAuthStateChanged,
};

/** "Cool Dude 99" → "cooldude99" (same rule as the iPhone app). */
export function normalize(name) {
  return (name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function validScreenName(name) {
  const t = (name || "").trim();
  const key = normalize(t);
  return key.length >= 3 && key.length <= 16 && t.length <= 20 && /^[A-Za-z0-9 ]+$/.test(t);
}

const emailFor = (name) => `${normalize(name)}@users.buddychat.app`;
const ACCOUNTS = "https://dialedup-push.stickyarcadecloud.workers.dev";   // private email lookups for sign-on and password reset
const post = async (path, body) => fetch(ACCOUNTS + path, { method: "POST", headers: { "content-type": "application/json", "x-du-appcheck": await appCheckToken() }, body: JSON.stringify(body) });

/** A renamed account still signs in with its original login name. */
async function loginFor(screenName) {
  let login = normalize(screenName);
  try { const l = (await get(ref(db, `loginnames/${login}/login`))).val(); if (typeof l === "string" && l) login = l; } catch {}
  return login;
}

function friendly(err) {
  const code = (err && (err.code || err.message)) || "";
  if (code.includes("email-already-in-use")) return "That screen name is already taken.";
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found"))
    return "Incorrect screen name or password.";
  if (code.includes("weak-password")) return "Password must be at least 6 characters.";
  if (code.includes("too-many-requests")) return "Too many tries. Wait a few minutes and try again.";
  if (code.includes("network")) return "Couldn't connect. Check your internet connection.";
  return "Something went wrong (" + code + ").";
}

export async function signOn(screenName, password, remember) {
  try {
    await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);
    const login = await loginFor(screenName);
    try {
      return (await signInWithEmailAndPassword(auth, emailFor(login), password)).user;
    } catch (e) {
      // Accounts with a confirmed email sign in with that email behind the scenes
      if (!/invalid-credential|wrong-password|user-not-found/.test(String(e?.code))) throw e;
      const r = await post("/signin-email", { login, password }).catch(() => null);
      const email = r?.ok ? (await r.json()).email : null;
      if (!email) throw e;
      return (await signInWithEmailAndPassword(auth, email, password)).user;
    }
  } catch (e) {
    throw new Error(friendly(e));
  }
}

export async function signUp(screenName, password) {
  const name = screenName.trim();
  if (!validScreenName(name)) throw new Error("Screen names are 3–16 letters or numbers (spaces are OK).");
  if (password.length < 6) throw new Error("Password must be at least 6 characters.");
  const key = normalize(name);
  let user;
  try {
    user = (await createUserWithEmailAndPassword(auth, emailFor(name), password)).user;
  } catch (e) {
    throw new Error(friendly(e));
  }
  try {
    await set(ref(db, `screennames/${key}`), user.uid);
  } catch (e) {
    await deleteUser(user).catch(() => {});
    throw new Error("That screen name is already taken.");
  }
  await set(ref(db, `users/${user.uid}`), {
    screenName: name, profile: "", away: "", signedOn: true, lastSeen: serverTimestamp(),
  });
  const groups = ["Homies", "Family", "Co-Workers"].map((n) => ({ id: crypto.randomUUID().toUpperCase(), name: n, members: [], collapsed: false }));
  await set(ref(db, `buddylists/${user.uid}`), JSON.stringify(groups)).catch(() => {});
  return user;
}

/** Emails are private: only you and the site owner can read them (see database rules). */
export const validEmail = (e) => /^[^\s@]{1,64}@[^\s@]+\.[a-z]{2,}$/i.test(String(e || "").trim()) && String(e).length <= 100;
export async function saveEmail(email) {
  const u = auth.currentUser;
  if (!u || !validEmail(email)) throw new Error("Please enter a real email address.");
  const n = (await get(ref(db, `users/${u.uid}/screenName`)).catch(() => null))?.val() || "";
  await set(ref(db, `emails/${u.uid}`), { email: email.trim().toLowerCase(), n, ts: serverTimestamp() });
}
/**
 * Turns on password reset: saves the email (encrypted) for screen-name sign-on, then Firebase emails a link
 * to confirm it. Returns "sent", "relogin" (needs a fresh sign-on first) or "error".
 */
export async function linkEmail(email) {
  const u = auth.currentUser;
  if (!u || !validEmail(email)) return "error";
  try {
    const login = await loginFor((await get(ref(db, `users/${u.uid}/screenName`))).val() || "");
    const token = await u.getIdToken();
    const r = await post("/link-email", { token, login, email: email.trim().toLowerCase() });
    if (!r.ok) return "error";
    if ((u.email || "").toLowerCase() === email.trim().toLowerCase()) return "done";
    await verifyBeforeUpdateEmail(u, email.trim().toLowerCase());
    await update(ref(db, `users/${u.uid}`), { emailLinkSent: serverTimestamp() }).catch(() => {});
    return "sent";
  } catch (e) {
    return /recent-login/.test(String(e?.code)) ? "relogin" : "error";
  }
}
/** True once the account's sign-in email is the member's real, confirmed email. */
export const emailConfirmed = () => !!auth.currentUser?.email && !auth.currentUser.email.endsWith("@users.buddychat.app");

/** "Forgot password?": Firebase emails a reset link if this screen name has a confirmed email. */
export async function sendPasswordReset(screenName) {
  if (!validScreenName(screenName)) throw new Error("Type your screen name first.");
  const login = await loginFor(screenName);
  const r = await post("/reset", { login }).catch(() => null);
  if (!r) throw new Error("Couldn't connect. Check your internet connection.");
}

export async function getMyEmail() {
  try { return (await get(ref(db, `emails/${auth.currentUser.uid}/email`))).val(); } catch { return undefined; }
}

export async function signOff() {
  window.__duSigningOff = true;
  setTimeout(() => (window.__duSigningOff = false), 10000);
  const u = auth.currentUser;
  if (u) await update(ref(db, `users/${u.uid}`), { signedOn: false, lastSeen: serverTimestamp() }).catch(() => {});
  await signOut(auth);
}

export const conversationID = (a, b) => [a, b].sort().join("_");

/** Change your screen name. Your password and login stay the same; the new name (and the old one) both sign you in. */
export async function changeScreenName(newName) {
  const user = auth.currentUser;
  if (!user) throw new Error("Sign on first.");
  const name = (newName || "").trim();
  if (!validScreenName(name)) throw new Error("Screen names are 3–16 letters or numbers (spaces are OK).");
  const key = normalize(name);
  const uid = user.uid;
  const login = (user.email || "").split("@")[0];
  const current = (await get(ref(db, `users/${uid}/screenName`))).val() || login;
  const oldKey = normalize(current);
  if (key !== oldKey) {
    const owner = (await get(ref(db, `screennames/${key}`))).val();
    if (owner && owner !== uid) throw new Error(`"${name}" is already taken. Try another one.`);
    if (!owner) {
      try { await set(ref(db, `screennames/${key}`), uid); } catch { throw new Error(`"${name}" is already taken. Try another one.`); }
    }
    if (key !== login) await set(ref(db, `loginnames/${key}`), { login }).catch(() => {});
    // Bring your Home Page along to its new address
    try {
      const page = (await get(ref(db, `homepages/${oldKey}`))).val();
      if (page && !(await get(ref(db, `homepages/${key}`))).val()) await set(ref(db, `homepages/${key}`), page);
    } catch {}
  }
  await update(ref(db, `users/${uid}`), { screenName: name, renamedAt: serverTimestamp() });
  await set(ref(db, `names/${uid}`), name).catch(() => {});
  if ((await get(ref(db, `directory/${uid}/screenName`)).catch(() => null))?.val()) await update(ref(db, `directory/${uid}`), { screenName: name }).catch(() => {});
  if ((await get(ref(db, `publicprofiles/${uid}/screenName`)).catch(() => null))?.val()) await update(ref(db, `publicprofiles/${uid}`), { screenName: name }).catch(() => {});
  return name;
}
