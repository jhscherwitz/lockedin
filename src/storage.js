import { activeTheme, applyTheme, fontSelect, hourFormatControl, zoneSelect } from "./appearance.js";
import { clockSettings, updateNow } from "./clock.js";
import { modeControl, positionThumb, syncSettingInputs, updateConditionalFields } from "./settings.js";
import { SOUNDS, masterSlider, masterVolume, paintSlider, setMasterVolume, soundState, tiles } from "./sounds.js";
import { notepad, renderTasks, setTasks, tasks } from "./tasks.js";
import { resetTimer, settings } from "./timer.js";

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
    themeDefaultMigrated: true,
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
export function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveState, 300);
}

// Rather than remembering to call save from twenty different places, listen
// once at the document level. Every control here is driven by one of these
// three events, so this catches all of them.

const LEGACY_DEFAULT_FONT = '"Outfit", system-ui, sans-serif';
const LEGACY_DEFAULT_THEME = "aurora";

function applySavedState(data) {
  /* The default timer font changed from Outfit to Clash Display. Anyone
     carrying the old default in their saved settings never actually chose a
     font - they just had the default - so let the new one through. The flag
     means this happens exactly once; a deliberate later choice of Outfit is
     then respected. */
  if (!data.fontDefaultMigrated && data.font === LEGACY_DEFAULT_FONT) {
    delete data.font;
  }

  /* The default theme changed from Aurora to Forest, and the same reasoning
     applies as for the font above: Aurora was the default, so almost
     everyone carrying it never chose it. Without this a returning visitor
     opens the redesign and sees the old theme, which looks exactly like
     nothing shipped. The flag means it happens once - pick Aurora
     deliberately afterwards and it stays. */
  if (!data.themeDefaultMigrated && data.theme === LEGACY_DEFAULT_THEME) {
    delete data.theme;
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
    setMasterVolume(data.master);
    masterSlider.value = Math.round(data.master * 100);
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
    setTasks(
      data.tasks.filter((task) => task && typeof task.text === "string" && task.id)
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


/* Called by main.js once every module has loaded. Doing this at module
   scope instead would run it while other modules were still initialising,
   which is how a circular import turns into a TDZ error. */
export function initStorage() {
  document.addEventListener("input", scheduleSave);
  document.addEventListener("change", scheduleSave);
  document.addEventListener("click", scheduleSave);
  window.addEventListener("beforeunload", saveState);
  loadState();
}
