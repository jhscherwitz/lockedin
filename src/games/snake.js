import { playWinSound } from "../alerts.js";
import { activeGame } from "./shell.js";
import { isTyping } from "../keys.js";
import { openPanel } from "../panels.js";

/* ==========================================================================
   Snake
   ========================================================================== */

const snBoard = document.getElementById("sn-board");
const snScoreEl = document.getElementById("sn-score");
const snBestEl = document.getElementById("sn-best");
const snMessageEl = document.getElementById("sn-message");
const snNewBtn = document.getElementById("sn-new");

const SN_N = 13;
const SN_BEST_KEY = "focus-app-sn-best";

export let snCells = [];
let snBody = [];
let snDir = { x: 1, y: 0 };
let snQueued = [];
let snFood = 0;
export let snStatus = "idle"; // idle | playing | over | won
// Cached per run, so snRender is not reading storage on every tick.
let snBest = 0;
let snTimer = null;

function snReadBest() {
  try {
    return Number(localStorage.getItem(SN_BEST_KEY)) || 0;
  } catch (error) {
    return 0;
  }
}

export function snBuild() {
  snBoard.innerHTML = "";
  snCells = [];
  for (let i = 0; i < SN_N * SN_N; i++) {
    const cell = document.createElement("div");
    cell.className = "sn-cell";
    snBoard.append(cell);
    snCells.push(cell);
  }
}

function snPlaceFood() {
  const taken = new Set(snBody);
  const free = [];
  for (let i = 0; i < SN_N * SN_N; i++) if (!taken.has(i)) free.push(i);
  snFood = free.length ? free[Math.floor(Math.random() * free.length)] : -1;
}

export function snRender() {
  snCells.forEach((cell, i) => {
    let className = "sn-cell";
    if (i === snBody[0]) className += " is-snake is-head";
    else if (snBody.includes(i)) className += " is-snake";
    else if (i === snFood) className += " is-food";
    if (cell.className !== className) cell.className = className;
  });
  snScoreEl.textContent = snBody.length;
  // Rises with the run once it is ahead. See the note in dnStep.
  snBestEl.textContent = Math.max(snBest, snBody.length);
}

function snStop() {
  clearInterval(snTimer);
  snTimer = null;
}

/* Filling all 169 cells is the real win, and the code was already most of the
   way there: snPlaceFood() returns -1 when there is nowhere left to put food.
   Until now the game just carried on with nothing left to chase. */
function snWin() {
  snStop();
  snStatus = "won";
  playWinSound();

  // A full board is the longest the snake can be, so it is necessarily best.
  try {
    localStorage.setItem(SN_BEST_KEY, String(snBody.length));
  } catch (error) {
    // Storage blocked.
  }
  snBest = Math.max(snBest, snBody.length);

  snMessageEl.textContent = "Perfect - all " + snBody.length + " cells";
  snNewBtn.textContent = "Play again";
  snNewBtn.hidden = false;
  snRender();
}

function snGameOver() {
  snStop();
  snStatus = "over";
  const best = snReadBest();
  snBest = Math.max(best, snBody.length);
  if (snBody.length > best) {
    try {
      localStorage.setItem(SN_BEST_KEY, String(snBody.length));
    } catch (error) {
      // Storage blocked.
    }
  }
  snMessageEl.textContent = "Length " + snBody.length;
  snNewBtn.textContent = "Play again";
  snNewBtn.hidden = false;
  snRender();
}

function snTick() {
  /* Turns are queued rather than applied instantly. Two quick presses inside
     one tick could otherwise reverse the snake into itself - press up then
     left while moving right, and without the queue the second press wins
     against a direction that was never actually travelled. */
  if (snQueued.length) {
    const next = snQueued.shift();
    if (next.x !== -snDir.x || next.y !== -snDir.y) snDir = next;
  }

  const head = snBody[0];
  const x = (head % SN_N) + snDir.x;
  const y = Math.floor(head / SN_N) + snDir.y;

  if (x < 0 || x >= SN_N || y < 0 || y >= SN_N) {
    snGameOver();
    return;
  }

  const target = y * SN_N + x;

  // Biting yourself ends it - except the tail tip, which is about to move.
  if (snBody.indexOf(target) !== -1 && target !== snBody[snBody.length - 1]) {
    snGameOver();
    return;
  }

  snBody.unshift(target);

  if (target === snFood) {
    snPlaceFood();

    if (snFood === -1) {
      snWin();
      return;
    }

    // A little faster with every meal.
    const speed = Math.max(70, 190 - snBody.length * 4);
    snStop();
    snTimer = setInterval(snTick, speed);
  } else {
    snBody.pop();
  }

  snRender();
}

function snNewGame() {
  snStop();
  if (!snCells.length) snBuild();
  const mid = Math.floor(SN_N / 2);
  snBody = [mid * SN_N + mid, mid * SN_N + mid - 1, mid * SN_N + mid - 2];
  snDir = { x: 1, y: 0 };
  snQueued = [];
  snStatus = "playing";
  snBest = snReadBest();
  snMessageEl.textContent = "Arrow keys, WASD or swipe";
  snNewBtn.hidden = true;
  snPlaceFood();
  snRender();
  snTimer = setInterval(snTick, 190);
}

function snTurn(x, y) {
  if (snStatus !== "playing") return;
  if (snQueued.length < 2) snQueued.push({ x, y });
}

snNewBtn.addEventListener("click", snNewGame);

const SN_KEYS = {
  arrowleft: [-1, 0], a: [-1, 0],
  arrowright: [1, 0], d: [1, 0],
  arrowup: [0, -1], w: [0, -1],
  arrowdown: [0, 1], s: [0, 1],
};

document.addEventListener("keydown", (event) => {
  if (openPanel !== "games" || activeGame !== "snake") return;
  if (isTyping(event.target)) return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const dir = SN_KEYS[event.key.toLowerCase()];
  if (!dir) return;
  event.preventDefault();
  snTurn(dir[0], dir[1]);
});

let snSwipeFrom = null;
snBoard.addEventListener("pointerdown", (e) => {
  snSwipeFrom = { x: e.clientX, y: e.clientY };
});
snBoard.addEventListener("pointerup", (e) => {
  if (!snSwipeFrom) return;
  const dx = e.clientX - snSwipeFrom.x;
  const dy = e.clientY - snSwipeFrom.y;
  snSwipeFrom = null;
  if (Math.abs(dx) < 20 && Math.abs(dy) < 20) return;
  if (Math.abs(dx) > Math.abs(dy)) snTurn(dx > 0 ? 1 : -1, 0);
  else snTurn(0, dy > 0 ? 1 : -1);
});
