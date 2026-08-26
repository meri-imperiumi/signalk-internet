/**
 * Signal K stream subscription for the Internet Monitor webapp.
 *
 * Opens a WebSocket to `/signalk/v1/stream?subscribe=none` and subscribes
 * to the plugin's connectivity paths. Forwards each value to a callback.
 * Auto-reconnects on loss.
 *
 * @file signalk-stream.js
 */

const STATE_PATH = "network.internet.state";
const PING_PATH = "network.internet.ping";
const MODE_PATH = "vessels.self.environment.mode";

class SignalKStream {
  /**
   * @param {(path: string, value: unknown) => void} onValue - Called for
   *   each subscribed value update
   */
  constructor(onValue) {
    /** @type {((path: string, value: unknown) => void)|null} */
    this.onValue = onValue;
    /** @type {WebSocket|null} */
    this.socket = null;
    /** @type {number|null} */
    this.reconnectTimer = null;
    /** @type {boolean} */
    this.closed = false;
  }

  connect() {
    if (this.closed) return;
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(
      `${proto}://${window.location.host}/signalk/v1/stream?subscribe=none`,
    );
    this.socket = socket;

    socket.addEventListener("open", () => {
      socket.send(
        JSON.stringify({
          context: "vessels.self",
          subscribe: [
            { path: STATE_PATH },
            { path: PING_PATH },
            { path: MODE_PATH },
          ],
        }),
      );
    });

    socket.addEventListener("message", (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      for (const update of data.updates || []) {
        for (const value of update.values || []) {
          this.onValue?.(value.path, value.value);
        }
      }
    });

    socket.addEventListener("close", () => {
      if (!this.closed) {
        this.reconnectTimer = setTimeout(() => this.connect(), 5000);
      }
    });

    socket.addEventListener("error", () => {
      socket.close();
    });
  }

  close() {
    this.closed = true;
    if (this.reconnectTimer != null) clearTimeout(this.reconnectTimer);
    this.socket?.close();
  }
}

export { MODE_PATH, PING_PATH, SignalKStream, STATE_PATH };
