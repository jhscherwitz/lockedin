import { playWinSound } from "../alerts.js";
import { activeGame } from "./shell.js";
import { openPanel } from "../panels.js";

/* ---- Wordie ----------------------------------------------------------------
   Functions here keep an `fl` prefix from when the game was called Five
   Letters. The name changed; the prefix stayed, since renaming forty
   identifiers buys nothing.
   -------------------------------------------------------------------------- */

const flBoard = document.getElementById("fl-board");
const flMessage = document.getElementById("fl-message");
const flKeyboard = document.getElementById("fl-keyboard");
export const flNewBtn = document.getElementById("fl-new");

const FL_ROWS = 6;
const FL_LEN = 5;
const FL_RECENT_KEY = "focus-app-fl-recent";

const FL_FLIP_MS = 290; // half a flip: edge-on at this point
const FL_STAGGER_MS = 210; // gap between one tile starting and the next

let flRevealing = false;
let flWords = null; // { answers: [...], guesses: Set }
let flLoading = null; // in-flight fetch, so two clicks don't load twice

export const fl = {
  answer: "",
  submitted: [],
  current: "",
  status: "idle", // idle | playing | won | lost
  keyState: {}, // letter -> correct | present | absent
};

export function flActive() {
  return openPanel === "games" && activeGame === "wordie";
}

/* Fetched the first time the game is opened rather than on page load, so
   104KB of word lists never delays the timer appearing. */
function loadWordLists() {
  if (flWords) return Promise.resolve(flWords);
  if (flLoading) return flLoading;

  flLoading = Promise.all([
    fetch("assets/words/answers.txt").then((r) => r.text()),
    fetch("assets/words/guesses.txt").then((r) => r.text()),
  ]).then(([answersText, guessesText]) => {
    flWords = {
      answers: answersText.trim().split("\n"),
      guesses: new Set(guessesText.trim().split("\n")),
    };
    return flWords;
  });

  return flLoading;
}

/* ---- Choosing a word ---- */

function flRecent() {
  try {
    const list = JSON.parse(localStorage.getItem(FL_RECENT_KEY));
    return Array.isArray(list) ? list : [];
  } catch (error) {
    return [];
  }
}

function flRememberAnswer(word) {
  const recent = [word, ...flRecent().filter((w) => w !== word)].slice(0, 40);
  try {
    localStorage.setItem(FL_RECENT_KEY, JSON.stringify(recent));
  } catch (error) {
    // Storage blocked. Occasional repeats are not worth failing over.
  }
}

function flPickAnswer(answers) {
  const recent = new Set(flRecent());
  const fresh = answers.filter((word) => !recent.has(word));
  const pool = fresh.length ? fresh : answers;
  return pool[Math.floor(Math.random() * pool.length)];
}

/* ---- Scoring ----------------------------------------------------------------

   Two passes, and the order is the whole point. Greens are assigned first and
   consume from a tally of the answer's letters; only then are yellows handed
   out, and only while that letter still has some left in the tally.

   Answer SPEED, guess ERASE. A single pass asking "is this letter somewhere in
   the answer?" lights up both E's in the guess. That is wrong: SPEED has two
   E's, and the guess's second E already claimed one of them as a green, so the
   first E has exactly one left to match against - not two.
   -------------------------------------------------------------------------- */

function flScore(guess, answer) {
  const result = new Array(FL_LEN).fill("absent");
  const remaining = {};

  for (const letter of answer) {
    remaining[letter] = (remaining[letter] || 0) + 1;
  }

  for (let i = 0; i < FL_LEN; i++) {
    if (guess[i] === answer[i]) {
      result[i] = "correct";
      remaining[guess[i]] -= 1;
    }
  }

  for (let i = 0; i < FL_LEN; i++) {
    if (result[i] === "correct") continue;
    const letter = guess[i];
    if (remaining[letter] > 0) {
      result[i] = "present";
      remaining[letter] -= 1;
    }
  }

  return result;
}

// A key never downgrades: once green it stays green.
const FL_RANK = { absent: 0, present: 1, correct: 2 };

function flMergeKeyStates(guess, scores) {
  for (let i = 0; i < FL_LEN; i++) {
    const letter = guess[i];
    const current = fl.keyState[letter];
    if (!current || FL_RANK[scores[i]] > FL_RANK[current]) {
      fl.keyState[letter] = scores[i];
    }
  }
}

/* ---- Drawing ---- */

export function flRenderBoard() {
  flBoard.innerHTML = "";

  for (let row = 0; row < FL_ROWS; row++) {
    const rowEl = document.createElement("div");
    rowEl.className = "fl-row";

    const guess = fl.submitted[row];
    const isCurrentRow = row === fl.submitted.length;
    const scores = guess ? flScore(guess, fl.answer) : null;

    for (let i = 0; i < FL_LEN; i++) {
      const tile = document.createElement("div");
      tile.className = "fl-tile";

      const revealingThisRow = flRevealing && row === fl.submitted.length - 1;

      if (guess) {
        tile.textContent = guess[i];
        // Mid-reveal the colours are applied tile by tile, not all at once.
        tile.classList.add(revealingThisRow ? "is-filled" : "is-" + scores[i]);
      } else if (isCurrentRow && fl.current[i]) {
        tile.textContent = fl.current[i];
        tile.classList.add("is-filled");
      }

      rowEl.append(tile);
    }

    flBoard.append(rowEl);
  }
}

const FL_KEYS = [
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
  ["Enter", "z", "x", "c", "v", "b", "n", "m", "Back"],
];

export function flBuildKeyboard() {
  flKeyboard.innerHTML = "";

  FL_KEYS.forEach((row) => {
    const rowEl = document.createElement("div");
    rowEl.className = "fl-krow";

    row.forEach((key) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "fl-key" + (key.length > 1 ? " fl-key-wide" : "");
      button.textContent = key === "Back" ? "⌫" : key;
      button.dataset.key = key;
      button.addEventListener("click", () => flPress(key));
      rowEl.append(button);
    });

    flKeyboard.append(rowEl);
  });
}

function flRenderKeyboard() {
  flKeyboard.querySelectorAll(".fl-key").forEach((button) => {
    button.classList.remove("is-correct", "is-present", "is-absent");
    const state = fl.keyState[button.dataset.key];
    if (state) button.classList.add("is-" + state);
  });
}

export function flSay(text) {
  flMessage.textContent = text || " ";
}

function flShakeCurrentRow() {
  const rowEl = flBoard.querySelectorAll(".fl-row")[fl.submitted.length];
  if (!rowEl) return;
  rowEl.classList.remove("is-invalid");
  // Reading a layout property forces the removal to take effect before the
  // class goes back on. Without it the animation does not restart.
  void rowEl.offsetWidth;
  rowEl.classList.add("is-invalid");
}

/* ---- Playing ---- */

const FL_PRAISE = [
  "Genius",
  "Magnificent",
  "Impressive",
  "Splendid",
  "Great",
  "Phew",
];

export function flPress(key) {
  if (fl.status !== "playing" || flRevealing) return;

  if (key === "Back") {
    fl.current = fl.current.slice(0, -1);
    flSay("");
    flRenderBoard();
    return;
  }

  if (key === "Enter") {
    flSubmit();
    return;
  }

  if (!/^[a-z]$/.test(key)) return;
  if (fl.current.length >= FL_LEN) return;

  fl.current += key;
  flSay("");
  flRenderBoard();
}

/* Turns one row over, left to right. Resolves when the last tile has landed,
   so the win or lose message waits for the reveal to finish rather than
   spoiling it. */
function flRevealRow(rowIndex, scores) {
  const rowEl = flBoard.querySelectorAll(".fl-row")[rowIndex];
  if (!rowEl) return Promise.resolve();

  const tiles = Array.from(rowEl.children);
  const paint = (tile, i) => {
    tile.classList.remove("is-filled");
    tile.classList.add("is-" + scores[i]);
  };

  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches;

  if (reduceMotion) {
    tiles.forEach(paint);
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    tiles.forEach((tile, i) => {
      const delay = i * FL_STAGGER_MS;
      tile.style.animation =
        "fl-flip " + FL_FLIP_MS * 2 + "ms ease " + delay + "ms";
      // Halfway through, the tile is edge-on and invisible - the only moment
      // the colour can change without the change itself being visible.
      setTimeout(() => paint(tile, i), delay + FL_FLIP_MS);
    });

    const total = (tiles.length - 1) * FL_STAGGER_MS + FL_FLIP_MS * 2;
    setTimeout(resolve, total);
  });
}

function flSubmit() {
  if (flRevealing) return;

  if (fl.current.length < FL_LEN) {
    flSay("Not enough letters");
    flShakeCurrentRow();
    return;
  }

  if (!flWords || !flWords.guesses.has(fl.current)) {
    flSay("Not in word list");
    flShakeCurrentRow();
    return;
  }

  const guess = fl.current;
  const scores = flScore(guess, fl.answer);

  fl.submitted.push(guess);
  fl.current = "";
  flSay("");

  flRevealing = true;
  flRenderBoard();

  flRevealRow(fl.submitted.length - 1, scores).then(() => {
    flRevealing = false;

    // The keyboard updates with the row, not ahead of it.
    flMergeKeyStates(guess, scores);
    flRenderKeyboard();

    if (guess === fl.answer) {
      fl.status = "won";
      playWinSound();
      flSay(FL_PRAISE[fl.submitted.length - 1]);
    } else if (fl.submitted.length >= FL_ROWS) {
      fl.status = "lost";
      flSay("It was " + fl.answer.toUpperCase());
    }

    flNewBtn.hidden = fl.status === "playing";
  });
}

export function flNewGame() {
  return loadWordLists().then((words) => {
    fl.answer = flPickAnswer(words.answers);
    fl.submitted = [];
    fl.current = "";
    fl.status = "playing";
    fl.keyState = {};
    // In case a new game is started while a row is still turning over.
    flRevealing = false;
    flRememberAnswer(fl.answer);
    flNewBtn.hidden = true;
    flSay("");
    flRenderBoard();
    flRenderKeyboard();
  });
}
