/* ==========================================================================
   Music

   Spotify's own embed player. Nothing is loaded until a playlist is chosen -
   embedding it on page load would pull Spotify's script and cookies into
   every visit, including visits where nobody touches the music panel.
   ========================================================================== */

const musicList = document.getElementById("music-list");
const musicMine = document.getElementById("music-mine");
const musicMineEmpty = document.getElementById("music-mine-empty");
const musicPlayer = document.getElementById("music-player");
const musicForm = document.getElementById("music-add");
const musicNameInput = document.getElementById("music-name");
const musicUrlInput = document.getElementById("music-url");
const musicError = document.getElementById("music-error");

const MUSIC_LAST_KEY = "focus-app-music-last";
const MUSIC_CUSTOM_KEY = "focus-app-music-custom";

const PLAYLISTS = [
  { name: "Lofi", id: "0vvXsWCC9xrXsKd4FyS8kM" },
  { name: "Morning Lofi", id: "3pTzWcIQHM5pUTJJcZoZr6" },
  { name: "Synthwave", id: "1YIe34rcmLjCYpY9wJoM2p" },
  { name: "Bouncy Synthwave", id: "1F9Di2wBgnwMqfWqYYuYKR" },
  { name: "Jazz", id: "5boMTmAPPigEsoB6kRB0CB" },
  { name: "Dark Ambient", id: "07lYUEyTkWP3NqIa7Kzyqx" },
  { name: "Sleepy", id: "5WeNl7LfgUHUYOnCFOPkls" },
];

let activePlaylist = null;

/* Accepts what people actually paste: a share link with its ?si= tracking
   parameter, a link with Spotify's /intl-xx/ locale prefix, a spotify: URI,
   or a bare id. */
function parsePlaylistId(text) {
  const input = String(text || "").trim();
  if (!input) return null;

  let match = input.match(/^spotify:playlist:([A-Za-z0-9]+)$/);
  if (match) return match[1];

  match = input.match(
    /open\.spotify\.com\/(?:intl-[a-z-]+\/)?playlist\/([A-Za-z0-9]+)/
  );
  if (match) return match[1];

  if (/^[A-Za-z0-9]{16,30}$/.test(input)) return input;
  return null;
}

function readCustomPlaylists() {
  try {
    const list = JSON.parse(localStorage.getItem(MUSIC_CUSTOM_KEY));
    return Array.isArray(list)
      ? list.filter((p) => p && typeof p.id === "string")
      : [];
  } catch (error) {
    return [];
  }
}

function writeCustomPlaylists(list) {
  try {
    localStorage.setItem(MUSIC_CUSTOM_KEY, JSON.stringify(list));
  } catch (error) {
    // Storage blocked; the list just won't survive a reload.
  }
}

function playPlaylist(id) {
  activePlaylist = id;

  /* Rebuilt rather than reusing the iframe: pointing an existing Spotify
     embed at a new src leaves the previous player's state behind. */
  musicPlayer.innerHTML = "";
  const frame = document.createElement("iframe");
  frame.src =
    "https://open.spotify.com/embed/playlist/" + id + "?utm_source=generator";
  frame.loading = "lazy";
  frame.allow =
    "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture";
  frame.setAttribute("title", "Spotify playlist");
  musicPlayer.append(frame);

  document.querySelectorAll(".music-chip").forEach((chip) => {
    chip.classList.toggle("is-active", chip.dataset.playlist === id);
  });

  try {
    localStorage.setItem(MUSIC_LAST_KEY, id);
  } catch (error) {
    // Storage blocked; the choice just won't be remembered.
  }
}

function musicChip(playlist, removable) {
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "music-chip" + (removable ? " is-custom" : "");
  chip.dataset.playlist = playlist.id;
  chip.classList.toggle("is-active", playlist.id === activePlaylist);

  const label = document.createElement("span");
  label.textContent = playlist.name;
  chip.append(label);
  chip.addEventListener("click", () => playPlaylist(playlist.id));

  if (removable) {
    const remove = document.createElement("span");
    remove.className = "music-remove";
    remove.textContent = "×";
    remove.setAttribute("role", "button");
    remove.setAttribute("aria-label", "Remove " + playlist.name);
    remove.addEventListener("click", (event) => {
      // Without this the click also reaches the chip and starts playing it.
      event.stopPropagation();
      writeCustomPlaylists(readCustomPlaylists().filter((p) => p.id !== playlist.id));
      renderCustomPlaylists();
    });
    chip.append(remove);
  }

  return chip;
}

function renderCustomPlaylists() {
  const list = readCustomPlaylists();
  musicMine.innerHTML = "";
  list.forEach((playlist) => musicMine.append(musicChip(playlist, true)));
  musicMineEmpty.hidden = list.length > 0;
}

function buildMusicList() {
  musicList.innerHTML = "";
  PLAYLISTS.forEach((playlist) => musicList.append(musicChip(playlist, false)));
  musicPlayer.innerHTML = '<p class="music-empty">Pick a playlist to start</p>';
  renderCustomPlaylists();
}


/* Called by main.js once every module has loaded. Doing this at module
   scope instead would run it while other modules were still initialising,
   which is how a circular import turns into a TDZ error. */
export function initMusic() {
  musicForm.addEventListener("submit", (event) => {
    event.preventDefault();
    musicError.hidden = true;

    const id = parsePlaylistId(musicUrlInput.value);
    if (!id) {
      musicError.textContent =
        "That does not look like a Spotify playlist link.";
      musicError.hidden = false;
      return;
    }

    const existing = readCustomPlaylists();
    if (existing.some((p) => p.id === id) || PLAYLISTS.some((p) => p.id === id)) {
      musicError.textContent = "That playlist is already here.";
      musicError.hidden = false;
      return;
    }

    const name =
      musicNameInput.value.trim() || "Playlist " + (existing.length + 1);
    writeCustomPlaylists(existing.concat([{ name, id }]));

    musicNameInput.value = "";
    musicUrlInput.value = "";
    renderCustomPlaylists();
    playPlaylist(id);
  });
  buildMusicList();
}
