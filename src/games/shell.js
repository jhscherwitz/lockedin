import { bjBet, bjNewRound, bjPhase, bjPlayerHand } from "./blackjack.js";
import { dnBestEl, dnDraw, dnReadBest, dnStatus } from "./dino.js";
import { sqNewGame, sqStatus } from "./game2048.js";
import { gdShow } from "./geometry.js";
import { msNewGame, msStatus } from "./minesweeper.js";
import { smBuildPads, smButtons, smRender, smSequence } from "./sequence.js";
import { snBuild, snCells, snRender, snStatus } from "./snake.js";
import { suNewGame, suStatus } from "./sudoku.js";
import { fl, flActive, flBuildKeyboard, flNewBtn, flNewGame, flPress, flRenderBoard, flSay } from "./wordle.js";
import { isTyping } from "../keys.js";
import { openPanel } from "../panels.js";
import { start } from "../timer.js";

/* ==========================================================================
   Games

   The panel holds a picker and one game view, so adding a second game means
   adding a card and its own module - not restructuring anything.
   ========================================================================== */

const gamesMenu = document.getElementById("games-menu");
const gameView = document.getElementById("game-view");
const gamesBack = document.getElementById("games-back");

export let activeGame = null; // id of the game on screen, or null at the picker

export function gameIsActive() {
  return openPanel === "games" && activeGame !== null;
}

/* ---- Wiring ---- */

/* A registry rather than a chain of ifs, so a third game is one more entry
   plus its own pane in the markup. */
const GAMES = {
  wordie: {
    inProgress: () => fl.status !== "idle",
    start() {
      flSay("Loading words…");
      flNewGame().catch(() => flSay("Could not load the word list"));
    },
  },
  squish: {
    inProgress: () => sqStatus !== "idle",
    start() {
      sqNewGame();
    },
  },
  blackjack: {
    // Mid-hand, or a bet placed, or a finished hand still on the table.
    inProgress: () =>
      bjPhase === "playing" || bjBet > 0 || bjPlayerHand.length > 0,
    start() {
      bjNewRound();
    },
  },
  mines: {
    inProgress: () => msStatus !== "idle",
    start() {
      msNewGame();
    },
  },
  snake: {
    inProgress: () => snStatus !== "idle",
    start() {
      if (!snCells.length) snBuild();
      snRender();
    },
  },
  dino: {
    inProgress: () => dnStatus !== "idle",
    start() {
      dnBestEl.textContent = dnReadBest();
      dnDraw();
    },
  },
  geometry: {
    /* Never resumes. A run is a single unbroken attempt through a fixed
       level, so coming back to a half-finished one would be meaningless -
       the cube would restart mid-air. Reopening shows the board and waits. */
    inProgress: () => false,
    start() {
      gdShow();
    },
  },
  sudoku: {
    inProgress: () => suStatus !== "idle",
    start() {
      suNewGame();
    },
  },
  sequence: {
    inProgress: () => smSequence.length > 0,
    start() {
      // Waits for Start rather than firing a pattern at you on arrival.
      if (!smButtons.length) smBuildPads();
      smRender();
    },
  },
};

function openGame(id) {
  const game = GAMES[id];
  if (!game) return;

  activeGame = id;
  gamesMenu.hidden = true;
  gameView.hidden = false;
  gameView.querySelectorAll(".game-pane").forEach((pane) => {
    pane.hidden = pane.dataset.game !== id;
  });

  /* Only deal a fresh game when there is nothing to come back to. Panes are
     hidden rather than destroyed, so a game left half-finished is still
     sitting there in the DOM - starting a new one every time threw away work
     just for glancing at the menu. Each game has its own New button for when
     a fresh start is actually wanted. */
  if (!game.inProgress || !game.inProgress()) game.start();
}

function closeGame() {
  activeGame = null;
  gameView.hidden = true;
  gamesMenu.hidden = false;
}




// A real keyboard should work, not just the on-screen one.


/* Called by main.js once every module has loaded. Doing this at module
   scope instead would run it while other modules were still initialising,
   which is how a circular import turns into a TDZ error. */
export function initGames() {
  gamesMenu.querySelectorAll(".game-card").forEach((card) => {
    card.addEventListener("click", () => openGame(card.dataset.game));
  });
  gamesBack.addEventListener("click", closeGame);
  flNewBtn.addEventListener("click", () => flNewGame());
  document.addEventListener("keydown", (event) => {
    if (!flActive() || fl.status !== "playing") return;
    if (isTyping(event.target)) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    if (event.key === "Enter") {
      event.preventDefault();
      flPress("Enter");
      return;
    }

    if (event.key === "Backspace") {
      event.preventDefault();
      flPress("Back");
      return;
    }

    const letter = event.key.toLowerCase();
    if (/^[a-z]$/.test(letter)) {
      event.preventDefault();
      flPress(letter);
    }
  });
  flBuildKeyboard();
  flRenderBoard();
}
