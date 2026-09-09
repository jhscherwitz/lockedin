import { displayMs, formatTime, isRunning, renderHooks, start, statusText, stop, timerEl } from "./timer.js";
import { showToast } from "./toast.js";

/* ==========================================================================
   Mini player (Document Picture-in-Picture)

   Opens a small real OS window containing the timer and a pause button. It
   floats above everything - other tabs, other applications - so the
   countdown stays visible while you work somewhere else.

   Only Chrome and Edge support this API today. Where it is missing the
   button disables itself and says why, rather than failing silently.
   ========================================================================== */

export const pipBtn = document.getElementById("pip-btn");
const pipSupported = "documentPictureInPicture" in window;

let pipWindow = null;
let pipTimeEl = null;
let pipButtonEl = null;
let pipStatusEl = null;
let pipStyleEl = null;
let pipThemeKey = null;
let pipSegments = [];

/* Rebuilds the mini window's stylesheet from the live page, so it carries the
   same background mesh, accent, font, weight and letter-spacing.

   Tracking is read off the real timer and converted to em. Copying the px
   value would be wrong: the pop-out's type is sized to its own window, so the
   same pixel tracking would be proportionally tighter or looser than the
   page's. As a ratio it stays identical at any size. */
function pipStyles() {
  const root = getComputedStyle(document.documentElement);
  const get = (name, fallback) => root.getPropertyValue(name).trim() || fallback;

  const base = get("--bg-base", "#241a3d");
  const accent = get("--accent", "#7c5cff");
  const font = get("--timer-font", '"Outfit", system-ui, sans-serif');
  const a = get("--blob-a", "#7c3aed");
  const b = get("--blob-b", "#d946ef");
  const c = get("--blob-c", "#ec4899");
  const d = get("--blob-d", "#4f46e5");

  const timer = getComputedStyle(timerEl);
  const pageSize = parseFloat(timer.fontSize) || 16;
  const trackingEm = (parseFloat(timer.letterSpacing) || 0) / pageSize;
  const weight = timer.fontWeight || "700";

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
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 19vw;
      font-weight: ${weight};
      line-height: 0.95;
      letter-spacing: ${trackingEm.toFixed(4)}em;
      font-variant-numeric: tabular-nums;
      text-shadow: 0 3px 26px rgba(0, 0, 0, 0.4);
    }
    /* Same drawn square colon as the page, in the same em units so it scales
       with the type here exactly as it does there. */
    .mini-colon {
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 0.16em;
      margin: 0 0.11em;
      transform: translateY(-0.03em);
    }
    .mini-colon::before, .mini-colon::after {
      content: "";
      display: block;
      width: 0.135em;
      height: 0.135em;
      border-radius: 0.022em;
      background: currentColor;
    }
    .mini-btn {
      border: 0;
      border-radius: 8px;
      padding: 7px 26px;
      font-family: inherit;
      font-size: 13px;
      font-weight: 700;
      color: #fff;
      background: ${accent};
      cursor: pointer;
      box-shadow: 0 6px 18px -6px rgba(0, 0, 0, 0.6);
    }
    .mini-btn:active { transform: scale(0.97); }
  `;
}

/* Mirrors setTimerText: minutes and seconds as separate spans with a drawn
   colon between, rebuilt only when crossing an hour changes the shape. */
function setPipTime(text) {
  if (!pipWindow || !pipTimeEl) return;
  const parts = text.split(":");

  if (pipSegments.length !== parts.length) {
    pipTimeEl.innerHTML = "";
    pipSegments = parts.map((_, i) => {
      if (i > 0) {
        const colon = pipWindow.document.createElement("span");
        colon.className = "mini-colon";
        pipTimeEl.append(colon);
      }
      const segment = pipWindow.document.createElement("span");
      pipTimeEl.append(segment);
      return segment;
    });
  }

  parts.forEach((part, i) => {
    if (pipSegments[i].textContent !== part) pipSegments[i].textContent = part;
  });
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

  setPipTime(formatTime(displayMs()));

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
    pipSegments = [];
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
