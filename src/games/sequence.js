import { audioContext } from "../audio.js";
import { masterVolume } from "../sounds.js";

/* ==========================================================================
   Sequence

   Four pads, each with its own pitch. The pattern grows by one every round;
   repeat it back to advance. The tones are the point - after a few rounds
   you stop reading positions and start remembering a tune.
   ========================================================================== */

const smPads = document.getElementById("sm-pads");
const smRoundEl = document.getElementById("sm-round");
const smBestEl = document.getElementById("sm-best");
const smMessageEl = document.getElementById("sm-message");
const smNewBtn = document.getElementById("sm-new");

const SM_BEST_KEY = "focus-app-sm-best";
// Roughly the intervals the original Simon used: a major triad plus the
// octave below, which is why the sequences sound musical rather than random.
const SM_TONES = [329.63, 261.63, 220.0, 164.81];

export let smSequence = [];
let smAt = 0;
let smStatus = "idle"; // idle | watching | input | over
export let smButtons = [];
let smTimers = [];

function smReadBest() {
  try {
    return Number(localStorage.getItem(SM_BEST_KEY)) || 0;
  } catch (error) {
    return 0;
  }
}

function smTone(freq, seconds) {
  const ctx = audioContext();
  if (!ctx) return; // No audio; the colours still carry the game.

  const now = ctx.currentTime;

  const osc = ctx.createOscillator();
  osc.type = "triangle";
  osc.frequency.value = freq;

  const gain = ctx.createGain();
  const peak = Math.max(0.0002, 0.16 * masterVolume);
  // Ramped rather than switched on: a square edge on a tone clicks audibly.
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(peak, now + 0.02);
  gain.gain.setValueAtTime(peak, now + Math.max(0.03, seconds - 0.06));
  gain.gain.exponentialRampToValueAtTime(0.0001, now + seconds);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + seconds + 0.02);
}

function smClearTimers() {
  smTimers.forEach(clearTimeout);
  smTimers = [];
}

function smLight(index, seconds) {
  const pad = smButtons[index];
  if (!pad) return;
  pad.classList.add("is-lit");
  smTone(SM_TONES[index], seconds);
  const off = setTimeout(() => pad.classList.remove("is-lit"), seconds * 1000);
  smTimers.push(off);
}

export function smRender() {
  smRoundEl.textContent = smSequence.length;
  smBestEl.textContent = Math.max(smReadBest(), smSequence.length);
  smPads.classList.toggle("is-watching", smStatus === "watching");
}

/* Playback speeds up as the sequence grows, which is most of the difficulty
   curve - by round ten you cannot subvocalise fast enough to keep up. */
function smPlaySequence() {
  smClearTimers();
  smStatus = "watching";
  smAt = 0;
  smRender();
  smMessageEl.textContent = "Watch";

  const step = Math.max(320, 620 - smSequence.length * 24);
  const lit = step * 0.6;

  smSequence.forEach((pad, i) => {
    smTimers.push(setTimeout(() => smLight(pad, lit / 1000), i * step));
  });

  smTimers.push(
    setTimeout(() => {
      smStatus = "input";
      smRender();
      smMessageEl.textContent = "Your turn";
    }, smSequence.length * step + 120)
  );
}

function smNextRound() {
  smSequence.push(Math.floor(Math.random() * 4));
  smPlaySequence();
}

function smFail() {
  smClearTimers();
  smStatus = "over";
  const reached = smSequence.length - 1;
  const best = smReadBest();

  if (reached > best) {
    try {
      localStorage.setItem(SM_BEST_KEY, String(reached));
    } catch (error) {
      // Storage blocked; the best round just won't persist.
    }
  }

  smPads.classList.add("is-wrong");
  setTimeout(() => smPads.classList.remove("is-wrong"), 420);

  smMessageEl.textContent = "Wrong — you reached round " + reached;
  smNewBtn.textContent = "Play again";
  smNewBtn.hidden = false;
  smRender();
}

function smPress(index) {
  if (smStatus !== "input") return;

  smLight(index, 0.22);

  if (index !== smSequence[smAt]) {
    smFail();
    return;
  }

  smAt += 1;

  if (smAt === smSequence.length) {
    smStatus = "watching";
    smMessageEl.textContent = "Good";
    smTimers.push(setTimeout(smNextRound, 700));
  }
}

export function smBuildPads() {
  smPads.innerHTML = "";
  smButtons = [];
  for (let i = 0; i < 4; i++) {
    const pad = document.createElement("button");
    pad.type = "button";
    pad.className = "sm-pad sm-pad-" + i;
    pad.setAttribute("aria-label", "Pad " + (i + 1));
    pad.addEventListener("click", () => smPress(i));
    smPads.append(pad);
    smButtons.push(pad);
  }
}

function smNewGame() {
  smClearTimers();
  if (!smButtons.length) smBuildPads();
  smSequence = [];
  smAt = 0;
  smStatus = "idle";
  smNewBtn.hidden = true;
  smRender();
  smNextRound();
}

smNewBtn.addEventListener("click", smNewGame);
