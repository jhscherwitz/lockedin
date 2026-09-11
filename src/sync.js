import { MqttClient } from "./mqtt.js";
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
   that channel and nothing else - open a session link with nobody hosting and
   everything still works exactly as before, on arithmetic alone.

   WHY NOT PEER TO PEER

   This was WebRTC first, which was the obvious choice and the wrong one.

   Two browsers connecting directly have to get through two home routers, and
   when neither will open a path the connection has to bounce off a relay.
   The free relay everybody points at is gone - it answers DNS and nothing
   else, and a candidate gathering test gets zero relay routes from it. So a
   direct connection worked perfectly between two tabs on one machine and
   failed between two actual houses, which is the only case that matters.

   Both sides dialling out to the same broker has no such failure. Outbound is
   the one thing every home router allows; there is no hole to punch, so there
   is nothing to punch through. It costs a few hundred milliseconds against a
   timer that ticks once a second.

   WHAT THE BROKER SEES

   A public MQTT broker, run by someone else for free. It carries two numbers
   - whether a timer is running and how far in it is - on a topic named by 64
   random bits. No account, nothing stored, and nothing in the payload worth
   reading. If the broker is down, sync is down, and a session falls back to
   the arithmetic it was built on.

   THE HOST IS THE CLOCK

   One direction only. The host broadcasts; guests apply. Nobody negotiates,
   which is why there is no conflict resolution here and no way for two
   machines to argue about the time.

   A guest who presses pause is not fought with - they leave. Snapping someone
   back after they pressed a button is hostile, and it is also the shape of
   bug that never stops: apply, which renders, which fires the hook, which
   sends, which applies.
   ========================================================================== */

/* Two, because these are other people's free servers and either may be down.
   The client falls through the list and keeps retrying. */
const BROKERS = [
  "wss://broker.emqx.io:8084/mqtt",
  "wss://broker.hivemq.com:8884/mqtt",
];

const TOPIC_PREFIX = "lockedin/";

// Pause and resume are instant, through the render hook. This is the floor
// for everything else: a reset, an edited duration, someone who just arrived.
const HEARTBEAT_MS = 2000;

// Guests say hello on this beat so the host can count them.
const HELLO_MS = 8000;

// A guest not heard from in this long has gone.
const GUEST_GONE_MS = 22000;

// Three missed heartbeats and the host is treated as gone. Long enough to
// ride out a reconnect, short enough to notice within a break.
const HOST_GONE_MS = 9000;

// Below this, two clocks are agreeing. Correcting for network latency alone
// would restart the ticker several times a minute to fix nothing anyone sees.
const DRIFT_MS = 1500;

const HOSTING_KEY = "lockedin-hosting";
const ID_KEY = "lockedin-channel-id";

let role = null; // null | "host" | "guest"
let client = null;
let topic = "";
let applying = false; // true while a guest is being moved by the host
let heartbeat = null;
let watchdog = null;
let lastHostAt = 0;
const seenGuests = new Map(); // id -> last heard, host only

const statusEl = document.getElementById("sync-status");

/* Ours, decided here rather than by a server, because the share link carries
   it and the link is built the instant the button is clicked. */
export let myChannelId = "";

let myClientId = "";

function randomId(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) out += byte.toString(36).padStart(2, "0");
  return out;
}

function setStatus(text) {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.hidden = !text;
}

/* --------------------------------------------------------------------------
   The line itself
   -------------------------------------------------------------------------- */

function openChannel(channelId, onMessage, onReady) {
  topic = TOPIC_PREFIX + channelId;
  client = new MqttClient(BROKERS, "lockedin-" + myClientId);
  client.onMessage = (_topic, text) => {
    let message = null;
    try {
      message = JSON.parse(text);
    } catch (error) {
      return; // Someone else's traffic, or a truncated frame. Not ours.
    }
    // Our own publishes come back to us; nothing here wants to hear itself.
    if (!message || message.from === myClientId) return;
    onMessage(message);
  };
  client.onConnect = () => {
    client.subscribe(topic);
    onReady();
  };
  client.onDrop = () => {
    if (role === "host") setStatus("Reconnecting...");
    else if (role === "guest") setStatus("Reconnecting...");
  };
  client.connect();
}

function publish(message) {
  if (!client) return;
  message.from = myClientId;
  client.publish(topic, JSON.stringify(message));
}

/* --------------------------------------------------------------------------
   Hosting
   -------------------------------------------------------------------------- */

function describeGuests() {
  if (role !== "host") return;
  const count = seenGuests.size;
  if (!count) {
    setStatus("Hosting - nobody has joined yet.");
    return;
  }
  setStatus(
    count === 1
      ? "1 person is studying with you. Your pauses reach them."
      : count + " people are studying with you. Your pauses reach them."
  );
}

function broadcastState() {
  if (role !== "host") return;
  publish({ t: "state", running: isRunning, elapsed: elapsedMs() });
}

export function startHosting() {
  if (role) return;
  role = "host";

  try {
    sessionStorage.setItem(HOSTING_KEY, "1");
    sessionStorage.setItem(ID_KEY, myChannelId);
  } catch (error) {
    // Private mode. Hosting works; it just will not survive a refresh.
  }

  setStatus("Connecting...");

  openChannel(
    myChannelId,
    (message) => {
      if (message.t !== "hi") return;
      const known = seenGuests.has(message.from);
      seenGuests.set(message.from, Date.now());
      if (!known) {
        showToast("Someone joined your session.");
        // Answer immediately, so they are not adrift until the next beat.
        broadcastState();
      }
      describeGuests();
    },
    () => {
      describeGuests();
      broadcastState();
    }
  );

  if (!heartbeat) heartbeat = setInterval(broadcastState, HEARTBEAT_MS);

  if (!watchdog) {
    watchdog = setInterval(() => {
      const cutoff = Date.now() - GUEST_GONE_MS;
      let dropped = false;
      seenGuests.forEach((at, id) => {
        if (at < cutoff) {
          seenGuests.delete(id);
          dropped = true;
        }
      });
      if (dropped) describeGuests();
    }, 5000);
  }
}

/* --------------------------------------------------------------------------
   Joining
   -------------------------------------------------------------------------- */

export function joinChannel(channelId) {
  if (role || !channelId) return;
  role = "guest";
  lastHostAt = Date.now(); // grace period before the watchdog can fire
  setStatus("Connecting...");

  openChannel(
    channelId,
    (message) => {
      if (message.t !== "state") return;
      lastHostAt = Date.now();
      setStatus("Synced. The host's pauses reach you.");
      applyState(message);
    },
    () => {
      publish({ t: "hi" });
    }
  );

  if (!heartbeat) heartbeat = setInterval(() => publish({ t: "hi" }), HELLO_MS);

  if (!watchdog) {
    watchdog = setInterval(() => {
      if (role !== "guest") return;
      if (Date.now() - lastHostAt < HOST_GONE_MS) return;
      setStatus("The host is not online - your timer runs on the link alone.");
    }, 3000);
  }
}

function applyState(message) {
  if (role !== "guest") return;

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
  clearInterval(heartbeat);
  clearInterval(watchdog);
  heartbeat = null;
  watchdog = null;
  if (client) {
    client.close();
    client = null;
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
  myChannelId = stored || randomId(8);
  myClientId = randomId(6);

  let wasRunning = isRunning;

  renderHooks.push(() => {
    if (isRunning === wasRunning) return;
    wasRunning = isRunning;

    if (role === "host") {
      broadcastState();
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
