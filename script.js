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
const timerMinsEl = document.getElementById("timer-mins");
const timerSecsEl = document.getElementById("timer-secs");
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

/* The minutes and seconds are separate elements so the colon between them
   can be two drawn squares rather than a font glyph. */
function setTimerText(text) {
  const split = text.indexOf(":");
  const mins = text.slice(0, split);
  const secs = text.slice(split + 1);
  if (timerMinsEl.textContent !== mins) timerMinsEl.textContent = mins;
  if (timerSecsEl.textContent !== secs) timerSecsEl.textContent = secs;
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
  { label: "Outfit", stack: '"Outfit", system-ui, sans-serif' },
  { label: "Satoshi", stack: '"Satoshi", system-ui, sans-serif' },
  { label: "Clash Display", stack: '"Clash Display", system-ui, sans-serif' },
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

function applySavedState(data) {
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
  const font = get("--timer-font", "system-ui, sans-serif");
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
