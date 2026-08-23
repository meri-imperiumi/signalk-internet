/**
 * Frontend entry point: mounts the status card and history log, and
 * wires the live Signal K stream so the status card updates in real time.
 *
 * @file app.js
 */

import { SignalKStream } from "./signalk-stream.js";
import "./components/status-card.js";
import "./components/history-log.js";

const STATE_PATH = "network.internet.state";
const PING_PATH = "network.internet.ping";

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
    // Live stream: push state/ping deltas to the status card.
    this.stream = new SignalKStream((path, value) => {
      if (path === STATE_PATH) {
        this.cardEl.state = value;
      } else if (path === PING_PATH) {
        this.cardEl.ping = value;
      }
    });
    this.stream.connect();
  }

  disconnectedCallback() {
    this.stream?.close();
  }
}

customElements.define("si-app", SiApp);

export { PING_PATH, SiApp, STATE_PATH };
