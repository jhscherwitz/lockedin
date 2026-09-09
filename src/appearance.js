import { clockSettings, updateNow } from "./clock.js";
import { initSegmented } from "./settings.js";
import { render } from "./timer.js";

/* ==========================================================================
   Appearance and clock options

   Themes and fonts work by rewriting the CSS custom properties declared at
   the top of style.css. Nothing here knows what uses them - it just changes
   the variable, and everything referring to it updates at once.
   ========================================================================== */

/* Four moods, not six tints. A theme's whole appearance - colours, how far
   the washes reach, shape layout, blur, grain, vignette, how warm the text
   is - lives in the Themes section of style.css, keyed off a data-theme
   attribute on <html>. Nothing here knows what a theme looks like, which is
   why this list is only ids and names.

   There used to be six, all sharing one layout and one blur, so they came
   out as the same page under six filters. */
const THEMES = [
  { id: "aurora", name: "Aurora" },
  { id: "midnight", name: "Midnight" },
  { id: "ember", name: "Ember" },
  { id: "tide", name: "Tide" },
  { id: "dawn", name: "Dawn" },
  { id: "canopy", name: "Canopy" },
  { id: "fog", name: "Fog" },
  { id: "noir", name: "Noir" },
  { id: "paper", name: "Paper" },
];

const DEFAULT_THEME = "aurora";

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
export const fontSelect = document.getElementById("font-select");
export const zoneSelect = document.getElementById("zone-select");
export const hourFormatControl = document.getElementById("hour-format-control");

export let activeTheme = DEFAULT_THEME;

export function applyTheme(id) {
  /* Ocean, Sunset, Forest and Rose are gone, so a returning visitor can
     easily be carrying an id that no longer exists. */
  if (!THEMES.some((theme) => theme.id === id)) id = DEFAULT_THEME;
  activeTheme = id;

  /* The entire theme is one attribute. CSS does the rest.

     Transitions are switched off across the switch, for two reasons. Twenty
     properties easing to new values at slightly different rates looks like a
     glitch rather than a fade. And Chrome wedges a transition whose value
     comes from a custom property if the property changes repeatedly - click
     through the themes quickly and buttons get stuck on an old accent, which
     is exactly what happened here.

     Reading offsetWidth between the two class changes is the trick: it forces
     the browser to recompute styles right there, while transitions are still
     off, so the new colours land instantly and no transition ever starts. */
  const root = document.documentElement;
  root.classList.add("theme-switching");
  root.dataset.theme = id;
  void root.offsetWidth;
  root.classList.remove("theme-switching");

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


/* Called by main.js once every module has loaded. Doing this at module
   scope instead would run it while other modules were still initialising,
   which is how a circular import turns into a TDZ error. */
export function initAppearance() {
  buildThemeGrid();
  applyTheme(activeTheme);
  buildFontSelect();
  buildZoneSelect();
  initSegmented(hourFormatControl, setHourFormat);
}
