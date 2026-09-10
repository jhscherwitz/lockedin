import { syncSettingInputs, updateConditionalFields } from "./settings.js";
import { MINUTE, elapsedMs, isRunning, joinSessionAt, phaseAt, render, settings } from "./timer.js";
import { showToast } from "./toast.js";

/* ==========================================================================
   Shared sessions

   Study to the same clock as someone else, with no server involved.

   This works only because of a decision made much earlier: the timer does not
   count down, it subtracts. It asks "what time is it, and when did this
   start" - which is why it never drifts across a backgrounded tab. The
   consequence, free and unplanned, is that two computers given the same start
   time compute the same remaining time forever, without ever talking to each
   other.

   So the link *is* the synchronisation. It carries the moment the session
   began and the lengths of its phases; both browsers do the same subtraction.
   No accounts, no signalling, no server, nothing to keep running.

     ?s=<epoch ms>  when the session started
     &m=pomodoro    mode, countdown otherwise
     &f=50&b=10     focus and short-break minutes
     &l=20&r=4      long break, and rounds before it

   The one thing it cannot do is fix a wrong clock. If someone's device is a
   minute out, they will be a minute out - there is no authority here to
   correct against. In practice phones and laptops sync to network time and
   this is a non-issue; it is worth knowing rather than discovering.
   ========================================================================== */

const params = new URLSearchParams(location.search);

function clampInt(raw, min, max, fallback) {
  const value = Math.round(Number(raw));
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/* Null when this is an ordinary visit. Everything downstream keys off that,
   so a normal load never touches any of this. */
function readSharedSession() {
  const start = Number(params.get("s"));
  // Sanity, not security: a garbage or absurd timestamp should be ignored
  // rather than starting a session that began in 1970.
  if (!Number.isFinite(start) || start < 1600000000000) return null;
  if (start > Date.now() + 5 * MINUTE) return null; // starts in the future

  return {
    start,
    mode: params.get("m") === "pomodoro" ? "pomodoro" : "countdown",
    focusMinutes: clampInt(params.get("f"), 1, 600, 60),
    shortBreakMinutes: clampInt(params.get("b"), 1, 60, 5),
    longBreakMinutes: clampInt(params.get("l"), 1, 60, 15),
    roundsBeforeLongBreak: clampInt(params.get("r"), 2, 10, 4),
  };
}

/* Resolved in initSession(), not here.

   Calling readSharedSession() at module scope threw on the first load:
   "Cannot access 'MINUTE' before initialization". It reads MINUTE from
   timer.js, and session.js is reached while timer.js is still evaluating -
   the same circular-import trap the whole split was built to avoid. Defining
   at load and doing when told is not a style preference; it is the only way
   this works. */
let sharedSession = null;

/* The timer settings this visitor had before a shared link overrode them.
   storage.js reads this so joining someone else's session does not quietly
   save their 50-minute Pomodoro over your own settings. */
export let timerSettingsBeforeJoin = null;

function buildLink() {
  const url = new URL(location.href);
  url.search = "";
  url.hash = "";

  /* If a session is already running, the link has to say when it *started*,
     not now - otherwise whoever opens it begins a fresh session while you are
     twenty minutes in, which is the whole thing this is meant to avoid. */
  const start = isRunning ? Date.now() - elapsedMs() : Date.now();

  url.searchParams.set("s", String(Math.round(start)));
  url.searchParams.set("m", settings.mode);
  url.searchParams.set("f", String(settings.focusMinutes));
  if (settings.mode === "pomodoro") {
    url.searchParams.set("b", String(settings.shortBreakMinutes));
    url.searchParams.set("l", String(settings.longBreakMinutes));
    url.searchParams.set("r", String(settings.roundsBeforeLongBreak));
  }
  return url.toString();
}

const shareBtn = document.getElementById("share-session");
const shareField = document.getElementById("share-link");

export function initSession() {
  sharedSession = readSharedSession();

  if (shareBtn) {
    shareBtn.addEventListener("click", async () => {
      const link = buildLink();
      if (shareField) shareField.value = link;

      try {
        await navigator.clipboard.writeText(link);
        showToast("Link copied. Anyone who opens it joins this session, in sync.");
      } catch (error) {
        /* Clipboard access can be refused outright - an insecure origin, or a
           browser that wants a more direct gesture. The field below is the
           fallback, and it is why the link is written there first. */
        if (shareField) {
          shareField.hidden = false;
          shareField.select();
        }
        showToast("Copy the link below to share this session.");
      }
    });
  }

  if (!sharedSession) return;

  // Remember what this visitor had, so storage.js can keep saving it.
  timerSettingsBeforeJoin = Object.assign({}, settings);

  settings.mode = sharedSession.mode;
  settings.focusMinutes = sharedSession.focusMinutes;
  settings.shortBreakMinutes = sharedSession.shortBreakMinutes;
  settings.longBreakMinutes = sharedSession.longBreakMinutes;
  settings.roundsBeforeLongBreak = sharedSession.roundsBeforeLongBreak;
  syncSettingInputs();
  updateConditionalFields();

  const elapsed = Date.now() - sharedSession.start;

  /* A countdown that already ran out is not a session to join. Pomodoro has
     no end, so it always has somewhere to put you. */
  if (settings.mode === "countdown" && elapsed >= settings.focusMinutes * MINUTE) {
    render();
    showToast("That session has already finished.");
    return;
  }

  joinSessionAt(elapsed);

  const at = phaseAt(elapsed);
  const where =
    settings.mode === "pomodoro"
      ? at.phase === "focus"
        ? "round " + at.round
        : at.phase === "short"
        ? "a short break"
        : "the long break"
      : "the session";
  showToast("Joined - you are in " + where + ", in sync with whoever shared it.");
}
