import { gameIsActive } from "./games/shell.js";
import { fullscreenBtn, togglePanel } from "./panels.js";
import { pipBtn } from "./pip.js";
import { isRunning, resetTimer, start, stop } from "./timer.js";
import { showToast } from "./toast.js";

/* ==========================================================================
   Keyboard shortcuts
   ========================================================================== */

// Never hijack a key while someone is typing into something.
export function isTyping(target) {
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
