/**
 * Status card: shows the live internet state and ping, with a manual
 * override toggle and a speed-test button that is disabled when the
 * state is metered or offline (bandwidth guard).
 *
 * @file status-card.js
 */

const API_BASE = "/plugins/signalk-internet";

const STATE_COLORS = {
  online: "var(--online)",
  offline: "var(--offline)",
  metered: "var(--metered)",
  captive: "var(--captive)",
};

const STATE_LABELS = {
  online: "Online",
  offline: "Offline",
  metered: "Metered",
  captive: "Captive portal",
};

class SiStatusCard extends HTMLElement {
  constructor() {
    super();
    const shadow = this.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host { display: block; }
        .card {
          border: 1px solid var(--border);
          border-radius: 0.5rem;
          padding: 1rem 1.25rem;
          margin-bottom: 1.5rem;
        }
        .state-row {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          font-size: 1.25rem;
          font-weight: 600;
        }
        .dot {
          width: 0.85rem;
          height: 0.85rem;
          border-radius: 50%;
          background: var(--muted);
          flex: 0 0 auto;
        }
        .ping {
          color: var(--muted);
          font-weight: 400;
          font-size: 0.95rem;
          margin-left: 0.25rem;
        }
        .controls {
          margin-top: 1rem;
          display: flex;
          flex-wrap: wrap;
          gap: 0.75rem;
          align-items: center;
        }
        select, button {
          font: inherit;
          padding: 0.4rem 0.6rem;
          border-radius: 0.35rem;
          border: 1px solid var(--border);
          background: var(--bg);
          color: var(--fg);
        }
        button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .result {
          font-size: 0.9rem;
          color: var(--muted);
          margin-top: 0.75rem;
          min-height: 1.2em;
        }
        .error {
          color: var(--offline);
        }
      </style>
      <div class="card">
        <div class="state-row">
          <span class="dot" id="dot"></span>
          <span id="state">Unknown</span>
          <span class="ping" id="ping"></span>
        </div>
        <div class="controls">
          <label>
            Override:
            <select id="override">
              <option value="">(auto)</option>
              <option value="online">online</option>
              <option value="offline">offline</option>
              <option value="metered">metered</option>
              <option value="captive">captive</option>
            </select>
          </label>
          <button id="speedtest" disabled>Run speed test</button>
        </div>
        <div class="result" id="result"></div>
      </div>
    `;
    /** @type {HTMLElement} */
    this.dotEl = shadow.getElementById("dot");
    /** @type {HTMLElement} */
    this.stateEl = shadow.getElementById("state");
    /** @type {HTMLElement} */
    this.pingEl = shadow.getElementById("ping");
    /** @type {HTMLSelectElement} */
    this.overrideEl = shadow.getElementById("override");
    /** @type {HTMLButtonElement} */
    this.speedtestEl = shadow.getElementById("speedtest");
    /** @type {HTMLElement} */
    this.resultEl = shadow.getElementById("result");

    this._state = "unknown";
    this._ping = null;

    this.overrideEl.addEventListener("change", () => this.setOverride());
    this.speedtestEl.addEventListener("click", () => this.runSpeedTest());
  }

  /** @param {string} value */
  set state(value) {
    this._state = value;
    this.render();
  }

  /** @param {number|null} value */
  set ping(value) {
    this._ping = value;
    this.render();
  }

  render() {
    const s = this._state;
    this.stateEl.textContent = STATE_LABELS[s] || "Unknown";
    this.dotEl.style.background = STATE_COLORS[s] || "var(--muted)";
    this.pingEl.textContent = this._ping != null ? `· ${this._ping} ms` : "";
    // Disable the speed test whenever the state is metered or offline —
    // the server enforces the same guard, but disabling client-side
    // prevents accidental bandwidth use on satellite links.
    const blocked = s === "metered" || s === "offline";
    this.speedtestEl.disabled = blocked;
    this.speedtestEl.title = blocked
      ? `Speed test blocked: ${STATE_LABELS[s]}`
      : "Run a 5 MB download speed test";
  }

  async setOverride() {
    const value = this.overrideEl.value;
    const body = value ? { state: value } : { state: null };
    try {
      const res = await fetch(`${API_BASE}/override`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        this.showResult(`Override failed: ${err.message || res.status}`, true);
      } else {
        this.showResult(`Override set to ${value || "auto"}`);
      }
    } catch (e) {
      this.showResult(`Override failed: ${e.message}`, true);
    }
  }

  async runSpeedTest() {
    this.speedtestEl.disabled = true;
    this.showResult("Running speed test…");
    try {
      const res = await fetch(`${API_BASE}/speedtest`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        this.showResult(
          `Speed test failed: ${body.message || res.status}`,
          true,
        );
      } else {
        const mb = (body.bytes / 1024 / 1024).toFixed(1);
        this.showResult(
          `Downloaded ${mb} MB in ${body.elapsedMs} ms — ${body.throughputMbps.toFixed(1)} Mbit/s`,
        );
      }
    } catch (e) {
      this.showResult(`Speed test failed: ${e.message}`, true);
    } finally {
      // Re-evaluate from the live state rather than blindly re-enabling.
      this.render();
    }
  }

  /** @param {string} text @param {boolean} isError */
  showResult(text, isError = false) {
    this.resultEl.textContent = text;
    this.resultEl.className = isError ? "result error" : "result";
  }
}

customElements.define("si-status-card", SiStatusCard);

export { API_BASE, SiStatusCard };
