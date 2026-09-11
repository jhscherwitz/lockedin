/* ==========================================================================
   A very small MQTT client, over WebSocket

   Enough of MQTT 3.1.1 to join a topic and send short messages on it:
   connect, subscribe, publish at QoS 0, and keep the line alive. Nothing
   else - no retained messages, no wills, no delivery guarantees, no
   persistence. A study timer that repeats itself every two seconds does not
   need a packet redelivered; the next one is along shortly.

   Written out rather than installed because the wire format is a byte of
   type, a length, and a payload, and the real clients are 150KB of features
   this uses none of. The same reasoning as the Discord IPC framing in
   presence.py.

   WHY A BROKER AND NOT PEER TO PEER

   This replaced WebRTC, which was the obvious choice and the wrong one.
   Two browsers connecting directly have to get through two routers, and when
   neither will open a path the connection needs a relay to bounce off. Free
   relays turn out not to exist - the one everybody points at answers DNS and
   nothing else. Tested between two real homes, it simply did not connect.

   Here both sides dial out to the same place, which is the one thing a home
   router always allows. There is no hole to punch, so there is nothing to
   fail.
   ========================================================================== */

const CONNECT = 0x10;
const CONNACK = 0x20;
const PUBLISH = 0x30;
const SUBSCRIBE = 0x80;
const SUBACK = 0x90;
const PINGREQ = 0xc0;
const PINGRESP = 0xd0;
const DISCONNECT = 0xe0;

const KEEPALIVE_S = 45;

/* MQTT's length field is a base-128 varint: seven bits of number per byte,
   the top bit meaning "another byte follows". Four bytes maximum, which caps
   a packet at 256MB and is not a limit anything here will meet. */
function encodeLength(value) {
  const out = [];
  do {
    let byte = value % 128;
    value = Math.floor(value / 128);
    if (value > 0) byte |= 0x80;
    out.push(byte);
  } while (value > 0);
  return out;
}

function decodeLength(bytes, start) {
  let value = 0;
  let multiplier = 1;
  let index = start;
  for (let i = 0; i < 4; i++) {
    if (index >= bytes.length) return null; // packet not all here yet
    const byte = bytes[index++];
    value += (byte & 127) * multiplier;
    if ((byte & 0x80) === 0) return { value, next: index };
    multiplier *= 128;
  }
  return null;
}

// Every string in MQTT is a two-byte length then UTF-8.
function encodeString(text) {
  const bytes = new TextEncoder().encode(text);
  return [bytes.length >> 8, bytes.length & 255, ...bytes];
}

function packet(type, flags, body) {
  return new Uint8Array([type | flags, ...encodeLength(body.length), ...body]);
}

export class MqttClient {
  /* `brokers` is a list because these are other people's free servers and
     any one of them may be down. The first that answers wins. */
  constructor(brokers, clientId) {
    this.brokers = brokers;
    this.clientId = clientId;
    this.socket = null;
    this.buffer = new Uint8Array(0);
    this.ping = null;
    this.topics = new Set();
    this.packetId = 1;
    this.connected = false;
    this.closed = false;
    this.attempt = 0;

    this.onMessage = () => {};
    this.onConnect = () => {};
    this.onDrop = () => {};
  }

  connect() {
    if (this.closed) return;
    const url = this.brokers[this.attempt % this.brokers.length];

    let socket;
    try {
      socket = new WebSocket(url, "mqtt");
    } catch (error) {
      this.retry();
      return;
    }
    socket.binaryType = "arraybuffer";
    this.socket = socket;

    socket.addEventListener("open", () => {
      const body = [
        ...encodeString("MQTT"),
        0x04, // protocol level: 3.1.1
        0x02, // clean session; no will, no credentials
        KEEPALIVE_S >> 8,
        KEEPALIVE_S & 255,
        ...encodeString(this.clientId),
      ];
      socket.send(packet(CONNECT, 0, body));
    });

    socket.addEventListener("message", (event) => {
      this.feed(new Uint8Array(event.data));
    });

    socket.addEventListener("close", () => this.retry());
    socket.addEventListener("error", () => {
      /* An error is always followed by a close, which is where the retry
         lives. Swallowed here so it does not reach the console as an
         unhandled event on every reconnect. */
    });
  }

  retry() {
    this.connected = false;
    clearInterval(this.ping);
    this.ping = null;
    if (this.closed) return;

    this.onDrop();
    this.attempt += 1;
    // Back off, but never so far that a session outlasts the wait.
    const wait = Math.min(15000, 500 * Math.pow(2, Math.min(this.attempt, 5)));
    setTimeout(() => this.connect(), wait);
  }

  /* Packets are not promised to arrive one per WebSocket frame: two can share
     a frame, and one can be split across two. So bytes accumulate here and
     are taken off only once a whole packet is present. */
  feed(chunk) {
    const merged = new Uint8Array(this.buffer.length + chunk.length);
    merged.set(this.buffer);
    merged.set(chunk, this.buffer.length);
    this.buffer = merged;

    for (;;) {
      if (this.buffer.length < 2) return;
      const header = decodeLength(this.buffer, 1);
      if (!header) return;
      const total = header.next + header.value;
      if (this.buffer.length < total) return;

      const type = this.buffer[0] & 0xf0;
      const body = this.buffer.slice(header.next, total);
      this.buffer = this.buffer.slice(total);
      this.handle(type, body);
    }
  }

  handle(type, body) {
    if (type === CONNACK) {
      // body[1] is the return code; anything but zero is a refusal.
      if (body[1] !== 0) {
        this.socket.close();
        return;
      }
      this.connected = true;
      this.attempt = 0;
      this.ping = setInterval(() => {
        if (this.socket && this.socket.readyState === 1) {
          this.socket.send(new Uint8Array([PINGREQ, 0]));
        }
      }, KEEPALIVE_S * 500); // twice per keepalive window, comfortably inside it
      this.topics.forEach((topic) => this.sendSubscribe(topic));
      this.onConnect();
      return;
    }

    if (type === PUBLISH) {
      const length = (body[0] << 8) | body[1];
      const topic = new TextDecoder().decode(body.slice(2, 2 + length));
      // QoS 0 only, so no packet id sits between the topic and the payload.
      const text = new TextDecoder().decode(body.slice(2 + length));
      this.onMessage(topic, text);
      return;
    }

    void SUBACK;
    void PINGRESP;
  }

  sendSubscribe(topic) {
    if (!this.socket || this.socket.readyState !== 1) return;
    const id = this.packetId++ & 0xffff;
    const body = [id >> 8, id & 255, ...encodeString(topic), 0];
    this.socket.send(packet(SUBSCRIBE, 0x02, body)); // 0x02 is required here
  }

  subscribe(topic) {
    this.topics.add(topic);
    if (this.connected) this.sendSubscribe(topic);
  }

  publish(topic, text) {
    if (!this.connected || !this.socket || this.socket.readyState !== 1) return;
    const body = [...encodeString(topic), ...new TextEncoder().encode(text)];
    try {
      this.socket.send(packet(PUBLISH, 0, body));
    } catch (error) {
      // The socket died between the check and the send. The next heartbeat
      // will go out on the reconnected one.
    }
  }

  close() {
    this.closed = true;
    this.connected = false;
    clearInterval(this.ping);
    this.ping = null;
    if (this.socket && this.socket.readyState === 1) {
      try {
        this.socket.send(new Uint8Array([DISCONNECT, 0]));
      } catch (error) {
        // Going away regardless.
      }
    }
    try {
      if (this.socket) this.socket.close();
    } catch (error) {
      // Already closed.
    }
    this.socket = null;
  }
}
