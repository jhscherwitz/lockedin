/* ==========================================================================
   Clock

   Formatting goes through Intl.DateTimeFormat rather than Date's own
   getHours(). That is what makes 12/24-hour and timezone support possible
   without hand-writing conversion logic.
   ========================================================================== */

const clockSettings = {
  hour12: true,
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
};

/* ==========================================================================
   Live clock, top right

   Shows seconds, so it visibly ticks. Follows the same timezone and 12/24
   setting as the main clock, and caches its formatter for the same reason.
   ========================================================================== */

const nowEl = document.getElementById("now");

let nowFormatter = null;
let nowFormatterKey = null;

function updateNow() {
  const key = clockSettings.timeZone + "|" + clockSettings.hour12;
  if (key !== nowFormatterKey) {
    nowFormatterKey = key;
    const options = {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      timeZone: clockSettings.timeZone,
    };
    if (clockSettings.hour12) options.hour12 = true;
    else options.hourCycle = "h23";
    nowFormatter = new Intl.DateTimeFormat("en-US", options);
  }

  const parts = nowFormatter.formatToParts(new Date());
  const pick = (type) => {
    const part = parts.find((piece) => piece.type === type);
    return part ? part.value : "";
  };

  const text = pick("hour") + ":" + pick("minute") + ":" + pick("second");
  if (nowEl.textContent !== text) nowEl.textContent = text;
}

updateNow();
setInterval(updateNow, 1000);

/* ==========================================================================
   Timer

   Three modes share one clock:
     countdown  - count down to zero from a set length
     stopwatch  - count up from zero, no target
     pomodoro   - focus/break cycle with rounds

   Everything is derived from elapsed milliseconds rather than counted down,
   so pausing, resuming and background-tab throttling cannot make it drift.
   ========================================================================== */

const APP_NAME = "LockedIn";
const MINUTE = 60000;

const timerEl = document.getElementById("timer");
const timerEditEl = document.getElementById("timer-edit");
const timerStatusEl = document.getElementById("timer-status");
const startBtn = document.getElementById("start-btn");
const resetBtn = document.getElementById("reset-btn");

const settings = {
  mode: "countdown",
  focusMinutes: 60,
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

/* Anything that needs redrawing whenever the timer redraws registers here.
   The mini player uses it, and it keeps render() from having to know what
   else exists. */
const renderHooks = [];

function render() {
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

/* ==========================================================================
   Settings panel
   ========================================================================== */

const focusInput = document.getElementById("focus-minutes");
const shortInput = document.getElementById("short-minutes");
const longInput = document.getElementById("long-minutes");
const roundsInput = document.getElementById("rounds");
const modeControl = document.getElementById("timer-mode-control");
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

bindNumberInput(focusInput, "focusMinutes", 1, 600);
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

/* Wires one tab strip. Scoped to its container so several panels can each
   have their own tabs without interfering. */
function initTabs(container) {
  const buttons = container.querySelectorAll(".tab");
  const panels = container.querySelectorAll(".tab-panel");

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      buttons.forEach((other) => {
        other.classList.toggle("is-active", other === button);
      });
      panels.forEach((panel) => {
        panel.classList.toggle(
          "is-active",
          panel.dataset.tab === button.dataset.tab
        );
      });
      // Widths are only measurable once the panel is displayed.
      positionAllThumbs();
    });
  });
}

document.querySelectorAll(".panel").forEach((panel) => {
  if (panel.querySelector(".tab")) initTabs(panel);
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
const PANEL_SAFE = ["panel", "dock-btn", "focus-prompt"];

document.addEventListener("click", (event) => {
  if (!openPanel) return;

  /* composedPath() is captured when the event is dispatched, so it survives
     the clicked element being removed from the DOM before the event reaches
     here. That is exactly what happens with a task checkbox: toggling it
     re-renders the task list, so by the time this handler runs the button
     that was clicked is detached, event.target.closest(".panel") returns
     null, and the panel would close itself mid-use. */
  const insidePanel = event
    .composedPath()
    .some(
      (node) =>
        node instanceof Element &&
        PANEL_SAFE.some((name) => node.classList.contains(name))
    );

  if (insidePanel) return;
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

   Each sound is an MP3 in assets/sounds/, played on loop by its own <audio>
   element. Any number can play at once, each with its own volume.
   ========================================================================== */

// Adding a sound means adding a line here (and, for kind "file", an MP3
// named <id>.mp3 in assets/sounds/). Nothing else needs to change.
const SOUNDS = [
  { id: "light-rain", name: "Light Rain", icon: "\u{1F326}\u{FE0F}" },
  { id: "heavy-rain", name: "Heavy Rain", icon: "\u{1F327}\u{FE0F}" },
  { id: "ocean-waves", name: "Ocean Waves", icon: "\u{1F30A}" },
  { id: "river", name: "River", icon: "\u{1F3DE}\u{FE0F}", doubleTrack: true },
  { id: "forest-ambience", name: "Forest", icon: "\u{1F332}" },
  { id: "campfire", name: "Campfire", icon: "\u{1F525}" },
];

const soundGrid = document.getElementById("sound-grid");
const masterSlider = document.getElementById("master-volume");

// State. File sounds start unavailable and are proven available by probing.
const soundState = {};
SOUNDS.forEach((sound) => {
  soundState[sound.id] = {
    on: false,
    volume: 0.6,
    unavailable: true, // until the MP3 is confirmed to exist
  };
});

let masterVolume = 0.8;

// Live audio objects, created only when a sound is first switched on.
const players = {};
// The tile elements, built once and then only re-styled.
const tiles = {};

/* One or two <audio> elements per sound, created once and reused.

   An earlier version destroyed the element on stop with `audio.src = ""`,
   which makes the browser try to load an empty URL. That fails, fires the
   error event below, and marked the sound permanently unavailable - so
   pausing a sound greyed out its tile for good. Pausing is both correct and
   faster to resume, since the file stays buffered.

   Sounds flagged doubleTrack get a second copy of the same file playing
   offset by half its length. Each copy plays straight through the moment the
   other reaches its loop point, so the seam is never exposed:

     copy A:  --------seam--------seam--------
     copy B:  --seam--------seam--------seam--

   Only worth doing on short files, where the seam comes round often enough
   to hear. The MP3 itself is untouched - this is two players, not an edit. */
function createFilePlayer(id, doubleTrack) {
  const src = "assets/sounds/" + id + ".mp3";

  const primary = new Audio(src);
  primary.loop = true;
  primary.volume = 0;

  const secondary = doubleTrack ? new Audio(src) : null;
  let offsetApplied = false;

  function applyOffset() {
    if (!secondary || offsetApplied) return;
    if (!Number.isFinite(secondary.duration) || secondary.duration === 0) return;
    secondary.currentTime = secondary.duration / 2;
    offsetApplied = true;
  }

  if (secondary) {
    secondary.loop = true;
    secondary.volume = 0;
    secondary.addEventListener("loadedmetadata", applyOffset);
  }

  const layers = secondary ? [primary, secondary] : [primary];

  /* Two streams of the same broadly noise-like material add by amplitude
     rather than linearly, so about 0.71 each lands near the loudness of one
     at full volume. */
  const perLayer = secondary ? Math.SQRT1_2 : 1;

  primary.addEventListener("error", () => {
    soundState[id].unavailable = true;
    soundState[id].on = false;
    renderSounds();
  });

  return {
    play() {
      applyOffset();
      layers.forEach((audio) => audio.play().catch(() => {}));
    },
    pause() {
      layers.forEach((audio) => audio.pause());
    },
    setVolume(value) {
      const level = Math.min(1, Math.max(0, value)) * perLayer;
      layers.forEach((audio) => (audio.volume = level));
    },
  };
}

/* ---- Behaviour ---- */

/* Range inputs give you no way to colour the portion you have passed, so the
   filled part is a gradient and this keeps its stop in sync with the value. */
function paintSlider(input) {
  const min = Number(input.min || 0);
  const max = Number(input.max || 100);
  const span = max - min || 1;
  const pct = ((Number(input.value) - min) / span) * 100;
  input.style.setProperty("--fill", pct + "%");
}

function initSlider(input) {
  paintSlider(input);
  input.addEventListener("input", () => paintSlider(input));
}

function applyVolumes() {
  Object.keys(players).forEach((id) => {
    players[id].setVolume(soundState[id].volume * masterVolume);
  });
}

function toggleSound(id) {
  const state = soundState[id];
  if (state.unavailable) return;

  state.on = !state.on;

  // Kept for the life of the page rather than rebuilt, so switching a sound
  // back on resumes a buffered element instead of downloading it again.
  if (!players[id]) {
    const sound = SOUNDS.find((entry) => entry.id === id);
    players[id] = createFilePlayer(id, Boolean(sound && sound.doubleTrack));
  }

  applyVolumes();
  if (state.on) players[id].play();
  else players[id].pause();

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
    initSlider(volume);

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

/* Checks which MP3s actually exist, so tiles are honest before you click
   them rather than after.

   A HEAD request asks only for the headers - "is this there?" - and returns
   no file body at all, so it is near-instant whatever the file size. The
   first version of this set preload="metadata" on an <audio> element, which
   made the browser begin downloading each file just to find out it existed:
   the 6.5MB forest recording left its tile greyed out and unclickable for
   several seconds after load. */
function probeFileSounds() {
  SOUNDS.forEach((sound) => {
    fetch("assets/sounds/" + sound.id + ".mp3", { method: "HEAD" })
      .then((response) => {
        soundState[sound.id].unavailable = !response.ok;
        renderSounds();
      })
      .catch(() => {
        soundState[sound.id].unavailable = true;
        renderSounds();
      });
  });
}

masterSlider.addEventListener("input", () => {
  masterVolume = masterSlider.value / 100;
  applyVolumes();
});
initSlider(masterSlider);

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
  { id: "aurora", name: "Aurora", base: "#241a3d", accent: "#7c5cff",
    blobs: ["#7c3aed", "#d946ef", "#ec4899", "#4f46e5"] },
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
  { label: "Clash Display", stack: '"Clash Display", "Outfit", system-ui, sans-serif' },
  { label: "Outfit", stack: '"Outfit", system-ui, sans-serif' },
  { label: "Satoshi", stack: '"Satoshi", system-ui, sans-serif' },
  { label: "Gabarito", stack: '"Gabarito", system-ui, sans-serif' },
  { label: "Onest", stack: '"Onest", system-ui, sans-serif' },
  { label: "Bricolage Grotesque", stack: '"Bricolage Grotesque", system-ui, sans-serif' },
  { label: "Archivo", stack: '"Archivo", system-ui, sans-serif' },
  { label: "Chivo", stack: '"Chivo", system-ui, sans-serif' },
  { label: "Rubik", stack: '"Rubik", system-ui, sans-serif' },
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

  // Redraw so anything mirroring the theme - the mini player - keeps up.
  render();
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
    updateNow();
  });
}

function setHourFormat(value) {
  clockSettings.hour12 = value === "12";
  updateNow();
}

buildThemeGrid();
applyTheme(activeTheme);
buildFontSelect();
buildZoneSelect();
initSegmented(hourFormatControl, setHourFormat);

/* ==========================================================================
   Tasks and notepad

   There are always at least three rows, empty and ready to type into, so the
   panel never looks like it is waiting for you to find an Add button. Each
   row is a live text input rather than a label, so a task is edited in place.
   ========================================================================== */

const MIN_TASK_ROWS = 3;

const taskList = document.getElementById("task-list");
const taskAddBtn = document.getElementById("task-add");
const notepad = document.getElementById("notepad");

// { id, text, done }
let tasks = [];

function newTask(text) {
  return {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    text: text || "",
    done: false,
  };
}

// Pad up to the minimum so there are always spare rows to type into.
function padTasks() {
  while (tasks.length < MIN_TASK_ROWS) tasks.push(newTask());
}

function renderTasks() {
  padTasks();
  taskList.innerHTML = "";

  tasks.forEach((task) => {
    const item = document.createElement("li");
    item.className = "task";
    item.classList.toggle("is-done", task.done);

    const check = document.createElement("button");
    check.className = "task-check";
    check.type = "button";
    check.setAttribute("aria-pressed", String(task.done));
    check.setAttribute("aria-label", "Mark complete");
    check.addEventListener("click", () => toggleTask(task.id));

    const input = document.createElement("input");
    input.className = "task-text";
    input.type = "text";
    input.value = task.text;
    input.placeholder = "Type your priority";
    input.autocomplete = "off";
    input.setAttribute("aria-label", "Task");
    // Edited in place: the input is the task.
    input.addEventListener("input", () => {
      task.text = input.value;
    });
    // Enter drops you into the next row, like a list should behave.
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      const inputs = [...taskList.querySelectorAll(".task-text")];
      const next = inputs[inputs.indexOf(input) + 1];
      if (next) next.focus();
      else addTaskRow();
    });

    const remove = document.createElement("button");
    remove.className = "task-delete";
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", "Delete task");
    remove.addEventListener("click", () => deleteTask(task.id));

    item.append(check, input, remove);
    taskList.append(item);
  });
}

function toggleTask(id) {
  const task = tasks.find((t) => t.id === id);
  if (!task) return;
  task.done = !task.done;
  renderTasks();
}

function deleteTask(id) {
  tasks = tasks.filter((t) => t.id !== id);
  renderTasks();
  scheduleSave();
}

function addTaskRow() {
  tasks.push(newTask());
  renderTasks();
  const inputs = taskList.querySelectorAll(".task-text");
  const last = inputs[inputs.length - 1];
  if (last) last.focus();
}

taskAddBtn.addEventListener("click", addTaskRow);

renderTasks();

/* ==========================================================================
   Saving

   Everything lives in localStorage: a small key/value store the browser
   keeps per site, on this device, with no server involved. It survives
   refreshes and reboots, but does not follow you to another computer -
   that would need accounts, which this project deliberately doesn't have.
   ========================================================================== */

const STORAGE_KEY = "focus-app-v1";

function collectState() {
  const volumes = {};
  SOUNDS.forEach((sound) => {
    volumes[sound.id] = soundState[sound.id].volume;
  });

  return {
    theme: activeTheme,
    font: fontSelect.value,
    fontDefaultMigrated: true,
    timerDefaultMigrated: true,
    clock: { hour12: clockSettings.hour12, timeZone: clockSettings.timeZone },
    timer: Object.assign({}, settings),
    master: masterVolume,
    volumes,
    tasks,
    notes: notepad.value,
  };
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(collectState()));
  } catch (error) {
    // Private browsing and some privacy settings block storage entirely.
    // Losing settings is not worth breaking the page over.
  }
}

// Writing on every keystroke would be wasteful, so wait for a pause first.
let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveState, 300);
}

// Rather than remembering to call save from twenty different places, listen
// once at the document level. Every control here is driven by one of these
// three events, so this catches all of them.
document.addEventListener("input", scheduleSave);
document.addEventListener("change", scheduleSave);
document.addEventListener("click", scheduleSave);
window.addEventListener("beforeunload", saveState);

const LEGACY_DEFAULT_FONT = '"Outfit", system-ui, sans-serif';

function applySavedState(data) {
  /* The default timer font changed from Outfit to Clash Display. Anyone
     carrying the old default in their saved settings never actually chose a
     font - they just had the default - so let the new one through. The flag
     means this happens exactly once; a deliberate later choice of Outfit is
     then respected. */
  if (!data.fontDefaultMigrated && data.font === LEGACY_DEFAULT_FONT) {
    delete data.font;
  }

  /* The default session length changed from 30 minutes to 60. Anyone still
     carrying 30 never chose it, so let the new default through - once. */
  if (!data.timerDefaultMigrated && data.timer && data.timer.focusMinutes === 30) {
    delete data.timer.focusMinutes;
  }

  if (data.theme) applyTheme(data.theme);

  // Guard every field: a saved font or timezone might not exist any more,
  // and a <select> silently refuses values that aren't in its list.
  if (data.font) {
    fontSelect.value = data.font;
    if (fontSelect.value === data.font) {
      document.documentElement.style.setProperty("--timer-font", data.font);
    }
  }

  if (data.clock) {
    if (typeof data.clock.hour12 === "boolean") {
      clockSettings.hour12 = data.clock.hour12;
      const value = data.clock.hour12 ? "12" : "24";
      hourFormatControl.querySelectorAll(".segment").forEach((segment) => {
        segment.classList.toggle("is-active", segment.dataset.value === value);
      });
      positionThumb(hourFormatControl);
    }
    if (data.clock.timeZone) {
      zoneSelect.value = data.clock.timeZone;
      if (zoneSelect.value === data.clock.timeZone) {
        clockSettings.timeZone = data.clock.timeZone;
      }
    }
    updateNow();
  }

  if (data.timer) {
    Object.keys(settings).forEach((key) => {
      if (data.timer[key] !== undefined) settings[key] = data.timer[key];
    });
    syncSettingInputs();
    modeControl.querySelectorAll(".segment").forEach((segment) => {
      segment.classList.toggle(
        "is-active",
        segment.dataset.value === settings.mode
      );
    });
    positionThumb(modeControl);
    updateConditionalFields();
    resetTimer();
  }

  if (typeof data.master === "number") {
    masterVolume = data.master;
    masterSlider.value = Math.round(masterVolume * 100);
    paintSlider(masterSlider);
  }

  if (data.volumes) {
    SOUNDS.forEach((sound) => {
      const value = data.volumes[sound.id];
      if (typeof value !== "number") return;
      soundState[sound.id].volume = value;
      const slider = tiles[sound.id].tile.querySelector(".sound-volume");
      if (slider) {
        slider.value = Math.round(value * 100);
        paintSlider(slider);
      }
    });
  }

  if (Array.isArray(data.tasks)) {
    tasks = data.tasks.filter(
      (task) => task && typeof task.text === "string" && task.id
    );
    renderTasks();
  }

  if (typeof data.notes === "string") notepad.value = data.notes;
}

function loadState() {
  let data = null;
  try {
    data = JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch (error) {
    // Corrupt or blocked storage: start fresh rather than crash.
    return;
  }
  if (data && typeof data === "object") applySavedState(data);
}

loadState();

/* ==========================================================================
   Mini player (Document Picture-in-Picture)

   Opens a small real OS window containing the timer and a pause button. It
   floats above everything - other tabs, other applications - so the
   countdown stays visible while you work somewhere else.

   Only Chrome and Edge support this API today. Where it is missing the
   button disables itself and says why, rather than failing silently.
   ========================================================================== */

const pipBtn = document.getElementById("pip-btn");
const pipSupported = "documentPictureInPicture" in window;

let pipWindow = null;
let pipTimeEl = null;
let pipButtonEl = null;
let pipStatusEl = null;
let pipStyleEl = null;
let pipThemeKey = null;

/* Rebuilds the mini window's stylesheet from the live CSS variables, so it
   carries the same background mesh, accent and timer font as the page. */
function pipStyles() {
  const root = getComputedStyle(document.documentElement);
  const get = (name, fallback) => root.getPropertyValue(name).trim() || fallback;

  const base = get("--bg-base", "#241a3d");
  const accent = get("--accent", "#7c5cff");
  const font = get("--timer-font", '"Outfit", system-ui, sans-serif');
  const a = get("--blob-a", "#7c3aed");
  const b = get("--blob-b", "#ec4899");
  const c = get("--blob-c", "#f43f5e");
  const d = get("--blob-d", "#2563eb");

  return `
    * { box-sizing: border-box; }
    body {
      margin: 0;
      height: 100vh;
      display: grid;
      place-content: center;
      justify-items: center;
      gap: 8px;
      position: relative;
      color: #fff;
      font-family: ${font};
      user-select: none;
      -webkit-user-select: none;
      background:
        radial-gradient(120% 95% at 10% 6%, ${a}, transparent 70%),
        radial-gradient(115% 90% at 84% 12%, ${b}, transparent 68%),
        radial-gradient(125% 105% at 28% 102%, ${c}, transparent 72%),
        radial-gradient(115% 95% at 98% 78%, ${d}, transparent 70%),
        ${base};
    }
    body::after {
      content: "";
      position: absolute;
      inset: 0;
      pointer-events: none;
      background: radial-gradient(
        125% 105% at 50% 45%,
        transparent 28%,
        rgba(0, 0, 0, 0.3) 70%,
        rgba(0, 0, 0, 0.6) 100%
      );
    }
    .mini-status, .mini-time, .mini-btn { position: relative; z-index: 1; }
    .mini-status {
      margin: 0;
      font-size: 10px;
      font-weight: 500;
      letter-spacing: 0.11em;
      text-transform: uppercase;
      opacity: 0.7;
      min-height: 12px;
    }
    .mini-time {
      font-size: 19vw;
      font-weight: 600;
      line-height: 0.95;
      letter-spacing: -0.045em;
      font-variant-numeric: tabular-nums;
      text-shadow: 0 3px 26px rgba(0, 0, 0, 0.4);
    }
    .mini-btn {
      border: 0;
      border-radius: 999px;
      padding: 7px 26px;
      font-family: inherit;
      font-size: 13px;
      font-weight: 600;
      color: #fff;
      background: ${accent};
      cursor: pointer;
      box-shadow: 0 6px 18px -6px rgba(0, 0, 0, 0.6);
    }
    .mini-btn:active { transform: scale(0.97); }
  `;
}

function currentPipThemeKey() {
  const root = getComputedStyle(document.documentElement);
  return (
    root.getPropertyValue("--accent") +
    root.getPropertyValue("--bg-base") +
    root.getPropertyValue("--timer-font")
  );
}

// Registered as a render hook, so it redraws whenever the main timer does.
function renderPip() {
  if (!pipWindow || !pipTimeEl) return;

  // Pick up a theme or font change made while the window is open.
  const themeKey = currentPipThemeKey();
  if (pipStyleEl && themeKey !== pipThemeKey) {
    pipThemeKey = themeKey;
    pipStyleEl.textContent = pipStyles();
  }

  const text = formatTime(displayMs());
  if (pipTimeEl.textContent !== text) pipTimeEl.textContent = text;

  const label = isRunning ? "Pause" : "Start";
  if (pipButtonEl.textContent !== label) pipButtonEl.textContent = label;

  const status = statusText() || "";
  if (pipStatusEl.textContent !== status) pipStatusEl.textContent = status;
}

async function openPip() {
  pipWindow = await documentPictureInPicture.requestWindow({
    width: 300,
    height: 170,
  });

  /* The pop-out is a separate document with its own empty head, so it does
     not inherit the page's webfonts. Passing it the font *name* is not
     enough - without the @font-face rules that family does not exist there
     and it silently falls back to a system face. The font links have to be
     cloned in. */
  document.querySelectorAll('link[rel="stylesheet"]').forEach((link) => {
    if (!/font/i.test(link.href)) return;
    pipWindow.document.head.append(link.cloneNode(true));
  });

  pipStyleEl = pipWindow.document.createElement("style");
  pipStyleEl.textContent = pipStyles();
  pipThemeKey = currentPipThemeKey();
  pipWindow.document.head.append(pipStyleEl);

  pipStatusEl = pipWindow.document.createElement("p");
  pipStatusEl.className = "mini-status";

  pipTimeEl = pipWindow.document.createElement("div");
  pipTimeEl.className = "mini-time";

  pipButtonEl = pipWindow.document.createElement("button");
  pipButtonEl.className = "mini-btn";
  pipButtonEl.addEventListener("click", () => (isRunning ? stop() : start()));

  pipWindow.document.body.append(pipStatusEl, pipTimeEl, pipButtonEl);

  // Fires whether it was closed by its own X or by the browser.
  pipWindow.addEventListener("pagehide", () => {
    pipWindow = null;
    pipTimeEl = null;
    pipButtonEl = null;
    pipStatusEl = null;
    pipStyleEl = null;
    pipThemeKey = null;
    pipBtn.classList.remove("is-active");
    document.body.classList.remove("pip-open");
  });

  pipBtn.classList.add("is-active");
  document.body.classList.add("pip-open");
  renderPip();
}

if (!pipSupported) {
  // Deliberately NOT disabled: a disabled button fires no click event, so
  // the explanation below could never be shown. A button that tells you why
  // it cannot help beats a dead one.
  pipBtn.style.opacity = "0.45";
  pipBtn.title = "Pop-out timer needs Chrome or Edge";
  pipBtn.addEventListener("click", () => {
    showToast(
      "The pop-out timer needs Chrome or Edge - this browser has not " +
        "implemented the Picture-in-Picture window API yet."
    );
  });
} else {
  pipBtn.title = "Pop out a mini timer";
  pipBtn.addEventListener("click", () => {
    if (pipWindow) pipWindow.close();
    else
      openPip().catch((error) => {
        // Never swallow this silently: if the window will not open, the only
        // clue anyone gets is what the browser said.
        console.warn("Mini player could not open:", error);
        pipBtn.title = "Mini player could not open: " + error.message;
        showToast("Mini player could not open - " + error.name + ": " + error.message);
      });
  });
  renderHooks.push(renderPip);
}

/* ==========================================================================
   Toast

   Somewhere for messages the user needs to see. Anything that can fail
   should say so on screen, not only in a console nobody has open.
   ========================================================================== */

const toastEl = document.getElementById("toast");
let toastTimer = null;

function showToast(message, ms) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.hidden = true;
  }, ms || 7000);
}

/* ==========================================================================
   Focus prompt - opens the tasks panel
   ========================================================================== */

document.getElementById("focus-prompt").addEventListener("click", () => {
  togglePanel("tasks");
});

/* ==========================================================================
   Keyboard shortcuts
   ========================================================================== */

// Never hijack a key while someone is typing into something.
function isTyping(target) {
  if (!target || !target.tagName) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable === true
  );
}

const SHORTCUTS = {
  " ": { label: "Start / pause", run: () => (isRunning ? stop() : start()) },
  r: { label: "Reset timer", run: resetTimer },
  f: { label: "Fullscreen", run: () => fullscreenBtn.click() },
  p: { label: "Mini player", run: () => pipBtn.click() },
  s: { label: "Sounds", run: () => togglePanel("sounds") },
  m: { label: "Music", run: () => togglePanel("music") },
  t: { label: "Tasks & notes", run: () => togglePanel("tasks") },
  ",": { label: "Settings", run: () => togglePanel("settings") },
};

function shortcutSummary() {
  const pretty = { " ": "Space", ",": "," };
  return Object.keys(SHORTCUTS)
    .map((key) => (pretty[key] || key.toUpperCase()) + " " + SHORTCUTS[key].label)
    .join("   ·   ");
}

document.addEventListener("keydown", (event) => {
  if (isTyping(event.target)) return;

  // An open game owns the keyboard. Without this, spelling a word containing
  // S, M, T, R or F would fire the panel shortcuts instead of typing, and
  // 2048's WASD keys would do the same.
  if (gameIsActive()) return;

  // Leave browser combinations alone: Ctrl+R should still reload the page.
  if (event.ctrlKey || event.metaKey || event.altKey) return;

  if (event.key === "?") {
    event.preventDefault();
    showToast(shortcutSummary(), 9000);
    return;
  }

  const shortcut = SHORTCUTS[event.key.toLowerCase()];
  if (!shortcut) return;

  // Space would otherwise scroll the page or re-trigger a focused button.
  event.preventDefault();
  shortcut.run();
});

/* ==========================================================================
   Games

   The panel holds a picker and one game view, so adding a second game means
   adding a card and its own module - not restructuring anything.
   ========================================================================== */

const gamesMenu = document.getElementById("games-menu");
const gameView = document.getElementById("game-view");
const gamesBack = document.getElementById("games-back");

let activeGame = null; // id of the game on screen, or null at the picker

function gameIsActive() {
  return openPanel === "games" && activeGame !== null;
}

/* ---- Wordie ----------------------------------------------------------------
   Functions here keep an `fl` prefix from when the game was called Five
   Letters. The name changed; the prefix stayed, since renaming forty
   identifiers buys nothing.
   -------------------------------------------------------------------------- */

const flBoard = document.getElementById("fl-board");
const flMessage = document.getElementById("fl-message");
const flKeyboard = document.getElementById("fl-keyboard");
const flNewBtn = document.getElementById("fl-new");

const FL_ROWS = 6;
const FL_LEN = 5;
const FL_RECENT_KEY = "focus-app-fl-recent";

const FL_FLIP_MS = 290; // half a flip: edge-on at this point
const FL_STAGGER_MS = 210; // gap between one tile starting and the next

let flRevealing = false;
let flWords = null; // { answers: [...], guesses: Set }
let flLoading = null; // in-flight fetch, so two clicks don't load twice

const fl = {
  answer: "",
  submitted: [],
  current: "",
  status: "idle", // idle | playing | won | lost
  keyState: {}, // letter -> correct | present | absent
};

function flActive() {
  return openPanel === "games" && activeGame === "wordie";
}

/* Fetched the first time the game is opened rather than on page load, so
   104KB of word lists never delays the timer appearing. */
function loadWordLists() {
  if (flWords) return Promise.resolve(flWords);
  if (flLoading) return flLoading;

  flLoading = Promise.all([
    fetch("assets/words/answers.txt").then((r) => r.text()),
    fetch("assets/words/guesses.txt").then((r) => r.text()),
  ]).then(([answersText, guessesText]) => {
    flWords = {
      answers: answersText.trim().split("\n"),
      guesses: new Set(guessesText.trim().split("\n")),
    };
    return flWords;
  });

  return flLoading;
}

/* ---- Choosing a word ---- */

function flRecent() {
  try {
    const list = JSON.parse(localStorage.getItem(FL_RECENT_KEY));
    return Array.isArray(list) ? list : [];
  } catch (error) {
    return [];
  }
}

function flRememberAnswer(word) {
  const recent = [word, ...flRecent().filter((w) => w !== word)].slice(0, 40);
  try {
    localStorage.setItem(FL_RECENT_KEY, JSON.stringify(recent));
  } catch (error) {
    // Storage blocked. Occasional repeats are not worth failing over.
  }
}

function flPickAnswer(answers) {
  const recent = new Set(flRecent());
  const fresh = answers.filter((word) => !recent.has(word));
  const pool = fresh.length ? fresh : answers;
  return pool[Math.floor(Math.random() * pool.length)];
}

/* ---- Scoring ----------------------------------------------------------------

   Two passes, and the order is the whole point. Greens are assigned first and
   consume from a tally of the answer's letters; only then are yellows handed
   out, and only while that letter still has some left in the tally.

   Answer SPEED, guess ERASE. A single pass asking "is this letter somewhere in
   the answer?" lights up both E's in the guess. That is wrong: SPEED has two
   E's, and the guess's second E already claimed one of them as a green, so the
   first E has exactly one left to match against - not two.
   -------------------------------------------------------------------------- */

function flScore(guess, answer) {
  const result = new Array(FL_LEN).fill("absent");
  const remaining = {};

  for (const letter of answer) {
    remaining[letter] = (remaining[letter] || 0) + 1;
  }

  for (let i = 0; i < FL_LEN; i++) {
    if (guess[i] === answer[i]) {
      result[i] = "correct";
      remaining[guess[i]] -= 1;
    }
  }

  for (let i = 0; i < FL_LEN; i++) {
    if (result[i] === "correct") continue;
    const letter = guess[i];
    if (remaining[letter] > 0) {
      result[i] = "present";
      remaining[letter] -= 1;
    }
  }

  return result;
}

// A key never downgrades: once green it stays green.
const FL_RANK = { absent: 0, present: 1, correct: 2 };

function flMergeKeyStates(guess, scores) {
  for (let i = 0; i < FL_LEN; i++) {
    const letter = guess[i];
    const current = fl.keyState[letter];
    if (!current || FL_RANK[scores[i]] > FL_RANK[current]) {
      fl.keyState[letter] = scores[i];
    }
  }
}

/* ---- Drawing ---- */

function flRenderBoard() {
  flBoard.innerHTML = "";

  for (let row = 0; row < FL_ROWS; row++) {
    const rowEl = document.createElement("div");
    rowEl.className = "fl-row";

    const guess = fl.submitted[row];
    const isCurrentRow = row === fl.submitted.length;
    const scores = guess ? flScore(guess, fl.answer) : null;

    for (let i = 0; i < FL_LEN; i++) {
      const tile = document.createElement("div");
      tile.className = "fl-tile";

      const revealingThisRow = flRevealing && row === fl.submitted.length - 1;

      if (guess) {
        tile.textContent = guess[i];
        // Mid-reveal the colours are applied tile by tile, not all at once.
        tile.classList.add(revealingThisRow ? "is-filled" : "is-" + scores[i]);
      } else if (isCurrentRow && fl.current[i]) {
        tile.textContent = fl.current[i];
        tile.classList.add("is-filled");
      }

      rowEl.append(tile);
    }

    flBoard.append(rowEl);
  }
}

const FL_KEYS = [
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
  ["Enter", "z", "x", "c", "v", "b", "n", "m", "Back"],
];

function flBuildKeyboard() {
  flKeyboard.innerHTML = "";

  FL_KEYS.forEach((row) => {
    const rowEl = document.createElement("div");
    rowEl.className = "fl-krow";

    row.forEach((key) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "fl-key" + (key.length > 1 ? " fl-key-wide" : "");
      button.textContent = key === "Back" ? "⌫" : key;
      button.dataset.key = key;
      button.addEventListener("click", () => flPress(key));
      rowEl.append(button);
    });

    flKeyboard.append(rowEl);
  });
}

function flRenderKeyboard() {
  flKeyboard.querySelectorAll(".fl-key").forEach((button) => {
    button.classList.remove("is-correct", "is-present", "is-absent");
    const state = fl.keyState[button.dataset.key];
    if (state) button.classList.add("is-" + state);
  });
}

function flSay(text) {
  flMessage.textContent = text || " ";
}

function flShakeCurrentRow() {
  const rowEl = flBoard.querySelectorAll(".fl-row")[fl.submitted.length];
  if (!rowEl) return;
  rowEl.classList.remove("is-invalid");
  // Reading a layout property forces the removal to take effect before the
  // class goes back on. Without it the animation does not restart.
  void rowEl.offsetWidth;
  rowEl.classList.add("is-invalid");
}

/* ---- Playing ---- */

const FL_PRAISE = [
  "Genius",
  "Magnificent",
  "Impressive",
  "Splendid",
  "Great",
  "Phew",
];

function flPress(key) {
  if (fl.status !== "playing" || flRevealing) return;

  if (key === "Back") {
    fl.current = fl.current.slice(0, -1);
    flSay("");
    flRenderBoard();
    return;
  }

  if (key === "Enter") {
    flSubmit();
    return;
  }

  if (!/^[a-z]$/.test(key)) return;
  if (fl.current.length >= FL_LEN) return;

  fl.current += key;
  flSay("");
  flRenderBoard();
}

/* Turns one row over, left to right. Resolves when the last tile has landed,
   so the win or lose message waits for the reveal to finish rather than
   spoiling it. */
function flRevealRow(rowIndex, scores) {
  const rowEl = flBoard.querySelectorAll(".fl-row")[rowIndex];
  if (!rowEl) return Promise.resolve();

  const tiles = Array.from(rowEl.children);
  const paint = (tile, i) => {
    tile.classList.remove("is-filled");
    tile.classList.add("is-" + scores[i]);
  };

  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches;

  if (reduceMotion) {
    tiles.forEach(paint);
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    tiles.forEach((tile, i) => {
      const delay = i * FL_STAGGER_MS;
      tile.style.animation =
        "fl-flip " + FL_FLIP_MS * 2 + "ms ease " + delay + "ms";
      // Halfway through, the tile is edge-on and invisible - the only moment
      // the colour can change without the change itself being visible.
      setTimeout(() => paint(tile, i), delay + FL_FLIP_MS);
    });

    const total = (tiles.length - 1) * FL_STAGGER_MS + FL_FLIP_MS * 2;
    setTimeout(resolve, total);
  });
}

function flSubmit() {
  if (flRevealing) return;

  if (fl.current.length < FL_LEN) {
    flSay("Not enough letters");
    flShakeCurrentRow();
    return;
  }

  if (!flWords || !flWords.guesses.has(fl.current)) {
    flSay("Not in word list");
    flShakeCurrentRow();
    return;
  }

  const guess = fl.current;
  const scores = flScore(guess, fl.answer);

  fl.submitted.push(guess);
  fl.current = "";
  flSay("");

  flRevealing = true;
  flRenderBoard();

  flRevealRow(fl.submitted.length - 1, scores).then(() => {
    flRevealing = false;

    // The keyboard updates with the row, not ahead of it.
    flMergeKeyStates(guess, scores);
    flRenderKeyboard();

    if (guess === fl.answer) {
      fl.status = "won";
      flSay(FL_PRAISE[fl.submitted.length - 1]);
    } else if (fl.submitted.length >= FL_ROWS) {
      fl.status = "lost";
      flSay("It was " + fl.answer.toUpperCase());
    }

    flNewBtn.hidden = fl.status === "playing";
  });
}

function flNewGame() {
  return loadWordLists().then((words) => {
    fl.answer = flPickAnswer(words.answers);
    fl.submitted = [];
    fl.current = "";
    fl.status = "playing";
    fl.keyState = {};
    // In case a new game is started while a row is still turning over.
    flRevealing = false;
    flRememberAnswer(fl.answer);
    flNewBtn.hidden = true;
    flSay("");
    flRenderBoard();
    flRenderKeyboard();
  });
}

/* ---- Wiring ---- */

/* A registry rather than a chain of ifs, so a third game is one more entry
   plus its own pane in the markup. */
const GAMES = {
  wordie: {
    inProgress: () => fl.status !== "idle",
    start() {
      flSay("Loading words…");
      flNewGame().catch(() => flSay("Could not load the word list"));
    },
  },
  squish: {
    inProgress: () => sqStatus !== "idle",
    start() {
      sqNewGame();
    },
  },
  blackjack: {
    // Mid-hand, or a bet placed, or a finished hand still on the table.
    inProgress: () =>
      bjPhase === "playing" || bjBet > 0 || bjPlayerHand.length > 0,
    start() {
      bjNewRound();
    },
  },
  mines: {
    inProgress: () => msStatus !== "idle",
    start() {
      msNewGame();
    },
  },
  snake: {
    inProgress: () => snStatus !== "idle",
    start() {
      if (!snCells.length) snBuild();
      snRender();
    },
  },
  dino: {
    inProgress: () => dnStatus !== "idle",
    start() {
      dnBestEl.textContent = dnReadBest();
      dnDraw();
    },
  },
  sudoku: {
    inProgress: () => suStatus !== "idle",
    start() {
      suNewGame();
    },
  },
  sequence: {
    inProgress: () => smSequence.length > 0,
    start() {
      // Waits for Start rather than firing a pattern at you on arrival.
      if (!smButtons.length) smBuildPads();
      smRender();
    },
  },
};

function openGame(id) {
  const game = GAMES[id];
  if (!game) return;

  activeGame = id;
  gamesMenu.hidden = true;
  gameView.hidden = false;
  gameView.querySelectorAll(".game-pane").forEach((pane) => {
    pane.hidden = pane.dataset.game !== id;
  });

  /* Only deal a fresh game when there is nothing to come back to. Panes are
     hidden rather than destroyed, so a game left half-finished is still
     sitting there in the DOM - starting a new one every time threw away work
     just for glancing at the menu. Each game has its own New button for when
     a fresh start is actually wanted. */
  if (!game.inProgress || !game.inProgress()) game.start();
}

function closeGame() {
  activeGame = null;
  gameView.hidden = true;
  gamesMenu.hidden = false;
}

gamesMenu.querySelectorAll(".game-card").forEach((card) => {
  card.addEventListener("click", () => openGame(card.dataset.game));
});

gamesBack.addEventListener("click", closeGame);

flNewBtn.addEventListener("click", () => flNewGame());

// A real keyboard should work, not just the on-screen one.
document.addEventListener("keydown", (event) => {
  if (!flActive() || fl.status !== "playing") return;
  if (isTyping(event.target)) return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;

  if (event.key === "Enter") {
    event.preventDefault();
    flPress("Enter");
    return;
  }

  if (event.key === "Backspace") {
    event.preventDefault();
    flPress("Back");
    return;
  }

  const letter = event.key.toLowerCase();
  if (/^[a-z]$/.test(letter)) {
    event.preventDefault();
    flPress(letter);
  }
});

flBuildKeyboard();
flRenderBoard();

/* ==========================================================================
   Squish 2048

   Standard 2048 rules. Tiles keep a stable identity across moves and are
   positioned with transform, so the browser animates them sliding instead of
   them teleporting between cells.
   ========================================================================== */

const sqBoard = document.getElementById("sq-board");
const sqScoreEl = document.getElementById("sq-score");
const sqBestEl = document.getElementById("sq-best");
const sqMessage = document.getElementById("sq-message");
const sqNewBtn = document.getElementById("sq-new");

const SQ_N = 4;
const SQ_TILE = 64;
const SQ_GAP = 6;
const SQ_BEST_KEY = "focus-app-sq-best-tile";

// Warm at the low end, cool and deeper as the numbers climb.
const SQ_COLOURS = {
  2: "#f4e7c3",
  4: "#f2d9a0",
  8: "#f5b877",
  16: "#f39c63",
  32: "#ef7f5e",
  64: "#e85f52",
  128: "#e0568b",
  256: "#c14fb4",
  512: "#9450d4",
  1024: "#6a5ae0",
  2048: "#3fc9c0",
};

let sqGrid = [];
let sqTiles = [];
let sqNextId = 1;
let sqScore = 0;
let sqBest = 0;
let sqStatus = "idle";

function sqReadBest() {
  try {
    return Number(localStorage.getItem(SQ_BEST_KEY)) || 0;
  } catch (error) {
    return 0;
  }
}

function sqWriteBest(value) {
  try {
    localStorage.setItem(SQ_BEST_KEY, String(value));
  } catch (error) {
    // Storage blocked. A lost high score is not worth failing over.
  }
}

function sqEmptyGrid() {
  return Array.from({ length: SQ_N }, () => new Array(SQ_N).fill(null));
}

/* Maps a position along a line to a cell, per direction. Writing it once here
   means the move logic below does not need four near-identical copies. */
function sqCellAt(dir, line, pos) {
  if (dir === "left") return { row: line, col: pos };
  if (dir === "right") return { row: line, col: SQ_N - 1 - pos };
  if (dir === "up") return { row: pos, col: line };
  return { row: SQ_N - 1 - pos, col: line };
}

function sqSpawn() {
  const free = [];
  for (let row = 0; row < SQ_N; row++) {
    for (let col = 0; col < SQ_N; col++) {
      if (!sqGrid[row][col]) free.push({ row, col });
    }
  }
  if (!free.length) return null;

  const spot = free[Math.floor(Math.random() * free.length)];
  const tile = {
    id: sqNextId++,
    value: Math.random() < 0.9 ? 2 : 4,
    row: spot.row,
    col: spot.col,
    spawned: true,
    merged: false,
  };
  sqGrid[spot.row][spot.col] = tile;
  sqTiles.push(tile);
  return tile;
}

function sqCanMove() {
  for (let row = 0; row < SQ_N; row++) {
    for (let col = 0; col < SQ_N; col++) {
      const tile = sqGrid[row][col];
      if (!tile) return true;
      const right = col + 1 < SQ_N ? sqGrid[row][col + 1] : null;
      const down = row + 1 < SQ_N ? sqGrid[row + 1][col] : null;
      if (right && right.value === tile.value) return true;
      if (down && down.value === tile.value) return true;
    }
  }
  return false;
}

/* The squish. A short noise burst through a low-pass filter that sweeps
   downwards, with a fast attack and decay - which is roughly what a wet,
   soft thing sounds like when pressed.

   Bigger merges sound lower and longer, so the sound tells you the size of
   what just happened, and every pop is pitch-jittered so no two are alike.
   Identical pops become grating within about ten clicks. */
let sqAudioCtx = null;

function sqSquishSound(value) {
  try {
    if (!sqAudioCtx) {
      sqAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (sqAudioCtx.state === "suspended") sqAudioCtx.resume();
  } catch (error) {
    return; // No audio available; the game still plays.
  }

  const ctx = sqAudioCtx;
  const now = ctx.currentTime;

  const tier = Math.log2(value); // 4 -> 2, 2048 -> 11
  const base = 460 / Math.pow(1.16, tier);
  const jitter = 0.88 + Math.random() * 0.24;
  const dur = 0.13 + tier * 0.012;

  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  }

  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.Q = 7;
  filter.frequency.setValueAtTime(base * 2.6 * jitter, now);
  filter.frequency.exponentialRampToValueAtTime(base * 0.5 * jitter, now + dur);

  const gain = ctx.createGain();
  const peak = Math.max(0.0002, 0.3 * masterVolume);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(peak, now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  source.start(now);
  source.stop(now + dur + 0.02);
}

/* ---- Drawing ---- */

function sqOffset(index) {
  return SQ_GAP + index * (SQ_TILE + SQ_GAP);
}

function sqBuildCells() {
  sqBoard.innerHTML = "";
  for (let row = 0; row < SQ_N; row++) {
    for (let col = 0; col < SQ_N; col++) {
      const cell = document.createElement("div");
      cell.className = "sq-cell";
      cell.style.left = sqOffset(col) + "px";
      cell.style.top = sqOffset(row) + "px";
      sqBoard.append(cell);
    }
  }
}

function sqRender() {
  const seen = new Set();

  sqTiles.forEach((tile) => {
    seen.add(tile.id);
    let el = sqBoard.querySelector('[data-tile="' + tile.id + '"]');

    if (!el) {
      el = document.createElement("div");
      el.className = "sq-tile";
      el.dataset.tile = tile.id;
      sqBoard.append(el);
    }

    const digits = String(tile.value).length;
    el.className =
      "sq-tile" +
      (digits > 3 ? " len4" : digits === 3 ? " len3" : "") +
      (tile.spawned ? " is-spawn" : "") +
      (tile.merged ? " is-merge" : "");

    el.textContent = tile.value;
    el.style.background = SQ_COLOURS[tile.value] || "#2fbf9f";

    // The keyframes reuse this via var(--pos), so a squish animates on top of
    // the tile's position instead of throwing it back to the origin.
    const pos = "translate(" + sqOffset(tile.col) + "px," + sqOffset(tile.row) + "px)";
    el.style.setProperty("--pos", pos);
    el.style.transform = pos;

    tile.spawned = false;
    tile.merged = false;
  });

  sqBoard.querySelectorAll(".sq-tile").forEach((el) => {
    if (!seen.has(Number(el.dataset.tile))) el.remove();
  });

  sqScoreEl.textContent = sqScore;
  sqBestEl.textContent = sqBest;
}

/* ---- Moving ---- */

const SQ_SLIDE_MS = 140;
let sqBusy = false;
let sqWon = false;

function sqMove(dir) {
  if (sqStatus !== "playing" || sqBusy) return;

  let moved = false;
  const pairs = []; // { survivor, absorbed, value }

  for (let line = 0; line < SQ_N; line++) {
    const inLine = [];
    for (let pos = 0; pos < SQ_N; pos++) {
      const { row, col } = sqCellAt(dir, line, pos);
      const tile = sqGrid[row][col];
      if (tile) inLine.push(tile);
    }

    // Compact towards the wall, merging each pair at most once.
    const out = [];
    for (let i = 0; i < inLine.length; i++) {
      const a = inLine[i];
      const b = inLine[i + 1];
      if (b && a.value === b.value) {
        pairs.push({ survivor: a, absorbed: b, value: a.value * 2 });
        out.push(a);
        i++;
      } else {
        out.push(a);
      }
    }

    for (let pos = 0; pos < SQ_N; pos++) {
      const { row, col } = sqCellAt(dir, line, pos);
      const tile = out[pos] || null;
      sqGrid[row][col] = tile;
      if (tile) {
        if (tile.row !== row || tile.col !== col) moved = true;
        tile.row = row;
        tile.col = col;
      }
    }
  }

  if (pairs.length) moved = true;
  if (!moved) return;

  /* Phase one: everything slides, absorbed tiles included, and they still
     show their old numbers. Sliding a tile that has already become a 64 looks
     wrong - the doubling should happen on arrival, not in transit. */
  pairs.forEach(({ survivor, absorbed }) => {
    absorbed.row = survivor.row;
    absorbed.col = survivor.col;
  });

  sqBusy = true;
  sqRender();

  // Phase two: the absorbed tile is gone, the survivor doubles and squishes.
  setTimeout(() => {
    const dead = new Set(pairs.map((p) => p.absorbed));
    sqTiles = sqTiles.filter((tile) => !dead.has(tile));

    let gained = 0;
    let biggest = 0;
    pairs.forEach(({ survivor, value }) => {
      survivor.value = value;
      survivor.merged = true;
      gained += value;
      biggest = Math.max(biggest, value);
    });

    sqScore += gained;

    // "Best" is the biggest tile ever reached, not accumulated points - that
    // is the number people actually care about in 2048.
    const highest = sqTiles.reduce((max, tile) => Math.max(max, tile.value), 0);
    if (highest > sqBest) {
      sqBest = highest;
      sqWriteBest(sqBest);
    }

    sqSpawn();
    sqRender();
    if (biggest) sqSquishSound(biggest);
    sqBusy = false;

    if (biggest >= 2048 && !sqWon) {
      sqWon = true;
      sqMessage.textContent = "2048! Keep going if you like.";
    } else if (!sqCanMove()) {
      sqStatus = "over";
      sqMessage.textContent = "No moves left — " + sqScore + " points";
    }
  }, SQ_SLIDE_MS);
}

function sqNewGame() {
  sqGrid = sqEmptyGrid();
  sqTiles = [];
  sqScore = 0;
  sqBest = sqReadBest();
  sqStatus = "playing";
  sqBusy = false;
  sqWon = false;
  sqMessage.textContent = " ";
  sqBuildCells();
  sqSpawn();
  sqSpawn();
  sqRender();
}

sqNewBtn.addEventListener("click", sqNewGame);

/* ---- Input ---- */

const SQ_KEYS = {
  arrowleft: "left",
  arrowright: "right",
  arrowup: "up",
  arrowdown: "down",
  a: "left",
  d: "right",
  w: "up",
  s: "down",
};

document.addEventListener("keydown", (event) => {
  if (openPanel !== "games" || activeGame !== "squish") return;
  if (isTyping(event.target)) return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;

  const dir = SQ_KEYS[event.key.toLowerCase()];
  if (!dir) return;

  // Arrow keys would otherwise scroll the panel.
  event.preventDefault();
  sqMove(dir);
});

// Swipe, so it works on a phone.
let sqSwipeFrom = null;

sqBoard.addEventListener("pointerdown", (event) => {
  sqSwipeFrom = { x: event.clientX, y: event.clientY };
});

sqBoard.addEventListener("pointerup", (event) => {
  if (!sqSwipeFrom) return;
  const dx = event.clientX - sqSwipeFrom.x;
  const dy = event.clientY - sqSwipeFrom.y;
  sqSwipeFrom = null;

  // Ignore taps and tiny drags.
  if (Math.abs(dx) < 24 && Math.abs(dy) < 24) return;

  if (Math.abs(dx) > Math.abs(dy)) sqMove(dx > 0 ? "right" : "left");
  else sqMove(dy > 0 ? "down" : "up");
});

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
let bjPlayerHand = [];
let bjDealerHand = [];
let bjChips = BJ_START_CHIPS;
let bjBet = 0;
let bjPhase = "betting"; // betting | playing | done
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

function bjNewRound() {
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

/* ==========================================================================
   Music

   Spotify's own embed player. Nothing is loaded until a playlist is chosen -
   embedding it on page load would pull Spotify's script and cookies into
   every visit, including visits where nobody touches the music panel.
   ========================================================================== */

const musicList = document.getElementById("music-list");
const musicMine = document.getElementById("music-mine");
const musicMineEmpty = document.getElementById("music-mine-empty");
const musicPlayer = document.getElementById("music-player");
const musicForm = document.getElementById("music-add");
const musicNameInput = document.getElementById("music-name");
const musicUrlInput = document.getElementById("music-url");
const musicError = document.getElementById("music-error");

const MUSIC_LAST_KEY = "focus-app-music-last";
const MUSIC_CUSTOM_KEY = "focus-app-music-custom";

const PLAYLISTS = [
  { name: "Lofi", id: "0vvXsWCC9xrXsKd4FyS8kM" },
  { name: "Morning Lofi", id: "3pTzWcIQHM5pUTJJcZoZr6" },
  { name: "Synthwave", id: "1YIe34rcmLjCYpY9wJoM2p" },
  { name: "Bouncy Synthwave", id: "1F9Di2wBgnwMqfWqYYuYKR" },
  { name: "Jazz", id: "5boMTmAPPigEsoB6kRB0CB" },
  { name: "Dark Ambient", id: "07lYUEyTkWP3NqIa7Kzyqx" },
  { name: "Sleepy", id: "5WeNl7LfgUHUYOnCFOPkls" },
];

let activePlaylist = null;

/* Accepts what people actually paste: a share link with its ?si= tracking
   parameter, a link with Spotify's /intl-xx/ locale prefix, a spotify: URI,
   or a bare id. */
function parsePlaylistId(text) {
  const input = String(text || "").trim();
  if (!input) return null;

  let match = input.match(/^spotify:playlist:([A-Za-z0-9]+)$/);
  if (match) return match[1];

  match = input.match(
    /open\.spotify\.com\/(?:intl-[a-z-]+\/)?playlist\/([A-Za-z0-9]+)/
  );
  if (match) return match[1];

  if (/^[A-Za-z0-9]{16,30}$/.test(input)) return input;
  return null;
}

function readCustomPlaylists() {
  try {
    const list = JSON.parse(localStorage.getItem(MUSIC_CUSTOM_KEY));
    return Array.isArray(list)
      ? list.filter((p) => p && typeof p.id === "string")
      : [];
  } catch (error) {
    return [];
  }
}

function writeCustomPlaylists(list) {
  try {
    localStorage.setItem(MUSIC_CUSTOM_KEY, JSON.stringify(list));
  } catch (error) {
    // Storage blocked; the list just won't survive a reload.
  }
}

function playPlaylist(id) {
  activePlaylist = id;

  /* Rebuilt rather than reusing the iframe: pointing an existing Spotify
     embed at a new src leaves the previous player's state behind. */
  musicPlayer.innerHTML = "";
  const frame = document.createElement("iframe");
  frame.src =
    "https://open.spotify.com/embed/playlist/" + id + "?utm_source=generator";
  frame.loading = "lazy";
  frame.allow =
    "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture";
  frame.setAttribute("title", "Spotify playlist");
  musicPlayer.append(frame);

  document.querySelectorAll(".music-chip").forEach((chip) => {
    chip.classList.toggle("is-active", chip.dataset.playlist === id);
  });

  try {
    localStorage.setItem(MUSIC_LAST_KEY, id);
  } catch (error) {
    // Storage blocked; the choice just won't be remembered.
  }
}

function musicChip(playlist, removable) {
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "music-chip" + (removable ? " is-custom" : "");
  chip.dataset.playlist = playlist.id;
  chip.classList.toggle("is-active", playlist.id === activePlaylist);

  const label = document.createElement("span");
  label.textContent = playlist.name;
  chip.append(label);
  chip.addEventListener("click", () => playPlaylist(playlist.id));

  if (removable) {
    const remove = document.createElement("span");
    remove.className = "music-remove";
    remove.textContent = "×";
    remove.setAttribute("role", "button");
    remove.setAttribute("aria-label", "Remove " + playlist.name);
    remove.addEventListener("click", (event) => {
      // Without this the click also reaches the chip and starts playing it.
      event.stopPropagation();
      writeCustomPlaylists(readCustomPlaylists().filter((p) => p.id !== playlist.id));
      renderCustomPlaylists();
    });
    chip.append(remove);
  }

  return chip;
}

function renderCustomPlaylists() {
  const list = readCustomPlaylists();
  musicMine.innerHTML = "";
  list.forEach((playlist) => musicMine.append(musicChip(playlist, true)));
  musicMineEmpty.hidden = list.length > 0;
}

function buildMusicList() {
  musicList.innerHTML = "";
  PLAYLISTS.forEach((playlist) => musicList.append(musicChip(playlist, false)));
  musicPlayer.innerHTML = '<p class="music-empty">Pick a playlist to start</p>';
  renderCustomPlaylists();
}

musicForm.addEventListener("submit", (event) => {
  event.preventDefault();
  musicError.hidden = true;

  const id = parsePlaylistId(musicUrlInput.value);
  if (!id) {
    musicError.textContent =
      "That does not look like a Spotify playlist link.";
    musicError.hidden = false;
    return;
  }

  const existing = readCustomPlaylists();
  if (existing.some((p) => p.id === id) || PLAYLISTS.some((p) => p.id === id)) {
    musicError.textContent = "That playlist is already here.";
    musicError.hidden = false;
    return;
  }

  const name =
    musicNameInput.value.trim() || "Playlist " + (existing.length + 1);
  writeCustomPlaylists(existing.concat([{ name, id }]));

  musicNameInput.value = "";
  musicUrlInput.value = "";
  renderCustomPlaylists();
  playPlaylist(id);
});

buildMusicList();

/* ==========================================================================
   Minesweeper

   Nine by nine, ten mines - a beginner board, which runs a couple of minutes
   rather than the half hour an expert board takes. That matters here: this
   sits in a panel called Brain Breaks.
   ========================================================================== */

const msBoard = document.getElementById("ms-board");
const msLeftEl = document.getElementById("ms-left");
const msTimeEl = document.getElementById("ms-time");
const msBestEl = document.getElementById("ms-best");
const msMessageEl = document.getElementById("ms-message");
const msNewBtn = document.getElementById("ms-new");

const MS_N = 9;
const MS_MINES = 10;
const MS_BEST_KEY = "focus-app-ms-best";

let msCells = [];
let msButtons = [];
let msStatus = "idle"; // idle | playing | won | lost
let msMinesPlaced = false;
let msStartedAt = 0;
let msTicker = null;

function msReadBest() {
  try {
    return Number(localStorage.getItem(MS_BEST_KEY)) || 0;
  } catch (error) {
    return 0;
  }
}

function msNeighbours(index) {
  const row = Math.floor(index / MS_N);
  const col = index % MS_N;
  const out = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const r = row + dr;
      const c = col + dc;
      if (r >= 0 && r < MS_N && c >= 0 && c < MS_N) out.push(r * MS_N + c);
    }
  }
  return out;
}

/* Mines are placed after the first click, never on it or beside it. Placing
   them up front means the first click can lose the game before you have any
   information, which is not a puzzle, just a coin toss. Excluding the
   neighbours too guarantees the first click opens a region rather than a
   single number. */
function msPlaceMines(safeIndex) {
  const forbidden = new Set([safeIndex].concat(msNeighbours(safeIndex)));
  const candidates = [];
  for (let i = 0; i < MS_N * MS_N; i++) {
    if (!forbidden.has(i)) candidates.push(i);
  }

  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const swap = candidates[i];
    candidates[i] = candidates[j];
    candidates[j] = swap;
  }

  candidates.slice(0, MS_MINES).forEach((i) => {
    msCells[i].mine = true;
  });

  msCells.forEach((cell, i) => {
    cell.count = msNeighbours(i).filter((n) => msCells[n].mine).length;
  });

  msMinesPlaced = true;
}

function msElapsed() {
  return msStartedAt ? Math.floor((Date.now() - msStartedAt) / 1000) : 0;
}

function msStopClock() {
  clearInterval(msTicker);
  msTicker = null;
}

function msBeginClock() {
  msStatus = "playing";
  msStartedAt = Date.now();
  msStopClock();
  msTicker = setInterval(() => {
    msTimeEl.textContent = msElapsed();
  }, 1000);
}

function msRender() {
  msCells.forEach((cell, i) => {
    const button = msButtons[i];
    let className = "ms-cell";
    let label = "";

    if (cell.open) {
      className += " is-open";
      if (cell.mine) {
        className += cell.boom ? " is-boom" : " is-mine";
        label = "✳";
      } else if (cell.count) {
        className += " ms-" + cell.count;
        label = cell.count;
      }
    } else if (cell.flag) {
      className += " is-flagged";
      label = "⚑";
    }

    if (button.className !== className) button.className = className;
    if (button.textContent !== String(label)) button.textContent = label;
  });

  const flagged = msCells.filter((cell) => cell.flag && !cell.open).length;
  msLeftEl.textContent = Math.max(0, MS_MINES - flagged);
  msTimeEl.textContent = msElapsed();
  const best = msReadBest();
  msBestEl.textContent = best ? best + "s" : "—";
}

function msLose(index) {
  msStatus = "lost";
  msStopClock();
  msCells[index].boom = true;
  msCells.forEach((cell) => {
    if (cell.mine) cell.open = true;
  });
  msMessageEl.textContent = "Boom — try again";
  msRender();
}

function msCheckWin() {
  if (!msCells.every((cell) => cell.mine || cell.open)) return;

  msStatus = "won";
  msStopClock();
  const seconds = msElapsed();
  const best = msReadBest();

  if (!best || seconds < best) {
    try {
      localStorage.setItem(MS_BEST_KEY, String(seconds));
    } catch (error) {
      // Storage blocked; the best time just won't persist.
    }
    msMessageEl.textContent = "Cleared in " + seconds + "s — new best";
  } else {
    msMessageEl.textContent = "Cleared in " + seconds + "s";
  }

  // Every remaining mine must be one you had not flagged.
  msCells.forEach((cell) => {
    if (cell.mine) cell.flag = true;
  });
  msRender();
}

function msOpen(index) {
  if (msStatus === "won" || msStatus === "lost") return;

  const cell = msCells[index];
  if (cell.open || cell.flag) return;

  if (!msMinesPlaced) {
    msPlaceMines(index);
    msBeginClock();
    msMessageEl.textContent = " ";
  }

  if (cell.mine) {
    msLose(index);
    return;
  }

  /* Flood fill from an empty cell, iteratively. Recursion would be neater to
     read but can nest 81 deep on an empty board. */
  const stack = [index];
  while (stack.length) {
    const at = stack.pop();
    const here = msCells[at];
    if (here.open || here.flag) continue;
    here.open = true;
    if (here.count === 0) {
      msNeighbours(at).forEach((n) => {
        if (!msCells[n].open) stack.push(n);
      });
    }
  }

  msRender();
  msCheckWin();
}

function msFlag(index) {
  if (msStatus === "won" || msStatus === "lost") return;
  if (msCells[index].open) return;
  msCells[index].flag = !msCells[index].flag;
  msRender();
}

/* Clicking an open number whose flags already account for its mines opens
   the rest of its neighbours. Experienced players expect this and it is most
   of what makes the game fast. */
function msChord(index) {
  const cell = msCells[index];
  if (!cell.open || !cell.count) return;

  const neighbours = msNeighbours(index);
  const flagged = neighbours.filter((n) => msCells[n].flag).length;
  if (flagged !== cell.count) return;

  neighbours.forEach((n) => {
    if (!msCells[n].flag && !msCells[n].open) msOpen(n);
  });
}

function msBuildBoard() {
  msBoard.innerHTML = "";
  msButtons = [];

  for (let i = 0; i < MS_N * MS_N; i++) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ms-cell";

    // Long press flags, for touch. The flag it raises must not then also
    // count as a click, or it would immediately open the cell.
    let pressTimer = null;
    let longPressFired = false;

    const cancelPress = () => {
      if (pressTimer) clearTimeout(pressTimer);
      pressTimer = null;
    };

    button.addEventListener("pointerdown", () => {
      longPressFired = false;
      pressTimer = setTimeout(() => {
        longPressFired = true;
        pressTimer = null;
        msFlag(i);
      }, 420);
    });
    button.addEventListener("pointerup", cancelPress);
    button.addEventListener("pointerleave", cancelPress);

    button.addEventListener("click", () => {
      if (longPressFired) {
        longPressFired = false;
        return;
      }
      if (msCells[i].open) msChord(i);
      else msOpen(i);
    });

    button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      msFlag(i);
    });

    msBoard.append(button);
    msButtons.push(button);
  }
}

function msNewGame() {
  msStopClock();
  msCells = Array.from({ length: MS_N * MS_N }, () => ({
    mine: false,
    open: false,
    flag: false,
    boom: false,
    count: 0,
  }));
  msMinesPlaced = false;
  msStatus = "idle";
  msStartedAt = 0;
  msMessageEl.textContent = "Click to start · right-click to flag";
  if (!msButtons.length) msBuildBoard();
  msRender();
}

msNewBtn.addEventListener("click", msNewGame);

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

let smSequence = [];
let smAt = 0;
let smStatus = "idle"; // idle | watching | input | over
let smButtons = [];
let smTimers = [];

function smReadBest() {
  try {
    return Number(localStorage.getItem(SM_BEST_KEY)) || 0;
  } catch (error) {
    return 0;
  }
}

function smTone(freq, seconds) {
  try {
    if (!sqAudioCtx) {
      sqAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (sqAudioCtx.state === "suspended") sqAudioCtx.resume();
  } catch (error) {
    return; // No audio; the colours still carry the game.
  }

  const ctx = sqAudioCtx;
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

function smRender() {
  smRoundEl.textContent = smSequence.length;
  smBestEl.textContent = smReadBest();
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

function smBuildPads() {
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

/* ==========================================================================
   Snake
   ========================================================================== */

const snBoard = document.getElementById("sn-board");
const snScoreEl = document.getElementById("sn-score");
const snBestEl = document.getElementById("sn-best");
const snMessageEl = document.getElementById("sn-message");
const snNewBtn = document.getElementById("sn-new");

const SN_N = 13;
const SN_BEST_KEY = "focus-app-sn-best";

let snCells = [];
let snBody = [];
let snDir = { x: 1, y: 0 };
let snQueued = [];
let snFood = 0;
let snStatus = "idle"; // idle | playing | over
let snTimer = null;

function snReadBest() {
  try {
    return Number(localStorage.getItem(SN_BEST_KEY)) || 0;
  } catch (error) {
    return 0;
  }
}

function snBuild() {
  snBoard.innerHTML = "";
  snCells = [];
  for (let i = 0; i < SN_N * SN_N; i++) {
    const cell = document.createElement("div");
    cell.className = "sn-cell";
    snBoard.append(cell);
    snCells.push(cell);
  }
}

function snPlaceFood() {
  const taken = new Set(snBody);
  const free = [];
  for (let i = 0; i < SN_N * SN_N; i++) if (!taken.has(i)) free.push(i);
  snFood = free.length ? free[Math.floor(Math.random() * free.length)] : -1;
}

function snRender() {
  snCells.forEach((cell, i) => {
    let className = "sn-cell";
    if (i === snBody[0]) className += " is-snake is-head";
    else if (snBody.includes(i)) className += " is-snake";
    else if (i === snFood) className += " is-food";
    if (cell.className !== className) cell.className = className;
  });
  snScoreEl.textContent = snBody.length;
  snBestEl.textContent = snReadBest();
}

function snStop() {
  clearInterval(snTimer);
  snTimer = null;
}

function snGameOver() {
  snStop();
  snStatus = "over";
  const best = snReadBest();
  if (snBody.length > best) {
    try {
      localStorage.setItem(SN_BEST_KEY, String(snBody.length));
    } catch (error) {
      // Storage blocked.
    }
  }
  snMessageEl.textContent = "Length " + snBody.length;
  snNewBtn.textContent = "Play again";
  snNewBtn.hidden = false;
  snRender();
}

function snTick() {
  /* Turns are queued rather than applied instantly. Two quick presses inside
     one tick could otherwise reverse the snake into itself - press up then
     left while moving right, and without the queue the second press wins
     against a direction that was never actually travelled. */
  if (snQueued.length) {
    const next = snQueued.shift();
    if (next.x !== -snDir.x || next.y !== -snDir.y) snDir = next;
  }

  const head = snBody[0];
  const x = (head % SN_N) + snDir.x;
  const y = Math.floor(head / SN_N) + snDir.y;

  if (x < 0 || x >= SN_N || y < 0 || y >= SN_N) {
    snGameOver();
    return;
  }

  const target = y * SN_N + x;

  // Biting yourself ends it - except the tail tip, which is about to move.
  if (snBody.indexOf(target) !== -1 && target !== snBody[snBody.length - 1]) {
    snGameOver();
    return;
  }

  snBody.unshift(target);

  if (target === snFood) {
    snPlaceFood();
    // A little faster with every meal.
    const speed = Math.max(70, 190 - snBody.length * 4);
    snStop();
    snTimer = setInterval(snTick, speed);
  } else {
    snBody.pop();
  }

  snRender();
}

function snNewGame() {
  snStop();
  if (!snCells.length) snBuild();
  const mid = Math.floor(SN_N / 2);
  snBody = [mid * SN_N + mid, mid * SN_N + mid - 1, mid * SN_N + mid - 2];
  snDir = { x: 1, y: 0 };
  snQueued = [];
  snStatus = "playing";
  snMessageEl.textContent = "Arrow keys, WASD or swipe";
  snNewBtn.hidden = true;
  snPlaceFood();
  snRender();
  snTimer = setInterval(snTick, 190);
}

function snTurn(x, y) {
  if (snStatus !== "playing") return;
  if (snQueued.length < 2) snQueued.push({ x, y });
}

snNewBtn.addEventListener("click", snNewGame);

const SN_KEYS = {
  arrowleft: [-1, 0], a: [-1, 0],
  arrowright: [1, 0], d: [1, 0],
  arrowup: [0, -1], w: [0, -1],
  arrowdown: [0, 1], s: [0, 1],
};

document.addEventListener("keydown", (event) => {
  if (openPanel !== "games" || activeGame !== "snake") return;
  if (isTyping(event.target)) return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const dir = SN_KEYS[event.key.toLowerCase()];
  if (!dir) return;
  event.preventDefault();
  snTurn(dir[0], dir[1]);
});

let snSwipeFrom = null;
snBoard.addEventListener("pointerdown", (e) => {
  snSwipeFrom = { x: e.clientX, y: e.clientY };
});
snBoard.addEventListener("pointerup", (e) => {
  if (!snSwipeFrom) return;
  const dx = e.clientX - snSwipeFrom.x;
  const dy = e.clientY - snSwipeFrom.y;
  snSwipeFrom = null;
  if (Math.abs(dx) < 20 && Math.abs(dy) < 20) return;
  if (Math.abs(dx) > Math.abs(dy)) snTurn(dx > 0 ? 1 : -1, 0);
  else snTurn(0, dy > 0 ? 1 : -1);
});

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
const dnBestEl = document.getElementById("dn-best");
const dnMessageEl = document.getElementById("dn-message");
const dnNewBtn = document.getElementById("dn-new");
const dnCtx = dnCanvas.getContext("2d");

const DN_BEST_KEY = "focus-app-dn-best";
const DN_W = 572;
const DN_H = 300;
const DN_GROUND = 240;
const DN_GRAVITY = 0.9;
const DN_JUMP = -17;

const DN_SPEED_START = 4.6;
const DN_SPEED_MAX = 9.5;
const DN_ACCEL = 0.0006;

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
let dnStatus = "idle"; // idle | playing | over
let dnFrame = null;
let dnSinceSpawn = 0;
let dnLast = 0;

function dnReadBest() {
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

function dnDraw() {
  const accent =
    getComputedStyle(document.documentElement)
      .getPropertyValue("--accent")
      .trim() || "#7c5cff";

  dnCtx.clearRect(0, 0, DN_W, DN_H);

  dnCtx.strokeStyle = "rgba(255,255,255,0.28)";
  dnCtx.lineWidth = 3;
  dnCtx.beginPath();
  dnCtx.moveTo(0, DN_GROUND + 2);
  dnCtx.lineTo(DN_W, DN_GROUND + 2);
  dnCtx.stroke();

  // Runner.
  dnCtx.fillStyle = "#ffffff";
  dnCtx.beginPath();
  dnCtx.roundRect(60, dnRunner.y - dnRunner.h, DN_TALL, dnRunner.h, 8);
  dnCtx.fill();

  dnObstacles.forEach((ob) => {
    dnCtx.fillStyle = accent;
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
  dnSinceSpawn += dt;

  /* Spacing is randomised but floored at a distance the runner can clear at
     the current speed, so late spawns stay jumpable. */
  const minGap = Math.max(58, 150 - dnSpeed * 5);
  if (dnSinceSpawn > minGap && Math.random() < 0.035) {
    dnSpawn();
    dnSinceSpawn = 0;
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
  dnScoreEl.textContent = Math.floor(dnScore / 6);

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
  dnScore = 0;
  dnSinceSpawn = 0;
  dnLast = 0;
  dnStatus = "playing";
  dnScoreEl.textContent = 0;
  dnBestEl.textContent = dnReadBest();
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

/* ==========================================================================
   Sudoku

   Puzzles are generated rather than shipped: fill a grid at random, then
   remove clues one at a time, keeping a removal only while exactly one
   solution remains. A puzzle with two solutions is not a puzzle - you would
   reach a point where logic runs out and guessing takes over.
   ========================================================================== */

const suBoard = document.getElementById("su-board");
const suPad = document.getElementById("su-pad");
const suTimeEl = document.getElementById("su-time");
const suLeftEl = document.getElementById("su-left");
const suMessageEl = document.getElementById("su-message");
const suNewBtn = document.getElementById("su-new");

const SU_GIVENS = 36;

let suPuzzle = [];
let suGrid = [];
let suSolution = [];
let suCellEls = [];
let suSelected = -1;
let suStatus = "idle"; // idle | playing | done
let suStartedAt = 0;
let suTicker = null;

function suAllowed(grid, index, value) {
  const row = Math.floor(index / 9);
  const col = index % 9;

  for (let i = 0; i < 9; i++) {
    if (grid[row * 9 + i] === value) return false;
    if (grid[i * 9 + col] === value) return false;
  }

  const boxRow = Math.floor(row / 3) * 3;
  const boxCol = Math.floor(col / 3) * 3;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      if (grid[(boxRow + r) * 9 + boxCol + c] === value) return false;
    }
  }

  return true;
}

function suShuffled(list) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const swap = out[i];
    out[i] = out[j];
    out[j] = swap;
  }
  return out;
}

function suFill(grid) {
  const index = grid.indexOf(0);
  if (index === -1) return true;

  for (const value of suShuffled([1, 2, 3, 4, 5, 6, 7, 8, 9])) {
    if (!suAllowed(grid, index, value)) continue;
    grid[index] = value;
    if (suFill(grid)) return true;
    grid[index] = 0;
  }

  return false;
}

/* Counts solutions, stopping as soon as `limit` are found. Only ever called
   with limit 2, because the single question that matters is "is there more
   than one?" - counting them all would be far slower for no benefit. */
function suCountSolutions(grid, limit) {
  const index = grid.indexOf(0);
  if (index === -1) return 1;

  let found = 0;
  for (let value = 1; value <= 9; value++) {
    if (!suAllowed(grid, index, value)) continue;
    grid[index] = value;
    found += suCountSolutions(grid, limit - found);
    grid[index] = 0;
    if (found >= limit) break;
  }

  return found;
}

function suGenerate(givens) {
  const solution = new Array(81).fill(0);
  suFill(solution);

  const puzzle = solution.slice();
  let remaining = 81;

  for (const index of suShuffled([...Array(81).keys()])) {
    if (remaining <= givens) break;
    const saved = puzzle[index];
    puzzle[index] = 0;
    if (suCountSolutions(puzzle.slice(), 2) === 1) {
      remaining -= 1;
    } else {
      puzzle[index] = saved; // removing it left the puzzle ambiguous
    }
  }

  return { puzzle, solution };
}

/* ---- Board ---- */

function suPeers(index) {
  const row = Math.floor(index / 9);
  const col = index % 9;
  const boxRow = Math.floor(row / 3) * 3;
  const boxCol = Math.floor(col / 3) * 3;
  const out = new Set();
  for (let i = 0; i < 9; i++) {
    out.add(row * 9 + i);
    out.add(i * 9 + col);
  }
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) out.add((boxRow + r) * 9 + boxCol + c);
  }
  out.delete(index);
  return out;
}

function suConflicts(index) {
  const value = suGrid[index];
  if (!value) return false;
  for (const peer of suPeers(index)) {
    if (suGrid[peer] === value) return true;
  }
  return false;
}

function suElapsed() {
  return suStartedAt ? Math.floor((Date.now() - suStartedAt) / 1000) : 0;
}

function suRender() {
  const selectedValue = suSelected >= 0 ? suGrid[suSelected] : 0;
  const peers = suSelected >= 0 ? suPeers(suSelected) : new Set();

  suGrid.forEach((value, index) => {
    const cell = suCellEls[index];
    const col = index % 9;
    const row = Math.floor(index / 9);

    let className = "su-cell";
    if (col === 2 || col === 5) className += " box-right";
    if (row === 2 || row === 5) className += " box-bottom";
    if (col === 8) className += " edge-right";
    if (row === 8) className += " edge-bottom";
    if (suPuzzle[index]) className += " is-given";
    if (index === suSelected) className += " is-selected";
    else if (peers.has(index)) className += " is-peer";
    else if (selectedValue && value === selectedValue) className += " is-same";
    if (value && suConflicts(index)) className += " is-wrong";

    if (cell.className !== className) cell.className = className;
    const label = value ? String(value) : "";
    if (cell.textContent !== label) cell.textContent = label;
  });

  suLeftEl.textContent = suGrid.filter((v) => !v).length;
  suTimeEl.textContent = suElapsed();
}

function suCheckDone() {
  if (suGrid.some((v) => !v)) return;
  if (suGrid.some((_, i) => suConflicts(i))) return;

  suStatus = "done";
  clearInterval(suTicker);
  suTicker = null;
  suSelected = -1;
  suMessageEl.textContent = "Solved in " + suElapsed() + "s";
  suRender();
}

function suSet(value) {
  if (suStatus !== "playing") return;
  if (suSelected < 0) return;
  if (suPuzzle[suSelected]) return; // a given, not yours to change

  suGrid[suSelected] = value;
  suRender();
  suCheckDone();
}

function suBuildBoard() {
  suBoard.innerHTML = "";
  suCellEls = [];

  for (let i = 0; i < 81; i++) {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "su-cell";
    cell.addEventListener("click", () => {
      if (suStatus !== "playing") return;
      suSelected = i;
      suRender();
    });
    suBoard.append(cell);
    suCellEls.push(cell);
  }

  suPad.innerHTML = "";
  for (let n = 1; n <= 9; n++) {
    const key = document.createElement("button");
    key.type = "button";
    key.className = "su-key";
    key.textContent = n;
    key.addEventListener("click", () => suSet(n));
    suPad.append(key);
  }
  const erase = document.createElement("button");
  erase.type = "button";
  erase.className = "su-key";
  erase.textContent = "⌫";
  erase.addEventListener("click", () => suSet(0));
  suPad.append(erase);
}

function suNewGame() {
  clearInterval(suTicker);
  if (!suCellEls.length) suBuildBoard();

  suMessageEl.textContent = "Generating…";
  suStatus = "idle";

  /* Generation blocks for a moment, so yield a frame first - otherwise the
     "Generating" message never gets painted before the work starts. */
  requestAnimationFrame(() => {
    const made = suGenerate(SU_GIVENS);
    suPuzzle = made.puzzle;
    suSolution = made.solution;
    suGrid = made.puzzle.slice();
    suSelected = -1;
    suStatus = "playing";
    suStartedAt = Date.now();
    suMessageEl.textContent = " ";
    suTicker = setInterval(() => {
      suTimeEl.textContent = suElapsed();
    }, 1000);
    suRender();
  });
}

suNewBtn.addEventListener("click", suNewGame);

document.addEventListener("keydown", (event) => {
  if (openPanel !== "games" || activeGame !== "sudoku") return;
  if (isTyping(event.target)) return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;

  if (/^[1-9]$/.test(event.key)) {
    event.preventDefault();
    suSet(Number(event.key));
    return;
  }

  if (event.key === "Backspace" || event.key === "Delete" || event.key === "0") {
    event.preventDefault();
    suSet(0);
    return;
  }

  // Arrow keys move the selection around the grid.
  const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -9, ArrowDown: 9 };
  if (moves[event.key] === undefined) return;
  event.preventDefault();
  if (suSelected < 0) suSelected = 0;
  else {
    const next = suSelected + moves[event.key];
    const sameRow = Math.floor(next / 9) === Math.floor(suSelected / 9);
    const horizontal = Math.abs(moves[event.key]) === 1;
    if (next >= 0 && next < 81 && (!horizontal || sameRow)) suSelected = next;
  }
  suRender();
});
