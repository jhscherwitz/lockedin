/* ==========================================================================
   Audio

   One AudioContext for the whole page. Browsers cap how many a page may
   create, and a context starts out suspended until the page has had a real
   click, so everything that makes a sound comes through here rather than
   building its own.
   ========================================================================== */

export let audioCtx = null;

export function audioContext() {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    // Suspended is the normal state until the page has been clicked once.
    if (audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  } catch (error) {
    return null; // No Web Audio here. Callers fall back to silence.
  }
}
