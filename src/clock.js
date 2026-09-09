/* ==========================================================================
   Clock

   Formatting goes through Intl.DateTimeFormat rather than Date's own
   getHours(). That is what makes 12/24-hour and timezone support possible
   without hand-writing conversion logic.
   ========================================================================== */

export const clockSettings = {
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

export function updateNow() {
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


/* Called by main.js once every module has loaded. Doing this at module
   scope instead would run it while other modules were still initialising,
   which is how a circular import turns into a TDZ error. */
export function initClock() {
  updateNow();
  setInterval(updateNow, 1000);
}
