import { playWinSound } from "../alerts.js";
import { isTyping } from "../keys.js";
import { openPanel } from "../panels.js";

/* ==========================================================================
   Geometry Dash

   A one-button precision platformer. One input - hold - and it means two
   different things depending on which mode a portal last put you in.

     cube   tap to jump. Only from the ground, and holding re-jumps the
            instant you land, exactly as the original does.
     ship   hold to thrust upward, release to fall. No jumping, no landing;
            the floor and ceiling just stop you.

   Two things separate this from Dino Run, and both are deliberate:

   The level is *designed*, not generated. That is the whole genre - the
   pleasure is learning a fixed sequence rather than reacting to a random
   one, which is why there is a progress bar and an attempt counter instead
   of a score. GD_LEVEL is hand-placed, and gdVerifyLevel() flies a simulated
   player through it rather than trusting that it is possible.

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
const GD_GROUND = 248; // y of the floor
const GD_CEILING = 44; // only reachable, and only drawn, in ship mode
const GD_SIZE = 26;
const GD_X = 96; // the player never moves horizontally

const GD_SPEED = 5.2; // px per 60fps frame

/* ---- Cube ---- */
const GD_GRAVITY = 0.62;
const GD_JUMP = -9.6;
const GD_PAD = -14.4; // a pad launches half again as high as a jump

/* Airtime is 2 * |JUMP| / GRAVITY frames, so a jump covers this much ground
   and reaches this high. Quoting them here is what stops the level drifting
   away from what the cube can actually do. */
const GD_AIR_FRAMES = (2 * Math.abs(GD_JUMP)) / GD_GRAVITY; // ~31
const GD_JUMP_LEN = GD_AIR_FRAMES * GD_SPEED; // ~161px
const GD_JUMP_HEIGHT = (GD_JUMP * GD_JUMP) / (2 * GD_GRAVITY); // ~74px
const GD_PAD_LEN = ((2 * Math.abs(GD_PAD)) / GD_GRAVITY) * GD_SPEED; // ~242px

/* ---- Ship ----

   Thrust is very slightly stronger than gravity, so a held ship climbs at
   about the rate an unheld one falls. Symmetry is what makes a corridor
   readable: the same tap length means the same distance either way. */
const GD_SHIP_GRAVITY = 0.4;
const GD_SHIP_THRUST = -0.82; // net -0.42 while held
const GD_SHIP_VMAX = 6.2;

/* ==========================================================================
   The level

   Obstacles, in world pixels:

     spike   { x, y?, flip? }   kills on contact. y is the surface it sits
                                on; flip hangs it from the ceiling.
     block   { x, y, h, w? }    solid. In cube mode you land on the top and
                                die hitting the side; in ship mode any
                                contact kills, which is what makes a
                                corridor a corridor.
     portal  { x, mode }        switches to "cube" or "ship".
     pad     { x }              launches the cube on contact, higher than
                                a jump, whether or not you are holding.
   ========================================================================== */

// A corridor wall: solid from the ceiling down to gapTop, and from
// gapBottom to the floor. Written as a helper because hand-placing sixty
// paired blocks is how a level ends up with a gap nobody can fit through.
function corridor(x, gapTop, gapBottom, w = 30) {
  const out = [];
  if (gapTop > GD_CEILING) {
    out.push({ x, type: "block", y: GD_CEILING, h: gapTop - GD_CEILING, w });
  }
  if (gapBottom < GD_GROUND) {
    out.push({ x, type: "block", y: gapBottom, h: GD_GROUND - gapBottom, w });
  }
  return out;
}

const GROUND_BLOCK = GD_GROUND - GD_SIZE;

const GD_LEVEL = [
  /* ---- A. Cube, warm-up. Single spikes, generously spaced. ---- */
  { x: 900, type: "spike" },
  { x: 1250, type: "spike" },
  { x: 1600, type: "spike" },

  /* ---- B. Cube, doubles and a platform. ---- */
  { x: 1980, type: "spike" },
  { x: 2016, type: "spike" },
  { x: 2400, type: "block", y: GROUND_BLOCK, h: GD_SIZE },
  { x: 2760, type: "spike" },
  { x: 2796, type: "spike" },
  { x: 3160, type: "spike" },
  { x: 3196, type: "spike" },
  { x: 3232, type: "spike" },

  /* ---- C. Ship. Wide gaps first, then a step up and a step down. ---- */
  { x: 3620, type: "portal", mode: "ship" },
  ...corridor(3980, 120, 232),
  ...corridor(4280, 120, 232),
  ...corridor(4580, 96, 208),
  ...corridor(4880, 96, 208),
  ...corridor(5180, 140, 248),
  ...corridor(5480, 140, 248),
  { x: 5760, type: "spike", y: GD_CEILING + 26, flip: true },
  ...corridor(5900, 110, 222),
  { x: 6220, type: "portal", mode: "cube" },

  /* ---- D. Cube with pads. A pad clears a field no jump could. ---- */
  /* Pad placement is arithmetic, not taste. A launch covers GD_PAD_LEN from
     the moment of contact, so the pad has to sit close enough to the field
     that the arc clears the far end - the first draft put it 170px early and
     the cube landed in the middle of the spikes. */
  { x: 6690, type: "pad" },
  { x: 6760, type: "spike" },
  { x: 6796, type: "spike" },
  { x: 6832, type: "spike" },
  { x: 6868, type: "spike" },
  { x: 7240, type: "block", y: GROUND_BLOCK, h: GD_SIZE },
  { x: 7266, type: "block", y: GROUND_BLOCK, h: GD_SIZE },
  { x: 7750, type: "pad" },
  { x: 7790, type: "spike" },
  { x: 7826, type: "spike" },
  { x: 7862, type: "spike" },
  { x: 7898, type: "spike" },
  { x: 7934, type: "spike" },

  /* ---- E. Ship, tighter, with a spike in the gap. ---- */
  { x: 8320, type: "portal", mode: "ship" },
  ...corridor(8660, 130, 234),
  ...corridor(8940, 104, 208),
  { x: 9180, type: "spike", y: GD_CEILING + 30, flip: true },
  ...corridor(9320, 150, 248),
  ...corridor(9600, 118, 216),
  ...corridor(9880, 90, 190),
  { x: 10180, type: "portal", mode: "cube" },

  /* ---- F. Cube finale. ---- */
  { x: 10560, type: "spike" },
  { x: 10596, type: "spike" },
  { x: 10940, type: "spike" },
  { x: 11280, type: "block", y: GROUND_BLOCK, h: GD_SIZE },
  { x: 11620, type: "spike" },
  { x: 11656, type: "spike" },
  { x: 11692, type: "spike" },
].sort((a, b) => a.x - b.x);

const GD_END = 12400;

const gdCanvas = document.getElementById("gd-canvas");
const gdCtx = gdCanvas ? gdCanvas.getContext("2d") : null;
const gdProgressEl = document.getElementById("gd-progress");
const gdBestEl = document.getElementById("gd-best");
const gdAttemptEl = document.getElementById("gd-attempt");
const gdBarEl = document.getElementById("gd-bar");
const gdMessageEl = document.getElementById("gd-message");
const gdNewBtn = document.getElementById("gd-new");

let gdStatus = "idle"; // idle | playing | dead | won
let gdMode = "cube"; // cube | ship
let gdCube = { y: GD_GROUND, vy: 0, grounded: true, rot: 0 };
let gdWorldX = 0;
let gdAttempt = 0;
let gdBest = 0;
let gdHeld = false;
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

function gdWidth(ob) {
  return ob.w || GD_SIZE;
}

function gdNearby() {
  const left = gdWorldX - GD_SIZE * 3;
  const right = gdWorldX + GD_W;
  return GD_LEVEL.filter((ob) => ob.x + gdWidth(ob) > left && ob.x < right);
}

function gdScreenX(ob) {
  return GD_X + (ob.x - gdWorldX);
}

function gdJump() {
  if (gdStatus !== "playing" || gdMode !== "cube") return;
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

/* Do the two boxes overlap? The player's box is fixed horizontally, so only
   the obstacle's x moves. */
function gdHits(ob, x, top, bottom, inset) {
  const pad = inset || 0;
  const obLeft = x + pad;
  const obRight = x + gdWidth(ob) - pad;
  if (obRight <= GD_X || obLeft >= GD_X + GD_SIZE) return false;
  const obTop = ob.type === "block" ? ob.y : gdSpikeTop(ob);
  const obBottom = ob.type === "block" ? ob.y + ob.h : gdSpikeBottom(ob);
  return top < obBottom && bottom > obTop;
}

function gdSpikeTop(ob) {
  const base = ob.y === undefined ? GD_GROUND : ob.y;
  /* Spikes get a forgiving hitbox. The drawn triangle is 26 wide at the base
     and a point at the tip, so a full square would kill on near-misses that
     visibly cleared it - the tip counts, the corners do not. */
  return ob.flip ? base : base - GD_SIZE + 8;
}

function gdSpikeBottom(ob) {
  const base = ob.y === undefined ? GD_GROUND : ob.y;
  return ob.flip ? base + GD_SIZE - 8 : base;
}

function gdStep(now) {
  if (typeof now !== "number") now = gdLast + 1000 / 60;
  if (!gdLast) gdLast = now;
  const dt = Math.min(3, (now - gdLast) / (1000 / 60)) || 1;
  gdLast = now;

  if (gdStatus !== "playing") return;

  gdWorldX += GD_SPEED * dt;

  const previousY = gdCube.y;

  if (gdMode === "ship") {
    gdCube.vy += (gdHeld ? GD_SHIP_THRUST : GD_SHIP_GRAVITY) * dt;
    gdCube.vy = Math.max(-GD_SHIP_VMAX, Math.min(GD_SHIP_VMAX, gdCube.vy));
  } else {
    gdCube.vy += GD_GRAVITY * dt;
  }
  gdCube.y += gdCube.vy * dt;

  const wasFalling = gdCube.vy >= 0;
  let landed = false;
  let launched = false;
  gdCube.grounded = false;

  for (const ob of gdNearby()) {
    const x = gdScreenX(ob);

    if (ob.type === "portal") {
      if (x < GD_X + GD_SIZE && x + gdWidth(ob) > GD_X && gdMode !== ob.mode) {
        gdMode = ob.mode;
        /* Entering a ship keeps whatever vertical speed you arrived with;
           entering a cube drops it, or a portal taken while climbing would
           fling the cube off the top of the screen. */
        if (gdMode === "cube") gdCube.vy = Math.max(0, gdCube.vy);
        gdCube.rot = 0;
      }
      continue;
    }

    if (ob.type === "pad") {
      const top = GD_GROUND - 10;
      if (
        gdMode === "cube" &&
        x + gdWidth(ob) > GD_X &&
        x < GD_X + GD_SIZE &&
        gdCube.y >= top
      ) {
        gdCube.vy = GD_PAD;
        gdCube.grounded = false;
        /* Contact happens while the cube is still standing on the floor, so
           without this the ground clamp below sees y >= GD_GROUND, zeroes
           the velocity and cancels the launch in the same frame it started.
           The pad appeared to do nothing at all. */
        launched = true;
      }
      continue;
    }

    if (ob.type === "block") {
      /* In a ship, a block is simply a wall - there is no landing on things.
         That is what turns two blocks into a corridor. */
      if (gdMode === "ship") {
        if (gdHits(ob, x, gdCube.y - GD_SIZE, gdCube.y)) {
          gdDie();
          return;
        }
        continue;
      }
      /* Landing is checked before collision, and only while descending -
         otherwise clipping the underside would read as a landing and the
         cube would pop through the block. */
      if (
        wasFalling &&
        previousY <= ob.y + 2 &&
        gdCube.y >= ob.y &&
        x + gdWidth(ob) > GD_X &&
        x < GD_X + GD_SIZE
      ) {
        gdCube.y = ob.y;
        gdCube.vy = 0;
        landed = true;
        continue;
      }
      if (gdHits(ob, x, gdCube.y - GD_SIZE, gdCube.y)) {
        gdDie();
        return;
      }
      continue;
    }

    // Spike.
    if (gdHits(ob, x, gdCube.y - GD_SIZE, gdCube.y, 7)) {
      gdDie();
      return;
    }
  }

  if (gdMode === "ship") {
    // The floor and ceiling stop the ship rather than killing it.
    if (gdCube.y > GD_GROUND) {
      gdCube.y = GD_GROUND;
      gdCube.vy = 0;
    }
    if (gdCube.y - GD_SIZE < GD_CEILING) {
      gdCube.y = GD_CEILING + GD_SIZE;
      gdCube.vy = 0;
    }
    // Tilt with vertical speed. A ship that stayed level would read as a box.
    gdCube.rot = Math.max(-32, Math.min(32, gdCube.vy * 5));
  } else {
    if (!landed && !launched && gdCube.y >= GD_GROUND) {
      gdCube.y = GD_GROUND;
      gdCube.vy = 0;
      landed = true;
    }
    if (landed) {
      gdCube.grounded = true;
      // Snap to a right angle so the cube always rests square.
      gdCube.rot = Math.round(gdCube.rot / 90) * 90;
      if (gdHeld) gdJump();
    } else {
      // A quarter turn over the jump, which is what makes it read as GD.
      gdCube.rot += (90 / GD_AIR_FRAMES) * dt;
    }
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
   the context - the lesson the Dino runner taught by staying white on the
   pale themes. */
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

  gdCtx.strokeStyle = paint.line;
  gdCtx.lineWidth = 3;
  gdCtx.beginPath();
  gdCtx.moveTo(0, GD_GROUND + 2);
  gdCtx.lineTo(GD_W, GD_GROUND + 2);
  gdCtx.stroke();

  // The ceiling exists only in a ship, so it is only drawn there.
  if (gdMode === "ship") {
    gdCtx.beginPath();
    gdCtx.moveTo(0, GD_CEILING - 2);
    gdCtx.lineTo(GD_W, GD_CEILING - 2);
    gdCtx.stroke();
  }

  /* Floor markings that scroll with the world. Without them a constant speed
     over an empty floor reads as standing still. */
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

  for (const ob of gdNearby()) {
    const x = gdScreenX(ob);
    const w = gdWidth(ob);

    if (ob.type === "portal") {
      /* Drawn as a gate rather than filled, so it never reads as something
         you have to avoid. */
      gdCtx.strokeStyle = ob.mode === "ship" ? paint.accent : paint.ink;
      gdCtx.lineWidth = 4;
      gdCtx.beginPath();
      gdCtx.ellipse(x + w / 2, (GD_CEILING + GD_GROUND) / 2, w / 2, (GD_GROUND - GD_CEILING) / 2, 0, 0, Math.PI * 2);
      gdCtx.stroke();
      continue;
    }

    if (ob.type === "pad") {
      gdCtx.fillStyle = paint.ink;
      gdCtx.beginPath();
      gdCtx.roundRect(x, GD_GROUND - 8, w, 8, 3);
      gdCtx.fill();
      continue;
    }

    gdCtx.fillStyle = paint.accent;

    if (ob.type === "block") {
      gdCtx.beginPath();
      gdCtx.roundRect(x, ob.y, w, ob.h, 4);
      gdCtx.fill();
      continue;
    }

    // Spike, pointing away from whatever surface it sits on.
    const base = ob.y === undefined ? GD_GROUND : ob.y;
    gdCtx.beginPath();
    if (ob.flip) {
      gdCtx.moveTo(x, base);
      gdCtx.lineTo(x + GD_SIZE / 2, base + GD_SIZE);
      gdCtx.lineTo(x + GD_SIZE, base);
    } else {
      gdCtx.moveTo(x, base);
      gdCtx.lineTo(x + GD_SIZE / 2, base - GD_SIZE);
      gdCtx.lineTo(x + GD_SIZE, base);
    }
    gdCtx.closePath();
    gdCtx.fill();
  }

  const endX = GD_X + (GD_END - gdWorldX);
  if (endX < GD_W + 40) {
    gdCtx.strokeStyle = paint.ink;
    gdCtx.lineWidth = 4;
    gdCtx.setLineDash([10, 8]);
    gdCtx.beginPath();
    gdCtx.moveTo(endX, GD_CEILING);
    gdCtx.lineTo(endX, GD_GROUND);
    gdCtx.stroke();
    gdCtx.setLineDash([]);
  }

  // The player, drawn about its own centre so it can spin or tilt.
  gdCtx.save();
  gdCtx.translate(GD_X + GD_SIZE / 2, gdCube.y - GD_SIZE / 2);
  gdCtx.rotate((gdCube.rot * Math.PI) / 180);
  gdCtx.fillStyle = paint.ink;
  gdCtx.beginPath();
  if (gdMode === "ship") {
    // A blunt wedge: enough to say which way is forward.
    gdCtx.moveTo(-GD_SIZE / 2, -GD_SIZE / 2 + 4);
    gdCtx.lineTo(GD_SIZE / 2, 0);
    gdCtx.lineTo(-GD_SIZE / 2, GD_SIZE / 2 - 4);
    gdCtx.closePath();
  } else {
    gdCtx.roundRect(-GD_SIZE / 2, -GD_SIZE / 2, GD_SIZE, GD_SIZE, 5);
  }
  gdCtx.fill();
  if (gdMode === "cube") {
    // A face mark, so the rotation is visible rather than implied.
    gdCtx.fillStyle = paint.accent;
    gdCtx.beginPath();
    gdCtx.roundRect(-GD_SIZE / 2 + 6, -GD_SIZE / 2 + 6, GD_SIZE - 12, GD_SIZE - 12, 2);
    gdCtx.fill();
  }
  gdCtx.restore();
}

function gdNewGame() {
  gdStop();
  gdAttempt += 1;
  gdWorldX = 0;
  gdMode = "cube";
  gdCube = { y: GD_GROUND, vy: 0, grounded: true, rot: 0 };
  gdHeld = false;
  gdLast = 0;
  gdStatus = "playing";
  gdBest = gdReadBest();
  gdMessageEl.textContent = "Tap to jump · hold to fly";
  gdNewBtn.hidden = true;
  gdRenderStats();
  gdDraw();
  gdFrame = requestAnimationFrame(gdStep);
}

export function gdShow() {
  gdBest = gdReadBest();
  gdMode = "cube";
  gdRenderStats();
  gdDraw();
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

/* ==========================================================================
   Is the level possible, and is it fair?

   A hand-placed level very easily contains a section nobody can clear, and
   playtesting does not reliably find it, because you assume you are just bad
   at it. So this flies a simulated player through and reports where it dies.

   Cube sections are checked in *clusters*, not obstacle by obstacle. Three
   spikes in a row are a single 98px hazard, and an arc that clears the first
   lands on the third. The window of take-off positions that clears a whole
   cluster runs from (cluster end - jump length) to (cluster start); narrower
   than about 25px is roughly five frames of input, which is technically
   possible and miserable in practice.

   Ship sections cannot be checked that way - there is no discrete decision,
   just steering - so the autopilot aims for the middle of the next gap and
   the check is simply whether it survives.
   ========================================================================== */

export function gdClusters() {
  const groups = [];
  for (const ob of GD_LEVEL) {
    if (ob.type !== "spike" && ob.type !== "block") continue;
    if (ob.y !== undefined && ob.y !== GROUND_BLOCK && ob.type === "block") continue;
    if (ob.flip) continue;
    const last = groups[groups.length - 1];
    if (last && ob.x - last.end < GD_SIZE * 1.6) {
      last.end = ob.x + gdWidth(ob);
      last.items.push(ob);
    } else {
      groups.push({ start: ob.x, end: ob.x + gdWidth(ob), items: [ob] });
    }
  }
  return groups.map((g) => {
    /* A pad just before a cluster changes the arithmetic completely: it
       launches on contact, so there is no take-off window to hit, and the
       arc is half again as long. Without this the checker calls a
       pad-cleared field impossible - which it is, by jumping. */
    const pad = GD_LEVEL.find(
      (ob) => ob.type === "pad" && ob.x < g.start && ob.x > g.end - GD_PAD_LEN
    );
    return {
      at: Math.round(g.start),
      percent: Math.round((g.start / GD_END) * 100),
      count: g.items.length,
      spanPx: Math.round(g.end - g.start),
      viaPad: !!pad,
      /* Jumped: how wide the range of take-off points is.
         Padded: how far past the cluster the launch lands. Either way it is
         the slack, and either way under ~25px is not a challenge, it is a
         coin toss. */
      windowPx: pad
        ? Math.round(pad.x + GD_PAD_LEN - g.end)
        : Math.round(g.start - (g.end - GD_JUMP_LEN)),
    };
  });
}

/* Where is the ship supposed to be at a given point? The centre of the next
   corridor gap, or mid-height when there is no wall coming. */
function gdShipTarget(worldX) {
  const wall = GD_LEVEL.find(
    (ob) => ob.type === "block" && ob.h > GD_SIZE && ob.x + gdWidth(ob) > worldX
  );
  if (!wall) return (GD_CEILING + GD_GROUND) / 2;
  const pair = GD_LEVEL.filter(
    (ob) => ob.type === "block" && ob.h > GD_SIZE && Math.abs(ob.x - wall.x) < 4
  );
  const ceilingWall = pair.find((ob) => ob.y <= GD_CEILING + 1);
  const floorWall = pair.find((ob) => ob.y > GD_CEILING + 1);
  const top = ceilingWall ? ceilingWall.y + ceilingWall.h : GD_CEILING;
  const bottom = floorWall ? floorWall.y : GD_GROUND;
  return (top + bottom) / 2 + GD_SIZE / 2;
}

/* Park the level at a given point and draw it, without playing to get there.
   Exported for the same reason gdVerifyLevel is: a level-based game is hard
   to inspect when the only way to see 40% is to be good enough to reach it.
   Nothing in the game calls this. */
export function gdSeek(worldX, mode) {
  gdStop();
  gdStatus = "idle";
  gdWorldX = worldX;
  gdMode = mode || "cube";
  gdCube = {
    y: gdMode === "ship" ? (GD_CEILING + GD_GROUND) / 2 : GD_GROUND,
    vy: 0,
    grounded: gdMode === "cube",
    rot: 0,
  };
  gdRenderStats();
  gdDraw();
}

export function gdVerifyLevel() {
  const save = {
    status: gdStatus,
    mode: gdMode,
    x: gdWorldX,
    cube: Object.assign({}, gdCube),
    held: gdHeld,
    last: gdLast,
  };

  gdWorldX = 0;
  gdMode = "cube";
  gdCube = { y: GD_GROUND, vy: 0, grounded: true, rot: 0 };
  gdHeld = false;
  gdStatus = "playing";
  gdLast = 0;

  const clusters = gdClusters();
  const pads = GD_LEVEL.filter((ob) => ob.type === "pad");
  let frames = 0;
  const limit = (GD_END / GD_SPEED) * 3;
  let died = null;
  let diedInMode = null;

  while (gdStatus === "playing" && frames < limit) {
    if (gdMode === "ship") {
      /* Steer toward the middle of the gap ahead, but aim at where the ship
         will *be*, not where it is. Holding purely on "am I below the
         target" oscillates: at full speed it takes about fifteen frames to
         reverse, so a bang-bang autopilot overshoots by forty-odd pixels and
         flies into the wall it was aiming past. Looking twelve frames ahead
         is the same anticipation a player does without thinking. */
      gdHeld = gdCube.y + gdCube.vy * 12 > gdShipTarget(gdWorldX);
    } else {
      gdHeld = false;
      const group = clusters.find((c) => c.at + c.spanPx > gdWorldX + GD_SIZE * 0.4);
      const pad = pads.find((p) => p.x + GD_SIZE > gdWorldX);
      /* A pad launches on contact, so the run must not be airborne over it -
         which means not jumping into the stretch just before one. */
      const padSoon = pad && pad.x - gdWorldX < GD_JUMP_LEN * 0.9;
      if (group && gdCube.grounded && !padSoon) {
        const earliest = group.at + group.spanPx - GD_JUMP_LEN;
        const aim = (earliest + group.at) / 2;
        if (gdWorldX >= aim - GD_SPEED && gdWorldX <= group.at) gdJump();
      }
    }
    gdStep(gdLast + 1000 / 60);
    if (gdStatus === "dead") {
      died = Math.floor((gdWorldX / GD_END) * 100);
      diedInMode = gdMode;
    }
    frames += 1;
  }

  const tight = clusters.filter((c) => c.windowPx < 25);
  const result = {
    completed: gdStatus === "won",
    diedAtPercent: died,
    diedInMode,
    seconds: Math.round((frames / 60) * 10) / 10,
    jumpLength: Math.round(GD_JUMP_LEN),
    jumpHeight: Math.round(GD_JUMP_HEIGHT),
    padLength: Math.round(GD_PAD_LEN),
    obstacles: GD_LEVEL.length,
    cubeClusters: clusters.length,
    shipSections: GD_LEVEL.filter((o) => o.type === "portal" && o.mode === "ship").length,
    pads: pads.length,
    tightestWindowPx: clusters.length ? Math.min(...clusters.map((c) => c.windowPx)) : null,
    unfairClusters: tight,
  };

  gdStop();
  gdStatus = save.status;
  gdMode = save.mode;
  gdWorldX = save.x;
  gdCube = save.cube;
  gdHeld = save.held;
  gdLast = save.last;
  return result;
}
