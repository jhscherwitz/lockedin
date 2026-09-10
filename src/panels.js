/* ==========================================================================
   Panels

   Same shape as the timer: a piece of state, one render function, and
   handlers that only ever change state. One system serves all four panels
   instead of four copies of near-identical code.
   ========================================================================== */

const dockButtons = document.querySelectorAll(".dock-btn[data-panel]");
const panels = document.querySelectorAll(".panel");
export const fullscreenBtn = document.getElementById("fullscreen-btn");

// The name of the open panel, or null when everything is closed.
export let openPanel = null;

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

  /* Panels are fixed to the left rail and the timer is centred, so on a wide
     screen they want the same band of pixels and the panel wins - it covers
     the leading digit. CSS moves the timer aside from here; which is its
     business, not this file's, so all that crosses is the fact of it. */
  document.body.classList.toggle("panel-open", openPanel !== null);
}

export function togglePanel(name) {
  // Clicking the button of the panel that's already open closes it.
  openPanel = openPanel === name ? null : name;
  renderPanels();
}

function closePanels() {
  if (!openPanel) return;
  openPanel = null;
  renderPanels();
}




// Click anywhere that isn't inside a panel or on a dock button, and we close.
// .closest() walks up from the clicked element looking for a match, so this
// works even when you click the text inside a panel rather than the panel.
const PANEL_SAFE = ["panel", "dock-btn", "focus-prompt"];


/* ---- Fullscreen ---- */



/* ==========================================================================
   Focus prompt - opens the tasks panel
   ========================================================================== */


/* Called by main.js once every module has loaded. Doing this at module
   scope instead would run it while other modules were still initialising,
   which is how a circular import turns into a TDZ error. */
export function initPanels() {
  dockButtons.forEach((btn) => {
    btn.addEventListener("click", () => togglePanel(btn.dataset.panel));
  });
  document.querySelectorAll(".panel-close").forEach((btn) => {
    btn.addEventListener("click", closePanels);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closePanels();
  });
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
  fullscreenBtn.addEventListener("click", () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      // Can be refused by the browser, so swallow the rejection.
      document.documentElement.requestFullscreen().catch(() => {});
    }
  });
  renderPanels();
  document.getElementById("focus-prompt").addEventListener("click", () => {
    togglePanel("tasks");
  });
}
