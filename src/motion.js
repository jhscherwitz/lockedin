/* ==========================================================================
   Motion

   Anime.js drives everything here. The library is vendored in
   src/vendor/anime.esm.js rather than installed, because there is still no
   package manager and no build step.

   The rule this file follows, and it is what keeps a focus timer from
   turning into a screensaver: motion happens when something *changes*. A
   digit ticks over, a panel opens, a session starts, a session ends. There
   is exactly one thing on this page that moves without being touched, and
   it is the progress line, because a session actually is progressing.

   The background is still painted once and cached. Nothing here touches it,
   and nothing here animates anything but transform and opacity, which is
   the reason this can run at all next to six blurred masses. The animated
   background that got removed re-blurred about two million pixels a frame;
   these move already-rasterised layers instead.
   ========================================================================== */

import { animate, createTimeline, stagger, eases } from "./vendor/anime.esm.js";
import { renderHooks, timerEl, isRunning, elapsedMs, targetMs } from "./timer.js";

const root = document.documentElement;

/* One switch for the whole file. Checked at startup and again if the user
   changes the setting, because someone turning motion off wants it off now,
   not on next load. */
const reduceQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
let reduce = reduceQuery.matches;

const progressEl = document.getElementById("timer-progress");
const progressFill = document.getElementById("timer-progress-fill");

/* --------------------------------------------------------------------------
   Entrance

   The only piece of choreography on the page. It runs once and then never
   again. The order is deliberate: the timer is the reason the page exists,
   so it arrives first and everything else assembles around it.
   -------------------------------------------------------------------------- */

function entrance() {
  const digits = timerEl.querySelectorAll("span:not(.timer-colon)");
  const colons = timerEl.querySelectorAll(".timer-colon");

  const tl = createTimeline({ defaults: { ease: "out(3)" } });

  tl.add(
    digits,
    { opacity: [0, 1], y: [18, 0], duration: 620, delay: stagger(55) },
    0
  )
    /* The colons follow the digits they separate, and only fade. A colon
       that slides looks like it is falling off the clock. */
    .add(colons, { opacity: [0, 1], duration: 400, delay: stagger(55) }, 180)
    .add("#timer-status", { opacity: [0, 1], y: [8, 0], duration: 420 }, 260)
    .add("#focus-prompt", { opacity: [0, 1], y: [10, 0], duration: 460 }, 300)
    .add(
      ".controls > *",
      { opacity: [0, 1], y: [12, 0], duration: 460, delay: stagger(70) },
      380
    )
    .add("#wordmark", { opacity: [0, 1], x: [-14, 0], duration: 520 }, 460)
    .add("#now", { opacity: [0, 1], x: [14, 0], duration: 520 }, 460)
    /* Each dock arrives from its own edge. That is the only thing telling
       you they are two groups rather than one row split by a gap. */
    .add(
      ".dock-left .dock-btn",
      {
        opacity: [0, 1],
        x: [-16, 0],
        scale: [0.85, 1],
        duration: 520,
        delay: stagger(60),
      },
      520
    )
    .add(
      ".dock-right .dock-btn",
      {
        opacity: [0, 1],
        x: [16, 0],
        scale: [0.85, 1],
        duration: 520,
        delay: stagger(60, { from: "last" }),
      },
      520
    );

  return tl;
}

/* --------------------------------------------------------------------------
   Digits

   render() runs four times a second, so this cannot animate on every call.
   It animates only the segments whose text actually changed, which in
   countdown is one segment most seconds. That is the point: the seconds
   tick and the minutes sit still until they do not.
   -------------------------------------------------------------------------- */

const lastText = new WeakMap();

function digitsChanged() {
  if (reduce) return;
  timerEl.querySelectorAll("span:not(.timer-colon)").forEach((segment) => {
    const text = segment.textContent;
    const previous = lastText.get(segment);
    lastText.set(segment, text);
    if (previous === undefined || previous === text) return;

    animate(segment, {
      y: [
        { to: -7, duration: 90, ease: "in(2)" },
        { to: 0, duration: 330, ease: eases.outBack(2.2) },
      ],
      opacity: [
        { to: 0.55, duration: 90 },
        { to: 1, duration: 240 },
      ],
    });
  });
}

/* --------------------------------------------------------------------------
   Progress

   The one thing here that moves on its own, and it is not decoration: it is
   how much of the session has gone. Hidden in stopwatch mode, where there
   is no target for it to be a fraction of.
   -------------------------------------------------------------------------- */

function progress() {
  const total = targetMs();
  if (!total || total <= 0) {
    if (!progressEl.hidden) progressEl.hidden = true;
    return;
  }
  if (progressEl.hidden) progressEl.hidden = false;

  const ratio = Math.min(1, Math.max(0, elapsedMs() / total));
  /* Written straight rather than handed to the library. render() already
     runs 4x a second, so this is its own tween; animating each step would
     stack four animations a second on one element for no visible gain. */
  progressFill.style.transform = "scaleX(" + ratio.toFixed(4) + ")";
  progressEl.classList.toggle("is-running", isRunning);
}

/* --------------------------------------------------------------------------
   Panels

   panels.js owns the is-open class and does not need to know this file
   exists, so this watches for the class rather than asking to be called.
   -------------------------------------------------------------------------- */

function watchPanels() {
  document.querySelectorAll(".panel").forEach((panel) => {
    const observer = new MutationObserver(() => {
      if (reduce || !panel.classList.contains("is-open")) return;
      const rows = panel.querySelectorAll(
        ".panel-body > *, .games-menu .game-card, .sound-row, .task"
      );
      if (!rows.length) return;
      animate(rows, {
        opacity: [0, 1],
        y: [10, 0],
        duration: 420,
        delay: stagger(28),
        ease: "out(3)",
      });
    });
    observer.observe(panel, { attributes: true, attributeFilter: ["class"] });
  });
}

/* --------------------------------------------------------------------------
   Tab strips

   The segmented control in Settings slides its thumb between segments. The
   tab strip directly above it moved its underline by swapping a
   border-bottom colour, so one control glided and the one touching it
   jumped. Same panel, two different ideas about how a selection moves.

   This gives every tab strip a real underline element and moves it, so the
   two now agree. The border-bottom on .tab.is-active is switched off in CSS.
   -------------------------------------------------------------------------- */

function tabIndicators() {
  document.querySelectorAll(".tabs").forEach((strip) => {
    const bar = document.createElement("span");
    bar.className = "tab-underline";
    strip.append(bar);

    const place = (animated) => {
      const active = strip.querySelector(".tab.is-active");
      if (!active) {
        bar.style.opacity = "0";
        return;
      }
      bar.style.opacity = "1";
      const left = active.offsetLeft;
      const width = active.offsetWidth;
      if (!animated || reduce) {
        bar.style.transform = "translateX(" + left + "px)";
        bar.style.width = width + "px";
        return;
      }
      animate(bar, {
        /* translateX rather than left, so this stays on the compositor. */
        x: left,
        width: width,
        duration: 380,
        ease: "out(4)",
      });
    };

    place(false);

    const observer = new MutationObserver(() => place(true));
    strip.querySelectorAll(".tab").forEach((tab) => {
      observer.observe(tab, { attributes: true, attributeFilter: ["class"] });
    });

    /* A hidden panel measures as zero, so the strip has to be re-measured
       when its panel opens rather than only when a tab is clicked. */
    const panel = strip.closest(".panel");
    if (panel) {
      new MutationObserver(() => {
        if (panel.classList.contains("is-open")) place(false);
      }).observe(panel, { attributes: true, attributeFilter: ["class"] });
    }
  });
}

/* --------------------------------------------------------------------------
   Toast

   It appeared and disappeared instantly, which for a strip that exists to
   tell you something went wrong is the one moment you want the eye caught.
   toast.js owns the hidden attribute; this only watches it.
   -------------------------------------------------------------------------- */

function toastMotion() {
  const toast = document.getElementById("toast");
  if (!toast) return;

  new MutationObserver(() => {
    if (reduce || toast.hidden) return;
    animate(toast, {
      opacity: [0, 1],
      y: [14, 0],
      duration: 460,
      ease: eases.outBack(1.6),
    });
  }).observe(toast, { attributes: true, attributeFilter: ["hidden"] });
}

/* --------------------------------------------------------------------------
   Starting, stopping, and finishing
   -------------------------------------------------------------------------- */

let wasRunning = null;
let wasDone = false;

function stateChanged() {
  if (reduce) return;

  if (wasRunning !== null && isRunning !== wasRunning) {
    /* A short settle on the timer block. Starting a session should feel
       like a switch being thrown rather than like nothing happened. */
    animate(".timer-wrap", {
      scale: [
        { to: isRunning ? 1.015 : 0.99, duration: 140, ease: "out(2)" },
        { to: 1, duration: 420, ease: eases.outElastic(1, 0.6) },
      ],
    });
  }
  wasRunning = isRunning;

  const done = timerEl.classList.contains("is-done");
  if (done && !wasDone) {
    animate(timerEl, {
      scale: [
        { to: 1.05, duration: 220, ease: "out(3)" },
        { to: 1, duration: 700, ease: eases.outElastic(1, 0.45) },
      ],
    });
  }
  wasDone = done;
}

/* --------------------------------------------------------------------------
   Wiring
   -------------------------------------------------------------------------- */

export function initMotion() {
  /* Seed the digit cache before anything animates, so the first render does
     not animate five segments that were never going to change. */
  timerEl.querySelectorAll("span:not(.timer-colon)").forEach((segment) => {
    lastText.set(segment, segment.textContent);
  });

  progress();
  watchPanels();
  tabIndicators();
  toastMotion();

  renderHooks.push(() => {
    digitsChanged();
    progress();
    stateChanged();
  });

  if (!reduce) {
    root.classList.add("is-entering");
    const done = () => root.classList.remove("is-entering");
    const tl = entrance();
    if (tl && typeof tl.then === "function") tl.then(done);
    /* Failsafe. If the timeline never resolves - a tab backgrounded at load,
       a library that failed to parse - the page must not stay half
       invisible. This is the one guarantee that matters here. */
    setTimeout(done, 3000);
  }

  reduceQuery.addEventListener("change", (event) => {
    reduce = event.matches;
    if (reduce) root.classList.remove("is-entering");
  });
}
