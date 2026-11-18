// Preferences: color themes, wallpapers and IM backgrounds.
import { openWindow, esc } from "./wm.js";

export const themes = {
  Grape: { grape: "#5b2a86", grape2: "#8a4dff", pink: "#ff5ec4", aqua: "#21d4fd" },
  Ocean: { grape: "#0b4f8a", grape2: "#1e88e5", pink: "#26c6da", aqua: "#80deea" },
  Lime: { grape: "#2e6b1f", grape2: "#58a832", pink: "#c6e83a", aqua: "#7ee8b0" },
  Cherry: { grape: "#8a1538", grape2: "#d81b60", pink: "#ff7043", aqua: "#ffb3c7" },
  Midnight: { grape: "#1b1b3a", grape2: "#3f3d8f", pink: "#7c4dff", aqua: "#4dd0e1" },
  Sunset: { grape: "#7a2e0e", grape2: "#f4511e", pink: "#ffb300", aqua: "#ff8a65" },
};

export const wallpapers = {
  "Candy Glow": "radial-gradient(circle at 20% 15%, #ff9de2 0, transparent 40%), radial-gradient(circle at 85% 80%, #7be7ff 0, transparent 45%), linear-gradient(160deg, #3a1563, #5b2a86 45%, #1f6f9e)",
  "Classic Teal": "#0f7f7f",
  "Starfield": "radial-gradient(#fff 1px, transparent 1.5px) 0 0/26px 26px, radial-gradient(#fff8 1px, transparent 1.5px) 13px 13px/26px 26px, linear-gradient(#060318, #1d0b45)",
  "Grid 2000": "linear-gradient(#ff5ec455 1px, transparent 1px) 0 0/32px 32px, linear-gradient(90deg, #ff5ec455 1px, transparent 1px) 0 0/32px 32px, linear-gradient(#12002a, #3d0a5c)",
  "Bubble Pop": "radial-gradient(circle at 30% 30%, #ffffff55 0 40px, transparent 41px) 0 0/140px 140px, linear-gradient(135deg, #34c3ff, #9b6bff)",
  "Sunset Strip": "linear-gradient(180deg, #2b1055, #d5426b 55%, #ffb86b)",
  "My Picture": null,
};

export const imBackgrounds = {
  Plain: "#ffffff",
  Notebook: "repeating-linear-gradient(#fff 0 22px, #cfe3ff 22px 23px)",
  Hearts: "radial-gradient(circle at 10px 10px, #ffd6e8 4px, transparent 5px) 0 0/28px 28px, #fff",
  Stars: "radial-gradient(#ffe94d 1.5px, transparent 2px) 0 0/22px 22px, #fffdf0",
  Mint: "linear-gradient(135deg, #e8fff4, #d6f5ff)",
  Grape: "linear-gradient(135deg, #f5ecff, #ffe8f6)",
  Dark: "#20152f",
};

export function applyPrefs() {
  const t = themes[localStorage.getItem("du.theme")] || themes.Grape;
  const root = document.documentElement.style;
  root.setProperty("--grape", t.grape);
  root.setProperty("--grape-2", t.grape2);
  root.setProperty("--pink", t.pink);
  root.setProperty("--aqua", t.aqua);
  const wpName = localStorage.getItem("du.wallpaper") || "Candy Glow";
  const custom = localStorage.getItem("du.wallpaperImg");
  document.body.style.background = wpName === "My Picture" && custom ? `center/cover no-repeat url(${custom})` : wallpapers[wpName] || wallpapers["Candy Glow"];
}

export const imBackgroundFor = (conv) => imBackgrounds[localStorage.getItem("du.imbg." + conv) || localStorage.getItem("du.imbg") || "Plain"] || "#fff";

export function openPreferences() {
  openWindow("prefs", {
    title: "Preferences", icon: "🎨", width: 400, height: 500, keyword: "preferences",
    render(body) {
      const cur = { theme: localStorage.getItem("du.theme") || "Grape", wp: localStorage.getItem("du.wallpaper") || "Candy Glow", im: localStorage.getItem("du.imbg") || "Plain" };
      body.innerHTML = `
        <div class="panel"><h3>🎨 Color Theme</h3><div class="swatches">${Object.entries(themes).map(([n, t]) =>
          `<button data-theme="${n}" class="${n === cur.theme ? "on" : ""}" style="background:linear-gradient(90deg, ${t.grape}, ${t.grape2}, ${t.pink})">${n}</button>`).join("")}</div></div>
        <div class="panel"><h3>🖼 Wallpaper</h3><div class="swatches">${Object.entries(wallpapers).map(([n, w]) =>
          `<button data-wp="${n}" class="${n === cur.wp ? "on" : ""}" style="background:${w || "#888"};color:#fff">${n}</button>`).join("")}</div>
          <label class="btn small-btn" style="display:inline-block;margin-top:6px;font-weight:normal">Use my own picture<input type="file" accept="image/*" id="wp-file" hidden></label></div>
        <div class="panel"><h3>💬 IM Window Background</h3><div class="swatches">${Object.entries(imBackgrounds).map(([n, b]) =>
          `<button data-im="${n}" class="${n === cur.im ? "on" : ""}" style="background:${b};color:${n === "Dark" ? "#fff" : "#333"}">${n}</button>`).join("")}</div>
          <p class="small muted">Applies to all IM windows. Each IM window also has its own 🎨 button.</p></div>`;
      const mark = (attr, val) => body.querySelectorAll(`[data-${attr}]`).forEach((b) => b.classList.toggle("on", b.dataset[attr] === val));
      body.querySelectorAll("[data-theme]").forEach((b) => (b.onclick = () => { localStorage.setItem("du.theme", b.dataset.theme); applyPrefs(); mark("theme", b.dataset.theme); }));
      body.querySelectorAll("[data-wp]").forEach((b) => (b.onclick = () => { localStorage.setItem("du.wallpaper", b.dataset.wp); applyPrefs(); mark("wp", b.dataset.wp); }));
      body.querySelectorAll("[data-im]").forEach((b) => (b.onclick = () => {
        localStorage.setItem("du.imbg", b.dataset.im); mark("im", b.dataset.im);
        document.querySelectorAll(".transcript[data-conv]").forEach((t) => (t.style.background = imBackgroundFor(t.dataset.conv)));
      }));
      body.querySelector("#wp-file").onchange = async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        const img = await createImageBitmap(f);
        const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = img.width * scale; c.height = img.height * scale;
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        try { localStorage.setItem("du.wallpaperImg", c.toDataURL("image/jpeg", 0.8)); } catch { alert("That picture is too big. Try a smaller one."); return; }
        localStorage.setItem("du.wallpaper", "My Picture"); applyPrefs(); mark("wp", "My Picture");
      };
    },
  });
}
