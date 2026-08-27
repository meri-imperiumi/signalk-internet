/**
 * Frontend entry point: mounts the status card and history log, and
 * wires the live Signal K stream so the status card updates in real time.
 *
 * Also reflects the stream connection state onto <html data-stream> so
 * the UI can indicate a lost signal (spec §2), and refreshes the history
 * log after a completed speed test so the recorded measurement shows up.
 *
 * @file app.js
 */

import { SignalKStream } from "./signalk-stream.js";
import "./components/status-card.js";
import "./components/history-log.js";

const STATE_PATH = "network.internet.state";
const PING_PATH = "network.internet.ping";
const SPEED_PATH = "network.internet.speed.download";
const MODE_PATH = "vessels.self.environment.mode";

class SiApp extends HTMLElement {
  constructor() {
    super();
    const shadow = this.attachShadow({ mode: "open" });
    const card = document.createElement("si-status-card");
    const log = document.createElement("si-history-log");
    shadow.append(card, log);
    /** @type {HTMLElement} */
    this.cardEl = card;
    /** @type {HTMLElement} */
    this.logEl = log;
  }

  connectedCallback() {
    // A completed speed test is recorded server-side as a delta; reload
    // the history so it appears in the console without a manual refresh.
    this.cardEl.addEventListener("si:speedtest", () => this.logEl.load());

    // Live stream: push state/ping/speed deltas to the status card,
    // reflect the connection state for the signal-lost indicator (spec
    // §2), and passively reflect day/night mode onto <html data-mode>.
    this.stream = new SignalKStream(
      (path, value) => {
        if (path === STATE_PATH) {
          this.cardEl.state = value;
        } else if (path === PING_PATH) {
          this.cardEl.ping = value;
        } else if (path === SPEED_PATH) {
          this.cardEl.speed = value;
        } else if (path === MODE_PATH) {
          const mode = value === "night" || value === "day" ? value : null;
          const root = document.documentElement;
          if (mode) root.setAttribute("data-mode", mode);
          else root.removeAttribute("data-mode");
        }
      },
      (status) => {
        const root = document.documentElement;
        if (status === "offline") root.setAttribute("data-stream", "offline");
        else root.removeAttribute("data-stream");
      },
    );
    this.stream.connect();
  }

  disconnectedCallback() {
    this.stream?.close();
  }
}

customElements.define("si-app", SiApp);

export { PING_PATH, SiApp, SPEED_PATH, STATE_PATH };
