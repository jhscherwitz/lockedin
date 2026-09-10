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
  { id: "forest", name: "Forest" },
  { id: "aurora", name: "Aurora" },
  { id: "midnight", name: "Midnight" },
  { id: "ember", name: "Ember" },
  { id: "tide", name: "Tide" },
  { id: "dawn", name: "Dawn" },
  { id: "canopy", name: "Dapple" },
  { id: "fog", name: "Fog" },
  { id: "noir", name: "Noir" },
  { id: "paper", name: "Paper" },
];

const DEFAULT_THEME = "forest";

/* ---- Fonts ----

   Grouped, because a flat list of twenty-seven is a wall.

   `weight` exists because several display faces ship exactly one weight. The
   timer asks for 700, and when a font only has a 400 the browser fakes the
   bold by smearing the glyphs sideways - which reads as a rendering fault
   rather than a typeface. Those entries declare 400 and get their real
   drawing instead.

   `google` is the Google Fonts query for that family. Only the three in the
   upfront <link> load at startup; the rest arrive when the settings panel
   opens. A visitor uses one font, and downloading twenty-four others before
   the first paint would be silly. */

const FONTS = [
  // These three are in the upfront <link>, so they need no google entry.
  { label: "Clash Display", group: "Sans", stack: '"Clash Display", "Outfit", system-ui, sans-serif' },
  { label: "Outfit", group: "Sans", stack: '"Outfit", system-ui, sans-serif' },
  { label: "Satoshi", group: "Sans", stack: '"Satoshi", system-ui, sans-serif' },

  { label: "Inter", group: "Sans", stack: '"Inter", system-ui, sans-serif', google: "Inter:wght@300;400;500;600;700" },
  { label: "Roboto", group: "Sans", stack: '"Roboto", system-ui, sans-serif', google: "Roboto:wght@300;400;500;700" },
  { label: "Poppins", group: "Sans", stack: '"Poppins", system-ui, sans-serif', google: "Poppins:wght@300;400;500;600;700" },
  { label: "Montserrat", group: "Sans", stack: '"Montserrat", system-ui, sans-serif', google: "Montserrat:wght@300;400;500;600;700" },
  { label: "Lato", group: "Sans", stack: '"Lato", system-ui, sans-serif', google: "Lato:wght@300;400;700" },
  { label: "Nunito", group: "Sans", stack: '"Nunito", system-ui, sans-serif', google: "Nunito:wght@300;400;600;700" },
  { label: "Work Sans", group: "Sans", stack: '"Work Sans", system-ui, sans-serif', google: "Work+Sans:wght@300;400;500;600;700" },
  { label: "DM Sans", group: "Sans", stack: '"DM Sans", system-ui, sans-serif', google: "DM+Sans:wght@400;500;700" },
  { label: "Manrope", group: "Sans", stack: '"Manrope", system-ui, sans-serif', google: "Manrope:wght@400;500;600;700" },
  { label: "Rubik", group: "Sans", stack: '"Rubik", system-ui, sans-serif', google: "Rubik:wght@400;500;600;700" },
  { label: "Space Grotesk", group: "Sans", stack: '"Space Grotesk", system-ui, sans-serif', google: "Space+Grotesk:wght@400;500;600;700" },

  { label: "Bebas Neue", group: "Display", weight: 400, stack: '"Bebas Neue", Impact, sans-serif', google: "Bebas+Neue" },
  { label: "Anton", group: "Display", weight: 400, stack: '"Anton", Impact, sans-serif', google: "Anton" },
  { label: "Archivo Black", group: "Display", weight: 400, stack: '"Archivo Black", system-ui, sans-serif', google: "Archivo+Black" },
  { label: "Bungee", group: "Display", weight: 400, stack: '"Bungee", system-ui, sans-serif', google: "Bungee" },
  { label: "Syne", group: "Display", stack: '"Syne", system-ui, sans-serif', google: "Syne:wght@400;600;700;800" },
  { label: "Unbounded", group: "Display", stack: '"Unbounded", system-ui, sans-serif', google: "Unbounded:wght@300;400;600;700" },
  { label: "Orbitron", group: "Display", stack: '"Orbitron", system-ui, sans-serif', google: "Orbitron:wght@400;500;700;900" },

  { label: "Playfair Display", group: "Serif", stack: '"Playfair Display", Georgia, serif', google: "Playfair+Display:wght@400;500;600;700;800" },
  { label: "Fraunces", group: "Serif", stack: '"Fraunces", Georgia, serif', google: "Fraunces:wght@300;400;600;700" },
  { label: "Instrument Serif", group: "Serif", weight: 400, stack: '"Instrument Serif", Georgia, serif', google: "Instrument+Serif" },

  { label: "JetBrains Mono", group: "Mono", stack: '"JetBrains Mono", ui-monospace, monospace', google: "JetBrains+Mono:wght@400;500;700" },
  { label: "Major Mono Display", group: "Mono", weight: 400, stack: '"Major Mono Display", ui-monospace, monospace', google: "Major+Mono+Display" },
  { label: "Silkscreen", group: "Mono", stack: '"Silkscreen", ui-monospace, monospace', google: "Silkscreen:wght@400;700" },
];

const FONT_GROUPS = ["Sans", "Display", "Serif", "Mono"];

const fontsRequested = new Set();

function ensureFontLoaded(font) {
  if (!font || !font.google || fontsRequested.has(font.google)) return;
  fontsRequested.add(font.google);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href =
    "https://fonts.googleapis.com/css2?family=" + font.google + "&display=swap";
  document.head.append(link);
}

/* Every family at once. Called when the settings panel first opens, so the
   dropdown can draw each name in its own face - which is the only sane way to
   pick a font - without that cost landing on every visitor at startup. */
function loadAllFonts() {
  FONTS.forEach(ensureFontLoaded);
}

function fontByStack(stack) {
  return FONTS.find((font) => font.stack === stack);
}

/* One place that changes the font, so the picker and the saved-state restore
   cannot drift apart. */
export function applyFont(stack) {
  const font = fontByStack(stack);
  if (!font) return false;
  ensureFontLoaded(font);
  const root = document.documentElement.style;
  root.setProperty("--timer-font", font.stack);
  root.setProperty("--timer-weight", String(font.weight || 700));
  if (fontSelect.value !== stack) fontSelect.value = stack;
  return true;
}

function buildFontSelect() {
  FONT_GROUPS.forEach((groupName) => {
    const members = FONTS.filter((font) => font.group === groupName);
    if (!members.length) return;
    const group = document.createElement("optgroup");
    group.label = groupName;
    members.forEach((font) => {
      const option = document.createElement("option");
      option.value = font.stack;
      option.textContent = font.label;
      option.style.fontFamily = font.stack;
      group.append(option);
    });
    fontSelect.append(group);
  });

  fontSelect.addEventListener("change", () => applyFont(fontSelect.value));

  /* Give the webfonts a head start: the panel takes a moment to open and the
     font row sits below the theme grid, so by the time it is on screen the
     faces have usually arrived. */
  const settingsBtn = document.querySelector('.dock-btn[data-panel="settings"]');
  if (settingsBtn) {
    settingsBtn.addEventListener("pointerdown", loadAllFonts, { once: true });
  }
  fontSelect.addEventListener("pointerdown", loadAllFonts, { once: true });
}

const themeGrid = document.getElementById("theme-grid");
export const fontSelect = document.getElementById("font-select");
export const zoneSelect = document.getElementById("zone-select");
export const hourFormatControl = document.getElementById("hour-format-control");

export let activeTheme = DEFAULT_THEME;

export function applyTheme(id) {
  /* Ocean, Sunset and Rose are gone, so a returning visitor can easily be
     carrying an id that no longer exists. Forest was on that list too and
     is now the default, which means a visitor who chose it before it was
     removed gets it back - the one case where this fallback returns
     something the user actually picked. */
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
