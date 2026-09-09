import { playWinSound } from "../alerts.js";

/* ==========================================================================
   Minesweeper

   Nine by nine, ten mines - a beginner board, which runs a couple of minutes
   rather than the half hour an expert board takes. That matters here: this
   sits in a panel called Brain Breaks.
   ========================================================================== */

const msBoard = document.getElementById("ms-board");
const msLeftEl = document.getElementById("ms-left");
const msTimeEl = document.getElementById("ms-time");
const msBestEl = document.getElementById("ms-best");
const msMessageEl = document.getElementById("ms-message");
const msNewBtn = document.getElementById("ms-new");

const MS_N = 9;
const MS_MINES = 10;
const MS_BEST_KEY = "focus-app-ms-best";

let msCells = [];
let msButtons = [];
export let msStatus = "idle"; // idle | playing | won | lost
let msMinesPlaced = false;
let msStartedAt = 0;
let msTicker = null;

function msReadBest() {
  try {
    return Number(localStorage.getItem(MS_BEST_KEY)) || 0;
  } catch (error) {
    return 0;
  }
}

function msNeighbours(index) {
  const row = Math.floor(index / MS_N);
  const col = index % MS_N;
  const out = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const r = row + dr;
      const c = col + dc;
      if (r >= 0 && r < MS_N && c >= 0 && c < MS_N) out.push(r * MS_N + c);
    }
  }
  return out;
}

/* Mines are placed after the first click, never on it or beside it. Placing
   them up front means the first click can lose the game before you have any
   information, which is not a puzzle, just a coin toss. Excluding the
   neighbours too guarantees the first click opens a region rather than a
   single number. */
function msPlaceMines(safeIndex) {
  const forbidden = new Set([safeIndex].concat(msNeighbours(safeIndex)));
  const candidates = [];
  for (let i = 0; i < MS_N * MS_N; i++) {
    if (!forbidden.has(i)) candidates.push(i);
  }

  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const swap = candidates[i];
    candidates[i] = candidates[j];
    candidates[j] = swap;
  }

  candidates.slice(0, MS_MINES).forEach((i) => {
    msCells[i].mine = true;
  });

  msCells.forEach((cell, i) => {
    cell.count = msNeighbours(i).filter((n) => msCells[n].mine).length;
  });

  msMinesPlaced = true;
}

function msElapsed() {
  return msStartedAt ? Math.floor((Date.now() - msStartedAt) / 1000) : 0;
}

function msStopClock() {
  clearInterval(msTicker);
  msTicker = null;
}

function msBeginClock() {
  msStatus = "playing";
  msStartedAt = Date.now();
  msStopClock();
  msTicker = setInterval(() => {
    msTimeEl.textContent = msElapsed();
  }, 1000);
}

function msRender() {
  msCells.forEach((cell, i) => {
    const button = msButtons[i];
    let className = "ms-cell";
    let label = "";

    if (cell.open) {
      className += " is-open";
      if (cell.mine) {
        className += cell.boom ? " is-boom" : " is-mine";
        label = "✳";
      } else if (cell.count) {
        className += " ms-" + cell.count;
        label = cell.count;
      }
    } else if (cell.flag) {
      className += " is-flagged";
      label = "⚑";
    }

    if (button.className !== className) button.className = className;
    if (button.textContent !== String(label)) button.textContent = label;
  });

  const flagged = msCells.filter((cell) => cell.flag && !cell.open).length;
  msLeftEl.textContent = Math.max(0, MS_MINES - flagged);
  msTimeEl.textContent = msElapsed();
  const best = msReadBest();
  msBestEl.textContent = best ? best + "s" : "—";
}

function msLose(index) {
  msStatus = "lost";
  msStopClock();
  msCells[index].boom = true;
  msCells.forEach((cell) => {
    if (cell.mine) cell.open = true;
  });
  msMessageEl.textContent = "Boom — try again";
  msRender();
}

function msCheckWin() {
  if (!msCells.every((cell) => cell.mine || cell.open)) return;

  msStatus = "won";
  playWinSound();
  msStopClock();
  const seconds = msElapsed();
  const best = msReadBest();

  if (!best || seconds < best) {
    try {
      localStorage.setItem(MS_BEST_KEY, String(seconds));
    } catch (error) {
      // Storage blocked; the best time just won't persist.
    }
    msMessageEl.textContent = "Cleared in " + seconds + "s — new best";
  } else {
    msMessageEl.textContent = "Cleared in " + seconds + "s";
  }

  // Every remaining mine must be one you had not flagged.
  msCells.forEach((cell) => {
    if (cell.mine) cell.flag = true;
  });
  msRender();
}

function msOpen(index) {
  if (msStatus === "won" || msStatus === "lost") return;

  const cell = msCells[index];
  if (cell.open || cell.flag) return;

  if (!msMinesPlaced) {
    msPlaceMines(index);
    msBeginClock();
    msMessageEl.textContent = " ";
  }

  if (cell.mine) {
    msLose(index);
    return;
  }

  /* Flood fill from an empty cell, iteratively. Recursion would be neater to
     read but can nest 81 deep on an empty board. */
  const stack = [index];
  while (stack.length) {
    const at = stack.pop();
    const here = msCells[at];
    if (here.open || here.flag) continue;
    here.open = true;
    if (here.count === 0) {
      msNeighbours(at).forEach((n) => {
        if (!msCells[n].open) stack.push(n);
      });
    }
  }

  msRender();
  msCheckWin();
}

function msFlag(index) {
  if (msStatus === "won" || msStatus === "lost") return;
  if (msCells[index].open) return;
  msCells[index].flag = !msCells[index].flag;
  msRender();
}

/* Clicking an open number whose flags already account for its mines opens
   the rest of its neighbours. Experienced players expect this and it is most
   of what makes the game fast. */
function msChord(index) {
  const cell = msCells[index];
  if (!cell.open || !cell.count) return;

  const neighbours = msNeighbours(index);
  const flagged = neighbours.filter((n) => msCells[n].flag).length;
  if (flagged !== cell.count) return;

  neighbours.forEach((n) => {
    if (!msCells[n].flag && !msCells[n].open) msOpen(n);
  });
}

function msBuildBoard() {
  msBoard.innerHTML = "";
  msButtons = [];

  for (let i = 0; i < MS_N * MS_N; i++) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ms-cell";

    // Long press flags, for touch. The flag it raises must not then also
    // count as a click, or it would immediately open the cell.
    let pressTimer = null;
    let longPressFired = false;

    const cancelPress = () => {
      if (pressTimer) clearTimeout(pressTimer);
      pressTimer = null;
    };

    button.addEventListener("pointerdown", () => {
      longPressFired = false;
      pressTimer = setTimeout(() => {
        longPressFired = true;
        pressTimer = null;
        msFlag(i);
      }, 420);
    });
    button.addEventListener("pointerup", cancelPress);
    button.addEventListener("pointerleave", cancelPress);

    button.addEventListener("click", () => {
      if (longPressFired) {
        longPressFired = false;
        return;
      }
      if (msCells[i].open) msChord(i);
      else msOpen(i);
    });

    button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      msFlag(i);
    });

    msBoard.append(button);
    msButtons.push(button);
  }
}

export function msNewGame() {
  msStopClock();
  msCells = Array.from({ length: MS_N * MS_N }, () => ({
    mine: false,
    open: false,
    flag: false,
    boom: false,
    count: 0,
  }));
  msMinesPlaced = false;
  msStatus = "idle";
  msStartedAt = 0;
  msMessageEl.textContent = "Click to start · right-click to flag";
  if (!msButtons.length) msBuildBoard();
  msRender();
}

msNewBtn.addEventListener("click", msNewGame);
