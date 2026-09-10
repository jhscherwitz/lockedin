import { elapsedMs, isRunning, renderHooks, setSessionState } from "./timer.js";
import { showToast } from "./toast.js";

/* ==========================================================================
   Live sync

   Shared sessions work with nothing in the middle, because the timer is a
   pure function of when it started and what time it is now. Both machines do
   the same subtraction and never need to speak.

   Pausing is not in that function. It is an event, happening after the link
   was made, and a link cannot carry an event that has not happened yet. So
   this is the one part of the feature that needs a channel, and this file is
   that channel and nothing else - open a session link with no one hosting and
   everything still works exactly as before, on arithmetic alone.

   WHY PEER-TO-PEER

   WebRTC data channels, through PeerJS. The two browsers talk directly; a
   free public server is used only to introduce them, and never sees the
   timer. Nothing is stored anywhere and no account exists. That keeps the
   character of the thing: a session is not a record somewhere, it is two
   people and a clock.

   The cost is honest and worth stating. The host's tab is the session - close
   it and the session is over for everyone. A strict enough network can refuse
   a direct connection outright. And the introduction service is somebody
   else's free server, so it can be slow or down.

   None of that loses you the timer. Sync failing drops you back to a plain
   shared session, which is what the link was before this file existed.

   THE HOST IS THE CLOCK

   One direction only. The host broadcasts; guests apply. Nobody negotiates,
   which is why there is no conflict resolution here and no way for two
   machines to argue about the time.

   A guest who presses pause is not fought with - they leave. Snapping someone
   back after they pressed a button is hostile, and it is also the shape of
   bug that never stops: apply, which renders, which fires the hook, which
   sends, which applies.
   ========================================================================== */

const PEER_LIBRARY = "src/vendor/peerjs.min.js";

/* Everything on the public PeerJS server shares one namespace, so ids need a
   prefix that will not collide with somebody else's project. */
const ID_PREFIX = "lockedin-";

// Re-broadcast even when nothing changed. Pause and resume are instant, via
// the render hook; this is the floor for everything else - a reset, an edited
// duration, a guest who connected a moment ago.
const HEARTBEAT_MS = 2000;

// Below this, two clocks are agreeing. Network latency alone is a few hundred
// milliseconds, and correcting for that would mean restarting the ticker
// several times a minute to fix something no one can see.
const DRIFT_MS = 1500;

const HOSTING_KEY = "lockedin-hosting";
const ID_KEY = "lockedin-peer-id";

let role = null; // null | "host" | "guest"
let peer = null;
let guests = [];
let hostConn = null;
let heartbeat = null;
let applying = false; // true while a guest is being moved by the host
let libraryPromise = null;

const statusEl = document.getElementById("sync-status");

/* Ours, decided here rather than by the server, because the share link has to
   carry it and the link is built the instant the button is clicked. Waiting
   for a server to name us would mean an await inside a click handler, and a
   clipboard write after an await is refused by some browsers - the gesture is
   considered spent. */
export let myPeerId = "";

function newPeerId() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) out += byte.toString(36).padStart(2, "0");
  return ID_PREFIX + out;
}

/* --------------------------------------------------------------------------
   The library

   84KB that most visitors will never need, so it is fetched on demand rather
   than in the page's script tags. It is a plain script that assigns a global,
   not a module, which is why this is a tag and not an import.
   -------------------------------------------------------------------------- */

function loadPeerLibrary() {
  if (libraryPromise) return libraryPromise;

  libraryPromise = new Promise((resolve, reject) => {
    if (window.Peer) return resolve(window.Peer);
    const tag = document.createElement("script");
    tag.src = PEER_LIBRARY;
    tag.addEventListener("load", () => {
      if (window.Peer) resolve(window.Peer);
      else reject(new Error("the peer library loaded but defined nothing"));
    });
    tag.addEventListener("error", () =>
      reject(new Error("the peer library could not be fetched"))
    );
    document.head.append(tag);
  });

  return libraryPromise;
}

/* --------------------------------------------------------------------------
   Saying where the timer is
   -------------------------------------------------------------------------- */

function currentState() {
  return { t: "state", running: isRunning, elapsed: elapsedMs() };
}

function send(connection, message) {
  try {
    if (connection && connection.open) connection.send(message);
  } catch (error) {
    // A connection that died between the check and the send is not worth
    // interrupting a study session over.
    console.warn("Sync: could not send to a peer:", error);
  }
}

function broadcast() {
  if (role !== "host" || !guests.length) return;
  const message = currentState();
  guests.forEach((connection) => send(connection, message));
}

function setStatus(text) {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.hidden = !text;
}

function describeGuests() {
  if (role !== "host") return;
  if (!guests.length) {
    setStatus("Hosting - nobody has joined yet.");
    return;
  }
  setStatus(
    guests.length === 1
      ? "1 person is studying with you. Your pauses reach them."
      : guests.length + " people are studying with you. Your pauses reach them."
  );
}

/* --------------------------------------------------------------------------
   Hosting
   -------------------------------------------------------------------------- */

export async function startHosting() {
  if (role === "guest" || peer) return;

  let Peer;
  try {
    Peer = await loadPeerLibrary();
  } catch (error) {
    setStatus("Live sync unavailable - the link still works.");
    console.warn("Sync:", error.message);
    return;
  }

  role = "host";
  try {
    sessionStorage.setItem(HOSTING_KEY, "1");
    sessionStorage.setItem(ID_KEY, myPeerId);
  } catch (error) {
    // Private mode. Hosting still works; it just will not survive a refresh.
  }

  peer = new Peer(myPeerId, { debug: 0 });

  peer.on("open", () => describeGuests());

  peer.on("connection", (connection) => {
    connection.on("open", () => {
      guests.push(connection);
      // Immediately, so a late arrival is not out of step until the next beat.
      send(connection, currentState());
      describeGuests();
      showToast("Someone joined your session.");
    });

    const forget = () => {
      guests = guests.filter((existing) => existing !== connection);
      describeGuests();
    };
    connection.on("close", forget);
    connection.on("error", forget);
  });

  peer.on("error", (error) => {
    /* unavailable-id means this id is already taken on the shared server -
       almost always this same tab reconnecting after a network blip, with the
       old registration not yet expired. */
    if (error && error.type === "unavailable-id") {
      setStatus("Reconnecting...");
      return;
    }
    setStatus("Live sync unavailable - the link still works.");
    console.warn("Sync: peer error:", error && error.type, error);
  });

  if (!heartbeat) heartbeat = setInterval(broadcast, HEARTBEAT_MS);
}

/* --------------------------------------------------------------------------
   Joining
   -------------------------------------------------------------------------- */

export async function connectToHost(hostId) {
  if (role || !hostId) return;

  let Peer;
  try {
    Peer = await loadPeerLibrary();
  } catch (error) {
    console.warn("Sync:", error.message);
    return; // The session still runs on the link alone.
  }

  role = "guest";
  peer = new Peer({ debug: 0 }); // our own id does not matter; nobody dials us

  peer.on("open", () => {
    hostConn = peer.connect(hostId, { reliable: true });

    hostConn.on("open", () => {
      setStatus("Synced. The host's pauses reach you.");
    });

    hostConn.on("data", (message) => applyState(message));

    hostConn.on("close", () => {
      setStatus("The host left. Your timer keeps its own time now.");
      showToast("The host closed their session - your timer carries on alone.");
      role = null;
      hostConn = null;
    });

    hostConn.on("error", (error) => {
      console.warn("Sync: connection error:", error);
    });
  });

  peer.on("error", (error) => {
    /* peer-unavailable means nobody is hosting that id: the host closed their
       tab, or shared the link and never opened the session. Neither is broken
       - it just means this is a plain shared session, which still works. */
    const quiet = error && error.type === "peer-unavailable";
    setStatus(
      quiet
        ? "The host is not online - your timer runs on the link alone."
        : "Live sync unavailable - your timer runs on the link alone."
    );
    if (!quiet) console.warn("Sync: peer error:", error && error.type, error);
    role = null;
  });
}

function applyState(message) {
  if (!message || message.t !== "state" || role !== "guest") return;

  const drift = Math.abs(message.elapsed - elapsedMs());
  if (message.running === isRunning && drift < DRIFT_MS) return;

  /* The flag is what stops this becoming a loop. setSessionState renders,
     rendering fires the hook below, and without this the hook would read a
     change it caused itself and treat it as the guest reaching for pause. */
  applying = true;
  try {
    setSessionState(message.elapsed, message.running);
  } finally {
    applying = false;
  }
}

function leaveSession() {
  role = null;
  if (hostConn) {
    try {
      hostConn.close();
    } catch (error) {
      // Already gone. Nothing to do.
    }
    hostConn = null;
  }
  setStatus("You left the shared session - this timer is yours now.");
  showToast("You took control of your own timer. The host no longer moves it.");
}

/* --------------------------------------------------------------------------
   Wiring
   -------------------------------------------------------------------------- */

export function initSync() {
  let stored = null;
  try {
    stored = sessionStorage.getItem(ID_KEY);
  } catch (error) {
    // Private mode; a fresh id is fine.
  }
  myPeerId = stored || newPeerId();

  let wasRunning = isRunning;

  renderHooks.push(() => {
    if (isRunning === wasRunning) return;
    wasRunning = isRunning;

    if (role === "host") {
      broadcast();
      return;
    }

    /* A guest whose running state changed while we were not the ones changing
       it reached for the button themselves. That is a decision, not a
       desync. */
    if (role === "guest" && !applying) leaveSession();
  });

  /* A refresh should not silently stop hosting - the link is out there and
     people may already be holding it. */
  let wasHosting = null;
  try {
    wasHosting = sessionStorage.getItem(HOSTING_KEY);
  } catch (error) {
    // Private mode.
  }
  if (wasHosting === "1" && !new URLSearchParams(location.search).get("p")) {
    startHosting();
  }
}
