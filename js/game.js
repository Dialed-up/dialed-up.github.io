// Byte Snake — a tiny original arcade game for the Games channel.
import { openWindow } from "./wm.js";

export function openGame() {
  let timer = null;
  openWindow("game", {
    title: "Byte Snake", icon: "🎮", width: 320, height: 470, onClose: () => clearInterval(timer),
    render(body) {
      const best = Number(localStorage.getItem("du.snake.best") || 0);
      body.innerHTML = `<div class="row"><b>Score: <span id="sc">0</span></b><span class="small">Best: <span id="bs">${best}</span></span></div>
        <canvas class="game-canvas" width="280" height="280"></canvas>
        <div class="dpad"><span></span><button data-d="0,-1">▲</button><span></span>
          <button data-d="-1,0">◀</button><button id="go">▶︎</button><button data-d="1,0">▶</button>
          <span></span><button data-d="0,1">▼</button><span></span></div>
        <p class="small muted" style="text-align:center">Eat the data packets 💾. Arrow keys, swipes or the pad.</p>`;
      const cv = body.querySelector("canvas"), g = cv.getContext("2d");
      const N = 14, S = cv.width / N;
      let snake, dir, next, food, score, alive = false;
      const reset = () => {
        snake = [{ x: 6, y: 7 }, { x: 5, y: 7 }, { x: 4, y: 7 }];
        dir = { x: 1, y: 0 }; next = dir; score = 0; placeFood(); alive = true;
        body.querySelector("#sc").textContent = "0";
      };
      const placeFood = () => {
        do food = { x: Math.floor(Math.random() * N), y: Math.floor(Math.random() * N) };
        while (snake.some((p) => p.x === food.x && p.y === food.y));
      };
      const draw = () => {
        g.fillStyle = "#120726"; g.fillRect(0, 0, cv.width, cv.height);
        g.fillStyle = "#ffe94d"; g.fillRect(food.x * S + 4, food.y * S + 4, S - 8, S - 8);
        snake.forEach((p, i) => {
          g.fillStyle = i === 0 ? "#ff5ec4" : i % 2 ? "#8a4dff" : "#21d4fd";
          g.fillRect(p.x * S + 1, p.y * S + 1, S - 2, S - 2);
        });
        if (!alive) {
          g.fillStyle = "rgba(0,0,0,.6)"; g.fillRect(0, 110, cv.width, 60);
          g.fillStyle = "#fff"; g.font = "bold 16px Verdana"; g.textAlign = "center";
          g.fillText(snake.length > 3 ? "CONNECTION LOST — tap ▶︎" : "Tap ▶︎ to play", cv.width / 2, 145);
        }
      };
      const step = () => {
        dir = next;
        const head = { x: (snake[0].x + dir.x + N) % N, y: (snake[0].y + dir.y + N) % N };
        if (snake.some((p) => p.x === head.x && p.y === head.y)) {
          alive = false; clearInterval(timer);
          const b = Math.max(score, Number(localStorage.getItem("du.snake.best") || 0));
          localStorage.setItem("du.snake.best", b); body.querySelector("#bs").textContent = b;
          import("./engage.js").then((m) => m.submitScore("snake", score));
          return draw();
        }
        snake.unshift(head);
        if (head.x === food.x && head.y === food.y) { score += 10; body.querySelector("#sc").textContent = score; placeFood(); }
        else snake.pop();
        draw();
      };
      const turn = (x, y) => { if (x !== -dir.x || y !== -dir.y) next = { x, y }; };
      body.querySelectorAll("[data-d]").forEach((b) => (b.onclick = () => turn(...b.dataset.d.split(",").map(Number))));
      body.querySelector("#go").onclick = () => { reset(); clearInterval(timer); timer = setInterval(step, 140); };
      body.tabIndex = 0;
      body.onkeydown = (e) => {
        const m = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[e.key];
        if (m) { e.preventDefault(); turn(...m); }
      };
      let sx = 0, sy = 0;
      cv.addEventListener("pointerdown", (e) => { sx = e.clientX; sy = e.clientY; });
      cv.addEventListener("pointerup", (e) => {
        const dx = e.clientX - sx, dy = e.clientY - sy;
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 20) return;
        Math.abs(dx) > Math.abs(dy) ? turn(Math.sign(dx), 0) : turn(0, Math.sign(dy));
      });
      snake = [{ x: 6, y: 7 }, { x: 5, y: 7 }, { x: 4, y: 7 }]; food = { x: 10, y: 7 }; draw();
    },
  });
}
