import { bookChime, cancelChime, chimeHasBegun, notifyDone, syncAlarm } from "./alerts.js";
import { syncSettingInputs, updateConditionalFields } from "./settings.js";

/* ==========================================================================
   Timer

   Three modes share one clock:
     countdown  - count down to zero from a set length
     stopwatch  - count up from zero, no target
     pomodoro   - focus/break cycle with rounds

   Everything is derived from elapsed milliseconds rather than counted down,
   so pausing, resuming and background-tab throttling cannot make it drift.
   ========================================================================== */

export const APP_NAME = "LockedIn";
export const MINUTE = 60000;

export const timerEl = document.getElementById("timer");
const timerEditEl = document.getElementById("timer-edit");
const timerStatusEl = document.getElementById("timer-status");
const startBtn = document.getElementById("start-btn");
const resetBtn = document.getElementById("reset-btn");

export const settings = {
  mode: "countdown",
  focusMinutes: 60,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  roundsBeforeLongBreak: 4,
  chime: true,
  notify: false,
};

export let isRunning = false;
let runStartedAt = null; // Date.now() when the current run began
let bankedMs = 0; // time from earlier runs, preserved across pauses
let ticker = null;

let phase = "focus"; // pomodoro only: "focus" | "short" | "long"
let round = 1;
let announcement = ""; // shown after a session ends, cleared on start/reset
let editing = false;

/* An imported binding is read-only, so a module that needs to change another
   module's state asks the owner to do it. That is not a workaround for the
   module system - it is the module system pointing out that shared mutable
   state should have exactly one place that writes it. */
export function clearBanked() {
  bankedMs = 0;
}

export function elapsedMs() {
  return bankedMs + (isRunning ? Date.now() - runStartedAt : 0);
}

// null means "no target", which is what makes the stopwatch a stopwatch.
export function targetMs() {
  if (settings.mode === "stopwatch") return null;
  if (settings.mode === "countdown") return settings.focusMinutes * MINUTE;
  if (phase === "focus") return settings.focusMinutes * MINUTE;
  if (phase === "short") return settings.shortBreakMinutes * MINUTE;
  return settings.longBreakMinutes * MINUTE;
}

export function displayMs() {
  const target = targetMs();
  return target === null ? elapsedMs() : Math.max(0, target - elapsedMs());
}

/* `fine` adds hundredths, which is what the stopwatch wants and what a
   countdown very much does not - watching a deadline race away in
   hundredths is the opposite of calming.

   Note the floor rather than the round. Whole seconds round to the nearest,
   so 1.6s reads as 2 and the display matches what you would say out loud.
   With hundredths on show that would be a bug: 1.999s would render as
   "0:02.99", a second ahead of its own fraction. */
export function formatTime(ms, fine) {
  const total = fine ? Math.floor(ms / 1000) : Math.round(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n) => String(n).padStart(2, "0");

  // An hour or more reads as 1:05:30 rather than 65:30.
  const clock =
    hours > 0
      ? hours + ":" + pad(minutes) + ":" + pad(seconds)
      : minutes + ":" + pad(seconds);

  if (!fine) return clock;
  return clock + "." + pad(Math.floor((ms % 1000) / 10));
}

/* The minutes and seconds are separate elements so the colon between them
   can be two drawn squares rather than a font glyph. */
let timerSegments = [];

let timerFractionEl = null;

function setTimerText(text) {
  const dot = text.indexOf(".");
  const fraction = dot === -1 ? null : text.slice(dot + 1);
  const parts = (dot === -1 ? text : text.slice(0, dot)).split(":");

  /* Rebuilt only when the shape changes - crossing an hour adds a segment
     and a colon, and switching to or from the stopwatch adds or removes the
     fraction. Rebuilding every tick would throw away the DOM thirty times a
     second in stopwatch mode. */
  const wantsFraction = fraction !== null;
  if (timerSegments.length !== parts.length || wantsFraction !== !!timerFractionEl) {
    timerEl.innerHTML = "";
    timerFractionEl = null;
    timerSegments = parts.map((_, i) => {
      if (i > 0) {
        const colon = document.createElement("span");
        colon.className = "timer-colon";
        colon.setAttribute("aria-hidden", "true");
        timerEl.append(colon);
      }
      const segment = document.createElement("span");
      timerEl.append(segment);
      return segment;
    });
    if (wantsFraction) {
      /* Its own element, at a smaller size. At the timer's full size the
         hundredths would be the largest thing on the page and the least
         worth reading. */
      timerFractionEl = document.createElement("span");
      timerFractionEl.className = "timer-fraction";
      timerEl.append(timerFractionEl);
    }
  }

  parts.forEach((part, i) => {
    if (timerSegments[i].textContent !== part) timerSegments[i].textContent = part;
  });
  if (timerFractionEl && timerFractionEl.textContent !== "." + fraction) {
    timerFractionEl.textContent = "." + fraction;
  }
}

export function statusText() {
  if (announcement) return announcement;
  if (settings.mode === "pomodoro") {
    if (phase === "focus") return "Focus · Round " + round;
    return phase === "short" ? "Short break" : "Long break";
  }
  if (settings.mode === "stopwatch") return "Stopwatch";
  return "";
}

function canEditDuration() {
  return !isRunning && settings.mode !== "stopwatch";
}

/* Anything that needs redrawing whenever the timer redraws registers here.
   The mini player uses it, and it keeps render() from having to know what
   else exists. */
export const renderHooks = [];

/* The stopwatch shows hundredths, so it has to redraw far more often than a
   countdown that only changes once a second. Nothing drifts either way - the
   time is derived from a wall-clock stamp, not accumulated - so this only
   decides how often the screen catches up. */
const TICK_MS = 250;
const TICK_MS_FINE = 33;

export function showsFraction() {
  return settings.mode === "stopwatch";
}

export function render() {
  /* Guarded writes throughout: render() runs four times a second on a
     countdown and thirty on the stopwatch, and assigning an unchanged value
     still costs the browser work. */
  const text = formatTime(displayMs(), showsFraction());
  if (!editing) setTimerText(text);

  const label = isRunning ? "Pause" : "Start";
  if (startBtn.textContent !== label) startBtn.textContent = label;

  // Hidden rather than filled with a space: an empty status line still
  // reserved a full line of height, pushing the prompt away from the timer
  // even though nothing was visible there.
  const status = statusText();
  if (timerStatusEl.textContent !== status) timerStatusEl.textContent = status;
  timerStatusEl.hidden = status === "";

  const editable = canEditDuration();
  timerEl.classList.toggle("is-editable", editable);
  const tip = editable ? "Click to change the length" : "";
  if (timerEl.title !== tip) timerEl.title = tip;

  /* Whole seconds in the tab title even on the stopwatch. Hundredths there
     would rewrite it thirty times a second for a strip of text too small and
     too brief to read. */
  const coarse = showsFraction() ? formatTime(displayMs()) : text;
  const title = isRunning ? coarse + " · " + APP_NAME : APP_NAME;
  if (document.title !== title) document.title = title;

  renderHooks.forEach((hook) => hook());
}

function advancePhase() {
  if (phase === "focus") {
    phase = round % settings.roundsBeforeLongBreak === 0 ? "long" : "short";
  } else {
    phase = "focus";
    round += 1;
  }
}

/* Where a session that began `elapsed` ago has got to.

   This walks the same cycle advancePhase() produces, one phase at a time,
   rather than deriving it with arithmetic. Slower and completely uninteresting
   - and that is the point: the two must never disagree. A shared session link
   that put one person on their long break while everyone else was still in
   round three would defeat the only thing it exists to do. Walking the real
   rule means there is no second rule to drift from. */
export function phaseAt(elapsed) {
  if (settings.mode !== "pomodoro") {
    return { phase: "focus", round: 1, offset: elapsed };
  }

  let left = elapsed;
  let at = "focus";
  let n = 1;

  // A guard, not a limit: at one minute a phase this covers over three days.
  for (let guard = 0; guard < 20000; guard++) {
    const length =
      at === "focus"
        ? settings.focusMinutes * MINUTE
        : at === "short"
        ? settings.shortBreakMinutes * MINUTE
        : settings.longBreakMinutes * MINUTE;

    if (left < length) return { phase: at, round: n, offset: left };
    left -= length;

    if (at === "focus") {
      at = n % settings.roundsBeforeLongBreak === 0 ? "long" : "short";
    } else {
      at = "focus";
      n += 1;
    }
  }
  return { phase: "focus", round: 1, offset: 0 };
}

/* Drop into a session already in progress. start() does the rest: it leaves
   bankedMs alone, so setting it here is what makes the timer resume partway
   through rather than from zero. */
export function joinSessionAt(elapsed) {
  const at = phaseAt(elapsed);
  phase = at.phase;
  round = at.round;
  bankedMs = at.offset;
  start();
}

function tick() {
  const target = targetMs();
  if (target !== null && elapsedMs() >= target) {
    complete();
    return;
  }
  render();
}

export function start() {
  if (isRunning) return;
  announcement = "";
  timerEl.classList.remove("is-done");
  isRunning = true;
  runStartedAt = Date.now();
  ticker = setInterval(tick, showsFraction() ? TICK_MS_FINE : TICK_MS);
  syncAlarm();
  render();
}

export function stop() {
  if (isRunning) {
    bankedMs += Date.now() - runStartedAt;
    isRunning = false;
  }
  clearInterval(ticker);
  ticker = null;
  cancelChime();
  render();
}

function complete() {
  // Read before stop(), which clears the booking.
  const chimed = chimeHasBegun();

  stop();
  bankedMs = 0;

  let body;
  if (settings.mode === "pomodoro") {
    advancePhase();
    announcement = phase === "focus" ? "Back to work" : "Break time";
    if (phase === "focus") {
      body = "Break over. Round " + round + " starts when you do.";
    } else {
      const minutes =
        phase === "short" ? settings.shortBreakMinutes : settings.longBreakMinutes;
      body = "Focus round done. Take " + minutes + " minutes.";
    }
  } else {
    announcement = "Time is up";
    body = "Your " + settings.focusMinutes + "-minute session is done.";
  }

  /* Normally the booked chime is sounding as this runs. It will not have
     started if the machine slept through the end of the session - the audio
     clock sleeps too - so in that case play it now instead. */
  if (settings.chime && !chimed) bookChime(0);
  notifyDone(body);

  timerEl.classList.add("is-done");
  render();
}

export function resetTimer() {
  stop();
  bankedMs = 0;
  announcement = "";
  timerEl.classList.remove("is-done");
  if (settings.mode === "pomodoro") {
    phase = "focus";
    round = 1;
  }
  render();
}

export function setTimerMode(mode) {
  settings.mode = mode;
  phase = "focus";
  round = 1;
  resetTimer();
  updateConditionalFields();
}

/* ---- Click the big number to change the length ---- */

function editableField() {
  if (settings.mode === "countdown" || phase === "focus") return "focusMinutes";
  return phase === "short" ? "shortBreakMinutes" : "longBreakMinutes";
}

function beginEdit() {
  if (!canEditDuration() || editing) return;
  editing = true;
  timerEditEl.value = settings[editableField()];
  timerEl.hidden = true;
  timerEditEl.hidden = false;
  timerEditEl.focus();
  timerEditEl.select();
}

function endEdit(save) {
  if (!editing) return;
  editing = false;

  if (save) {
    const value = Math.round(Number(timerEditEl.value));
    if (Number.isFinite(value) && value >= 1 && value <= 600) {
      settings[editableField()] = value;
      syncSettingInputs();
      bankedMs = 0;
    }
  }

  timerEditEl.hidden = true;
  timerEl.hidden = false;
  render();
}

timerEl.addEventListener("click", beginEdit);
timerEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    beginEdit();
  }
});

timerEditEl.addEventListener("blur", () => endEdit(true));
timerEditEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter") endEdit(true);
  if (event.key === "Escape") endEdit(false);
});

startBtn.addEventListener("click", () => (isRunning ? stop() : start()));
resetBtn.addEventListener("click", resetTimer);
