// Profiles, the classic way: styled text (fonts, colors, sizes, effects), Member Info fields,
// clickable interests, a profile background, a profile song, a view counter and %n / %d / %t magic words.
import { db, ref, get, set, update, remove, runTransaction } from "./firebase.js";
import { openWindow, closeWindow, esc, img64 } from "./wm.js";
import { pickEmoji } from "./emoji.js";
import { smileys } from "./chat.js";

// ---------- Safe rich text ----------
const TAGS = new Set(["B", "STRONG", "I", "EM", "U", "S", "STRIKE", "FONT", "SPAN", "A", "BR", "DIV", "P", "CENTER", "HR", "SMALL", "BIG", "SUB", "SUP", "UL", "OL", "LI"]);
const EFFECTS = ["du-glow", "du-rainbow", "du-blink", "du-scroll", "du-sparkle", "du-shadow"];
const FONTS = ["Verdana", "Arial", "Georgia", "Times New Roman", "Courier New", "Comic Sans MS", "Trebuchet MS", "Impact", "Tahoma", "Brush Script MT", "Lucida Console", "Palatino"];
const okColor = (c) => /^(#[0-9a-f]{3,8}|rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)|[a-z]{3,20})$/i.test(String(c).trim());

/** Keeps only safe formatting; drops scripts, styles we don't allow, event handlers, etc. */
export function sanitize(html) {
  const tpl = document.createElement("template");
  tpl.innerHTML = String(html || "").slice(0, 12000);
  const clean = (node) => {
    [...node.childNodes].forEach((n) => {
      if (n.nodeType === 3) return;
      if (n.nodeType !== 1 || !TAGS.has(n.tagName)) {
        if (n.nodeType === 1 && !/^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED|svg|SVG|MATH|TEMPLATE)$/.test(n.tagName)) { clean(n); n.replaceWith(...n.childNodes); }
        else n.remove();
        return;
      }
      const keep = {};
      if (n.tagName === "A") {
        const href = n.getAttribute("href") || "";
        if (/^https?:\/\//i.test(href)) keep.href = href;
      }
      if (n.tagName === "FONT") {
        if (okColor(n.getAttribute("color") || "")) keep.color = n.getAttribute("color");
        const face = (n.getAttribute("face") || "").split(",")[0].trim();
        if (FONTS.includes(face)) keep.face = face;
        const size = Number(n.getAttribute("size"));
        if (size >= 1 && size <= 7) keep.size = String(size);
      }
      const st = n.getAttribute("style") || "";
      const styles = [];
      st.split(";").forEach((d) => {
        const [k, ...v] = d.split(":");
        const prop = (k || "").trim().toLowerCase(), val = v.join(":").trim();
        if ((prop === "color" || prop === "background-color") && okColor(val)) styles.push(`${prop}:${val}`);
        if (prop === "font-family") { const f = val.split(",")[0].replace(/['"]/g, "").trim(); if (FONTS.includes(f)) styles.push(`font-family:'${f}'`); }
        if (prop === "font-size" && /^(\d{1,2}px|x?x-small|small|medium|large|x?x-large|xxx-large)$/.test(val)) styles.push(`font-size:${val}`);
        if (prop === "text-align" && /^(left|center|right)$/.test(val)) styles.push(`text-align:${val}`);
        if (prop === "font-weight" && /^(bold|normal|[1-9]00)$/.test(val)) styles.push(`font-weight:${val}`);
        if (prop === "font-style" && /^(italic|normal)$/.test(val)) styles.push(`font-style:${val}`);
        if (prop === "text-decoration" && /^(underline|line-through|none)$/.test(val)) styles.push(`text-decoration:${val}`);
      });
      const cls = (n.getAttribute("class") || "").split(/\s+/).filter((c) => EFFECTS.includes(c));
      const align = n.getAttribute("align");
      [...n.attributes].forEach((a) => n.removeAttribute(a.name));
      Object.entries(keep).forEach(([k, v]) => n.setAttribute(k, v));
      if (styles.length) n.setAttribute("style", styles.join(";"));
      if (cls.length) n.setAttribute("class", cls.join(" "));
      if (align && /^(left|center|right)$/i.test(align)) n.setAttribute("align", align);
      if (n.tagName === "A") { n.setAttribute("target", "_blank"); n.setAttribute("rel", "noopener nofollow"); }
      clean(n);
    });
  };
  clean(tpl.content);
  return tpl.innerHTML;
}

/** Fills in %n (whoever is reading), %d (date) and %t (time). */
const magic = (html, viewer) => html.replace(/%n/g, esc(viewer || "you"))
  .replace(/%d/g, new Date().toLocaleDateString()).replace(/%t/g, new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));

// ---------- Looks ----------
export const LOOKS = {
  "Classic White": { bg: "#ffffff", ink: "#222222" },
  "Grape Soda": { bg: "linear-gradient(160deg,#f3e9ff,#d9c2ff)", ink: "#2b0f57" },
  "Bubblegum": { bg: "linear-gradient(160deg,#ffe3f3,#ffb8de)", ink: "#5a0a3a" },
  "Ocean": { bg: "linear-gradient(160deg,#dff6ff,#9fd8ff)", ink: "#06324f" },
  "Lime Light": { bg: "linear-gradient(160deg,#f2ffd9,#c8f58a)", ink: "#223d00" },
  "Sunset": { bg: "linear-gradient(160deg,#fff1c9,#ffb38a 60%,#ff7aa8)", ink: "#4a1300" },
  "Midnight": { bg: "linear-gradient(160deg,#111a3a,#2b0f57)", ink: "#f1ecff" },
  "Black Light": { bg: "#0b0b12", ink: "#39ff14" },
  "Glitter": { bg: "radial-gradient(circle at 20% 30%,#fff 0 1px,transparent 2px) 0 0/22px 22px, radial-gradient(circle at 70% 60%,#ffe680 0 1px,transparent 2px) 0 0/30px 30px, linear-gradient(160deg,#ff9de2,#8a4dff)", ink: "#ffffff" },
  "Stars": { bg: "radial-gradient(circle,#fff 0 1px,transparent 1.5px) 0 0/26px 26px, linear-gradient(#0d1b4a,#2c1460)", ink: "#fff6c2" },
  "Checkerboard": { bg: "repeating-conic-gradient(#ffffff 0 25%,#ffe3f3 0 50%) 0 0/28px 28px", ink: "#3a0a2a" },
  "Notebook": { bg: "repeating-linear-gradient(#fffef6 0 22px,#cfe3ff 22px 23px)", ink: "#1a237e" },
};
const BORDERS = { "None": "none", "Simple": "2px solid #b79bff", "Dotted": "3px dotted #ff5ec4", "Double": "5px double #5b2a86", "Glow": "2px solid #fff;box-shadow:0 0 12px #ff5ec4" };
const lookCSS = (look = {}) => {
  const L = look.theme === "Custom" && okColor(look.bgColor || "") ? { bg: look.bgColor, ink: "#222222" } : LOOKS[look.theme] || LOOKS["Classic White"];
  const ink = okColor(look.ink || "") ? look.ink : L.ink;
  return `background:${L.bg};color:${ink};border:${(BORDERS[look.border] || "none").split(";")[0]};${(BORDERS[look.border] || "").split(";")[1] || ""};font-family:'${FONTS.includes(look.font) ? look.font : "Verdana"}',Verdana,sans-serif;`;
};

// ---------- Member Info ----------
export const FIELDS = [
  ["realName", "Name", "Pat"], ["location", "Location", "Brooklyn, NY"], ["birthday", "Birthday", "May 4"],
  ["gender", "Gender", ""], ["status", "Relationship", ""], ["occupation", "Occupation", "DJ"],
  ["music", "Favorite Music", "90s hip hop, house"], ["gadgets", "Gadgets", "iPhone, turntables"], ["quote", "Personal Quote", "Keep it spinning."],
];
const STATUS = ["", "Single", "Taken", "Married", "It's complicated", "Not saying"];
const GENDER = ["", "Male", "Female", "Non-binary", "Not saying"];

// ---------- Viewing a profile (inside Homie Info) ----------
export function renderProfile(el, u, uid, { viewer, openDirectory } = {}) {
  const card = u.card || {};
  const interests = String(u.interests || "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 15);
  const rows = FIELDS.filter(([k]) => k !== "quote" && (card[k] || (k === "location" && u.location)))
    .map(([k, label]) => `<tr><th>${label}</th><td>${esc(card[k] || u[k] || "")}</td></tr>`).join("");
  const body = withSmileys(u.profileHtml ? magic(sanitize(u.profileHtml), viewer) : u.profile ? esc(u.profile).replace(/\n/g, "<br>") : "");
  el.innerHTML = `<div class="profile-card" style="${lookCSS(u.look)}">
      ${body ? `<div class="profile-body">${body}</div>` : `<p class="small" style="opacity:.7">(${esc(u.screenName || "They")} hasn't written a profile yet)</p>`}
      ${card.quote ? `<p class="profile-quote">“${esc(card.quote)}”</p>` : ""}
      ${u.song?.title ? `<div class="profile-song"><button class="btn small-btn" data-song>▶</button> 🎵 <b>${esc(u.song.title)}</b></div>` : ""}
    </div>
    ${rows ? `<div class="panel"><h3>📋 Member Info</h3><table class="member-info">${rows}</table></div>` : ""}
    ${interests.length ? `<div class="panel"><h3>❤️ Interests</h3><div class="chips">${interests.map((i) => `<button class="chip" data-int="${esc(i)}">${esc(i)}</button>`).join("")}</div>
      <p class="small muted" style="margin:4px 0 0">Tap an interest to find other members who like it.</p></div>` : ""}
    <div class="profile-badges"></div>
    <div class="profile-pics"></div>
    <div class="profile-top8"></div>
    <div class="profile-wall"></div>
    <p class="small muted profile-views"></p>`;
  if (!String(uid).endsWith("__preview")) import("./social.js").then((m) => {
    m.renderTop8(el.querySelector(".profile-top8"), uid, u.top8);
    m.renderWall(el.querySelector(".profile-wall"), uid);
  });
  if (!String(uid).endsWith("__preview") && (u.badges || u.streak?.n > 1)) import("./engage.js").then((m) => {
    const st = u.streak && u.streak.n > 1 && Date.now() - new Date(u.streak.last + "T23:59:59").getTime() < 86400000 * 2 ? u.streak.n : 0;
    el.querySelector(".profile-badges").innerHTML = `<div class="panel"><h3>🏅 Badges</h3>${st ? `<p class="small" style="margin:0 0 4px">🔥 <b>${st}-day</b> sign-on streak</p>` : ""}${m.badgesHTML(u.badges)}</div>`;
  });
  {
    const realUid = String(uid).replace(/__preview$/, "");
    get(ref(db, `profilepics/${realUid}`)).then((sn) => {
      const list = Object.values(sn.val() || {}).filter(Boolean).slice(0, 6);
      const box = el.querySelector(".profile-pics");
      if (!list.length || !box) return;
      box.innerHTML = `<div class="panel"><h3>📷 Photos</h3><div class="pp-grid">${list.map((d) => `<figure><img src="${img64(d)}" alt=""></figure>`).join("")}</div></div>`;
      box.querySelectorAll("img").forEach((im) => (im.onclick = () => {
        const v = document.createElement("div"); v.className = "media-viewer"; v.innerHTML = `<img src="${esc(im.src)}" alt=""><button>✕</button>`; v.onclick = () => v.remove(); document.body.appendChild(v);
      }));
    }).catch(() => {});
  }
  el.querySelectorAll("[data-int]").forEach((b) => (b.onclick = () => openDirectory?.(b.dataset.int)));
  const songBtn = el.querySelector("[data-song]");
  if (songBtn) {
    songBtn.onclick = () => {
      if (/youtube\.com|youtu\.be|soundcloud\.com|spotify\.com/.test(u.song.url)) import("./browser.js").then((m) => m.openBrowser(u.song.url));
      else {
        window.__duSong = window.__duSong || new Audio();
        const a = window.__duSong;
        if (a.src === u.song.url && !a.paused) { a.pause(); songBtn.textContent = "▶"; return; }
        a.src = u.song.url; a.play().then(() => (songBtn.textContent = "⏸")).catch(() => alert("That song isn't playing right now."));
      }
    };
  }
  if (!String(uid).endsWith("__preview")) countView(uid, el.querySelector(".profile-views"), viewer === u.screenName);
}

async function countView(uid, el, isMe) {
  try {
    const r = ref(db, `profileviews/${uid}`);
    let n = (await get(r)).val() || 0;
    const seenKey = "du.pv." + uid;
    if (!isMe && sessionStorage.getItem(seenKey) !== "1") {
      sessionStorage.setItem(seenKey, "1");
      n = (await runTransaction(r, (v) => (v || 0) + 1)).snapshot.val() || n + 1;
    }
    if (el && n) el.textContent = `👀 Profile viewed ${n.toLocaleString()} time${n === 1 ? "" : "s"}`;
  } catch {}
}

// ---------- Editing your profile ----------
export function openProfileEditor({ uid, user, screenName, iconHTML, setMyIcon, openDirectory }) {
  const u = user || {};
  const card = { ...(u.card || {}) };
  const look = { theme: "Classic White", border: "None", font: "Verdana", ...(u.look || {}) };
  let song = u.song || null;
  openWindow("profile", {
    title: "My Profile", icon: "🪪", width: 420, height: 560, keyword: "profile",
    render(body) {
      body.innerHTML = `<div class="ptabs">
          <button data-t="write" class="on">✏️ Profile</button><button data-t="info">📋 Member Info</button>
          <button data-t="look">🎨 Look</button><button data-t="top8">⭐ Top 8</button><button data-t="photos">📷 Photos</button><button data-t="song">🎵 Song</button><button data-t="icon">🖼 Icon</button><button data-t="preview">👀 Preview</button></div>
        <section data-p="write">
          <div class="rt-bar">
            <select data-c="fontName" title="Font">${FONTS.map((f) => `<option style="font-family:'${f}'">${f}</option>`).join("")}</select>
            <select data-c="fontSize" title="Size">${[["1", "Tiny"], ["2", "Small"], ["3", "Normal"], ["4", "Medium"], ["5", "Large"], ["6", "Huge"], ["7", "Giant"]].map(([v, l]) => `<option value="${esc(v)}" ${v === "3" ? "selected" : ""}>${l}</option>`).join("")}</select>
            <button data-c="bold"><b>B</b></button><button data-c="italic"><i>I</i></button><button data-c="underline"><u>U</u></button><button data-c="strikeThrough"><s>S</s></button>
            <button data-c="textcolor" title="Text color" class="rt-a">A<span class="rt-a-bar"></span></button>
            <button data-c="bucket" title="Background color">🪣</button>
            <button data-c="justifyLeft" title="Left">⬅</button><button data-c="justifyCenter" title="Center">↔</button><button data-c="justifyRight" title="Right">➡</button>
            <button data-c="insertUnorderedList" title="Bullet list">•≡</button><button data-c="insertOrderedList" title="Numbered list">1≡</button>
            <button data-c="superscript" title="Raised text">x²</button><button data-c="subscript" title="Lowered text">x₂</button>
            <button data-c="link" title="Add a link">🔗</button><button data-c="hr" title="Line">➖</button><button data-c="emoji" title="Emoji">😀</button>
            <select data-c="effect" title="Effects"><option value="">✨ Effects…</option><option value="du-glow">Glow</option><option value="du-rainbow">Rainbow</option><option value="du-sparkle">Sparkle</option><option value="du-blink">Blink</option><option value="du-scroll">Scrolling</option><option value="du-shadow">Shadow</option><option value="none">Remove effect</option></select>
          </div>
          <div class="rt-edit" contenteditable="true" spellcheck="true"></div>
          <p class="small muted" style="margin:4px 0">Magic words: <b>%n</b> = the name of whoever's reading · <b>%d</b> = today's date · <b>%t</b> = the time</p>
        </section>
        <section data-p="info" hidden>
          <div class="panel sn-panel"><b>🆔 Screen Name</b>
            <div class="row" style="gap:4px;margin-top:4px"><input id="sn-new" value="${esc(screenName)}" maxlength="20" autocapitalize="off" style="flex:1"><button class="btn small-btn" id="sn-go">Change</button></div>
            <p class="small muted" style="margin:4px 0 0">3–16 letters or numbers (spaces OK). Your password stays the same, and you can sign on with your new or old name. Homies see the new name right away.</p>
            <p class="error" id="sn-err"></p></div>
          ${FIELDS.map(([k, label, ph]) => k === "gender" ? `<label>${label}<select data-f="${esc(k)}">${GENDER.map((g) => `<option ${card[k] === g ? "selected" : ""}>${g}</option>`).join("")}</select></label>`
            : k === "status" ? `<label>${label}<select data-f="${esc(k)}">${STATUS.map((g) => `<option ${card[k] === g ? "selected" : ""}>${g}</option>`).join("")}</select></label>`
            : `<label>${label}<input data-f="${esc(k)}" maxlength="${k === "quote" ? 140 : 60}" value="${esc(card[k] || (k === "location" ? u.location || "" : ""))}" placeholder="${esc(ph)}"></label>`).join("")}
          <label>Interests <span class="small muted">(separate with commas — people can tap these to find you)</span><input data-f="interests" maxlength="200" value="${esc(u.interests || "")}" placeholder="music, sneakers, basketball"></label>
          <label class="check"><input type="checkbox" id="pd" ${localStorage.getItem("du.listed." + uid) === "1" ? "checked" : ""}> List me in the Member Directory (screen name, interests and location only)</label>
          <div class="panel" style="margin-top:8px"><b>Who can see my profile?</b>
            <label class="check"><input type="radio" name="pv" value="buddies" ${u.publicProfile ? "" : "checked"}> 👥 Homies only</label>
            <label class="check"><input type="radio" name="pv" value="public" ${u.publicProfile ? "checked" : ""}> 🌍 Public — anyone can look me up with Get Member Info</label></div>
          <p class="small muted">Leave anything blank to keep it private.</p>
        </section>
        <section data-p="look" hidden>
          <div class="look-preview"><b>👀 Live preview</b><br>This is how your profile box will look. <span class="du-rainbow">✨</span></div>
          <div class="row look-colors">
            <label class="color-pick">🎨 Any background color<input type="color" id="lbg" value="${okColor(look.bgColor || "") && look.bgColor.startsWith("#") ? look.bgColor : "#ffe3f3"}"></label>
            <label class="color-pick">🖋 Text color<input type="color" id="link" value="${okColor(look.ink || "") && look.ink.startsWith("#") ? look.ink : "#222222"}"></label>
            <button class="btn small-btn" id="lreset" title="Use the background's own text color">Auto text</button>
          </div>
          <h4 style="margin:8px 0 4px">Or pick a style</h4><div class="look-grid">${Object.entries(LOOKS).map(([n, L]) => `<button data-look="${esc(n)}" style="background:${L.bg};color:${L.ink}" class="${look.theme === n ? "on" : ""}">${esc(n)}</button>`).join("")}</div>
          <h4 style="margin:10px 0 4px">Border</h4><div class="row" style="justify-content:flex-start;gap:4px;flex-wrap:wrap">${Object.keys(BORDERS).map((b) => `<button class="btn small-btn ${look.border === b ? "primary" : ""}" data-border="${esc(b)}">${b}</button>`).join("")}</div>
          <label style="margin-top:10px">Main font<select id="lf">${FONTS.map((f) => `<option ${look.font === f ? "selected" : ""} style="font-family:'${f}'">${f}</option>`).join("")}</select></label>
        </section>
        <section data-p="top8" hidden><div id="t8"></div></section>
        <section data-p="photos" hidden>
          <p class="small" style="margin-top:0">Show up to 6 photos on your profile.</p>
          <div class="pf-photos"></div>
          <div class="row" style="justify-content:flex-start;gap:4px;margin-top:6px">
            <label class="btn small-btn" style="margin:0;font-weight:normal">📱 Add from my phone<input type="file" accept="image/*" multiple id="pp-file" hidden></label>
            <button class="btn small-btn" id="pp-albums">📸 Add from my Photo Albums</button></div>
          <div id="pp-pick"></div>
        </section>
        <section data-p="song" hidden>
          <p class="small" style="margin-top:0">Pick a song people can play from your profile (it never plays by itself).</p>
          <div class="panel" id="song-now"></div>
          <label>Song name<input id="sg-t" maxlength="60" placeholder="My jam" value="${esc(song?.title || "")}"></label>
          <label>Link (YouTube, SoundCloud, Spotify or a radio stream)<input id="sg-u" placeholder="https://…" value="${esc(song?.url || "")}"></label>
          <div class="row" style="justify-content:flex-start;gap:4px"><button class="btn small-btn" id="sg-radio">📻 Use the radio station I'm playing</button><button class="btn small-btn" id="sg-clear">Remove song</button></div>
        </section>
        <section data-p="icon" hidden>
          <div class="panel" style="display:flex;gap:10px;align-items:center"><span id="pf-icon">${iconHTML(uid, 72)}</span>
            <div><b>Homie Icon</b><br><label class="btn small-btn" style="margin:4px 0 0;display:inline-block;font-weight:normal">Choose a picture<input type="file" accept="image/*" id="pf-file" hidden></label>
            <span class="small muted" id="pf-msg"></span></div></div>
        </section>
        <section data-p="preview" hidden><div id="pv"></div></section>
        <div class="row profile-save"><span class="small muted">Your homies see this in Homie Info.</span><button class="btn primary" id="ps">💾 Save Profile</button></div>`;

      const ed = body.querySelector(".rt-edit");
      ed.innerHTML = u.profileHtml ? sanitize(u.profileHtml) : esc(u.profile || "").replace(/\n/g, "<br>");
      let saved = null;
      const keepSel = () => { const s = getSelection(); if (s.rangeCount && ed.contains(s.anchorNode)) saved = s.getRangeAt(0).cloneRange(); };
      const restoreSel = () => { ed.focus(); if (saved) { const s = getSelection(); s.removeAllRanges(); s.addRange(saved); } };
      ["keyup", "mouseup", "touchend", "input"].forEach((ev) => ed.addEventListener(ev, keepSel));
      const cmd = (c, v = null) => { restoreSel(); try { document.execCommand("styleWithCSS", false, c === "hiliteColor"); } catch {} document.execCommand(c, false, v); keepSel(); };

      body.querySelectorAll(".rt-bar [data-c]").forEach((el) => {
        const c = el.dataset.c;
        if (el.tagName === "BUTTON") el.addEventListener("pointerdown", (e) => e.preventDefault());
        if (c === "fontName" || c === "fontSize") el.onchange = () => cmd(c, el.value);
        else if (c === "foreColor" || c === "hiliteColor") el.oninput = () => cmd(c, el.value);
        else if (c === "link") el.onclick = () => { const url = prompt("Link address (https://…):", "https://"); if (url && /^https?:\/\/\S+\.\S+/.test(url)) cmd("createLink", url); };
        else if (c === "hr") el.onclick = () => cmd("insertHorizontalRule");
        else if (c === "emoji") el.onclick = () => pickEmoji(el, (e) => cmd("insertText", e));
        else if (c === "bucket") el.onclick = () => pickBackground(el, "🪣 Profile background", (color) => { look.theme = "Custom"; look.bgColor = color; paintLook(); });
        else if (c === "textcolor") el.onclick = () => {
          keepSel();
          pickBackground(el, "A  Text color (highlight text first)", (color) => {
            cmd("foreColor", color);
            el.querySelector(".rt-a-bar").style.background = color;
          });
        };
        else if (c === "effect") el.onchange = () => {
          restoreSel();
          const s = getSelection();
          if (!s.rangeCount || s.isCollapsed) { alert("Highlight some text first, then pick an effect."); el.value = ""; return; }
          const range = s.getRangeAt(0);
          if (el.value === "none") {
            const span = range.commonAncestorContainer.parentElement?.closest("span[class]");
            if (span && ed.contains(span)) span.replaceWith(...span.childNodes);
          } else {
            const span = document.createElement("span");
            span.className = el.value;
            span.appendChild(range.extractContents());
            range.insertNode(span);
          }
          el.value = "";
        };
        else el.onclick = () => cmd(c);
      });

      const tabs = body.querySelectorAll("[data-t]");
      const showTab = (t) => {
        tabs.forEach((b) => b.classList.toggle("on", b.dataset.t === t));
        body.querySelectorAll("section[data-p]").forEach((s) => (s.hidden = s.dataset.p !== t));
        if (t === "preview") renderProfile(body.querySelector("#pv"), { ...collect(), screenName }, uid + "__preview", { viewer: screenName, openDirectory });
        if (t === "song") paintSong();
      };
      tabs.forEach((b) => (b.onclick = () => showTab(b.dataset.t)));

      // Live look: the preview box and the editor change as soon as you pick something.
      const paintLook = () => {
        const css = lookCSS(look);
        body.querySelector(".look-preview").setAttribute("style", css);
        ed.setAttribute("style", css);
        body.querySelectorAll("[data-look]").forEach((x) => x.classList.toggle("on", x.dataset.look === look.theme));
        body.querySelectorAll("[data-border]").forEach((x) => x.classList.toggle("primary", x.dataset.border === look.border));
      };
      body.querySelector("#sn-go").onclick = async () => {
        const n = body.querySelector("#sn-new").value.trim();
        const err = body.querySelector("#sn-err");
        err.textContent = "";
        if (!n || n === screenName) return;
        if (!confirm(`Change your screen name to "${n}"?`)) return;
        try {
          const { changeScreenName } = await import("./firebase.js");
          const done = await changeScreenName(n);
          try {
            const names = JSON.parse(localStorage.getItem("du.names") || "[]").filter((x) => x.toLowerCase() !== done.toLowerCase());
            localStorage.setItem("du.names", JSON.stringify([done, ...names].slice(0, 7)));
          } catch {}
          alert(`You're now "${done}"! Sign on with this name next time (your password is the same).`);
          import("./engage.js").then((m) => m.screenNameLetter(screenName, done));
          screenName = done;
          document.title = document.title.replace(/—.*$/, "— " + done);
        } catch (e) { err.textContent = e.message; }
      };
      body.querySelectorAll("[data-look]").forEach((b) => (b.onclick = () => { look.theme = b.dataset.look; paintLook(); }));
      body.querySelectorAll("[data-border]").forEach((b) => (b.onclick = () => { look.border = b.dataset.border; paintLook(); }));
      body.querySelector("#lf").onchange = (e) => { look.font = e.target.value; paintLook(); };
      body.querySelector("#lbg").oninput = (e) => { look.theme = "Custom"; look.bgColor = e.target.value; paintLook(); };
      body.querySelector("#link").oninput = (e) => { look.ink = e.target.value; paintLook(); };
      body.querySelector("#lreset").onclick = () => { delete look.ink; paintLook(); };
      paintLook();

      const paintSong = () => (body.querySelector("#song-now").innerHTML = song?.title ? `🎵 <b>${esc(song.title)}</b><br><span class="small muted">${esc(song.url)}</span>` : `<span class="muted small">No profile song yet.</span>`);
      body.querySelector("#sg-radio").onclick = () => {
        const n = document.querySelector("#radio-mini .rm-name")?.textContent;
        import("./radio.js").then((m) => {
          const st = m.getNowPlaying?.();
          if (!st) { alert("Start a station in DialedUp Radio first, then come back and tap this."); return; }
          body.querySelector("#sg-t").value = st.name.slice(0, 60) || n || "";
          body.querySelector("#sg-u").value = st.url;
        });
      };
      body.querySelector("#sg-clear").onclick = () => { body.querySelector("#sg-t").value = ""; body.querySelector("#sg-u").value = ""; song = null; paintSong(); };

      body.querySelector("#pf-file").onchange = async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        body.querySelector("#pf-msg").textContent = "Saving…";
        try { await setMyIcon(f); body.querySelector("#pf-msg").textContent = "Saved!"; body.querySelector("#pf-icon").innerHTML = iconHTML(uid, 72); }
        catch { body.querySelector("#pf-msg").textContent = "Couldn't use that picture."; }
      };

      // ----- Top 8 -----
      let top8 = () => (Array.isArray(u.top8) ? u.top8 : []);
      import("./social.js").then((m) => (top8 = m.top8Editor(body.querySelector("#t8"), u.top8)));

      // ----- Profile photos -----
      let pics = [];
      const paintPics = () => {
        const box = body.querySelector(".pf-photos");
        box.innerHTML = pics.length ? `<div class="pp-grid">${pics.map((d, i) => `<figure><img src="${img64(d)}" alt=""><button data-rmp="${esc(i)}" title="Remove">✕</button></figure>`).join("")}</div>`
          : `<p class="small muted">No profile photos yet.</p>`;
        box.querySelectorAll("[data-rmp]").forEach((b) => (b.onclick = () => { pics.splice(Number(b.dataset.rmp), 1); paintPics(); }));
      };
      get(ref(db, `profilepics/${uid}`)).then((sn) => { pics = Object.values(sn.val() || {}).filter(Boolean).slice(0, 6); paintPics(); }).catch(paintPics);
      const shrink = async (file) => {
        const img = await createImageBitmap(file);
        const sc = Math.min(1, 640 / Math.max(img.width, img.height));
        const c = document.createElement("canvas"); c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        return c.toDataURL("image/jpeg", 0.72).split(",")[1];
      };
      body.querySelector("#pp-file").onchange = async (e) => {
        for (const f of [...e.target.files]) { if (pics.length >= 6) break; try { pics.push(await shrink(f)); } catch {} }
        e.target.value = ""; paintPics();
      };
      body.querySelector("#pp-albums").onclick = async () => {
        const pick = body.querySelector("#pp-pick");
        pick.innerHTML = `<p class="small muted">Loading your albums…</p>`;
        const all = (await get(ref(db, `photos/${uid}`)).catch(() => null))?.val() || {};
        const list = Object.values(all).flatMap((album) => Object.values(album || {})).map((p) => p.data).filter(Boolean).slice(0, 60);
        pick.innerHTML = list.length ? `<p class="small">Tap photos to add them:</p><div class="pp-grid">${list.map((d, i) => `<figure><img src="${img64(d)}" data-ai="${esc(i)}" alt=""></figure>`).join("")}</div>`
          : `<p class="small muted">Your Photo Albums are empty.</p>`;
        pick.querySelectorAll("[data-ai]").forEach((im) => (im.onclick = () => { if (pics.length < 6) { pics.push(list[im.dataset.ai]); paintPics(); im.style.opacity = ".35"; } }));
      };

      const collect = () => {
        const c = {};
        body.querySelectorAll("[data-f]").forEach((el) => { if (el.dataset.f !== "interests" && el.value.trim()) c[el.dataset.f] = el.value.trim(); });
        const t = body.querySelector("#sg-t").value.trim(), url = body.querySelector("#sg-u").value.trim();
        song = t && /^https?:\/\//.test(url) ? { title: t, url } : null;
        const html = sanitize(ed.innerHTML);
        return { profileHtml: html, profile: ed.innerText.trim().slice(0, 2000), card: c, look: { ...look }, song,
          interests: body.querySelector("[data-f=interests]").value.trim(), location: c.location || "" };
      };

      body.querySelector("#ps").onclick = async () => {
        const data = collect();
        if (data.profileHtml.length > 10000) { alert("Your profile is too long. Try trimming it a bit."); return; }
        try {
          const isPublic = body.querySelector("input[name=pv]:checked")?.value === "public";
          await update(ref(db, `users/${uid}`), { ...data, song: data.song || null, publicProfile: isPublic, top8: top8().length ? top8() : null });
          await set(ref(db, `profilepics/${uid}`), pics.length ? Object.fromEntries(pics.map((d, i) => [`p${i}`, d])) : null).catch(() => {});
          if (isPublic) {
            const icon = (await get(ref(db, `icons/${uid}`)).catch(() => null))?.val() || null;
            await set(ref(db, `publicprofiles/${uid}`), { screenName, profileHtml: data.profileHtml, card: data.card, look: data.look, song: data.song || null,
              interests: data.interests, since: u.since || null, icon, top8: top8().length ? top8() : null, ts: Date.now() });
          } else await remove(ref(db, `publicprofiles/${uid}`)).catch(() => {});
          const listed = body.querySelector("#pd").checked;
          localStorage.setItem("du.listed." + uid, listed ? "1" : "0");
          if (listed) await set(ref(db, `directory/${uid}`), { screenName, interests: data.interests, location: data.location }).catch(() => {});
          else await remove(ref(db, `directory/${uid}`)).catch(() => {});
          closeWindow("profile");
        } catch { alert("Couldn't save your profile right now."); }
      };
    },
  });
}

// ---------- Paint bucket: a grid of background colors ----------
const PALETTE = [
  "#ffffff", "#f2f2f2", "#d9d9d9", "#a6a6a6", "#595959", "#000000",
  "#ffd6d6", "#ff8a8a", "#ff3b3b", "#c40000", "#7a0000", "#3d0000",
  "#ffe6cc", "#ffb870", "#ff8c1a", "#d96600", "#8a4100", "#4a2300",
  "#fff8cc", "#fff06b", "#ffe11a", "#d4b800", "#8a7700", "#4a4000",
  "#e3ffd6", "#a6f58a", "#4cd137", "#2e9e1f", "#1a5c12", "#0d2e09",
  "#d6fff6", "#8af5e0", "#1ad9b8", "#0f9e85", "#0a5c4e", "#052e27",
  "#d6f0ff", "#8ad4ff", "#1aa3ff", "#0072c4", "#00437a", "#00213d",
  "#e3dcff", "#b79bff", "#8a4dff", "#5b2a86", "#3a1563", "#1d0b32",
  "#ffdcf3", "#ff9de2", "#ff5ec4", "#d81b8a", "#8a0f57", "#45072b",
];
let bucketPop = null;
function pickBackground(anchor, title, onPick) {
  if (bucketPop) { bucketPop.remove(); bucketPop = null; return; }
  bucketPop = document.createElement("div");
  bucketPop.className = "color-pop";
  bucketPop.innerHTML = `<b class="small">${esc(title)}</b>
    <div class="color-grid">${PALETTE.map((c) => `<button style="background:${c}" data-col="${esc(c)}" title="${esc(c)}"></button>`).join("")}</div>
    <label class="color-pick" style="margin-top:6px">🎨 More colors…<input type="color" value="#ffe3f3"></label>`;
  document.body.appendChild(bucketPop);
  const r = anchor.getBoundingClientRect();
  const w = Math.min(260, innerWidth - 12);
  bucketPop.style.width = w + "px";
  bucketPop.style.left = Math.max(6, Math.min(r.left, innerWidth - w - 6)) + "px";
  const h = bucketPop.offsetHeight;
  bucketPop.style.top = (r.bottom + h + 6 < innerHeight ? r.bottom + 6 : Math.max(6, r.top - h - 6)) + "px";
  const close = () => { bucketPop?.remove(); bucketPop = null; document.removeEventListener("pointerdown", away, true); };
  const away = (e) => { if (bucketPop && !bucketPop.contains(e.target) && e.target !== anchor) close(); };
  setTimeout(() => document.addEventListener("pointerdown", away, true), 0);
  bucketPop.querySelectorAll("[data-col]").forEach((b) => {
    b.addEventListener("pointerdown", (e) => e.preventDefault());   // don't steal the text selection
    b.onclick = () => { onPick(b.dataset.col); close(); };
  });
  bucketPop.querySelector("input").oninput = (e) => onPick(e.target.value);
}

/** Turns :) <3 ;) etc. into smileys inside a profile, without touching links or tags. */
function withSmileys(html) {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  const walk = (n) => {
    [...n.childNodes].forEach((c) => {
      if (c.nodeType === 3) {
        let t = c.textContent;
        for (const [re, emo] of smileys) t = t.replace(re, emo);
        if (t !== c.textContent) c.textContent = t;
      } else if (c.nodeType === 1 && c.tagName !== "A") walk(c);
    });
  };
  walk(tpl.content);
  return tpl.innerHTML;
}

/** Keeps the public copy of your profile's icon up to date when you change your Homie Icon. */
export async function refreshPublicIcon(uid, icon) {
  try {
    const exists = (await get(ref(db, `publicprofiles/${uid}/screenName`))).val();
    if (exists) await set(ref(db, `publicprofiles/${uid}/icon`), icon);
  } catch {}
}
