/**
 * History log: queries the standard Signal K v2 History API for
 * `network.internet.state` and renders a timeline of connectivity
 * changes. Works with any history provider (e.g. signalk-history-sqlite)
 * — no custom database needed.
 *
 * Styled per the Signal K "Tactical Sci-Fi" UI spec: flat geometry,
 * corner-bracket framing, semantic neon segments, hardware-style
 * controls and monospace telemetry.
 *
 * @file history-log.js
 */

const HISTORY_PATH = "network.internet.state";
const HISTORY_BASE = "/signalk/v2/api/history/values";
// Default to the last 7 days. The v2 API accepts from/to ISO timestamps.
const DEFAULT_DAYS = 7;

/** Map state -> theme color (spec §4 semantic neon). */
const STATE_COLOR = {
  online: "var(--color-green)",
  metered: "var(--color-orange)",
  offline: "var(--color-red)",
  captive: "var(--color-teal)",
  unknown: "var(--color-grey)",
};

const LEGEND_ITEMS = [
  ["online", "Online"],
  ["metered", "Metered"],
  ["captive", "Captive"],
  ["offline", "Offline"],
];

class SiHistoryLog extends HTMLElement {
  constructor() {
    super();
    const shadow = this.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host { display: block; }

        .sk-card {
          --theme-color: var(--color-teal);
          position: relative;
          display: block;
          background: var(--bg-panel);
          color: var(--text-main);
          padding: 1.25rem 1.5rem 1.5rem;
          margin-bottom: 1.5rem;
          border: 1px solid rgba(255, 255, 255, 0.08);
        }

        /* Corner brackets (spec §3). */
        .sk-card::before,
        .sk-card::after {
          content: "";
          position: absolute;
          width: 14px;
          height: 14px;
          border: 2px solid var(--theme-color);
          pointer-events: none;
        }
        .sk-card::before {
          top: -1px;
          left: -1px;
          border-right: none;
          border-bottom: none;
        }
        .sk-card::after {
          bottom: -1px;
          right: -1px;
          border-left: none;
          border-top: none;
        }

        h2 {
          font-size: 0.85rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: var(--theme-color);
          margin: 0 0 0.9rem;
        }

        .controls {
          display: flex;
          gap: 0.75rem;
          align-items: center;
          margin-bottom: 1rem;
          flex-wrap: wrap;
        }

        .field-label {
          font-size: 0.85rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: var(--text-muted);
          margin-right: 0.4rem;
        }

        /* Hardware-style select (spec §6). */
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
        select {
          appearance: none;
          -webkit-appearance: none;
          font-family: ui-monospace, "Fira Code", monospace;
          font-size: 0.9rem;
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

        /* Bracket button. */
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
        button:hover,
        button:active {
          background-color: var(--theme-color);
          color: var(--bg-base);
        }

        /* Proportional timeline — sharp flat segments (spec §3). */
        .timeline {
          display: flex;
          height: 2rem;
          overflow: hidden;
          border: 1px solid rgba(255, 255, 255, 0.1);
          background: var(--bg-panel-muted);
        }
        .segment {
          flex: 1 0 auto;
          min-width: 2px;
          height: 100%;
        }

        .legend {
          display: flex;
          flex-wrap: wrap;
          gap: 0.9rem;
          margin-top: 0.75rem;
          font-size: 0.8rem;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--text-muted);
        }
        .legend span {
          display: inline-flex;
          align-items: center;
          gap: 0.4rem;
        }
        .swatch {
          width: 0.7rem;
          height: 0.7rem;
          display: inline-block;
        }

        .events {
          margin: 1.1rem 0 0;
          padding: 0;
          list-style: none;
          max-height: 14rem;
          overflow-y: auto;
        }
        .events li {
          font-family: ui-monospace, "Fira Code", monospace;
          font-size: 0.85rem;
          font-variant-numeric: tabular-nums;
          padding: 0.45rem 0;
          border-bottom: 1px solid rgba(255, 255, 255, 0.06);
        }
        .events time {
          color: var(--text-muted);
          margin-right: 0.6rem;
        }
        .events .marker {
          margin-right: 0.35rem;
        }

        .empty {
          color: var(--text-muted);
          font-size: 0.85rem;
          margin-top: 0.75rem;
        }

        @media (max-width: 600px) {
          .sk-card {
            padding: 1rem 1.1rem 1.25rem;
          }
        }
      </style>
      <div class="sk-card">
        <h2>Connection history</h2>
        <div class="controls">
          <span class="field-label">Window</span>
          <span class="select-wrap">
            <select id="window">
              <option value="1">24h</option>
              <option value="7" selected>7d</option>
              <option value="30">30d</option>
            </select>
          </span>
          <button id="refresh">[ Refresh ]</button>
        </div>
        <div class="timeline" id="timeline"></div>
        <div class="legend" id="legend"></div>
        <ul class="events" id="events"></ul>
        <p class="empty" id="empty">No history available.</p>
      </div>
    `;
    /** @type {HTMLSelectElement} */
    this.windowEl = shadow.getElementById("window");
    /** @type {HTMLButtonElement} */
    this.refreshEl = shadow.getElementById("refresh");
    /** @type {HTMLElement} */
    this.timelineEl = shadow.getElementById("timeline");
    /** @type {HTMLElement} */
    this.legendEl = shadow.getElementById("legend");
    /** @type {HTMLElement} */
    this.eventsEl = shadow.getElementById("events");
    /** @type {HTMLElement} */
    this.emptyEl = shadow.getElementById("empty");

    this.windowEl.addEventListener("change", () => this.load());
    this.refreshEl.addEventListener("click", () => this.load());
  }

  connectedCallback() {
    this.renderLegend();
    this.load();
  }

  renderLegend() {
    this.legendEl.innerHTML = LEGEND_ITEMS.map(
      ([key, label]) =>
        `<span><i class="swatch" style="background:${STATE_COLOR[key]}"></i>${label}</span>`,
    ).join("");
  }

  async load() {
    const days = parseInt(this.windowEl.value, 10) || DEFAULT_DAYS;
    const to = new Date();
    const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
    // state is a string enum, so use the :last aggregation postfix — the
    // default average returns no rows for non-numeric values.
    const url =
      `${HISTORY_BASE}?paths=${encodeURIComponent(HISTORY_PATH + ":last")}` +
      `&from=${from.toISOString()}&to=${to.toISOString()}`;

    let data;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        this.showEmpty(`History API returned ${res.status}`);
        return;
      }
      data = await res.json();
    } catch (e) {
      this.showEmpty(`History API error: ${e.message}`);
      return;
    }

    this.render(data, from, to);
  }

  /**
   * @param {object} data - v2 history ValuesResponse: { context, range,
   *   values: [{path, method}], data: [[ts, value, ...], ...] }
   * @param {Date} from
   * @param {Date} to
   */
  render(data, from, to) {
    // data is an array of rows; the first element of each row is the
    // ISO timestamp and the rest are the per-path values (null when
    // missing). We query a single path, so each row is [ts, state].
    const rows = Array.isArray(data?.data) ? data.data : [];
    // Drop rows where the state column is null (no sample in that bucket).
    const series = rows
      .filter((row) => row[1] != null)
      .map((row) => ({ ts: new Date(row[0]).getTime(), value: row[1] }));
    if (!series.length) {
      this.showEmpty("No connectivity data recorded yet.");
      return;
    }
    this.emptyEl.style.display = "none";

    // Build a proportional timeline of segments.
    const span = to.getTime() - from.getTime();
    const segments = [];
    for (let i = 0; i < series.length; i++) {
      const { ts, value } = series[i];
      const next = series[i + 1] ? series[i + 1].ts : to.getTime();
      const start = Math.max(ts, from.getTime());
      const end = Math.min(next, to.getTime());
      if (end <= start) continue;
      const width = ((end - start) / span) * 100;
      segments.push({ value, width });
    }

    this.timelineEl.innerHTML = segments
      .map(
        (s) =>
          `<div class="segment" style="width:${s.width}%;background:${STATE_COLOR[s.value] || STATE_COLOR.unknown}" title="${s.value}"></div>`,
      )
      .join("");

    // Events list: state transitions (newest first).
    const transitions = [];
    let prev = null;
    for (const { ts, value } of series) {
      if (value !== prev) {
        transitions.push({ ts, value });
        prev = value;
      }
    }
    transitions.reverse();

    this.eventsEl.innerHTML = transitions
      .slice(0, 50)
      .map((t) => {
        const time = new Date(t.ts).toLocaleString();
        const color = STATE_COLOR[t.value] || STATE_COLOR.unknown;
        return `<li><time>${time}</time><span class="marker" style="color:${color}">●</span>${t.value}</li>`;
      })
      .join("");
  }

  /** @param {string} text */
  showEmpty(text) {
    this.timelineEl.innerHTML = "";
    this.eventsEl.innerHTML = "";
    this.emptyEl.textContent = text;
    this.emptyEl.style.display = "block";
  }
}

customElements.define("si-history-log", SiHistoryLog);

export { HISTORY_BASE, HISTORY_PATH, SiHistoryLog };
