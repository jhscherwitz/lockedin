import { playWinSound } from "../alerts.js";
import { isTyping } from "../keys.js";
import { openPanel } from "../panels.js";

/* ==========================================================================
   Geometry Dash

   A one-button precision platformer. The cube runs at a constant speed and
   the only input is jump; everything else is the level.

   Two things separate this from Dino Run, and both are deliberate:

   The level is *designed*, not generated. That is the whole genre - the
   pleasure is learning a fixed sequence rather than reacting to a random
   one, which is why there is a progress bar and an attempt counter instead
   of a score. GD_LEVEL below is hand-placed, and gdVerifyLevel() proves it
   is completable rather than trusting that it is.

   The physics run on elapsed time, not frames. Dino needed this too, but
   here it is non-negotiable: players memorise a jump arc, and an arc that
   changes length with the monitor's refresh rate makes the level unlearnable.

   Nothing here comes from the real Geometry Dash - the level is original and
   there is no music. Its levels, songs and artwork belong to RobTop and the
   individual artists.
   ========================================================================== */

const GD_BEST_KEY = "focus-app-gd-best";

const GD_W = 572;
const GD_H = 300;
const GD_GROUND = 248; // y of the ground line
const GD_SIZE = 26; // the cube
const GD_X = 96; // the cube never moves horizontally

const GD_SPEED = 5.2; // px per 60fps frame
const GD_GRAVITY = 0.62;
const GD_JUMP = -9.6;

/* Airtime is 2 * |JUMP| / GRAVITY frames, so the jump covers this much
   ground and reaches this high. Both numbers are used by the level checker
   below, and quoting them here is what stops the level drifting away from
   what the cube can actually do. */
const GD_AIR_FRAMES = (2 * Math.abs(GD_JUMP)) / GD_GRAVITY; // ~31
const GD_JUMP_LEN = GD_AIR_FRAMES * GD_SPEED; // ~161px
const GD_JUMP_HEIGHT = (GD_JUMP * GD_JUMP) / (2 * GD_GRAVITY); // ~74px

/* The level, in world pixels. `spike` kills on contact; `block` can be landed
   on but kills if hit side-on. Spacing gets tighter as it goes. */
const GD_LEVEL = [
  { x: 900, type: "spike" },
  { x: 1260, type: "spike" },
  { x: 1620, type: "spike" },
  { x: 1980, type: "spike" },
  { x: 2016, type: "spike" },

  { x: 2460, type: "block" },
  { x: 2820, type: "spike" },
  { x: 3170, type: "spike" },
  { x: 3206, type: "spike" },

  { x: 3640, type: "block" },
  { x: 3666, type: "block" },
  { x: 4040, type: "spike" },
  { x: 4400, type: "spike" },
  { x: 4436, type: "spike" },
  { x: 4472, type: "spike" },

  { x: 4900, type: "block" },
  { x: 5250, type: "spike" },
  { x: 5286, type: "spike" },
  { x: 5640, type: "block" },
  { x: 5666, type: "block" },

  { x: 6040, type: "spike" },
  { x: 6380, type: "spike" },
  { x: 6416, type: "spike" },
  { x: 6760, type: "spike" },
  { x: 7100, type: "block" },
  { x: 7126, type: "block" },
  { x: 7152, type: "block" },

  { x: 7540, type: "spike" },
  { x: 7576, type: "spike" },
  { x: 7920, type: "spike" },
  { x: 8260, type: "spike" },
  { x: 8296, type: "spike" },
  { x: 8332, type: "spike" },

  { x: 8760, type: "block" },
  { x: 9120, type: "spike" },
  { x: 9156, type: "spike" },
];

const GD_END = 9800; // finish line, in world pixels

const gdCanvas = document.getElementById("gd-canvas");
const gdCtx = gdCanvas ? gdCanvas.getContext("2d") : null;
const gdProgressEl = document.getElementById("gd-progress");
const gdBestEl = document.getElementById("gd-best");
const gdAttemptEl = document.getElementById("gd-attempt");
const gdBarEl = document.getElementById("gd-bar");
const gdMessageEl = document.getElementById("gd-message");
const gdNewBtn = document.getElementById("gd-new");

let gdStatus = "idle"; // idle | playing | dead | won
let gdCube = { y: GD_GROUND, vy: 0, grounded: true, rot: 0 };
let gdWorldX = 0; // how far into the level we are
let gdAttempt = 0;
let gdBest = 0;
let gdHeld = false; // holding jump re-jumps on landing, as in the original
let gdFrame = null;
let gdLast = 0;

function gdReadBest() {
  try {
    return Number(localStorage.getItem(GD_BEST_KEY)) || 0;
  } catch (error) {
    return 0;
  }
}

function gdWriteBest(percent) {
  try {
    localStorage.setItem(GD_BEST_KEY, String(percent));
  } catch (error) {
    // Storage blocked.
  }
}

function gdPercent() {
  return Math.max(0, Math.min(100, Math.floor((gdWorldX / GD_END) * 100)));
}

/* Obstacles near enough to matter. The level is a sorted list, so this could
   binary-search, but forty entries is nothing. */
function gdNearby() {
  const left = gdWorldX - GD_SIZE * 2;
  const right = gdWorldX + GD_W;
  return GD_LEVEL.filter((ob) => ob.x > left && ob.x < right);
}

function gdScreenX(ob) {
  return GD_X + (ob.x - gdWorldX);
}

function gdJump() {
  if (gdStatus !== "playing") return;
  if (!gdCube.grounded) return;
  gdCube.vy = GD_JUMP;
  gdCube.grounded = false;
}

function gdDie() {
  gdStatus = "dead";
  const reached = gdPercent();
  if (reached > gdBest) {
    gdBest = reached;
    gdWriteBest(gdBest);
  }
  gdStop();
  gdMessageEl.textContent = "Died at " + reached + "%";
  gdNewBtn.textContent = "Try again";
  gdNewBtn.hidden = false;
  gdRenderStats();
  gdDraw();
}

function gdWin() {
  gdStatus = "won";
  gdBest = 100;
  gdWriteBest(100);
  gdStop();
  playWinSound();
  gdMessageEl.textContent = "Complete - " + gdAttempt + " attempts";
  gdNewBtn.textContent = "Play again";
  gdNewBtn.hidden = false;
  gdRenderStats();
  gdDraw();
}

function gdStop() {
  if (gdFrame) cancelAnimationFrame(gdFrame);
  gdFrame = null;
}

/* One physics tick. `now` comes from requestAnimationFrame; dt is in
   60fps-frames so every constant above reads as "per frame at 60". */
function gdStep(now) {
  if (typeof now !== "number") now = gdLast + 1000 / 60;
  if (!gdLast) gdLast = now;
  const dt = Math.min(3, (now - gdLast) / (1000 / 60)) || 1;
  gdLast = now;

  if (gdStatus !== "playing") return;

  gdWorldX += GD_SPEED * dt;

  gdCube.vy += GD_GRAVITY * dt;
  gdCube.y += gdCube.vy * dt;

  const cubeTop = gdCube.y - GD_SIZE;
  const wasFalling = gdCube.vy >= 0;
  let landed = false;
  gdCube.grounded = false;

  for (const ob of gdNearby()) {
    const x = gdScreenX(ob);
    if (x + GD_SIZE < GD_X || x > GD_X + GD_SIZE) continue;

    if (ob.type === "block") {
      const top = GD_GROUND - GD_SIZE;
      /* Landing is checked before collision, and only while descending -
         otherwise clipping the underside of a block would read as a landing
         and the cube would pop through it. */
      if (wasFalling && gdCube.y - gdCube.vy * dt <= top + 2 && gdCube.y >= top) {
        gdCube.y = top;
        gdCube.vy = 0;
        landed = true;
        continue;
      }
      if (gdCube.y > top && cubeTop < GD_GROUND) {
        gdDie();
        return;
      }
    } else {
      /* Spikes get a forgiving hitbox: the real triangle is 26 wide at the
         base and a point at the top, so a square hitbox would kill on
         near-misses that visibly cleared it. */
      const spikeTop = GD_GROUND - GD_SIZE + 8;
      if (gdCube.y > spikeTop && x + GD_SIZE - 7 > GD_X && x + 7 < GD_X + GD_SIZE) {
        gdDie();
        return;
      }
    }
  }

  if (!landed && gdCube.y >= GD_GROUND) {
    gdCube.y = GD_GROUND;
    gdCube.vy = 0;
    landed = true;
  }

  if (landed) {
    gdCube.grounded = true;
    // Snap the rotation to a right angle so the cube always rests square.
    gdCube.rot = Math.round(gdCube.rot / 90) * 90;
    if (gdHeld) gdJump();
  } else {
    // A full quarter turn over the jump, which is what makes it read as GD.
    gdCube.rot += (90 / GD_AIR_FRAMES) * dt;
  }

  if (gdWorldX >= GD_END) {
    gdWin();
    return;
  }

  gdRenderStats();
  gdDraw();
  gdFrame = requestAnimationFrame(gdStep);
}

function gdRenderStats() {
  const percent = gdStatus === "won" ? 100 : gdPercent();
  if (gdProgressEl) gdProgressEl.textContent = percent + "%";
  if (gdBestEl) gdBestEl.textContent = Math.max(gdBest, percent) + "%";
  if (gdAttemptEl) gdAttemptEl.textContent = gdAttempt;
  if (gdBarEl) gdBarEl.style.width = percent + "%";
}

/* Canvas cannot use a CSS variable, so the tokens are read out and handed to
   the context - the same lesson the Dino runner taught when it stayed white
   on the pale themes. */
function gdColours() {
  const root = getComputedStyle(document.documentElement);
  const get = (name, fallback) => root.getPropertyValue(name).trim() || fallback;
  return {
    accent: get("--accent", "#7c5cff"),
    ink: get("--text", "#ffffff"),
    line: get("--line-strong", "rgba(255,255,255,0.34)"),
    faint: get("--line-soft", "rgba(255,255,255,0.09)"),
  };
}

function gdDraw() {
  if (!gdCtx) return;
  const paint = gdColours();
  gdCtx.clearRect(0, 0, GD_W, GD_H);

  // Ground.
  gdCtx.strokeStyle = paint.line;
  gdCtx.lineWidth = 3;
  gdCtx.beginPath();
  gdCtx.moveTo(0, GD_GROUND + 2);
  gdCtx.lineTo(GD_W, GD_GROUND + 2);
  gdCtx.stroke();

  /* Floor markings that scroll with the world. Without them a constant
     speed over an empty floor reads as standing still. */
  gdCtx.strokeStyle = paint.faint;
  gdCtx.lineWidth = 2;
  const spacing = 48;
  const offset = gdWorldX % spacing;
  for (let x = -offset; x < GD_W; x += spacing) {
    gdCtx.beginPath();
    gdCtx.moveTo(x, GD_GROUND + 2);
    gdCtx.lineTo(x, GD_GROUND + 14);
    gdCtx.stroke();
  }

  // Obstacles.
  gdCtx.fillStyle = paint.accent;
  for (const ob of gdNearby()) {
    const x = gdScreenX(ob);
    if (ob.type === "spike") {
      gdCtx.beginPath();
      gdCtx.moveTo(x, GD_GROUND);
      gdCtx.lineTo(x + GD_SIZE / 2, GD_GROUND - GD_SIZE);
      gdCtx.lineTo(x + GD_SIZE, GD_GROUND);
      gdCtx.closePath();
      gdCtx.fill();
    } else {
      gdCtx.beginPath();
      gdCtx.roundRect(x, GD_GROUND - GD_SIZE, GD_SIZE, GD_SIZE, 4);
      gdCtx.fill();
    }
  }

  // The finish line, once it is in view.
  const endX = GD_X + (GD_END - gdWorldX);
  if (endX < GD_W + 40) {
    gdCtx.strokeStyle = paint.ink;
    gdCtx.lineWidth = 4;
    gdCtx.setLineDash([10, 8]);
    gdCtx.beginPath();
    gdCtx.moveTo(endX, 40);
    gdCtx.lineTo(endX, GD_GROUND);
    gdCtx.stroke();
    gdCtx.setLineDash([]);
  }

  // The cube, drawn about its own centre so it can spin.
  gdCtx.save();
  gdCtx.translate(GD_X + GD_SIZE / 2, gdCube.y - GD_SIZE / 2);
  gdCtx.rotate((gdCube.rot * Math.PI) / 180);
  gdCtx.fillStyle = paint.ink;
  gdCtx.beginPath();
  gdCtx.roundRect(-GD_SIZE / 2, -GD_SIZE / 2, GD_SIZE, GD_SIZE, 5);
  gdCtx.fill();
  // A face mark, so the rotation is visible rather than implied.
  gdCtx.fillStyle = paint.accent;
  gdCtx.beginPath();
  gdCtx.roundRect(-GD_SIZE / 2 + 6, -GD_SIZE / 2 + 6, GD_SIZE - 12, GD_SIZE - 12, 2);
  gdCtx.fill();
  gdCtx.restore();
}

function gdNewGame() {
  gdStop();
  gdAttempt += 1;
  gdWorldX = 0;
  gdCube = { y: GD_GROUND, vy: 0, grounded: true, rot: 0 };
  gdHeld = false;
  gdLast = 0;
  gdStatus = "playing";
  gdBest = gdReadBest();
  gdMessageEl.textContent = "Space, up arrow or tap to jump";
  gdNewBtn.hidden = true;
  gdRenderStats();
  gdDraw();
  gdFrame = requestAnimationFrame(gdStep);
}

export function gdShow() {
  gdBest = gdReadBest();
  gdRenderStats();
  gdDraw();
}

function gdActive() {
  return openPanel === "games" && gdStatus !== "idle";
}

if (gdCanvas) {
  gdNewBtn.addEventListener("click", gdNewGame);

  gdCanvas.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    gdHeld = true;
    if (gdStatus === "playing") gdJump();
    else gdNewGame();
  });
  window.addEventListener("pointerup", () => {
    gdHeld = false;
  });

  document.addEventListener("keydown", (event) => {
    if (isTyping(event)) return;
    if (event.key !== " " && event.key !== "ArrowUp" && event.key !== "w") return;
    if (openPanel !== "games") return;
    if (gdStatus === "idle") return;
    event.preventDefault();
    gdHeld = true;
    if (gdStatus === "playing") gdJump();
    else gdNewGame();
  });

  document.addEventListener("keyup", (event) => {
    if (event.key === " " || event.key === "ArrowUp" || event.key === "w") {
      gdHeld = false;
    }
  });
}

/* ---- Is the level actually possible, and is it fair? ----

   A hand-placed level very easily contains a jump nobody can make, and
   playtesting does not reliably find it - you assume you are just bad at it.

   Obstacles have to be considered in *clusters*, not one at a time. Three
   spikes in a row are a single 98px hazard, and an arc that clears the first
   one lands on the third. So this groups anything close enough to be jumped
   together, then works out the window of take-off positions that clears the
   whole group:

     earliest take-off = end of cluster - jump length   (any earlier and the
                                                         cube lands on it)
     latest take-off   = start of cluster               (any later and the
                                                         cube runs into it)

   A window narrower than about 25px is roughly five frames of input at this
   speed - technically possible, miserable in practice, and worth failing on.
*/
export function gdClusters() {
  const groups = [];
  for (const ob of GD_LEVEL) {
    const last = groups[groups.length - 1];
    // Close enough that one jump has to clear both.
    if (last && ob.x - last.end < GD_SIZE * 1.6) {
      last.end = ob.x + GD_SIZE;
      last.items.push(ob);
    } else {
      groups.push({ start: ob.x, end: ob.x + GD_SIZE, items: [ob] });
    }
  }
  return groups.map((g) => {
    const earliest = g.end - GD_JUMP_LEN;
    const latest = g.start;
    return {
      at: Math.round(g.start),
      percent: Math.round((g.start / GD_END) * 100),
      count: g.items.length,
      kind: g.items[0].type,
      spanPx: Math.round(g.end - g.start),
      windowPx: Math.round(latest - earliest),
    };
  });
}

export function gdVerifyLevel() {
  const saveStatus = gdStatus;
  const saveX = gdWorldX;
  const saveCube = Object.assign({}, gdCube);
  const saveHeld = gdHeld;

  gdWorldX = 0;
  gdCube = { y: GD_GROUND, vy: 0, grounded: true, rot: 0 };
  gdHeld = false;
  gdStatus = "playing";
  gdLast = 0;

  let frames = 0;
  const limit = (GD_END / GD_SPEED) * 3;
  let died = null;

  const clusters = gdClusters();

  while (gdStatus === "playing" && frames < limit) {
    /* Aim at the whole cluster, not its first spike, and take off in the
       middle of the safe window rather than at its edge. */
    const group = clusters.find((c) => c.at + c.spanPx > gdWorldX + GD_SIZE * 0.4);
    if (group && gdCube.grounded) {
      const earliest = group.at + group.spanPx - GD_JUMP_LEN;
      const latest = group.at;
      const aim = (earliest + latest) / 2;
      if (gdWorldX >= aim - GD_SPEED && gdWorldX <= latest) gdJump();
    }
    gdStep(gdLast + 1000 / 60);
    if (gdStatus === "dead") died = Math.floor((gdWorldX / GD_END) * 100);
    frames += 1;
  }

  const tight = clusters.filter((c) => c.windowPx < 25);

  const result = {
    completed: gdStatus === "won",
    diedAtPercent: died,
    frames,
    seconds: Math.round((frames / 60) * 10) / 10,
    jumpLength: Math.round(GD_JUMP_LEN),
    jumpHeight: Math.round(GD_JUMP_HEIGHT),
    obstacles: GD_LEVEL.length,
    clusters: clusters.length,
    tightestWindowPx: Math.min(...clusters.map((c) => c.windowPx)),
    unfairClusters: tight,
  };

  gdStop();
  gdStatus = saveStatus;
  gdWorldX = saveX;
  gdCube = saveCube;
  gdHeld = saveHeld;
  return result;
}
