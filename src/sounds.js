/* ==========================================================================
   Sounds

   Each sound is an MP3 in assets/sounds/, played on loop by its own <audio>
   element. Any number can play at once, each with its own volume.
   ========================================================================== */

// Adding a sound means adding a line here (and, for kind "file", an MP3
// named <id>.mp3 in assets/sounds/). Nothing else needs to change.
export const SOUNDS = [
  { id: "light-rain", name: "Light Rain", icon: "\u{1F326}\u{FE0F}" },
  { id: "heavy-rain", name: "Heavy Rain", icon: "\u{1F327}\u{FE0F}" },
  { id: "ocean-waves", name: "Ocean Waves", icon: "\u{1F30A}" },
  { id: "river", name: "River", icon: "\u{1F3DE}\u{FE0F}", doubleTrack: true },
  { id: "forest-ambience", name: "Forest", icon: "\u{1F332}" },
  { id: "campfire", name: "Campfire", icon: "\u{1F525}" },
];

const soundGrid = document.getElementById("sound-grid");
export const masterSlider = document.getElementById("master-volume");

// State. File sounds start unavailable and are proven available by probing.
export const soundState = {};

export let masterVolume = 0.8;

// Live audio objects, created only when a sound is first switched on.
const players = {};
// The tile elements, built once and then only re-styled.
export const tiles = {};

/* One or two <audio> elements per sound, created once and reused.

   An earlier version destroyed the element on stop with `audio.src = ""`,
   which makes the browser try to load an empty URL. That fails, fires the
   error event below, and marked the sound permanently unavailable - so
   pausing a sound greyed out its tile for good. Pausing is both correct and
   faster to resume, since the file stays buffered.

   Sounds flagged doubleTrack get a second copy of the same file playing
   offset by half its length. Each copy plays straight through the moment the
   other reaches its loop point, so the seam is never exposed:

     copy A:  --------seam--------seam--------
     copy B:  --seam--------seam--------seam--

   Only worth doing on short files, where the seam comes round often enough
   to hear. The MP3 itself is untouched - this is two players, not an edit. */
function createFilePlayer(id, doubleTrack) {
  const src = "assets/sounds/" + id + ".mp3";

  const primary = new Audio(src);
  primary.loop = true;
  primary.volume = 0;

  const secondary = doubleTrack ? new Audio(src) : null;
  let offsetApplied = false;

  function applyOffset() {
    if (!secondary || offsetApplied) return;
    if (!Number.isFinite(secondary.duration) || secondary.duration === 0) return;
    secondary.currentTime = secondary.duration / 2;
    offsetApplied = true;
  }

  if (secondary) {
    secondary.loop = true;
    secondary.volume = 0;
    secondary.addEventListener("loadedmetadata", applyOffset);
  }

  const layers = secondary ? [primary, secondary] : [primary];

  /* Two streams of the same broadly noise-like material add by amplitude
     rather than linearly, so about 0.71 each lands near the loudness of one
     at full volume. */
  const perLayer = secondary ? Math.SQRT1_2 : 1;

  primary.addEventListener("error", () => {
    soundState[id].unavailable = true;
    soundState[id].on = false;
    renderSounds();
  });

  return {
    play() {
      applyOffset();
      layers.forEach((audio) => audio.play().catch(() => {}));
    },
    pause() {
      layers.forEach((audio) => audio.pause());
    },
    setVolume(value) {
      const level = Math.min(1, Math.max(0, value)) * perLayer;
      layers.forEach((audio) => (audio.volume = level));
    },
  };
}

/* ---- Behaviour ---- */

/* Range inputs give you no way to colour the portion you have passed, so the
   filled part is a gradient and this keeps its stop in sync with the value. */
export function paintSlider(input) {
  const min = Number(input.min || 0);
  const max = Number(input.max || 100);
  const span = max - min || 1;
  const pct = ((Number(input.value) - min) / span) * 100;
  input.style.setProperty("--fill", pct + "%");
}

function initSlider(input) {
  paintSlider(input);
  input.addEventListener("input", () => paintSlider(input));
}

function applyVolumes() {
  Object.keys(players).forEach((id) => {
    players[id].setVolume(soundState[id].volume * masterVolume);
  });
}

function toggleSound(id) {
  const state = soundState[id];
  if (state.unavailable) return;

  state.on = !state.on;

  // Kept for the life of the page rather than rebuilt, so switching a sound
  // back on resumes a buffered element instead of downloading it again.
  if (!players[id]) {
    const sound = SOUNDS.find((entry) => entry.id === id);
    players[id] = createFilePlayer(id, Boolean(sound && sound.doubleTrack));
  }

  applyVolumes();
  if (state.on) players[id].play();
  else players[id].pause();

  renderSounds();
}

/* Builds the tiles once. Re-creating them on every render would destroy the
   slider you're in the middle of dragging. */
function buildSoundTiles() {
  SOUNDS.forEach((sound) => {
    const tile = document.createElement("div");
    tile.className = "sound-tile";

    const toggle = document.createElement("button");
    toggle.className = "sound-toggle";
    toggle.innerHTML =
      `<span class="sound-icon">${sound.icon}</span>` +
      `<span class="sound-name">${sound.name}</span>`;
    toggle.addEventListener("click", () => toggleSound(sound.id));

    const volume = document.createElement("input");
    volume.type = "range";
    volume.className = "slider sound-volume";
    volume.min = 0;
    volume.max = 100;
    volume.value = soundState[sound.id].volume * 100;
    volume.setAttribute("aria-label", `${sound.name} volume`);
    volume.addEventListener("input", () => {
      soundState[sound.id].volume = volume.value / 100;
      applyVolumes();
    });
    initSlider(volume);

    tile.append(toggle, volume);
    soundGrid.append(tile);
    tiles[sound.id] = { tile, toggle };
  });
}

// Only ever changes styling, never rebuilds the DOM.
/* See the note on clearBanked() in timer.js. Applying it to the players here
   too means every caller gets the volume change for free. */
export function setMasterVolume(value) {
  masterVolume = value;
  SOUNDS.forEach((sound) => {
    if (players[sound.id]) players[sound.id].setVolume(soundState[sound.id].volume * masterVolume);
  });
}

function renderSounds() {
  SOUNDS.forEach((sound) => {
    const state = soundState[sound.id];
    const { tile, toggle } = tiles[sound.id];

    tile.classList.toggle("is-on", state.on);
    tile.classList.toggle("is-unavailable", state.unavailable);

    toggle.disabled = state.unavailable;
    toggle.setAttribute("aria-pressed", String(state.on));
    toggle.title = state.unavailable
      ? `Missing assets/sounds/${sound.id}.mp3`
      : sound.name;
  });
}

/* Checks which MP3s actually exist, so tiles are honest before you click
   them rather than after.

   A HEAD request asks only for the headers - "is this there?" - and returns
   no file body at all, so it is near-instant whatever the file size. The
   first version of this set preload="metadata" on an <audio> element, which
   made the browser begin downloading each file just to find out it existed:
   the 6.5MB forest recording left its tile greyed out and unclickable for
   several seconds after load. */
function probeFileSounds() {
  SOUNDS.forEach((sound) => {
    fetch("assets/sounds/" + sound.id + ".mp3", { method: "HEAD" })
      .then((response) => {
        soundState[sound.id].unavailable = !response.ok;
        renderSounds();
      })
      .catch(() => {
        soundState[sound.id].unavailable = true;
        renderSounds();
      });
  });
}


/* Called by main.js once every module has loaded. Doing this at module
   scope instead would run it while other modules were still initialising,
   which is how a circular import turns into a TDZ error. */
export function initSounds() {
  SOUNDS.forEach((sound) => {
    soundState[sound.id] = {
      on: false,
      volume: 0.6,
      unavailable: true, // until the MP3 is confirmed to exist
    };
  });
  masterSlider.addEventListener("input", () => {
    masterVolume = masterSlider.value / 100;
    applyVolumes();
  });
  initSlider(masterSlider);
  buildSoundTiles();
  renderSounds();
  probeFileSounds();
}
