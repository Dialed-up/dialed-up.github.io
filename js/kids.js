// Kid-Safe Mode: locks this device to kid-friendly areas until a grown-up enters the PIN.
import { openWindow, closeWindow, esc } from "./wm.js";

const hash = async (pin) => {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("dialedup:" + pin));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
};
export const kidMode = () => !!localStorage.getItem("du.kidpin");

// What kids can't open while Kid-Safe Mode is on.
const blockedKeywords = ["classifieds", "forsale", "ads", "buyandsell", "lottery", "lotto", "powerball", "megamillions", "events", "live", "liveevents", "auditorium", "locate", "find", "whereis", "browser", "web", "internet", "www", "cnn", "espn", "youtube", "wikipedia", "chat", "plaza", "peopleplaza",
  "chatrooms", "rooms", "lobby", "boards", "forums", "messageboards", "people", "directory", "members", "stocks", "news", "radio"];
export const isBlockedForKids = (k) => kidMode() && (blockedKeywords.includes(k) || k.includes("."));

export function applyKidMode() {
  document.body.classList.toggle("kid-mode", kidMode());
}

export function openKidSafe() {
  openWindow("kids", {
    title: "Kid-Safe Mode", icon: "🧒", width: 340, height: 380, keyword: "kids",
    render(body) {
      const on = kidMode();
      body.innerHTML = `<div class="panel"><h3>${on ? "🔒 Kid-Safe Mode is ON" : "🧒 Kid-Safe Mode is off"}</h3>
        <p class="small">When it's on, this device can't open chat rooms, message boards, the web browser, news, radio or the member directory —
        and only homies can send mail. Mail, IMs with homies, games, weather and home pages still work.</p></div>
        <form id="kf"><label>${on ? "Enter the PIN to turn it off" : "Pick a 4-digit PIN (grown-ups only!)"}
          <input id="kp" inputmode="numeric" maxlength="4" pattern="\\d{4}" required></label>
        ${on ? "" : `<label>Type the PIN again <input id="kp2" inputmode="numeric" maxlength="4" pattern="\\d{4}" required></label>`}
        <p class="error" id="ke"></p><div class="row"><span></span><button class="btn primary">${on ? "Turn Off" : "Turn On"}</button></div></form>
        <p class="small muted">This only affects this device and browser.</p>`;
      body.querySelector("#kf").onsubmit = async (e) => {
        e.preventDefault();
        const pin = body.querySelector("#kp").value;
        if (on) {
          if ((await hash(pin)) !== localStorage.getItem("du.kidpin")) { body.querySelector("#ke").textContent = "That's not the PIN."; return; }
          localStorage.removeItem("du.kidpin");
          localStorage.setItem("du.mailBuddiesOnly", localStorage.getItem("du.kidPrevMail") || "0");
        } else {
          if (pin !== body.querySelector("#kp2").value) { body.querySelector("#ke").textContent = "The PINs don't match."; return; }
          localStorage.setItem("du.kidPrevMail", localStorage.getItem("du.mailBuddiesOnly") || "0");
          localStorage.setItem("du.kidpin", await hash(pin));
          localStorage.setItem("du.mailBuddiesOnly", "1");
        }
        applyKidMode();
        closeWindow("kids");
      };
    },
  });
}
