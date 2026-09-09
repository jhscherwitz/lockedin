import { activeGame } from "./shell.js";
import { isTyping } from "../keys.js";
import { openPanel } from "../panels.js";

/* ==========================================================================
   Blackjack

   Six-deck shoe, dealer stands on all 17, blackjack pays 3:2. Double down on
   the first two cards. No splitting or insurance. Chips are pretend and reset
   when you run out.
   ========================================================================== */

const bjChipsEl = document.getElementById("bj-chips");
const bjBetEl = document.getElementById("bj-bet");
const bjDealerEl = document.getElementById("bj-dealer");
const bjPlayerEl = document.getElementById("bj-player");
const bjDealerTotalEl = document.getElementById("bj-dealer-total");
const bjPlayerTotalEl = document.getElementById("bj-player-total");
const bjMessageEl = document.getElementById("bj-message");
const bjBetControls = document.getElementById("bj-bet-controls");
const bjPlayControls = document.getElementById("bj-play-controls");
const bjDealBtn = document.getElementById("bj-deal");
const bjClearBtn = document.getElementById("bj-clear");
const bjHitBtn = document.getElementById("bj-hit");
const bjStandBtn = document.getElementById("bj-stand");
const bjDoubleBtn = document.getElementById("bj-double");
const bjResetBtn = document.getElementById("bj-reset");

const BJ_CHIPS_KEY = "focus-app-bj-chips";
const BJ_START_CHIPS = 500;
const BJ_SUITS = [
  { suit: "♠", red: false },
  { suit: "♥", red: true },
  { suit: "♦", red: true },
  { suit: "♣", red: false },
];
const BJ_RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

let bjShoe = [];
export let bjPlayerHand = [];
let bjDealerHand = [];
let bjChips = BJ_START_CHIPS;
export let bjBet = 0;
export let bjPhase = "betting"; // betting | playing | done
let bjHoleDown = true;

function bjReadChips() {
  try {
    const saved = Number(localStorage.getItem(BJ_CHIPS_KEY));
    return Number.isFinite(saved) && saved > 0 ? saved : BJ_START_CHIPS;
  } catch (error) {
    return BJ_START_CHIPS;
  }
}

function bjWriteChips() {
  try {
    localStorage.setItem(BJ_CHIPS_KEY, String(bjChips));
  } catch (error) {
    // Storage blocked; chips just won't persist.
  }
}

function bjShuffleShoe() {
  const cards = [];
  for (let deck = 0; deck < 6; deck++) {
    BJ_SUITS.forEach(({ suit, red }) => {
      BJ_RANKS.forEach((rank) => cards.push({ rank, suit, red }));
    });
  }
  // Fisher-Yates: every ordering equally likely.
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const swap = cards[i];
    cards[i] = cards[j];
    cards[j] = swap;
  }
  bjShoe = cards;
}

function bjDrawCard() {
  if (bjShoe.length < 20) bjShuffleShoe();
  return bjShoe.pop();
}

/* An ace is worth 11 unless that busts the hand, in which case it drops to 1.
   Counting every ace as 11 and then demoting them one at a time while over 21
   handles every case, including AA (12) and AAA (13) - which is where a naive
   "ace is 11 if total <= 10" check falls over. */
function bjValue(hand) {
  let total = 0;
  let aces = 0;

  hand.forEach((card) => {
    if (card.rank === "A") {
      aces += 1;
      total += 11;
    } else if (card.rank === "J" || card.rank === "Q" || card.rank === "K") {
      total += 10;
    } else {
      total += Number(card.rank);
    }
  });

  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }

  return total;
}

function bjIsBlackjack(hand) {
  return hand.length === 2 && bjValue(hand) === 21;
}

/* ---- Drawing ---- */

function bjCardEl(card, faceDown) {
  const el = document.createElement("div");
  el.className =
    "bj-card" + (faceDown ? " is-facedown" : card.red ? " is-red" : "");

  if (!faceDown) {
    const rank = document.createElement("span");
    rank.className = "bj-rank";
    rank.textContent = card.rank;
    const suit = document.createElement("span");
    suit.className = "bj-suit";
    suit.textContent = card.suit;
    el.append(rank, suit);
  }

  return el;
}

function bjRenderHands() {
  bjDealerEl.innerHTML = "";
  bjDealerHand.forEach((card, i) => {
    // The hole card stays down until the dealer's turn.
    bjDealerEl.append(bjCardEl(card, bjHoleDown && i === 1));
  });

  bjPlayerEl.innerHTML = "";
  bjPlayerHand.forEach((card) => bjPlayerEl.append(bjCardEl(card, false)));

  // While the hole card is down, only the up card is public knowledge.
  bjDealerTotalEl.textContent = !bjDealerHand.length
    ? ""
    : bjHoleDown
    ? bjValue([bjDealerHand[0]])
    : bjValue(bjDealerHand);

  bjPlayerTotalEl.textContent = bjPlayerHand.length
    ? bjValue(bjPlayerHand)
    : "";
}

function bjRender() {
  bjRenderHands();
  bjChipsEl.textContent = bjChips;
  bjBetEl.textContent = bjBet;

  const betting = bjPhase !== "playing";
  bjBetControls.hidden = !betting;
  bjPlayControls.hidden = betting;

  bjBetControls.querySelectorAll(".bj-chip").forEach((button) => {
    button.disabled = Number(button.dataset.chip) > bjChips - bjBet;
  });
  bjDealBtn.disabled = bjBet <= 0;

  // Double needs two cards and enough chips to match the bet.
  bjDoubleBtn.disabled = bjPlayerHand.length !== 2 || bjChips < bjBet;

  bjResetBtn.hidden = !(bjChips <= 0 && bjBet <= 0 && bjPhase !== "playing");
}

function bjSay(text) {
  bjMessageEl.textContent = text || " ";
}

/* ---- Flow ---- */

function bjSettle(outcome) {
  bjPhase = "done";
  bjHoleDown = false;

  if (outcome === "blackjack") {
    // 3:2 - the stake back plus one and a half times it.
    bjChips += Math.floor(bjBet * 2.5);
    bjSay("Blackjack! +" + Math.floor(bjBet * 1.5));
  } else if (outcome === "win") {
    bjChips += bjBet * 2;
    bjSay("You win +" + bjBet);
  } else if (outcome === "push") {
    bjChips += bjBet;
    bjSay("Push — bet returned");
  } else {
    bjSay(outcome === "bust" ? "Bust" : "Dealer wins");
  }

  bjBet = 0;
  bjWriteChips();
  bjRender();
}

function bjDealerPlay() {
  bjHoleDown = false;
  // House rule: stands on all 17, soft or hard.
  while (bjValue(bjDealerHand) < 17) {
    bjDealerHand.push(bjDrawCard());
  }

  const player = bjValue(bjPlayerHand);
  const dealer = bjValue(bjDealerHand);

  if (dealer > 21 || player > dealer) bjSettle("win");
  else if (player === dealer) bjSettle("push");
  else bjSettle("lose");
}

function bjDeal() {
  if (bjBet <= 0 || bjBet > bjChips) return;

  bjChips -= bjBet;
  bjPlayerHand = [bjDrawCard(), bjDrawCard()];
  bjDealerHand = [bjDrawCard(), bjDrawCard()];
  bjHoleDown = true;
  bjPhase = "playing";
  bjSay("");
  bjRender();

  const playerBJ = bjIsBlackjack(bjPlayerHand);
  const dealerBJ = bjIsBlackjack(bjDealerHand);

  if (playerBJ || dealerBJ) {
    if (playerBJ && dealerBJ) bjSettle("push");
    else if (playerBJ) bjSettle("blackjack");
    else bjSettle("lose");
  }
}

function bjHit() {
  if (bjPhase !== "playing") return;
  bjPlayerHand.push(bjDrawCard());
  bjRender();
  if (bjValue(bjPlayerHand) > 21) bjSettle("bust");
}

function bjStand() {
  if (bjPhase !== "playing") return;
  bjDealerPlay();
}

function bjDouble() {
  if (bjPhase !== "playing") return;
  if (bjPlayerHand.length !== 2 || bjChips < bjBet) return;

  bjChips -= bjBet;
  bjBet *= 2;
  bjPlayerHand.push(bjDrawCard());
  bjRender();

  if (bjValue(bjPlayerHand) > 21) bjSettle("bust");
  else bjDealerPlay();
}

export function bjNewRound() {
  bjPlayerHand = [];
  bjDealerHand = [];
  bjBet = 0;
  bjHoleDown = true;
  bjPhase = "betting";
  bjChips = bjReadChips();
  if (!bjShoe.length) bjShuffleShoe();
  bjSay(bjChips > 0 ? "Place a bet" : "");
  bjRender();
}

/* ---- Wiring ---- */

bjBetControls.querySelectorAll(".bj-chip").forEach((button) => {
  button.addEventListener("click", () => {
    // Betting again clears the hand that just finished.
    if (bjPhase === "done") {
      bjPlayerHand = [];
      bjDealerHand = [];
      bjPhase = "betting";
      bjSay("");
    }

    const amount = Number(button.dataset.chip);
    if (amount > bjChips - bjBet) return;
    bjBet += amount;
    bjRender();
  });
});

bjClearBtn.addEventListener("click", () => {
  bjBet = 0;
  bjRender();
});

bjDealBtn.addEventListener("click", bjDeal);
bjHitBtn.addEventListener("click", bjHit);
bjStandBtn.addEventListener("click", bjStand);
bjDoubleBtn.addEventListener("click", bjDouble);

bjResetBtn.addEventListener("click", () => {
  bjChips = BJ_START_CHIPS;
  bjWriteChips();
  bjNewRound();
});

// The app's letter shortcuts already stand down while a game is open, so
// these are free to use.
document.addEventListener("keydown", (event) => {
  if (openPanel !== "games" || activeGame !== "blackjack") return;
  if (isTyping(event.target)) return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;

  const key = event.key.toLowerCase();

  if (bjPhase === "playing") {
    if (key === "h") { event.preventDefault(); bjHit(); }
    else if (key === "s") { event.preventDefault(); bjStand(); }
    else if (key === "d") { event.preventDefault(); bjDouble(); }
    return;
  }

  if (key === "enter" && bjBet > 0) {
    event.preventDefault();
    bjDeal();
  }
});
