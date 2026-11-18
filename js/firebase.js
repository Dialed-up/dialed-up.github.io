// Shared with BuddyChat: same accounts, buddy lists, IMs and chat rooms.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut,
  setPersistence, browserLocalPersistence, browserSessionPersistence, deleteUser,
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
    const cred = await signInWithEmailAndPassword(auth, emailFor(screenName), password);
    return cred.user;
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
  const groups = ["Buddies", "Family", "Co-Workers"].map((n) => ({ id: crypto.randomUUID().toUpperCase(), name: n, members: [], collapsed: false }));
  await set(ref(db, `buddylists/${user.uid}`), JSON.stringify(groups)).catch(() => {});
  return user;
}

export async function signOff() {
  const u = auth.currentUser;
  if (u) await update(ref(db, `users/${u.uid}`), { signedOn: false, lastSeen: serverTimestamp() }).catch(() => {});
  await signOut(auth);
}

export const conversationID = (a, b) => [a, b].sort().join("_");
