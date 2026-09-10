import { audioContext } from "../audio.js";
import { activeGame } from "./shell.js";
import { isTyping } from "../keys.js";
import { openPanel } from "../panels.js";
import { masterVolume } from "../sounds.js";

/* ==========================================================================
   Squish 2048

   Standard 2048 rules. Tiles keep a stable identity across moves and are
   positioned with transform, so the browser animates them sliding instead of
   them teleporting between cells.
   ========================================================================== */

const sqBoard = document.getElementById("sq-board");
const sqScoreEl = document.getElementById("sq-score");
const sqBestEl = document.getElementById("sq-best");
const sqMessage = document.getElementById("sq-message");
const sqNewBtn = document.getElementById("sq-new");

const SQ_N = 4;
const SQ_TILE = 80;
const SQ_GAP = 8;
const SQ_BEST_KEY = "focus-app-sq-best-tile";

// Warm at the low end, cool and deeper as the numbers climb.
const SQ_COLOURS = {
  2: "#f4e7c3",
  4: "#f2d9a0",
  8: "#f5b877",
  16: "#f39c63",
  32: "#ef7f5e",
  64: "#e85f52",
  128: "#e0568b",
  256: "#c14fb4",
  512: "#9450d4",
  1024: "#6a5ae0",
  2048: "#3fc9c0",
};

let sqGrid = [];
let sqTiles = [];
let sqNextId = 1;
let sqScore = 0;
let sqBest = 0;
export let sqStatus = "idle";

function sqReadBest() {
  try {
    return Number(localStorage.getItem(SQ_BEST_KEY)) || 0;
  } catch (error) {
    return 0;
  }
}

function sqWriteBest(value) {
  try {
    localStorage.setItem(SQ_BEST_KEY, String(value));
  } catch (error) {
    // Storage blocked. A lost high score is not worth failing over.
  }
}

function sqEmptyGrid() {
  return Array.from({ length: SQ_N }, () => new Array(SQ_N).fill(null));
}

/* Maps a position along a line to a cell, per direction. Writing it once here
   means the move logic below does not need four near-identical copies. */
function sqCellAt(dir, line, pos) {
  if (dir === "left") return { row: line, col: pos };
  if (dir === "right") return { row: line, col: SQ_N - 1 - pos };
  if (dir === "up") return { row: pos, col: line };
  return { row: SQ_N - 1 - pos, col: line };
}

function sqSpawn() {
  const free = [];
  for (let row = 0; row < SQ_N; row++) {
    for (let col = 0; col < SQ_N; col++) {
      if (!sqGrid[row][col]) free.push({ row, col });
    }
  }
  if (!free.length) return null;

  const spot = free[Math.floor(Math.random() * free.length)];
  const tile = {
    id: sqNextId++,
    value: Math.random() < 0.9 ? 2 : 4,
    row: spot.row,
    col: spot.col,
    spawned: true,
    merged: false,
  };
  sqGrid[spot.row][spot.col] = tile;
  sqTiles.push(tile);
  return tile;
}

function sqCanMove() {
  for (let row = 0; row < SQ_N; row++) {
    for (let col = 0; col < SQ_N; col++) {
      const tile = sqGrid[row][col];
      if (!tile) return true;
      const right = col + 1 < SQ_N ? sqGrid[row][col + 1] : null;
      const down = row + 1 < SQ_N ? sqGrid[row + 1][col] : null;
      if (right && right.value === tile.value) return true;
      if (down && down.value === tile.value) return true;
    }
  }
  return false;
}

/* The squish. A short noise burst through a low-pass filter that sweeps
   downwards, with a fast attack and decay - which is roughly what a wet,
   soft thing sounds like when pressed.

   Bigger merges sound lower and longer, so the sound tells you the size of
   what just happened, and every pop is pitch-jittered so no two are alike.
   Identical pops become grating within about ten clicks. */
function sqSquishSound(value) {
  const ctx = audioContext();
  if (!ctx) return; // No audio available; the game still plays.

  const now = ctx.currentTime;

  const tier = Math.log2(value); // 4 -> 2, 2048 -> 11
  const base = 460 / Math.pow(1.16, tier);
  const jitter = 0.88 + Math.random() * 0.24;
  const dur = 0.13 + tier * 0.012;

  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  }

  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  /* .Q is an AudioParam, not a number - assigning to it throws in strict
     mode, which every ES module is. This threw on every squish. */
  filter.Q.value = 7;
  filter.frequency.setValueAtTime(base * 2.6 * jitter, now);
  filter.frequency.exponentialRampToValueAtTime(base * 0.5 * jitter, now + dur);

  const gain = ctx.createGain();
  const peak = Math.max(0.0002, 0.3 * masterVolume);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(peak, now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  source.start(now);
  source.stop(now + dur + 0.02);
}

/* ---- Drawing ---- */

function sqOffset(index) {
  return SQ_GAP + index * (SQ_TILE + SQ_GAP);
}

function sqBuildCells() {
  sqBoard.innerHTML = "";
  for (let row = 0; row < SQ_N; row++) {
    for (let col = 0; col < SQ_N; col++) {
      const cell = document.createElement("div");
      cell.className = "sq-cell";
      cell.style.left = sqOffset(col) + "px";
      cell.style.top = sqOffset(row) + "px";
      sqBoard.append(cell);
    }
  }
}

function sqRender() {
  const seen = new Set();

  sqTiles.forEach((tile) => {
    seen.add(tile.id);
    let el = sqBoard.querySelector('[data-tile="' + tile.id + '"]');

    if (!el) {
      el = document.createElement("div");
      el.className = "sq-tile";
      el.dataset.tile = tile.id;
      sqBoard.append(el);
    }

    const digits = String(tile.value).length;
    el.className =
      "sq-tile" +
      (digits > 3 ? " len4" : digits === 3 ? " len3" : "") +
      (tile.spawned ? " is-spawn" : "") +
      (tile.merged ? " is-merge" : "");

    el.textContent = tile.value;
    el.style.background = SQ_COLOURS[tile.value] || "#2fbf9f";

    // The keyframes reuse this via var(--pos), so a squish animates on top of
    // the tile's position instead of throwing it back to the origin.
    const pos = "translate(" + sqOffset(tile.col) + "px," + sqOffset(tile.row) + "px)";
    el.style.setProperty("--pos", pos);
    el.style.transform = pos;

    tile.spawned = false;
    tile.merged = false;
  });

  sqBoard.querySelectorAll(".sq-tile").forEach((el) => {
    if (!seen.has(Number(el.dataset.tile))) el.remove();
  });

  sqScoreEl.textContent = sqScore;
  sqBestEl.textContent = sqBest;
}

/* ---- Moving ---- */

const SQ_SLIDE_MS = 140;
let sqBusy = false;
let sqWon = false;

function sqMove(dir) {
  if (sqStatus !== "playing" || sqBusy) return;

  let moved = false;
  const pairs = []; // { survivor, absorbed, value }

  for (let line = 0; line < SQ_N; line++) {
    const inLine = [];
    for (let pos = 0; pos < SQ_N; pos++) {
      const { row, col } = sqCellAt(dir, line, pos);
      const tile = sqGrid[row][col];
      if (tile) inLine.push(tile);
    }

    // Compact towards the wall, merging each pair at most once.
    const out = [];
    for (let i = 0; i < inLine.length; i++) {
      const a = inLine[i];
      const b = inLine[i + 1];
      if (b && a.value === b.value) {
        pairs.push({ survivor: a, absorbed: b, value: a.value * 2 });
        out.push(a);
        i++;
      } else {
        out.push(a);
      }
    }

    for (let pos = 0; pos < SQ_N; pos++) {
      const { row, col } = sqCellAt(dir, line, pos);
      const tile = out[pos] || null;
      sqGrid[row][col] = tile;
      if (tile) {
        if (tile.row !== row || tile.col !== col) moved = true;
        tile.row = row;
        tile.col = col;
      }
    }
  }

  if (pairs.length) moved = true;
  if (!moved) return;

  /* Phase one: everything slides, absorbed tiles included, and they still
     show their old numbers. Sliding a tile that has already become a 64 looks
     wrong - the doubling should happen on arrival, not in transit. */
  pairs.forEach(({ survivor, absorbed }) => {
    absorbed.row = survivor.row;
    absorbed.col = survivor.col;
  });

  sqBusy = true;
  sqRender();

  // Phase two: the absorbed tile is gone, the survivor doubles and squishes.
  setTimeout(() => {
    const dead = new Set(pairs.map((p) => p.absorbed));
    sqTiles = sqTiles.filter((tile) => !dead.has(tile));

    let gained = 0;
    let biggest = 0;
    pairs.forEach(({ survivor, value }) => {
      survivor.value = value;
      survivor.merged = true;
      gained += value;
      biggest = Math.max(biggest, value);
    });

    sqScore += gained;

    // "Best" is the biggest tile ever reached, not accumulated points - that
    // is the number people actually care about in 2048.
    const highest = sqTiles.reduce((max, tile) => Math.max(max, tile.value), 0);
    if (highest > sqBest) {
      sqBest = highest;
      sqWriteBest(sqBest);
    }

    sqSpawn();
    sqRender();
    if (biggest) sqSquishSound(biggest);
    sqBusy = false;

    if (biggest >= 2048 && !sqWon) {
      sqWon = true;
      sqMessage.textContent = "2048! Keep going if you like.";
    } else if (!sqCanMove()) {
      sqStatus = "over";
      sqMessage.textContent = "No moves left — " + sqScore + " points";
    }
  }, SQ_SLIDE_MS);
}

export function sqNewGame() {
  sqGrid = sqEmptyGrid();
  sqTiles = [];
  sqScore = 0;
  sqBest = sqReadBest();
  sqStatus = "playing";
  sqBusy = false;
  sqWon = false;
  sqMessage.textContent = " ";
  sqBuildCells();
  sqSpawn();
  sqSpawn();
  sqRender();
}

sqNewBtn.addEventListener("click", sqNewGame);

/* ---- Input ---- */

const SQ_KEYS = {
  arrowleft: "left",
  arrowright: "right",
  arrowup: "up",
  arrowdown: "down",
  a: "left",
  d: "right",
  w: "up",
  s: "down",
};

document.addEventListener("keydown", (event) => {
  if (openPanel !== "games" || activeGame !== "squish") return;
  if (isTyping(event.target)) return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;

  const dir = SQ_KEYS[event.key.toLowerCase()];
  if (!dir) return;

  // Arrow keys would otherwise scroll the panel.
  event.preventDefault();
  sqMove(dir);
});

// Swipe, so it works on a phone.
let sqSwipeFrom = null;

sqBoard.addEventListener("pointerdown", (event) => {
  sqSwipeFrom = { x: event.clientX, y: event.clientY };
});

sqBoard.addEventListener("pointerup", (event) => {
  if (!sqSwipeFrom) return;
  const dx = event.clientX - sqSwipeFrom.x;
  const dy = event.clientY - sqSwipeFrom.y;
  sqSwipeFrom = null;

  // Ignore taps and tiny drags.
  if (Math.abs(dx) < 24 && Math.abs(dy) < 24) return;

  if (Math.abs(dx) > Math.abs(dy)) sqMove(dx > 0 ? "right" : "left");
  else sqMove(dy > 0 ? "down" : "up");
});
