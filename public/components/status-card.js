/**
 * Status card: shows the live internet state, ping and last measured
 * download speed, with a manual override toggle and a speed-test button
 * that is disabled when the state is metered or offline (bandwidth
 * guard). After a successful test it dispatches `si:speedtest` so the
 * host can refresh the recorded history.
 *
 * Styled per the Signal K "Tactical Sci-Fi" UI spec: flat geometry,
 * corner-bracket framing, semantic neon theme classes with ultra-faint
 * tints, hardware-style inputs and bracket toggle buttons.
 *
 * @file status-card.js
 */

import { fetchUnits, formatSI } from "../format.js";

const API_BASE = "/plugins/signalk-internet";

/** Map connectivity state -> theme class (spec §4 semantic neon). */
const STATE_THEME = {
  online: "theme-green",
  metered: "theme-orange",
  offline: "theme-red",
  captive: "theme-teal",
  unknown: "theme-offline",
};

const STATE_LABELS = {
  online: "Online",
  offline: "Offline",
  metered: "Metered",
  captive: "Captive portal",
  unknown: "Unknown",
};

const OVERRIDE_OPTIONS = [
  ["", "(auto)"],
  ["online", "online"],
  ["offline", "offline"],
  ["metered", "metered"],
  ["captive", "captive"],
];

class SiStatusCard extends HTMLElement {
  constructor() {
    super();
    const shadow = this.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host { display: block; }

        /* Local theme color defaults to grey/offline; the theme-* class
           swaps it and tints backgrounds. */
        .card {
          --theme-color: var(--color-grey);
          --theme-color-rgb: var(--color-grey-rgb);

          position: relative;
          display: block;
          /* Ultra-faint theme tint (spec §5) — the theme classes below
             only swap the vars, so the tint follows day/night too. */
          background: rgba(var(--theme-color-rgb), 0.05);
          color: var(--text-main);
          padding: 1.25rem 1.5rem 1.5rem;
          margin-bottom: 1.5rem;
          border: 1px solid rgba(var(--theme-color-rgb), 0.3);
        }

        /* Corner brackets (spec §3) — 2px L-shapes on each corner. */
        .card::before,
        .card::after {
          content: "";
          position: absolute;
          width: 14px;
          height: 14px;
          border: 2px solid var(--theme-color);
          pointer-events: none;
        }
        .card::before {
          top: -1px;
          left: -1px;
          border-right: none;
          border-bottom: none;
        }
        .card::after {
          bottom: -1px;
          right: -1px;
          border-left: none;
          border-top: none;
        }

        /* Theme classes. */
        .card.theme-green {
          --theme-color: var(--color-green);
          --theme-color-rgb: var(--color-green-rgb);
        }
        .card.theme-teal {
          --theme-color: var(--color-teal);
          --theme-color-rgb: var(--color-teal-rgb);
        }
        .card.theme-orange {
          --theme-color: var(--color-orange);
          --theme-color-rgb: var(--color-orange-rgb);
        }
        .card.theme-red {
          --theme-color: var(--color-red);
          --theme-color-rgb: var(--color-red-rgb);
        }
        .card.theme-offline {
          --theme-color: var(--color-grey);
          --theme-color-rgb: var(--color-grey-rgb);
        }

        .label {
          font-size: 0.85rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: var(--theme-color);
          margin-bottom: 0.5rem;
        }

        .state-row {
          display: flex;
          align-items: baseline;
          gap: 0.75rem;
          flex-wrap: wrap;
        }

        .state {
          font-family: ui-monospace, "Fira Code", monospace;
          font-size: clamp(2rem, 1.5rem + 2vw, 2.5rem);
          font-weight: 700;
          color: var(--text-main);
          font-variant-numeric: tabular-nums;
          line-height: 1.1;
        }

        .dot {
          width: 0.85rem;
          height: 0.85rem;
          background: var(--theme-color);
          flex: 0 0 auto;
          align-self: center;
        }

        .ping {
          font-family: ui-monospace, "Fira Code", monospace;
          color: var(--text-muted);
          font-size: 1rem;
          font-variant-numeric: tabular-nums;
        }

        .last-speed {
          font-family: ui-monospace, "Fira Code", monospace;
          color: var(--text-muted);
          font-size: 1rem;
          font-variant-numeric: tabular-nums;
        }

        .controls {
          margin-top: 1.25rem;
          display: flex;
          flex-wrap: wrap;
          gap: 0.75rem;
          align-items: center;
        }

        .override-group {
          display: inline-flex;
          flex-wrap: wrap;
          gap: 0.75rem;
          align-items: center;
        }

        /* The speed test is an independent action; push it to the right
           edge so it reads as separate from the override controls. */
        #speedtest {
          margin-left: auto;
        }

        .field-label {
          font-size: 0.85rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: var(--text-muted);
          margin-right: 0.4rem;
        }

        /* Hardware-style text/select inputs (spec §6). */
        select {
          appearance: none;
          -webkit-appearance: none;
          font-family: ui-monospace, "Fira Code", monospace;
          font-size: 0.95rem;
          color: var(--text-main);
          background: transparent;
          border: none;
          border-bottom: 2px solid var(--color-grey);
          padding: 0.5rem 1.25rem 0.4rem 0.4rem;
          min-height: 48px;
          cursor: pointer;
          transition: border-color 0.15s ease;
        }
        select:focus,
        select:hover {
          outline: none;
          border-bottom-color: var(--theme-color);
        }
        /* Custom sharp arrow marker. */
        .select-wrap {
          position: relative;
          display: inline-flex;
          align-items: center;
        }
        .select-wrap::after {
          content: "▾";
          position: absolute;
          right: 0.35rem;
          font-size: 0.7rem;
          color: var(--theme-color);
          pointer-events: none;
        }

        /* Bracket toggle button (spec §6) for the speed test. */
        button {
          appearance: none;
          -webkit-appearance: none;
          font-family: ui-monospace, "Fira Code", monospace;
          font-size: 0.9rem;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--theme-color);
          background: transparent;
          border: 1px solid var(--theme-color);
          padding: 0 1rem;
          min-height: 48px;
          cursor: pointer;
          transition:
            background-color 0.12s ease,
            color 0.12s ease;
        }
        button:hover:not(:disabled),
        button:active:not(:disabled) {
          background-color: var(--theme-color);
          color: var(--bg-base);
        }
        button:disabled {
          color: var(--color-grey);
          border-color: var(--color-grey);
          cursor: not-allowed;
          opacity: 0.7;
        }

        .result {
          font-family: ui-monospace, "Fira Code", monospace;
          font-size: 0.9rem;
          color: var(--text-muted);
          margin-top: 0.9rem;
          min-height: 1.2em;
          font-variant-numeric: tabular-nums;
        }
        .result.error {
          color: var(--color-red);
        }

        @media (max-width: 600px) {
          .card {
            padding: 1rem 1.1rem 1.25rem;
          }
        }
      </style>
      <div class="card theme-offline" id="card">
        <div class="label">Link status</div>
        <div class="state-row">
          <span class="dot" id="dot"></span>
          <span class="state" id="state">UNKNOWN</span>
          <span class="ping" id="ping"></span>
          <span class="last-speed" id="speed"></span>
        </div>
        <div class="controls">
          <div class="override-group">
            <span class="field-label">Override</span>
            <span class="select-wrap">
              <select id="override">
                ${OVERRIDE_OPTIONS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}
              </select>
            </span>
            <button id="apply" disabled>[ Apply ]</button>
          </div>
          <button id="speedtest" disabled>[ Run speed test ]</button>
        </div>
        <div class="result" id="result"></div>
      </div>
    `;
    /** @type {HTMLElement} */
    this.cardEl = shadow.getElementById("card");
    /** @type {HTMLElement} */
    this.dotEl = shadow.getElementById("dot");
    /** @type {HTMLElement} */
    this.stateEl = shadow.getElementById("state");
    /** @type {HTMLElement} */
    this.pingEl = shadow.getElementById("ping");
    /** @type {HTMLElement} */
    this.speedEl = shadow.getElementById("speed");
    /** @type {HTMLSelectElement} */
    this.overrideEl = shadow.getElementById("override");
    /** @type {HTMLButtonElement} */
    this.applyEl = shadow.getElementById("apply");
    /** @type {HTMLButtonElement} */
    this.speedtestEl = shadow.getElementById("speedtest");
    /** @type {HTMLElement} */
    this.resultEl = shadow.getElementById("result");

    this._state = "unknown";
    this._ping = null;
    this._speed = null;
    // Units come from the Signal K meta tree (spec §2); the values below
    // are fallbacks for when the tree is unreachable and match the meta
    // this plugin publishes.
    this._pingUnit = "ms";
    this._speedUnit = "bit/s";
    // Last override value this client has confirmed with the server.
    // The Apply button stays disabled until the select differs from it,
    // so a stray tap on a heeling boat can't change connectivity policy.
    this._appliedOverride = "";

    this.overrideEl.addEventListener("change", () => this.syncApplyButton());
    this.applyEl.addEventListener("click", () => this.setOverride());
    this.speedtestEl.addEventListener("click", () => this.runSpeedTest());
  }

  connectedCallback() {
    // Meta-driven units (spec §2): read units from the Signal K tree,
    // keeping the fallback only when the API is unavailable.
    fetchUnits("network/internet", "ping").then((u) => {
      if (u) {
        this._pingUnit = u;
        this.render();
      }
    });
    fetchUnits("network/internet", "speed.download").then((u) => {
      if (u) {
        this._speedUnit = u;
        this.render();
      }
    });
  }

  /** Enable Apply only when the select differs from the applied override. */
  syncApplyButton() {
    this.applyEl.disabled = this.overrideEl.value === this._appliedOverride;
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

  /** @param {number|null} value - Last measured download speed in bit/s */
  set speed(value) {
    this._speed = value;
    this.render();
  }

  render() {
    const s = this._state;
    this.stateEl.textContent = (STATE_LABELS[s] || "Unknown").toUpperCase();
    this.cardEl.className = `card ${STATE_THEME[s] || "theme-offline"}`;
    this.pingEl.textContent =
      this._ping != null ? `· ${this._ping} ${this._pingUnit}` : "";
    this.speedEl.textContent =
      this._speed != null
        ? `· ↓ ${formatSI(this._speed, this._speedUnit)}`
        : "";
    // Disable the speed test whenever the state is metered or offline —
    // the server enforces the same guard, but disabling client-side
    // prevents accidental bandwidth use on satellite links.
    const blocked = s === "metered" || s === "offline";
    this.speedtestEl.disabled = blocked;
    this.speedtestEl.textContent = blocked
      ? `[ blocked · ${STATE_LABELS[s] || s} ]`
      : "[ Run speed test ]";
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
        return;
      }
      this._appliedOverride = value;
      this.syncApplyButton();
      this.showResult(`Override set to ${value || "auto"}`);
    } catch (e) {
      this.showResult(`Override failed: ${e.message}`, true);
    }
  }

  async runSpeedTest() {
    this.speedtestEl.disabled = true;
    this.speedtestEl.textContent = "[ running… ]";
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
          `Downloaded ${mb} MB in ${body.elapsedMs} ms — ${formatSI(
            body.throughputMbps * 1e6,
            this._speedUnit,
          )}`,
        );
        // The server recorded this measurement as a delta; let the host
        // refresh the connection history so it shows up immediately.
        this.dispatchEvent(new CustomEvent("si:speedtest"));
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
