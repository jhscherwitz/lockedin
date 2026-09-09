/* ==========================================================================
   Toast

   Somewhere for messages the user needs to see. Anything that can fail
   should say so on screen, not only in a console nobody has open.
   ========================================================================== */

const toastEl = document.getElementById("toast");
let toastTimer = null;

export function showToast(message, ms) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.hidden = true;
  }, ms || 7000);
}
