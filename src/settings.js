import { bookChime, notificationsGranted, syncAlarm } from "./alerts.js";
import { scheduleSave } from "./storage.js";
import { clearBanked, render, setTimerMode, settings } from "./timer.js";
import { showToast } from "./toast.js";

/* ==========================================================================
   Settings panel
   ========================================================================== */

const focusInput = document.getElementById("focus-minutes");
const shortInput = document.getElementById("short-minutes");
const longInput = document.getElementById("long-minutes");
const roundsInput = document.getElementById("rounds");
const chimeToggle = document.getElementById("chime-toggle");
const notifyToggle = document.getElementById("notify-toggle");
export const modeControl = document.getElementById("timer-mode-control");
export function syncSettingInputs() {
  chimeToggle.checked = settings.chime;

  /* Permission can be revoked in the browser's settings between visits, so a
     saved "on" only counts if the browser still agrees. */
  settings.notify = settings.notify && notificationsGranted();
  notifyToggle.checked = settings.notify;

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
    clearBanked();
    syncAlarm();
    render();
  });
}



/* Browsers only show the permission prompt in response to a click, which is
   exactly where this runs - asking on page load would be refused. */

// Only show the fields that apply to the current mode.
export function updateConditionalFields() {
  document.querySelectorAll("[data-show-for]").forEach((field) => {
    field.hidden = !field.dataset.showFor.split(" ").includes(settings.mode);
  });
}

/* The sliding pill. Its width and position are copied from whichever segment
   is active, which is why clicking one makes it glide across. */
export function positionThumb(control) {
  const active = control.querySelector(".segment.is-active");
  const thumb = control.querySelector(".segmented-thumb");
  if (!active || !thumb) return;
  thumb.style.width = active.offsetWidth + "px";
  thumb.style.left = active.offsetLeft + "px";
}

/* Wires up any segmented control, so the pattern is written once and reused
   wherever a slider-style choice is needed. */
const segmentedControls = [];

export function initSegmented(control, onChange) {
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


/* Called by main.js once every module has loaded. Doing this at module
   scope instead would run it while other modules were still initialising,
   which is how a circular import turns into a TDZ error. */
export function initSettings() {
  bindNumberInput(focusInput, "focusMinutes", 1, 600);
  bindNumberInput(shortInput, "shortBreakMinutes", 1, 60);
  bindNumberInput(longInput, "longBreakMinutes", 1, 60);
  bindNumberInput(roundsInput, "roundsBeforeLongBreak", 2, 10);
  chimeToggle.addEventListener("change", () => {
    settings.chime = chimeToggle.checked;
    syncAlarm(); // book it for a session already running, or unbook it
    // Play it once on the way on, so the setting is not a mystery.
    if (settings.chime) bookChime(0);
  });
  notifyToggle.addEventListener("change", () => {
    if (!notifyToggle.checked) {
      settings.notify = false;
      return;
    }

    const refuse = (message) => {
      notifyToggle.checked = false;
      settings.notify = false;
      showToast(message);
    };

    if (typeof Notification === "undefined") {
      refuse("This browser cannot show notifications.");
      return;
    }

    if (Notification.permission === "denied") {
      refuse(
        "Notifications are blocked for this site. You can turn them back on in your browser's site settings."
      );
      return;
    }

    if (Notification.permission === "granted") {
      settings.notify = true;
      return;
    }

    Notification.requestPermission().then((result) => {
      settings.notify = result === "granted";
      notifyToggle.checked = settings.notify;
      if (!settings.notify) {
        showToast("Notifications stayed off - the browser did not grant permission.");
      }
      // The click that opened the prompt has long since been and gone.
      scheduleSave();
    });
  });
  document.querySelectorAll(".panel").forEach((panel) => {
    if (panel.querySelector(".tab")) initTabs(panel);
  });
  window.addEventListener("resize", positionAllThumbs);
  initSegmented(modeControl, setTimerMode);
  syncSettingInputs();
  updateConditionalFields();
  render();
}
