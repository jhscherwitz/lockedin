import { audioContext, audioCtx } from "./audio.js";
import { masterVolume } from "./sounds.js";
import { APP_NAME, elapsedMs, isRunning, settings, targetMs } from "./timer.js";

/* ==========================================================================
   End-of-session alert

   The chime is booked in advance on the audio clock rather than played at the
   moment the timer reaches zero. Browsers throttle background tabs hard - a
   setInterval or setTimeout in a tab that has been hidden for a few minutes
   can be held back by up to a minute - and a focus timer that dings a minute
   late is a focus timer you stop trusting. The Web Audio clock runs on the
   audio thread and is not throttled, so a note booked an hour out still
   sounds exactly on time whatever the tab is doing.
   ========================================================================== */

/* A rising A major triad - A5, C sharp 6, E6. Three notes because two can
   pass for a stray interface blip; three read as something deliberate. */
const CHIME_NOTES = [
  { freq: 880.0, delay: 0 },
  { freq: 1108.73, delay: 0.15 },
  { freq: 1318.51, delay: 0.3 },
];
const CHIME_TAIL = 2.2; // seconds a note takes to fade away
/* Peaks around 0.73, which leaves headroom for ambient sound playing
   underneath - the destination hard-clips anything past 1.0 and that
   crackles. */
const CHIME_LEVEL = 0.42;

/* A pure sine has no harmonics at all, which is exactly what you do not want
   from an alarm competing with rain and a Spotify playlist - it disappears
   underneath them. A triangle fundamental plus an octave and a twelfth above
   gives it enough edge to stay audible without turning shrill. */
const CHIME_PARTIALS = [
  { ratio: 1, level: 1, type: "triangle" },
  { ratio: 2, level: 0.34, type: "sine" },
  { ratio: 3, level: 0.12, type: "sine" },
];

let chimeVoices = []; // every oscillator booked but not yet finished
let chimeAt = 0; // audio-clock time the first note is booked for

/* One note: struck hard and left to ring, which is roughly what a small bell
   does. Deliberately not scaled by masterVolume - that slider lives in the
   Sounds panel and reads as the ambient mixer's volume, so letting it silence
   the alarm would be a trap. The chime has its own switch instead. */
function chimeNote(ctx, at, freq) {
  CHIME_PARTIALS.forEach((partial) => {
    const osc = ctx.createOscillator();
    osc.type = partial.type;
    osc.frequency.value = freq * partial.ratio;

    const gain = ctx.createGain();
    const peak = CHIME_LEVEL * partial.level;
    // An exponential ramp cannot reach zero, hence the near-silent floor.
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(peak, at + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + CHIME_TAIL);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(at);
    osc.stop(at + CHIME_TAIL + 0.05);
    chimeVoices.push(osc);
  });
}


/* ---- Sound files in assets/alerts/ ----

   Two of them: one for the end of a timer session, one for beating a game.
   See the README in that folder.

   They are decoded into audio buffers rather than played through <audio>
   elements, because a buffer can be *scheduled* - source.start(t) takes the
   same audio-clock time the oscillators do, so the timer sound gets exactly
   the same punctuality in a throttled background tab. An <audio> element
   cannot be told to start in an hour.

   Each file is scanned for its loudest sample and gained so its peak matches
   the built-in chime, which is why it does not matter that free sound
   libraries vary wildly in level. */

const ALERT_PEAK = 0.75; // matched to the built-in chime's peak
const ALERT_MAX_GAIN = 8; // so a near-silent file is not amplified into hiss

const ALERT_SOUNDS = {
  timer: {
    paths: ["assets/alerts/alarm-sound.mp3", "assets/alerts/chime.mp3"],
    // An alarm ignores the ambient mixer's volume. See chimeNote().
    scaleByMaster: false,
    buffer: null,
    gain: 1,
    name: "",
  },
  win: {
    paths: ["assets/alerts/game-achievement.mp3", "assets/alerts/win.mp3"],
    // A win sound is incidental, like the other game sounds, so it follows
    // the master volume the way they do - that is how you turn it off.
    scaleByMaster: true,
    buffer: null,
    gain: 1,
    name: "",
  },
};

let alertsLoading = false;

function timerFileReady() {
  return ALERT_SOUNDS.timer.buffer !== null;
}

/* Your file is the chime, full stop. The synthesised one is no longer an
   alternative, only the fallback for when the file is missing - without that
   a renamed or deleted MP3 would mean no alarm at all, which is the one
   failure this whole feature exists to prevent. */
function usingAlertFile() {
  return timerFileReady();
}

/* The loudest sample in the file. An alarm you cannot hear is not an alarm,
   and a win sound that blows your headphones off is worse. */
function bufferPeak(buffer) {
  let peak = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i++) {
      const value = Math.abs(data[i]);
      if (value > peak) peak = value;
    }
  }
  return peak;
}

async function loadAlertSound(sound, ctx) {
  for (const path of sound.paths) {
    try {
      // HEAD first: a 404 here costs nothing, where fetching the file to
      // find out it is missing would download it.
      const head = await fetch(path, { method: "HEAD" });
      if (!head.ok) continue;

      const bytes = await (await fetch(path)).arrayBuffer();
      const buffer = await ctx.decodeAudioData(bytes);
      const peak = bufferPeak(buffer);

      sound.buffer = buffer;
      sound.gain = peak > 0 ? Math.min(ALERT_MAX_GAIN, ALERT_PEAK / peak) : 1;
      sound.name = path.split("/").pop();
      return;
    } catch (error) {
      // Missing, offline, or not audio this browser can decode. The timer
      // still has its built-in chime; a game just stays quiet.
    }
  }
}

/* Runs once, on the first click or keypress anywhere on the page. Waiting for
   a gesture is not politeness - an AudioContext created before one is
   suspended, and Chrome logs a warning about it. */
async function loadAlertSounds() {
  if (alertsLoading) return;
  alertsLoading = true;

  const ctx = audioContext();
  if (!ctx) return;

  await Promise.all(
    Object.values(ALERT_SOUNDS).map((sound) => loadAlertSound(sound, ctx))
  );

  // A session already running was booked with the built-in chime, so re-book
  // it now that the file is here.
  if (isRunning) syncAlarm();
}

document.addEventListener("pointerdown", loadAlertSounds, { once: true });
document.addEventListener("keydown", loadAlertSounds, { once: true });

/* Plays one of them. `at` is an audio-clock time; leave it out for now-ish.
   Returns the node so the timer can cancel a booking it no longer wants. */
function playAlert(id, at) {
  const sound = ALERT_SOUNDS[id];
  const ctx = audioContext();
  if (!ctx || !sound || !sound.buffer) return null;

  const source = ctx.createBufferSource();
  source.buffer = sound.buffer;

  const gain = ctx.createGain();
  gain.gain.value = sound.scaleByMaster ? sound.gain * masterVolume : sound.gain;

  source.connect(gain);
  gain.connect(ctx.destination);
  source.start(at === undefined ? ctx.currentTime + 0.02 : at);
  return source;
}

// Beating Sudoku, Snake, Wordle or Minesweeper. Silent if the file is absent.
export function playWinSound() {
  playAlert("win");
}

// Zero means now, which is what the settings preview passes.
export function bookChime(msFromNow) {
  const ctx = audioContext();
  if (!ctx) return;
  chimeAt = ctx.currentTime + Math.max(0, msFromNow) / 1000 + 0.02;

  if (usingAlertFile()) {
    // A buffer source has stop() like an oscillator, so cancelling and the
    // grace window need no special case for it.
    const source = playAlert("timer", chimeAt);
    if (source) chimeVoices.push(source);
    return;
  }

  CHIME_NOTES.forEach((note) => {
    chimeNote(ctx, chimeAt + note.delay, note.freq);
  });
}

/* Seconds of slack around the booked moment. The wall clock decides when the
   session is over and the audio clock decides when the chime sounds; they
   agree to within a few milliseconds, and this window is what stops that
   sliver of disagreement mattering. */
const CHIME_GRACE = 0.25;

/* Has the booked chime begun, or is it about to within the grace window?

   One predicate answers two questions, deliberately - if cancelChime() and
   complete() ever disagreed about this, the chime would either be cancelled
   and never replaced, or played twice. */
export function chimeHasBegun() {
  if (!chimeAt || !audioCtx) return false;
  return audioCtx.currentTime >= chimeAt - CHIME_GRACE;
}

/* All-or-nothing, because the three notes are one sound. Once the figure has
   begun the rest of it has to be left alone to finish.

   An earlier version cancelled note by note, keeping only the notes already
   sounding. That looked careful and was badly wrong: complete() runs the
   instant the first note strikes, so notes two and three were always still
   in the future and always got stopped. The chime came out as a single lonely
   ping every time. */
export function cancelChime() {
  if (!chimeHasBegun()) {
    chimeVoices.forEach((osc) => {
      try {
        osc.stop();
      } catch (error) {
        // Already stopped. Nothing to do.
      }
    });
  }
  chimeVoices = [];
  chimeAt = 0;
}

/* Called whenever anything that moves the finish line moves: starting,
   pausing, resetting, editing the length, switching modes. */
export function syncAlarm() {
  cancelChime();
  const target = targetMs();
  if (!isRunning || target === null || !settings.chime) return;
  bookChime(target - elapsedMs());
}

export function notificationsGranted() {
  return (
    typeof Notification !== "undefined" && Notification.permission === "granted"
  );
}

export function notifyDone(body) {
  if (!settings.notify || !notificationsGranted()) return;
  try {
    const note = new Notification(APP_NAME, {
      body: body,
      // A tag makes each new notification replace the last rather than
      // stacking a column of them up over a long Pomodoro run.
      tag: "lockedin-session",
      // The chime is already the sound. Only let the system add its own
      // when the chime is switched off.
      silent: settings.chime,
    });
    note.onclick = () => {
      window.focus();
      note.close();
    };
  } catch (error) {
    // Some mobile browsers only allow notifications from a service worker.
  }
}
