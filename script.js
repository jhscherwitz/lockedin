/* ==========================================================================
   Clock

   Formatting goes through Intl.DateTimeFormat rather than Date's own
   getHours(). That is what makes 12/24-hour and timezone support possible
   without hand-writing conversion logic.
   ========================================================================== */

const clockEl = document.getElementById("clock");
const greetingEl = document.getElementById("greeting");

const clockSettings = {
  hour12: true,
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
};

function greetingFor(hour) {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

// The hour, 0-23, in whichever timezone is selected.
function hourInZone(date) {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone: clockSettings.timeZone,
    }).format(date)
  );
}

function updateClock() {
  const now = new Date();

  const options = {
    hour: "numeric",
    minute: "2-digit",
    timeZone: clockSettings.timeZone,
  };
  if (clockSettings.hour12) options.hour12 = true;
  else options.hourCycle = "h23";

  // formatToParts hands back the pieces separately, which lets us drop the
  // AM/PM label and keep the display clean.
  const parts = new Intl.DateTimeFormat("en-US", options).formatToParts(now);
  const pick = (type) => {
    const part = parts.find((p) => p.type === type);
    return part ? part.value : "";
  };

  clockEl.textContent = pick("hour") + ":" + pick("minute");
  greetingEl.textContent = greetingFor(hourInZone(now));
}

updateClock();
setInterval(updateClock, 1000);

/* ==========================================================================
   Timer

   Three modes share one clock:
     countdown  - count down to zero from a set length
     stopwatch  - count up from zero, no target
     pomodoro   - focus/break cycle with rounds

   Everything is derived from elapsed milliseconds rather than counted down,
   so pausing, resuming and background-tab throttling cannot make it drift.
   ========================================================================== */

const APP_NAME = "Focus";
const MINUTE = 60000;

const timerEl = document.getElementById("timer");
const timerEditEl = document.getElementById("timer-edit");
const timerStatusEl = document.getElementById("timer-status");
const startBtn = document.getElementById("start-btn");
const resetBtn = document.getElementById("reset-btn");

const settings = {
  mode: "countdown",
  focusMinutes: 30,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  roundsBeforeLongBreak: 4,
};

let isRunning = false;
let runStartedAt = null; // Date.now() when the current run began
let bankedMs = 0; // time from earlier runs, preserved across pauses
let ticker = null;

let phase = "focus"; // pomodoro only: "focus" | "short" | "long"
let round = 1;
let announcement = ""; // shown after a session ends, cleared on start/reset
let editing = false;

function elapsedMs() {
  return bankedMs + (isRunning ? Date.now() - runStartedAt : 0);
}

// null means "no target", which is what makes the stopwatch a stopwatch.
function targetMs() {
  if (settings.mode === "stopwatch") return null;
  if (settings.mode === "countdown") return settings.focusMinutes * MINUTE;
  if (phase === "focus") return settings.focusMinutes * MINUTE;
  if (phase === "short") return settings.shortBreakMinutes * MINUTE;
  return settings.longBreakMinutes * MINUTE;
}

function displayMs() {
  const target = targetMs();
  return target === null ? elapsedMs() : Math.max(0, target - elapsedMs());
}

function formatTime(ms) {
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes + ":" + String(seconds).padStart(2, "0");
}

function statusText() {
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

function render() {
  if (!editing) timerEl.textContent = formatTime(displayMs());
  startBtn.textContent = isRunning ? "Pause" : "Start";
  timerStatusEl.textContent = statusText() || " ";
  timerEl.style.cursor = canEditDuration() ? "pointer" : "default";
  timerEl.title = canEditDuration() ? "Click to change the length" : "";
  document.title = isRunning
    ? formatTime(displayMs()) + " · " + APP_NAME
    : APP_NAME;
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

function start() {
  if (isRunning) return;
  announcement = "";
  timerEl.classList.remove("is-done");
  isRunning = true;
  runStartedAt = Date.now();
  ticker = setInterval(tick, 250);
  render();
}

function stop() {
  if (isRunning) {
    bankedMs += Date.now() - runStartedAt;
    isRunning = false;
  }
  clearInterval(ticker);
  ticker = null;
  render();
}

function complete() {
  stop();
  bankedMs = 0;
  if (settings.mode === "pomodoro") {
    advancePhase();
    announcement = phase === "focus" ? "Back to work" : "Break time";
  } else {
    announcement = "Time is up";
  }
  timerEl.classList.add("is-done");
  render();
}

function resetTimer() {
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

function setTimerMode(mode) {
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
    if (Number.isFinite(value) && value >= 1 && value <= 180) {
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

/* ==========================================================================
   Settings panel
   ========================================================================== */

const focusInput = document.getElementById("focus-minutes");
const shortInput = document.getElementById("short-minutes");
const longInput = document.getElementById("long-minutes");
const roundsInput = document.getElementById("rounds");
const modeControl = document.getElementById("timer-mode-control");
const tabButtons = document.querySelectorAll(".tab");
const tabPanels = document.querySelectorAll(".tab-panel");

function syncSettingInputs() {
  focusInput.value = settings.focusMinutes;
  shortInput.value = settings.shortBreakMinutes;
  longInput.value = settings.longBreakMinutes;
  roundsInput.value = settings.roundsBeforeLongBreak;
}

function bindNumberInput(input, key, min, max) {
  input.addEventListener("change", () => {
    const value = Math.round(Number(input.value));
    if (Number.isFinite(value)) {
      settings[key] = Math.min(max, Math.max(min, value));
    }
    input.value = settings[key];
    bankedMs = 0;
    render();
  });
}

bindNumberInput(focusInput, "focusMinutes", 1, 180);
bindNumberInput(shortInput, "shortBreakMinutes", 1, 60);
bindNumberInput(longInput, "longBreakMinutes", 1, 60);
bindNumberInput(roundsInput, "roundsBeforeLongBreak", 2, 10);

// Only show the fields that apply to the current mode.
function updateConditionalFields() {
  document.querySelectorAll("[data-show-for]").forEach((field) => {
    field.hidden = !field.dataset.showFor.split(" ").includes(settings.mode);
  });
}

/* The sliding pill. Its width and position are copied from whichever segment
   is active, which is why clicking one makes it glide across. */
function positionThumb(control) {
  const active = control.querySelector(".segment.is-active");
  const thumb = control.querySelector(".segmented-thumb");
  if (!active || !thumb) return;
  thumb.style.width = active.offsetWidth + "px";
  thumb.style.left = active.offsetLeft + "px";
}

/* Wires up any segmented control, so the pattern is written once and reused
   wherever a slider-style choice is needed. */
const segmentedControls = [];

function initSegmented(control, onChange) {
  control.addEventListener("click", (event) => {
    const segment = event.target.closest(".segment");
    if (!segment) return;

    control.querySelectorAll(".segment").forEach((other) => {
      other.classList.toggle("is-active", other === segment);
    });

    // Run the change first: it may show or hide fields, which can add a
    // scrollbar and narrow the control. Measuring before that would place
    // the pill using widths that are about to change.
    onChange(segment.dataset.value);
    requestAnimationFrame(() => positionThumb(control));
  });

  // Belt and braces: reposition whenever the control changes size for any
  // reason - scrollbars appearing, the panel opening, fonts loading.
  if (window.ResizeObserver) {
    new ResizeObserver(() => positionThumb(control)).observe(control);
  }

  segmentedControls.push(control);
  positionThumb(control);
}

function positionAllThumbs() {
  segmentedControls.forEach(positionThumb);
}

tabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    tabButtons.forEach((other) => {
      other.classList.toggle("is-active", other === button);
    });
    tabPanels.forEach((panel) => {
      panel.classList.toggle(
        "is-active",
        panel.dataset.tab === button.dataset.tab
      );
    });
    // Widths are only measurable once the panel is displayed.
    positionAllThumbs();
  });
});

window.addEventListener("resize", positionAllThumbs);

initSegmented(modeControl, setTimerMode);

syncSettingInputs();
updateConditionalFields();
render();

/* ==========================================================================
   Panels

   Same shape as the timer: a piece of state, one render function, and
   handlers that only ever change state. One system serves all four panels
   instead of four copies of near-identical code.
   ========================================================================== */

const dockButtons = document.querySelectorAll(".dock-btn[data-panel]");
const panels = document.querySelectorAll(".panel");
const fullscreenBtn = document.getElementById("fullscreen-btn");

// The name of the open panel, or null when everything is closed.
let openPanel = null;

function renderPanels() {
  panels.forEach((panel) => {
    panel.classList.toggle("is-open", panel.dataset.panel === openPanel);
  });

  dockButtons.forEach((btn) => {
    const isOpen = btn.dataset.panel === openPanel;
    btn.classList.toggle("is-active", isOpen);
    // Tells screen readers whether this button's panel is showing.
    btn.setAttribute("aria-expanded", String(isOpen));
  });
}

function togglePanel(name) {
  // Clicking the button of the panel that's already open closes it.
  openPanel = openPanel === name ? null : name;
  renderPanels();
}

function closePanels() {
  if (!openPanel) return;
  openPanel = null;
  renderPanels();
}

dockButtons.forEach((btn) => {
  btn.addEventListener("click", () => togglePanel(btn.dataset.panel));
});

document.querySelectorAll(".panel-close").forEach((btn) => {
  btn.addEventListener("click", closePanels);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closePanels();
});

// Click anywhere that isn't inside a panel or on a dock button, and we close.
// .closest() walks up from the clicked element looking for a match, so this
// works even when you click the text inside a panel rather than the panel.
document.addEventListener("click", (event) => {
  if (!openPanel) return;
  if (event.target.closest(".panel")) return;
  if (event.target.closest(".dock-btn")) return;
  closePanels();
});

/* ---- Fullscreen ---- */

fullscreenBtn.addEventListener("click", () => {
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else {
    // Can be refused by the browser, so swallow the rejection.
    document.documentElement.requestFullscreen().catch(() => {});
  }
});

renderPanels();

/* ==========================================================================
   Sounds

   Two different engines behind one interface:
     - "file"  sounds play an MP3 with a plain <audio> element
     - "noise" sounds are generated from scratch with the Web Audio API,
               so they need no files and loop perfectly by definition
   ========================================================================== */

// Adding a sound means adding a line here (and, for kind "file", an MP3
// named <id>.mp3 in assets/sounds/). Nothing else needs to change.
const SOUNDS = [
  { id: "rain", name: "Rain", icon: "\u{1F327}\u{FE0F}", kind: "file" },
  { id: "ocean", name: "Ocean", icon: "\u{1F30A}", kind: "file" },
  { id: "forest", name: "Forest", icon: "\u{1F332}", kind: "file" },
  { id: "cafe", name: "Café", icon: "\u{2615}", kind: "file" },
  { id: "fireplace", name: "Fireplace", icon: "\u{1F525}", kind: "file" },
  { id: "thunder", name: "Thunder", icon: "\u{26C8}\u{FE0F}", kind: "file" },
  { id: "white", name: "White Noise", icon: "\u{26AA}", kind: "noise" },
  { id: "pink", name: "Pink Noise", icon: "\u{1F338}", kind: "noise" },
  { id: "brown", name: "Brown Noise", icon: "\u{1F7E4}", kind: "noise" },
];

const soundGrid = document.getElementById("sound-grid");
const masterSlider = document.getElementById("master-volume");

// State. File sounds start unavailable and are proven available by probing.
const soundState = {};
SOUNDS.forEach((sound) => {
  soundState[sound.id] = {
    on: false,
    volume: 0.6,
    unavailable: sound.kind === "file",
  };
});

let masterVolume = 0.8;

// Live audio objects, created only when a sound is first switched on.
const players = {};
// The tile elements, built once and then only re-styled.
const tiles = {};

/* ---- Web Audio plumbing ---- */

let audioCtx = null;

function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  // Browsers create the context suspended until the user interacts with the
  // page, so it has to be resumed from inside a click handler.
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

/* Fills a few seconds of raw audio samples with noise, by hand.

   White noise is just random numbers. Pink and brown are white noise with
   progressively more energy pushed into the low frequencies, which is why
   brown sounds like a waterfall and white sounds like TV static. */
function createNoiseBuffer(ctx, kind) {
  const length = ctx.sampleRate * 4;
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);

  if (kind === "white") {
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
  } else if (kind === "pink") {
    // Paul Kellet's filter: six running averages summed together.
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }
  } else {
    // Brown: a leaky running total of white noise.
    let last = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
  }

  return buffer;
}

function createNoisePlayer(id) {
  const ctx = getAudioContext();
  const source = ctx.createBufferSource();
  source.buffer = createNoiseBuffer(ctx, id);
  source.loop = true;

  const gain = ctx.createGain();
  gain.gain.value = 0;

  source.connect(gain);
  gain.connect(ctx.destination);
  source.start();

  return {
    setVolume(value) {
      gain.gain.value = value;
    },
    stop() {
      source.stop();
      source.disconnect();
      gain.disconnect();
    },
  };
}

function createFilePlayer(id) {
  const audio = new Audio(`assets/sounds/${id}.mp3`);
  audio.loop = true;
  audio.volume = 0;

  audio.addEventListener("error", () => {
    soundState[id].unavailable = true;
    soundState[id].on = false;
    delete players[id];
    renderSounds();
  });

  audio.play().catch(() => {});

  return {
    setVolume(value) {
      audio.volume = Math.min(1, Math.max(0, value));
    },
    stop() {
      audio.pause();
      audio.src = "";
    },
  };
}

/* ---- Behaviour ---- */

function applyVolumes() {
  Object.keys(players).forEach((id) => {
    players[id].setVolume(soundState[id].volume * masterVolume);
  });
}

function toggleSound(id) {
  const state = soundState[id];
  if (state.unavailable) return;

  state.on = !state.on;

  if (state.on && !players[id]) {
    const sound = SOUNDS.find((s) => s.id === id);
    players[id] =
      sound.kind === "noise" ? createNoisePlayer(id) : createFilePlayer(id);
  } else if (!state.on && players[id]) {
    players[id].stop();
    delete players[id];
  }

  applyVolumes();
  renderSounds();
}

/* Builds the tiles once. Re-creating them on every render would destroy the
   slider you're in the middle of dragging. */
function buildSoundTiles() {
  SOUNDS.forEach((sound) => {
    const tile = document.createElement("div");
    tile.className = "sound-tile";

    const toggle = document.createElement("button");
    toggle.className = "sound-toggle";
    toggle.innerHTML =
      `<span class="sound-icon">${sound.icon}</span>` +
      `<span class="sound-name">${sound.name}</span>`;
    toggle.addEventListener("click", () => toggleSound(sound.id));

    const volume = document.createElement("input");
    volume.type = "range";
    volume.className = "slider sound-volume";
    volume.min = 0;
    volume.max = 100;
    volume.value = soundState[sound.id].volume * 100;
    volume.setAttribute("aria-label", `${sound.name} volume`);
    volume.addEventListener("input", () => {
      soundState[sound.id].volume = volume.value / 100;
      applyVolumes();
    });

    tile.append(toggle, volume);
    soundGrid.append(tile);
    tiles[sound.id] = { tile, toggle };
  });
}

// Only ever changes styling, never rebuilds the DOM.
function renderSounds() {
  SOUNDS.forEach((sound) => {
    const state = soundState[sound.id];
    const { tile, toggle } = tiles[sound.id];

    tile.classList.toggle("is-on", state.on);
    tile.classList.toggle("is-unavailable", state.unavailable);

    toggle.disabled = state.unavailable;
    toggle.setAttribute("aria-pressed", String(state.on));
    toggle.title = state.unavailable
      ? `Missing assets/sounds/${sound.id}.mp3`
      : sound.name;
  });
}

/* Asks the browser whether each MP3 actually exists, so tiles are honest
   before you click them rather than after. */
function probeFileSounds() {
  SOUNDS.filter((sound) => sound.kind === "file").forEach((sound) => {
    const probe = new Audio();
    probe.preload = "metadata";
    probe.addEventListener("loadedmetadata", () => {
      soundState[sound.id].unavailable = false;
      renderSounds();
    });
    probe.addEventListener("error", () => {
      soundState[sound.id].unavailable = true;
      renderSounds();
    });
    probe.src = `assets/sounds/${sound.id}.mp3`;
  });
}

masterSlider.addEventListener("input", () => {
  masterVolume = masterSlider.value / 100;
  applyVolumes();
});

buildSoundTiles();
renderSounds();
probeFileSounds();

/* ==========================================================================
   Appearance and clock options

   Themes and fonts work by rewriting the CSS custom properties declared at
   the top of style.css. Nothing here knows what uses them - it just changes
   the variable, and everything referring to it updates at once.
   ========================================================================== */

const THEMES = [
  { id: "aurora", name: "Aurora", base: "#0d0a1a", accent: "#7c5cff",
    blobs: ["#7c3aed", "#ec4899", "#f43f5e", "#2563eb"] },
  { id: "ocean", name: "Ocean", base: "#04121f", accent: "#0ea5e9",
    blobs: ["#0ea5e9", "#06b6d4", "#3b82f6", "#14b8a6"] },
  { id: "sunset", name: "Sunset", base: "#1a0a0f", accent: "#f97316",
    blobs: ["#f97316", "#ef4444", "#ec4899", "#eab308"] },
  { id: "forest", name: "Forest", base: "#071410", accent: "#10b981",
    blobs: ["#10b981", "#22c55e", "#84cc16", "#0d9488"] },
  { id: "midnight", name: "Midnight", base: "#050510", accent: "#6366f1",
    blobs: ["#312e81", "#1e3a8a", "#4c1d95", "#0f172a"] },
  { id: "rose", name: "Rose", base: "#1a0812", accent: "#ec4899",
    blobs: ["#f43f5e", "#ec4899", "#d946ef", "#fb7185"] },
];

const FONTS = [
  { label: "Outfit", stack: '"Outfit", system-ui, sans-serif' },
  { label: "Figtree", stack: '"Figtree", system-ui, sans-serif' },
  { label: "Plus Jakarta Sans", stack: '"Plus Jakarta Sans", system-ui, sans-serif' },
  { label: "Poppins", stack: '"Poppins", system-ui, sans-serif' },
  { label: "Space Grotesk", stack: '"Space Grotesk", system-ui, sans-serif' },
  { label: "DM Mono", stack: '"DM Mono", ui-monospace, monospace' },
];

const themeGrid = document.getElementById("theme-grid");
const fontSelect = document.getElementById("font-select");
const zoneSelect = document.getElementById("zone-select");
const hourFormatControl = document.getElementById("hour-format-control");

let activeTheme = "aurora";

function applyTheme(id) {
  const theme = THEMES.find((t) => t.id === id);
  if (!theme) return;
  activeTheme = id;

  const root = document.documentElement.style;
  root.setProperty("--bg-base", theme.base);
  root.setProperty("--accent", theme.accent);
  theme.blobs.forEach((colour, index) => {
    root.setProperty("--blob-" + "abcd"[index], colour);
  });

  themeGrid.querySelectorAll(".theme-swatch").forEach((swatch) => {
    swatch.classList.toggle("is-active", swatch.dataset.theme === id);
  });
}

function buildThemeGrid() {
  THEMES.forEach((theme) => {
    const swatch = document.createElement("button");
    swatch.className = "theme-swatch";
    swatch.dataset.theme = theme.id;
    swatch.title = theme.name;
    swatch.style.background =
      "linear-gradient(135deg, " + theme.blobs.join(", ") + ")";
    swatch.innerHTML =
      '<span class="theme-swatch-name">' + theme.name + "</span>";
    swatch.addEventListener("click", () => applyTheme(theme.id));
    themeGrid.append(swatch);
  });
}

function buildFontSelect() {
  FONTS.forEach((font) => {
    const option = document.createElement("option");
    option.value = font.stack;
    option.textContent = font.label;
    option.style.fontFamily = font.stack;
    fontSelect.append(option);
  });

  fontSelect.addEventListener("change", () => {
    document.documentElement.style.setProperty(
      "--timer-font",
      fontSelect.value
    );
  });
}

/* The full IANA timezone list where the browser exposes it, with a short
   fallback for older browsers that do not. */
function timeZoneOptions() {
  if (typeof Intl.supportedValuesOf === "function") {
    try {
      return Intl.supportedValuesOf("timeZone");
    } catch (error) {
      // fall through to the short list
    }
  }
  return [
    "UTC",
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Los_Angeles",
    "Europe/London",
    "Europe/Paris",
    "Europe/Berlin",
    "Asia/Tokyo",
    "Asia/Shanghai",
    "Asia/Kolkata",
    "Australia/Sydney",
  ];
}

function buildZoneSelect() {
  const zones = timeZoneOptions().slice();
  if (!zones.includes(clockSettings.timeZone)) {
    zones.unshift(clockSettings.timeZone);
  }

  zones.forEach((zone) => {
    const option = document.createElement("option");
    option.value = zone;
    option.textContent = zone.replace(/_/g, " ");
    zoneSelect.append(option);
  });

  zoneSelect.value = clockSettings.timeZone;

  zoneSelect.addEventListener("change", () => {
    clockSettings.timeZone = zoneSelect.value;
    updateClock();
  });
}

function setHourFormat(value) {
  clockSettings.hour12 = value === "12";
  updateClock();
}

buildThemeGrid();
applyTheme(activeTheme);
buildFontSelect();
buildZoneSelect();
initSegmented(hourFormatControl, setHourFormat);
