import { activeGame } from "./shell.js";
import { isTyping } from "../keys.js";
import { openPanel } from "../panels.js";

/* ==========================================================================
   Dino Run

   Canvas rather than DOM: this scrolls continuously, and moving dozens of
   elements every frame is exactly what canvas is for.

   Speed follows Chrome's own numbers - start at 6, add 0.001 per frame, stop
   at 13. The cap is the part that matters: an uncapped ramp eventually
   outruns the jump arc and the game becomes unwinnable rather than hard.
   ========================================================================== */

const dnCanvas = document.getElementById("dn-canvas");
const dnScoreEl = document.getElementById("dn-score");
export const dnBestEl = document.getElementById("dn-best");
const dnMessageEl = document.getElementById("dn-message");
const dnNewBtn = document.getElementById("dn-new");
const dnCtx = dnCanvas.getContext("2d");

const DN_BEST_KEY = "focus-app-dn-best";
const DN_W = 572;
const DN_H = 300;
const DN_GROUND = 240;
const DN_GRAVITY = 0.9;
const DN_JUMP = -17;

/* The ramp. DN_ACCEL is per 60fps-normalised frame, so the gain per second is
   ACCEL * 60 - which is the number worth reasoning about.

   It used to be 0.0006, or 0.036 a second: eight tenths of one percent of the
   starting speed, needing 136 seconds to reach a max that was itself only
   twice the start. It did accelerate. You simply could not feel it, and most
   runs ended before anything changed. Now 0.12 a second, reaching a higher
   max in about a minute. */
const DN_SPEED_START = 4.6;
const DN_SPEED_MAX = 12.5;
const DN_ACCEL = 0.002;

/* Spacing, in PIXELS - which is the whole point.

   It used to be counted in frames, and that quietly cancelled the difficulty
   curve: a fixed frame gap at a higher speed is a *longer* distance, so
   obstacles drifted further apart as the run sped up. Measured out, the gap
   went from 716px at the starting speed to 1245px at the old maximum, on a
   572px-wide canvas. The game got emptier the faster it went.

   Distance is the honest unit, because what makes a runner hard is how far
   apart the obstacles are on screen, not how many frames passed. */
const DN_GAP_START = 560; // floor at the starting speed
const DN_GAP_RANDOM = 260; // variation on top, so it is not metronomic

/* The floor at full speed is derived, not guessed. A jump lasts
   2 * |DN_JUMP| / DN_GRAVITY frames, so at DN_SPEED_MAX it covers that many
   pixels of ground. Any gap shorter than that can produce a pair the runner
   physically cannot clear however well it times the jump - an unwinnable
   spawn, which is a worse sin than being easy. The margin is the landing. */
const DN_JUMP_FRAMES = (2 * Math.abs(DN_JUMP)) / DN_GRAVITY;
const DN_GAP_MIN = Math.ceil(DN_JUMP_FRAMES * DN_SPEED_MAX) + 30;

const DN_TALL = 34;
const DN_SHORT = 18;

// Birds fly at three heights: one you must jump, one you must duck, and one
// you can simply run beneath.
const DN_BIRD_Y = [216, 194, 160];
const DN_BIRD_H = 26;
const DN_BIRD_W = 34;
// Birds are held back until the run has had time to settle.
const DN_BIRD_AFTER = 480;

let dnRunner = { y: DN_GROUND, vy: 0, h: DN_TALL };
let dnDucking = false;
let dnObstacles = [];
let dnSpeed = DN_SPEED_START;
let dnScore = 0;
export let dnStatus = "idle"; // idle | playing | over
let dnFrame = null;
let dnSinceSpawn = 0; // pixels travelled since the last obstacle
/* Read once per run rather than per frame. The draw loop runs 60 times a
   second and localStorage is synchronous. */
let dnBest = 0;
let dnShownBest = -1;
let dnNextGap = DN_GAP_START;
let dnLast = 0;

/* The gap floor slides from DN_GAP_START down to DN_GAP_MIN as the run speeds
   up, so obstacles close in rather than drifting apart. */
function dnPickGap() {
  const span = DN_SPEED_MAX - DN_SPEED_START;
  const through = span > 0 ? (dnSpeed - DN_SPEED_START) / span : 1;
  const floor = DN_GAP_START + (DN_GAP_MIN - DN_GAP_START) * through;
  return floor + Math.random() * DN_GAP_RANDOM;
}

export function dnReadBest() {
  try {
    return Number(localStorage.getItem(DN_BEST_KEY)) || 0;
  } catch (error) {
    return 0;
  }
}

function dnAirborne() {
  return dnRunner.y < DN_GROUND;
}

function dnJump() {
  if (dnStatus !== "playing") return;
  if (dnAirborne()) return; // no double jumps
  dnRunner.vy = DN_JUMP;
}

function dnDuck(on) {
  if (dnStatus !== "playing") return;
  dnDucking = on;
  // Pressing down mid-air drops you faster, as in the original.
  if (on && dnAirborne() && dnRunner.vy < 0) dnRunner.vy = 2;
}

/* A canvas cannot use a CSS variable, so the tokens have to be read out and
   handed to the context. Worth doing rather than hardcoding: the runner and
   the ground line were "#ffffff" and white-alpha, which is invisible on the
   Paper theme's pale board - a light theme breaks canvas drawing silently,
   because none of it lives in the stylesheet the token audit swept. */
function dnColours() {
  const root = getComputedStyle(document.documentElement);
  const get = (name, fallback) => root.getPropertyValue(name).trim() || fallback;
  return {
    accent: get("--accent", "#7c5cff"),
    runner: get("--text", "#ffffff"),
    ground: get("--line-strong", "rgba(255,255,255,0.34)"),
  };
}

export function dnDraw() {
  const paint = dnColours();

  dnCtx.clearRect(0, 0, DN_W, DN_H);

  dnCtx.strokeStyle = paint.ground;
  dnCtx.lineWidth = 3;
  dnCtx.beginPath();
  dnCtx.moveTo(0, DN_GROUND + 2);
  dnCtx.lineTo(DN_W, DN_GROUND + 2);
  dnCtx.stroke();

  // Runner.
  dnCtx.fillStyle = paint.runner;
  dnCtx.beginPath();
  dnCtx.roundRect(60, dnRunner.y - dnRunner.h, DN_TALL, dnRunner.h, 8);
  dnCtx.fill();

  dnObstacles.forEach((ob) => {
    dnCtx.fillStyle = paint.accent;
    if (ob.type === "bird") {
      // Body plus a wing that flips with distance, so it appears to flap.
      const up = Math.floor(dnScore / 7) % 2 === 0;
      dnCtx.beginPath();
      dnCtx.roundRect(ob.x, ob.y + 9, ob.w, 9, 4);
      dnCtx.fill();
      dnCtx.beginPath();
      dnCtx.moveTo(ob.x + 8, ob.y + 12);
      dnCtx.lineTo(ob.x + 22, ob.y + 12);
      dnCtx.lineTo(ob.x + 15, ob.y + (up ? -1 : 25));
      dnCtx.closePath();
      dnCtx.fill();
    } else {
      dnCtx.beginPath();
      dnCtx.roundRect(ob.x, DN_GROUND - ob.h, ob.w, ob.h, 5);
      dnCtx.fill();
    }
  });
}

function dnEnd() {
  dnStatus = "over";
  cancelAnimationFrame(dnFrame);
  dnFrame = null;

  const shown = Math.floor(dnScore / 6);
  if (shown > dnReadBest()) {
    try {
      localStorage.setItem(DN_BEST_KEY, String(shown));
    } catch (error) {
      // Storage blocked.
    }
  }

  dnBestEl.textContent = dnReadBest();
  dnMessageEl.textContent = "Score " + shown;
  dnNewBtn.textContent = "Play again";
  dnNewBtn.hidden = false;
}

function dnSpawn() {
  const birdsAllowed = dnScore > DN_BIRD_AFTER;

  if (birdsAllowed && Math.random() < 0.32) {
    dnObstacles.push({
      type: "bird",
      x: DN_W + 20,
      y: DN_BIRD_Y[Math.floor(Math.random() * DN_BIRD_Y.length)],
      w: DN_BIRD_W,
      h: DN_BIRD_H,
      // Birds fly towards you, so they close slightly faster than the ground.
      extra: 1.6,
    });
    return;
  }

  dnObstacles.push({
    type: "cactus",
    x: DN_W + 20,
    w: 16 + Math.random() * 12,
    h: 30 + Math.random() * 34,
    extra: 0,
  });
}

/* Everything below is scaled by elapsed time rather than counted per frame.
   Without this the game runs as fast as the monitor refreshes - the same
   constants give a 144Hz display a game 2.4x faster than a 60Hz one, which
   is why "matching Chrome's numbers" meant nothing on its own. */
function dnStep(now) {
  if (typeof now !== "number") now = dnLast + 1000 / 60;
  if (!dnLast) dnLast = now;

  // Normalised so dt is 1 at 60fps. Clamped, so a dropped frame or a tab
  // returning from the background cannot teleport the runner through a cactus.
  const dt = Math.min(3, (now - dnLast) / (1000 / 60)) || 1;
  dnLast = now;

  dnRunner.h = dnDucking && !dnAirborne() ? DN_SHORT : DN_TALL;

  dnRunner.vy += DN_GRAVITY * dt;
  dnRunner.y = Math.min(DN_GROUND, dnRunner.y + dnRunner.vy * dt);
  if (dnRunner.y === DN_GROUND) dnRunner.vy = 0;

  if (dnSpeed < DN_SPEED_MAX) dnSpeed += DN_ACCEL * dt;

  // Pixels, not frames. See the note on DN_GAP_START.
  dnSinceSpawn += dnSpeed * dt;
  if (dnSinceSpawn > dnNextGap) {
    dnSpawn();
    dnSinceSpawn = 0;
    dnNextGap = dnPickGap();
  }

  dnObstacles.forEach((ob) => {
    ob.x -= (dnSpeed + ob.extra) * dt;
  });
  dnObstacles = dnObstacles.filter((ob) => ob.x + ob.w > -40);

  const rx = 60;
  const rTop = dnRunner.y - dnRunner.h;
  const hit = dnObstacles.some((ob) => {
    if (rx + DN_TALL <= ob.x + 3 || rx >= ob.x + ob.w - 3) return false;
    const obTop = ob.type === "bird" ? ob.y : DN_GROUND - ob.h;
    const obBottom = ob.type === "bird" ? ob.y + ob.h : DN_GROUND;
    return rTop < obBottom && dnRunner.y > obTop;
  });

  dnScore += dt;
  const shown = Math.floor(dnScore / 6);
  if (dnScoreEl.textContent !== String(shown)) dnScoreEl.textContent = shown;

  /* Once you are past your best, the best rises with you instead of sitting
     there stale until the run ends. */
  const best = Math.max(dnBest, shown);
  if (best !== dnShownBest) {
    dnShownBest = best;
    dnBestEl.textContent = best;
  }

  dnDraw();

  if (hit) {
    dnEnd();
    return;
  }

  dnFrame = requestAnimationFrame(dnStep);
}

function dnNewGame() {
  cancelAnimationFrame(dnFrame);
  dnRunner = { y: DN_GROUND, vy: 0, h: DN_TALL };
  dnDucking = false;
  dnObstacles = [];
  dnSpeed = DN_SPEED_START;
  dnNextGap = dnPickGap();
  dnScore = 0;
  dnSinceSpawn = 0;
  dnLast = 0;
  dnStatus = "playing";
  dnScoreEl.textContent = 0;
  dnBest = dnReadBest();
  dnShownBest = dnBest;
  dnBestEl.textContent = dnBest;
  dnMessageEl.textContent = "Space to jump · down to duck";
  dnNewBtn.hidden = true;
  dnFrame = requestAnimationFrame(dnStep);
}

dnNewBtn.addEventListener("click", dnNewGame);
dnCanvas.addEventListener("pointerdown", dnJump);

document.addEventListener("keydown", (event) => {
  if (openPanel !== "games" || activeGame !== "dino") return;
  if (isTyping(event.target)) return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;

  const key = event.key;
  if (key === " " || key === "ArrowUp" || key === "w") {
    event.preventDefault();
    if (dnStatus === "playing") dnJump();
    else dnNewGame();
    return;
  }

  if (key === "ArrowDown" || key === "s") {
    event.preventDefault();
    dnDuck(true);
  }
});

document.addEventListener("keyup", (event) => {
  if (event.key === "ArrowDown" || event.key === "s") dnDuck(false);
});
