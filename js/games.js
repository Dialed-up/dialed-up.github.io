// The Games Arcade: Byte Snake, Trivia, Word Scramble, Memory Match and online Tic-Tac-Toe.
import { auth, db, ref, get, set, update, push, remove, onValue, off, serverTimestamp, normalize } from "./firebase.js";
import { openWindow, closeWindow, esc } from "./wm.js";
import { openGame as openSnake } from "./game.js";
import { userName, me, buddyList } from "./chat.js";
import * as sfx from "./sounds.js";

export function openArcade() {
  openWindow("arcade", {
    title: "Games Arcade", icon: "🎮", width: 380, height: 430, keyword: "games",
    render(body) {
      const games = [
        ["🐍", "Byte Snake", "Eat the data packets", "#8a4dff", openSnake],
        ["❓", "Trivia Night", "10 questions, beat your best", "#ff5ec4", openTrivia],
        ["🔤", "Word Scramble", "Unscramble before time runs out", "#00a68c", openScramble],
        ["🃏", "Memory Match", "Flip and find the pairs", "#ff8a3d", openMemory],
        ["⭕", "Tic-Tac-Toe Online", "Challenge a buddy live", "#2b59ff", openTicTacToeLobby],
      ];
      body.innerHTML = `<div class="grid2">${games.map(([ic, n, sub, c], i) =>
        `<button class="tile" data-g="${i}" style="background:linear-gradient(135deg, ${c}, #5b2a86)"><span style="font-size:26px">${ic}</span><br>${n}<small>${sub}</small></button>`).join("")}</div>`;
      body.querySelectorAll("[data-g]").forEach((b) => (b.onclick = () => games[b.dataset.g][4]()));
    },
  });
}

// ---------- Trivia (questions written for DialedUp) ----------
const trivia = [
  ["How many minutes are in a full day?", ["1,440", "1,240", "2,400", "960"]],
  ["Which planet is known as the Red Planet?", ["Mars", "Venus", "Jupiter", "Mercury"]],
  ["How many boroughs does New York City have?", ["5", "4", "6", "7"]],
  ["What does the 'www' in a web address stand for?", ["World Wide Web", "Wide World Web", "Web World Wide", "World Web Wire"]],
  ["Which ocean is the largest?", ["Pacific", "Atlantic", "Indian", "Arctic"]],
  ["How many players does a basketball team have on the court?", ["5", "6", "7", "4"]],
  ["What is the freezing point of water in Fahrenheit?", ["32°", "0°", "12°", "40°"]],
  ["Which instrument has 88 keys?", ["Piano", "Organ", "Accordion", "Harpsichord"]],
  ["What color do you get by mixing blue and yellow?", ["Green", "Purple", "Orange", "Brown"]],
  ["How many sides does a hexagon have?", ["6", "5", "8", "7"]],
  ["Which bridge connects Brooklyn and Lower Manhattan, opened in 1883?", ["Brooklyn Bridge", "Manhattan Bridge", "Williamsburg Bridge", "Queensboro Bridge"]],
  ["What's the largest mammal on Earth?", ["Blue whale", "Elephant", "Giraffe", "Orca"]],
  ["How many points is a touchdown worth in American football (before the extra point)?", ["6", "7", "3", "5"]],
  ["What speed, in bits per second, did the classic dial-up modems top out at?", ["56,000", "14,400", "128,000", "9,600"]],
  ["Which gas do plants take in from the air?", ["Carbon dioxide", "Oxygen", "Nitrogen", "Helium"]],
  ["How many strings does a standard guitar have?", ["6", "4", "5", "12"]],
  ["What year did the 2000s decade begin (Y2K)?", ["2000", "1999", "2001", "1998"]],
  ["Which continent is Egypt in?", ["Africa", "Asia", "Europe", "South America"]],
  ["In music, how many beats are in a bar of 4/4 time?", ["4", "3", "2", "8"]],
  ["What's the tallest animal in the world?", ["Giraffe", "Elephant", "Moose", "Camel"]],
  ["Which sport uses the terms 'love' and 'deuce'?", ["Tennis", "Golf", "Bowling", "Volleyball"]],
  ["How many hours are in a week?", ["168", "144", "160", "172"]],
  ["What does BPM stand for in music?", ["Beats per minute", "Bass per measure", "Bars per mix", "Beats per measure"]],
  ["Which is the closest star to Earth?", ["The Sun", "Sirius", "Polaris", "Alpha Centauri"]],
  ["How many cards are in a standard deck (no jokers)?", ["52", "54", "48", "50"]],
  ["Which subway line color is the A/C/E in NYC?", ["Blue", "Red", "Green", "Yellow"]],
  ["What's the hardest natural substance?", ["Diamond", "Gold", "Iron", "Quartz"]],
  ["How many continents are there?", ["7", "6", "5", "8"]],
  ["Which vitamin do we get from sunlight?", ["Vitamin D", "Vitamin C", "Vitamin A", "Vitamin B12"]],
  ["How many innings are in a regular MLB game?", ["9", "7", "10", "8"]],
];

function shuffle(a) { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

function openTrivia() {
  openWindow("trivia", {
    title: "Trivia Night", icon: "❓", width: 380, height: 420,
    render(body) {
      const qs = shuffle(trivia).slice(0, 10);
      let i = 0, score = 0;
      const best = () => Number(localStorage.getItem("du.trivia.best") || 0);
      const ask = () => {
        if (i >= qs.length) {
          const b = Math.max(best(), score);
          localStorage.setItem("du.trivia.best", b);
          body.innerHTML = `<div style="text-align:center"><h2 style="color:var(--grape)">${score} / ${qs.length}</h2>
            <p>${score >= 9 ? "Genius status! 🧠" : score >= 6 ? "Nice work! 😎" : "Not bad — run it back! 💪"}</p>
            <p class="small muted">Your best: ${b}</p><button class="btn primary" id="again">Play Again</button></div>`;
          body.querySelector("#again").onclick = () => openTrivia.call(null, closeWindow("trivia"));
          return;
        }
        const [q, answers] = qs[i];
        const opts = shuffle(answers);
        body.innerHTML = `<div class="row small"><span>Question ${i + 1} of ${qs.length}</span><b>Score: ${score}</b></div>
          <h3 style="margin:10px 0;color:var(--grape)">${esc(q)}</h3>
          <div style="display:grid;gap:6px">${opts.map((o) => `<button class="btn" data-a="${esc(o)}">${esc(o)}</button>`).join("")}</div>`;
        body.querySelectorAll("[data-a]").forEach((b) => (b.onclick = () => {
          const right = b.dataset.a === answers[0];
          if (right) { score++; sfx.buddyIn(); } else sfx.buddyOut();
          body.querySelectorAll("[data-a]").forEach((x) => {
            x.disabled = true;
            if (x.dataset.a === answers[0]) x.classList.add("primary");
            else if (x === b) x.classList.add("danger");
          });
          i++;
          setTimeout(ask, 1100);
        }));
      };
      ask();
    },
  });
}

// ---------- Word Scramble ----------
const words = ["MODEM", "BUDDY", "SIGNAL", "CHATROOM", "PROFILE", "KEYWORD", "MAILBOX", "GLITTER", "TURNTABLE", "SUBWAY", "BROOKLYN",
  "PIXEL", "DOWNLOAD", "SCREEN", "MIXTAPE", "SPEAKER", "WEEKEND", "MIDNIGHT", "PLAYLIST", "BASKETBALL", "CONNECT", "MESSAGE",
  "EMOTICON", "HOMEPAGE", "WALLPAPER", "KEYBOARD", "SNEAKERS", "BOOMBOX", "PAGER", "WEBSITE"];

function openScramble() {
  openWindow("scramble", {
    title: "Word Scramble", icon: "🔤", width: 340, height: 330,
    render(body) {
      let score = 0, timer, left = 60;
      const list = shuffle(words);
      let word = "";
      const next = () => {
        word = list.pop() || shuffle(words)[0];
        let mixed;
        do mixed = shuffle(word.split("")).join(""); while (mixed === word);
        body.querySelector("#sc-w").textContent = mixed.split("").join(" ");
        body.querySelector("#sc-in").value = "";
        body.querySelector("#sc-in").focus();
      };
      body.innerHTML = `<div class="row small"><b>Score: <span id="sc-s">0</span></b><span>⏱ <span id="sc-t">60</span>s</span></div>
        <div id="sc-w" style="font:900 28px/1.4 'Courier New', monospace;text-align:center;color:var(--grape);margin:14px 0;letter-spacing:2px"></div>
        <form id="sc-f" class="row"><input id="sc-in" autocomplete="off" autocapitalize="characters" style="flex:1"><button class="btn primary small-btn">Guess</button></form>
        <div class="row" style="margin-top:8px"><button class="btn small-btn" id="sc-skip">Skip</button><span class="small muted">Best: ${localStorage.getItem("du.scramble.best") || 0}</span></div>`;
      body.querySelector("#sc-f").onsubmit = (e) => {
        e.preventDefault();
        if (left <= 0) return;
        if (body.querySelector("#sc-in").value.trim().toUpperCase() === word) { score++; sfx.buddyIn(); body.querySelector("#sc-s").textContent = score; next(); }
        else sfx.alertBlip();
      };
      body.querySelector("#sc-skip").onclick = () => left > 0 && next();
      timer = setInterval(() => {
        if (!document.body.contains(body)) return clearInterval(timer);
        left--;
        body.querySelector("#sc-t").textContent = left;
        if (left <= 0) {
          clearInterval(timer);
          const b = Math.max(score, Number(localStorage.getItem("du.scramble.best") || 0));
          localStorage.setItem("du.scramble.best", b);
          body.querySelector("#sc-w").innerHTML = `⏱ Time! The word was <u>${word}</u>.<br><span style="font-size:18px">You got ${score}.</span>`;
        }
      }, 1000);
      next();
    },
  });
}

// ---------- Memory Match ----------
function openMemory() {
  openWindow("memory", {
    title: "Memory Match", icon: "🃏", width: 340, height: 420,
    render(body) {
      const faces = ["💿", "📟", "🎧", "📼", "🕹", "💾", "📻", "📞"];
      const deck = shuffle([...faces, ...faces]);
      let open = [], matched = 0, moves = 0, lock = false;
      body.innerHTML = `<div class="row small"><b>Moves: <span id="mm-m">0</span></b><span>Pairs: <span id="mm-p">0</span>/8</span></div>
        <div class="mm-grid">${deck.map((f, i) => `<button class="mm-card" data-i="${i}"><span>${f}</span></button>`).join("")}</div>`;
      body.querySelectorAll(".mm-card").forEach((c) => (c.onclick = () => {
        if (lock || c.classList.contains("up")) return;
        c.classList.add("up");
        open.push(c);
        if (open.length < 2) return;
        moves++;
        body.querySelector("#mm-m").textContent = moves;
        const [a, b] = open;
        open = [];
        if (deck[a.dataset.i] === deck[b.dataset.i]) {
          matched++;
          sfx.buddyIn();
          body.querySelector("#mm-p").textContent = matched;
          if (matched === 8) setTimeout(() => alert(`You matched them all in ${moves} moves! 🎉`), 300);
        } else {
          lock = true;
          setTimeout(() => { a.classList.remove("up"); b.classList.remove("up"); lock = false; }, 800);
        }
      }));
    },
  });
}

// ---------- Tic-Tac-Toe online ----------
const lines = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
const winner = (b) => { for (const [x, y, z] of lines) if (b[x] && b[x] === b[y] && b[x] === b[z]) return b[x]; return b.every(Boolean) ? "draw" : null; };

function openTicTacToeLobby() {
  openWindow("ttt-lobby", {
    title: "Tic-Tac-Toe Online", icon: "⭕", width: 320, height: 330,
    render(body) {
      body.innerHTML = `<p class="small">Challenge someone by screen name. They'll get an invitation window.</p>
        <form id="tt-f"><label>Screen name <input id="tt-n" list="tt-buddies"></label>
        <datalist id="tt-buddies">${buddyList().map((u) => `<option value="${esc(userName(u))}">`).join("")}</datalist>
        <p class="error" id="tt-e"></p><div class="row"><span></span><button class="btn primary">Challenge!</button></div></form>`;
      body.querySelector("#tt-f").onsubmit = async (e) => {
        e.preventDefault();
        const n = body.querySelector("#tt-n").value.trim();
        const opp = (await get(ref(db, `screennames/${normalize(n)}`))).val();
        if (!opp) { body.querySelector("#tt-e").textContent = "No one has that screen name."; return; }
        if (opp === auth.currentUser.uid) { body.querySelector("#tt-e").textContent = "You can't play yourself 😄"; return; }
        const g = await push(ref(db, "games"), { x: auth.currentUser.uid, o: opp, board: "---------", turn: "x", status: "playing", ts: serverTimestamp() });
        await push(ref(db, `gameinvites/${opp}`), { game: g.key, from: auth.currentUser.uid, fromName: me().screenName, ts: serverTimestamp() });
        closeWindow("ttt-lobby");
        openTicTacToe(g.key);
      };
    },
  });
}

export function openTicTacToe(gameId) {
  const meId = auth.currentUser.uid;
  let r;
  openWindow("ttt." + gameId, {
    title: "Tic-Tac-Toe", icon: "⭕", width: 300, height: 380, onClose: () => r && off(r),
    render(body) {
      r = ref(db, `games/${gameId}`);
      onValue(r, (s) => {
        const g = s.val();
        if (!g) { body.innerHTML = `<p class="muted">This game is over.</p>`; return; }
        const board = g.board.split("").map((c) => (c === "-" ? "" : c));
        const mark = g.x === meId ? "x" : "o";
        const opp = g.x === meId ? g.o : g.x;
        const w = winner(board);
        const status = w === "draw" ? "It's a draw! 🤝" : w ? (w === mark ? "You win! 🎉" : `${esc(userName(opp))} wins!`)
          : g.turn === mark ? "Your turn" : `Waiting for ${esc(userName(opp))}…`;
        body.innerHTML = `<p style="text-align:center"><b>You (${mark.toUpperCase()}) vs ${esc(userName(opp))}</b><br><span class="small">${status}</span></p>
          <div class="ttt">${board.map((c, i) => `<button data-i="${i}" ${c || w || g.turn !== mark ? "disabled" : ""}>${c === "x" ? "❌" : c === "o" ? "⭕" : ""}</button>`).join("")}</div>
          ${w ? `<div class="row" style="margin-top:8px"><span></span><button class="btn primary small-btn" id="rematch">Rematch</button></div>` : ""}`;
        body.querySelectorAll("[data-i]").forEach((b) => (b.onclick = () => {
          const nb = g.board.split("");
          nb[b.dataset.i] = mark;
          update(r, { board: nb.join(""), turn: mark === "x" ? "o" : "x" });
          sfx.imOut();
        }));
        body.querySelector("#rematch")?.addEventListener("click", () => update(r, { board: "---------", turn: "x" }));
      });
    },
  });
}

let invRef = null;
export function watchGameInvites() {
  const meId = auth.currentUser.uid;
  invRef = ref(db, `gameinvites/${meId}`);
  onValue(invRef, (s) => {
    Object.entries(s.val() || {}).forEach(([id, inv]) => {
      sfx.alertBlip();
      openWindow("ginv." + id, {
        title: "Game Challenge!", icon: "⭕", width: 280, height: 190,
        render(body) {
          body.innerHTML = `<p><b>${esc(inv.fromName)}</b> challenged you to Tic-Tac-Toe!</p>
            <div class="row"><button class="btn small-btn" data-x="no">No thanks</button><button class="btn primary small-btn" data-x="yes">Play!</button></div>`;
          const done = () => { remove(ref(db, `gameinvites/${meId}/${id}`)); closeWindow("ginv." + id); };
          body.querySelector("[data-x=no]").onclick = done;
          body.querySelector("[data-x=yes]").onclick = () => { done(); openTicTacToe(inv.game); };
        },
      });
    });
  });
}
export function stopGameInvites() { if (invRef) off(invRef); invRef = null; }
