// E-Greetings: send an animated card to any screen name. Cards arrive in Mail.
import { openWindow, esc } from "./wm.js";

export const cardDesigns = {
  birthday: { label: "🎂 Happy Birthday", bg: "linear-gradient(160deg,#ff8ad4,#8a4dff)", emoji: ["🎈", "🎉", "🎂", "🎁"], headline: "Happy Birthday!" },
  thanks: { label: "🙏 Thank You", bg: "linear-gradient(160deg,#ffd36e,#ff7a59)", emoji: ["🌻", "✨", "💛"], headline: "Thank You!" },
  love: { label: "💘 Thinking of You", bg: "linear-gradient(160deg,#ff5e8a,#ffb3c7)", emoji: ["💖", "💌", "💕"], headline: "Thinking of You" },
  congrats: { label: "🏆 Congrats", bg: "linear-gradient(160deg,#21d4fd,#2b59ff)", emoji: ["🏆", "🎊", "⭐"], headline: "Congratulations!" },
  holiday: { label: "❄️ Happy Holidays", bg: "linear-gradient(160deg,#0b3d2e,#1e7a4c)", emoji: ["❄️", "⛄", "✨"], headline: "Happy Holidays!" },
  justbecause: { label: "🌈 Just Because", bg: "linear-gradient(160deg,#7be7ff,#b6ff3b)", emoji: ["🌈", "😎", "🦄"], headline: "Just Because!" },
  party: { label: "🪩 Party Time", bg: "linear-gradient(160deg,#120726,#5b2a86)", emoji: ["🪩", "🎧", "🔊", "💃"], headline: "Party Time!" },
};

/** Draws a card (with floating emoji) into an element. */
export function renderCard(el, card) {
  const d = cardDesigns[card.design] || cardDesigns.justbecause;
  const floaters = Array.from({ length: 14 }, (_, i) =>
    `<span class="floater" style="left:${(i * 37) % 95}%;animation-delay:${(i % 7) * 0.6}s;animation-duration:${5 + (i % 4)}s">${d.emoji[i % d.emoji.length]}</span>`).join("");
  el.innerHTML = `<div class="ecard" style="background:${d.bg}">${floaters}
    <div class="ecard-inner"><h2>${esc(card.headline || d.headline)}</h2><p>${esc(card.text || "")}</p>
    <p class="ecard-from">— ${esc(card.fromName || "")}</p></div></div>`;
}

export function openGreetings(send) {
  openWindow("greetings", {
    title: "E-Greetings", icon: "💌", width: 420, height: 560, keyword: "greetings",
    render(body) {
      let design = "birthday";
      body.innerHTML = `<div class="swatches">${Object.entries(cardDesigns).map(([k, d], i) =>
          `<button data-d="${esc(k)}" class="${i ? "" : "on"}" style="background:${d.bg};color:#fff">${d.label}</button>`).join("")}</div>
        <label style="margin-top:8px">To (screen name) <input id="g-to"></label>
        <label>Headline <input id="g-h" maxlength="60" placeholder="${esc(cardDesigns.birthday.headline)}"></label>
        <label>Your message <textarea id="g-t" rows="3" maxlength="400" placeholder="Hope your day is amazing!"></textarea></label>
        <div id="g-prev" style="margin-bottom:8px"></div>
        <p class="error" id="g-err"></p>
        <div class="row"><span class="small muted">Arrives in their Mailbox.</span><button class="btn primary" id="g-send">💌 Send Card</button></div>`;
      const prev = () => renderCard(body.querySelector("#g-prev"), { design, headline: body.querySelector("#g-h").value, text: body.querySelector("#g-t").value, fromName: "You" });
      body.querySelectorAll("[data-d]").forEach((b) => (b.onclick = () => {
        design = b.dataset.d;
        body.querySelectorAll("[data-d]").forEach((x) => x.classList.toggle("on", x === b));
        body.querySelector("#g-h").placeholder = cardDesigns[design].headline;
        prev();
      }));
      body.querySelectorAll("#g-h, #g-t").forEach((i) => (i.oninput = prev));
      prev();
      body.querySelector("#g-send").onclick = async () => {
        const err = body.querySelector("#g-err");
        err.textContent = "";
        const to = body.querySelector("#g-to").value.trim();
        if (!to) { err.textContent = "Who's it for? Type their screen name."; return; }
        const card = { design, headline: body.querySelector("#g-h").value.trim() || cardDesigns[design].headline, text: body.querySelector("#g-t").value.trim() };
        try { await send(to, card); body.closest(".win").querySelector(".close").click(); }
        catch (e) { err.textContent = e.message; }
      };
    },
  });
}
