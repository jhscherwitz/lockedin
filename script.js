/* ==========================================================================
   Clock
   ========================================================================== */

const clockEl = document.getElementById("clock");
const greetingEl = document.getElementById("greeting");

function greetingFor(hour) {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function updateClock() {
  const now = new Date();
  const hours24 = now.getHours();
  const hours12 = hours24 % 12 || 12;
  const minutes = String(now.getMinutes()).padStart(2, "0");

  clockEl.textContent = `${hours12}:${minutes}`;
  greetingEl.textContent = greetingFor(hours24);
}

updateClock();
setInterval(updateClock, 1000);

/* ==========================================================================
   Timer
   ========================================================================== */

const timerEl = document.getElementById("timer");
const startBtn = document.getElementById("start-btn");
const resetBtn = document.getElementById("reset-btn");
const modeButtons = document.querySelectorAll(".mode-btn");

// How long each mode runs, in seconds.
const DURATIONS = {
  focus: 25 * 60,
  short: 5 * 60,
  long: 15 * 60,
};

/* ---- State ----------------------------------------------------------------
   These four variables are the entire memory of the timer. Everything on
   screen is drawn from them, and nothing on screen is ever the source of
   truth. Change state, then call render().
   -------------------------------------------------------------------------- */

let mode = "focus";
let remaining = DURATIONS[mode]; // seconds left
let isRunning = false;
let endTime = null; // real-world timestamp when we should reach zero
let ticker = null; // id of the repeating timer, so we can cancel it

function formatTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

// The single place that writes to the page.
function render() {
  timerEl.textContent = formatTime(remaining);
  startBtn.textContent = isRunning ? "Pause" : "Start";

  modeButtons.forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.mode === mode);
  });

  document.title = isRunning ? `${formatTime(remaining)} · Focus` : "Focus";
}

function tick() {
  // Recomputed from the real clock every time rather than counting down by
  // one. Browsers throttle background tabs hard, so a naive counter loses
  // minutes while you're reading something in another tab. This can't.
  remaining = Math.max(0, Math.round((endTime - Date.now()) / 1000));

  if (remaining === 0) {
    stop();
    complete();
    return;
  }

  render();
}

function start() {
  if (isRunning) return;

  // Starting from a finished timer should begin a fresh session.
  if (remaining === 0) remaining = DURATIONS[mode];

  isRunning = true;
  endTime = Date.now() + remaining * 1000;
  timerEl.classList.remove("is-done");

  // Four times a second, so the display never looks a beat behind.
  ticker = setInterval(tick, 250);
  render();
}

function stop() {
  isRunning = false;
  clearInterval(ticker);
  ticker = null;
  render();
}

function reset() {
  stop();
  remaining = DURATIONS[mode];
  timerEl.classList.remove("is-done");
  render();
}

function setMode(newMode) {
  mode = newMode;
  reset();
}

function complete() {
  document.title = "Time's up!";
  timerEl.classList.add("is-done");
}

/* ---- Wiring ---- */

startBtn.addEventListener("click", () => {
  if (isRunning) stop();
  else start();
});

resetBtn.addEventListener("click", reset);

modeButtons.forEach((btn) => {
  btn.addEventListener("click", () => setMode(btn.dataset.mode));
});

render();
