import { playWinSound } from "../alerts.js";
import { activeGame } from "./shell.js";
import { isTyping } from "../keys.js";
import { openPanel } from "../panels.js";

/* ==========================================================================
   Sudoku

   Puzzles are generated rather than shipped: fill a grid at random, then
   remove clues one at a time, keeping a removal only while exactly one
   solution remains. A puzzle with two solutions is not a puzzle - you would
   reach a point where logic runs out and guessing takes over.
   ========================================================================== */

const suBoard = document.getElementById("su-board");
const suPad = document.getElementById("su-pad");
const suTimeEl = document.getElementById("su-time");
const suLeftEl = document.getElementById("su-left");
const suMessageEl = document.getElementById("su-message");
const suNewBtn = document.getElementById("su-new");

const SU_GIVENS = 36;

let suPuzzle = [];
let suGrid = [];
let suSolution = [];
let suCellEls = [];
let suSelected = -1;
export let suStatus = "idle"; // idle | playing | done
let suStartedAt = 0;
let suTicker = null;

function suAllowed(grid, index, value) {
  const row = Math.floor(index / 9);
  const col = index % 9;

  for (let i = 0; i < 9; i++) {
    if (grid[row * 9 + i] === value) return false;
    if (grid[i * 9 + col] === value) return false;
  }

  const boxRow = Math.floor(row / 3) * 3;
  const boxCol = Math.floor(col / 3) * 3;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      if (grid[(boxRow + r) * 9 + boxCol + c] === value) return false;
    }
  }

  return true;
}

function suShuffled(list) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const swap = out[i];
    out[i] = out[j];
    out[j] = swap;
  }
  return out;
}

function suFill(grid) {
  const index = grid.indexOf(0);
  if (index === -1) return true;

  for (const value of suShuffled([1, 2, 3, 4, 5, 6, 7, 8, 9])) {
    if (!suAllowed(grid, index, value)) continue;
    grid[index] = value;
    if (suFill(grid)) return true;
    grid[index] = 0;
  }

  return false;
}

/* Counts solutions, stopping as soon as `limit` are found. Only ever called
   with limit 2, because the single question that matters is "is there more
   than one?" - counting them all would be far slower for no benefit. */
function suCountSolutions(grid, limit) {
  const index = grid.indexOf(0);
  if (index === -1) return 1;

  let found = 0;
  for (let value = 1; value <= 9; value++) {
    if (!suAllowed(grid, index, value)) continue;
    grid[index] = value;
    found += suCountSolutions(grid, limit - found);
    grid[index] = 0;
    if (found >= limit) break;
  }

  return found;
}

function suGenerate(givens) {
  const solution = new Array(81).fill(0);
  suFill(solution);

  const puzzle = solution.slice();
  let remaining = 81;

  for (const index of suShuffled([...Array(81).keys()])) {
    if (remaining <= givens) break;
    const saved = puzzle[index];
    puzzle[index] = 0;
    if (suCountSolutions(puzzle.slice(), 2) === 1) {
      remaining -= 1;
    } else {
      puzzle[index] = saved; // removing it left the puzzle ambiguous
    }
  }

  return { puzzle, solution };
}

/* ---- Board ---- */

function suPeers(index) {
  const row = Math.floor(index / 9);
  const col = index % 9;
  const boxRow = Math.floor(row / 3) * 3;
  const boxCol = Math.floor(col / 3) * 3;
  const out = new Set();
  for (let i = 0; i < 9; i++) {
    out.add(row * 9 + i);
    out.add(i * 9 + col);
  }
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) out.add((boxRow + r) * 9 + boxCol + c);
  }
  out.delete(index);
  return out;
}

function suConflicts(index) {
  const value = suGrid[index];
  if (!value) return false;
  for (const peer of suPeers(index)) {
    if (suGrid[peer] === value) return true;
  }
  return false;
}

function suElapsed() {
  return suStartedAt ? Math.floor((Date.now() - suStartedAt) / 1000) : 0;
}

function suRender() {
  const selectedValue = suSelected >= 0 ? suGrid[suSelected] : 0;
  const peers = suSelected >= 0 ? suPeers(suSelected) : new Set();

  suGrid.forEach((value, index) => {
    const cell = suCellEls[index];
    const col = index % 9;
    const row = Math.floor(index / 9);

    let className = "su-cell";
    if (col === 2 || col === 5) className += " box-right";
    if (row === 2 || row === 5) className += " box-bottom";
    if (col === 8) className += " edge-right";
    if (row === 8) className += " edge-bottom";
    if (suPuzzle[index]) className += " is-given";
    if (index === suSelected) className += " is-selected";
    else if (peers.has(index)) className += " is-peer";
    else if (selectedValue && value === selectedValue) className += " is-same";
    if (value && suConflicts(index)) className += " is-wrong";

    if (cell.className !== className) cell.className = className;
    const label = value ? String(value) : "";
    if (cell.textContent !== label) cell.textContent = label;
  });

  suLeftEl.textContent = suGrid.filter((v) => !v).length;
  suTimeEl.textContent = suElapsed();
}

function suCheckDone() {
  if (suGrid.some((v) => !v)) return;
  if (suGrid.some((_, i) => suConflicts(i))) return;

  suStatus = "done";
  playWinSound();
  clearInterval(suTicker);
  suTicker = null;
  suSelected = -1;
  suMessageEl.textContent = "Solved in " + suElapsed() + "s";
  suRender();
}

function suSet(value) {
  if (suStatus !== "playing") return;
  if (suSelected < 0) return;
  if (suPuzzle[suSelected]) return; // a given, not yours to change

  suGrid[suSelected] = value;
  suRender();
  suCheckDone();
}

function suBuildBoard() {
  suBoard.innerHTML = "";
  suCellEls = [];

  for (let i = 0; i < 81; i++) {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "su-cell";
    cell.addEventListener("click", () => {
      if (suStatus !== "playing") return;
      suSelected = i;
      suRender();
    });
    suBoard.append(cell);
    suCellEls.push(cell);
  }

  suPad.innerHTML = "";
  for (let n = 1; n <= 9; n++) {
    const key = document.createElement("button");
    key.type = "button";
    key.className = "su-key";
    key.textContent = n;
    key.addEventListener("click", () => suSet(n));
    suPad.append(key);
  }
  const erase = document.createElement("button");
  erase.type = "button";
  erase.className = "su-key";
  erase.textContent = "⌫";
  erase.addEventListener("click", () => suSet(0));
  suPad.append(erase);
}

export function suNewGame() {
  clearInterval(suTicker);
  if (!suCellEls.length) suBuildBoard();

  suMessageEl.textContent = "Generating…";
  suStatus = "idle";

  /* Generation blocks for a moment, so yield a frame first - otherwise the
     "Generating" message never gets painted before the work starts. */
  requestAnimationFrame(() => {
    const made = suGenerate(SU_GIVENS);
    suPuzzle = made.puzzle;
    suSolution = made.solution;
    suGrid = made.puzzle.slice();
    suSelected = -1;
    suStatus = "playing";
    suStartedAt = Date.now();
    suMessageEl.textContent = " ";
    suTicker = setInterval(() => {
      suTimeEl.textContent = suElapsed();
    }, 1000);
    suRender();
  });
}

suNewBtn.addEventListener("click", suNewGame);

document.addEventListener("keydown", (event) => {
  if (openPanel !== "games" || activeGame !== "sudoku") return;
  if (isTyping(event.target)) return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;

  if (/^[1-9]$/.test(event.key)) {
    event.preventDefault();
    suSet(Number(event.key));
    return;
  }

  if (event.key === "Backspace" || event.key === "Delete" || event.key === "0") {
    event.preventDefault();
    suSet(0);
    return;
  }

  // Arrow keys move the selection around the grid.
  const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -9, ArrowDown: 9 };
  if (moves[event.key] === undefined) return;
  event.preventDefault();
  if (suSelected < 0) suSelected = 0;
  else {
    const next = suSelected + moves[event.key];
    const sameRow = Math.floor(next / 9) === Math.floor(suSelected / 9);
    const horizontal = Math.abs(moves[event.key]) === 1;
    if (next >= 0 && next < 81 && (!horizontal || sameRow)) suSelected = next;
  }
  suRender();
});
