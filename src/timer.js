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

export function formatTime(ms) {
  const total = Math.round(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n) => String(n).padStart(2, "0");

  // An hour or more reads as 1:05:30 rather than 65:30.
  if (hours > 0) return hours + ":" + pad(minutes) + ":" + pad(seconds);
  return minutes + ":" + pad(seconds);
}

/* The minutes and seconds are separate elements so the colon between them
   can be two drawn squares rather than a font glyph. */
let timerSegments = [];

function setTimerText(text) {
  const parts = text.split(":");

  // Rebuilt only when the shape changes - crossing an hour adds a segment
  // and a colon. Rebuilding every tick would throw away the DOM 4x a second.
  if (timerSegments.length !== parts.length) {
    timerEl.innerHTML = "";
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
  }

  parts.forEach((part, i) => {
    if (timerSegments[i].textContent !== part) timerSegments[i].textContent = part;
  });
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

export function render() {
  // render() runs four times a second while the timer runs, so every write is
  // guarded - assigning an unchanged value still costs the browser work.
  const text = formatTime(displayMs());
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

  const title = isRunning ? text + " · " + APP_NAME : APP_NAME;
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
  ticker = setInterval(tick, 250);
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
