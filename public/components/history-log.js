/**
 * History log: queries the standard Signal K v2 History API for
 * `network.internet.state` and `network.internet.speed.download` and
 * renders a timeline of connectivity changes plus a pseudo-console of
 * events (state transitions and recorded speed-test results). Works
 * with any history provider (e.g. signalk-history-sqlite) — no custom
 * database needed.
 *
 * Styled per the Signal K "Tactical Sci-Fi" UI spec: flat geometry,
 * corner-bracket framing, semantic neon segments, hardware-style
 * controls and a 3-column monospace pseudo-console for the event
 * history (spec §9).
 *
 * @file history-log.js
 */

import { fetchUnits, formatLocalTime, formatSI } from "../format.js";

const STATE_PATH = "network.internet.state";
const SPEED_PATH = "network.internet.speed.download";
const HISTORY_BASE = "/signalk/v2/api/history/values";
// Default to the last 7 days. The v2 API accepts from/to ISO timestamps.
const DEFAULT_DAYS = 7;

/** Maximum console lines rendered (spec §9 circular-buffer cap). */
const MAX_LINES = 50;

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
          --theme-color-rgb: var(--color-teal-rgb);
          position: relative;
          display: block;
          background: rgba(var(--theme-color-rgb), 0.05);
          color: var(--text-main);
          padding: 1.25rem 1.5rem 1.5rem;
          margin-bottom: 1.5rem;
          border: 1px solid rgba(var(--theme-color-rgb), 0.3);
        }

        /* Corner brackets (spec §5). */
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

        /* Hardware-style select (spec §7). */
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

        /* Proportional timeline — sharp flat segments (spec §5). */
        .timeline {
          display: flex;
          height: 2rem;
          overflow: hidden;
          border: 1px solid rgba(var(--theme-color-rgb), 0.3);
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

        /* Event console (spec §9): 3-column pseudo-console grid. */
        .console {
          margin: 1.1rem 0 0;
          border: 1px solid rgba(var(--theme-color-rgb), 0.15);
          background: var(--bg-panel-muted);
          max-height: 16rem;
          overflow-y: auto;
          font-family: ui-monospace, "Fira Code", monospace;
        }
        .row {
          display: grid;
          /* First column fits YYYY-MM-DD HH:mm timestamps. */
          grid-template-columns: 11em 1fr auto;
          gap: 0.75rem;
          align-items: baseline;
          padding: 0.45rem 0.75rem;
          border-bottom: 1px solid rgba(var(--theme-color-rgb), 0.12);
          font-size: 0.85rem;
          font-variant-numeric: tabular-nums;
        }
        .row:last-child {
          border-bottom: none;
        }
        .row time {
          color: var(--text-muted);
        }
        .row .msg {
          color: var(--text-main);
        }
        .row .status {
          justify-self: end;
          white-space: nowrap;
        }

        .empty {
          color: var(--text-muted);
          font-size: 0.85rem;
          margin-top: 0.75rem;
        }

        /* Error state: a failed History API call is a fault, not an
           empty dataset — show it loud (spec §4 red, §9 brackets). */
        .empty.error {
          color: var(--color-red);
          font-family: ui-monospace, "Fira Code", monospace;
          font-size: 0.85rem;
          text-transform: uppercase;
          letter-spacing: 0.08em;
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
        <div class="console" id="console"></div>
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
    this.consoleEl = shadow.getElementById("console");
    /** @type {HTMLElement} */
    this.emptyEl = shadow.getElementById("empty");

    // Unit fallback matching the meta this plugin publishes; replaced by
    // the tree's meta when reachable (spec §2).
    this._speedUnit = "bit/s";

    this.windowEl.addEventListener("change", () => this.load());
    this.refreshEl.addEventListener("click", () => this.load());
  }

  connectedCallback() {
    this.renderLegend();
    // Meta-driven unit (spec §2) before the first render, then load.
    fetchUnits("network/internet", "speed.download").then((u) => {
      if (u) this._speedUnit = u;
    });
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
    // Both paths are non-numeric-friendly strings / sparse samples, so
    // use the :last aggregation postfix — the default average returns
    // no rows for string values and hides sparse speed samples.
    const paths = `${STATE_PATH}:last,${SPEED_PATH}:last`;
    const url =
      `${HISTORY_BASE}?paths=${encodeURIComponent(paths)}` +
      `&from=${from.toISOString()}&to=${to.toISOString()}`;

    let data;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        this.showError(
          `History API returned ${res.status}${
            res.statusText ? ` (${res.statusText})` : ""
          }`,
        );
        return;
      }
      data = await res.json();
    } catch (e) {
      this.showError(`History API error: ${e.message}`);
      return;
    }

    this.render(data, from, to);
  }

  /**
   * @param {object} data - v2 history ValuesResponse: { context, range,
   *   values: [{path, method}], data: [[ts, state, speed], ...] }
   * @param {Date} from
   * @param {Date} to
   */
  render(data, from, to) {
    // Rows are [timestamp, state, speed]; each column is null when the
    // bucket holds no sample for that path.
    const rows = Array.isArray(data?.data) ? data.data : [];
    const stateSeries = rows
      .filter((row) => row[1] != null)
      .map((row) => ({ ts: new Date(row[0]).getTime(), value: row[1] }));
    const speedSamples = rows
      .filter((row) => row[2] != null)
      .map((row) => ({ ts: new Date(row[0]).getTime(), value: row[2] }));

    if (!stateSeries.length && !speedSamples.length) {
      this.showEmpty("No connectivity data recorded yet.");
      return;
    }
    this.emptyEl.style.display = "none";
    this.renderTimeline(stateSeries, from, to);
    this.renderConsole(stateSeries, speedSamples);
  }

  /**
   * Builds the proportional state timeline.
   *
   * @param {{ts: number, value: string}[]} series
   * @param {Date} from
   * @param {Date} to
   */
  renderTimeline(series, from, to) {
    if (!series.length) {
      this.timelineEl.innerHTML = "";
      return;
    }
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
  }

  /**
   * Renders the event console: state transitions and recorded speed-test
   * results, newest first, capped at {@link MAX_LINES} (spec §9).
   *
   * @param {{ts: number, value: string}[]} stateSeries
   * @param {{ts: number, value: number}[]} speedSamples
   */
  renderConsole(stateSeries, speedSamples) {
    const events = [];

    // State transitions (consecutive equal states collapse).
    let prev = null;
    for (const { ts, value } of stateSeries) {
      if (value !== prev) {
        events.push({
          ts,
          msg: "Link state changed",
          status: `[ ${(value || "unknown").toUpperCase()} ]`,
          color: STATE_COLOR[value] || STATE_COLOR.unknown,
        });
        prev = value;
      }
    }

    // Recorded speed-test results (throughput in bit/s).
    for (const { ts, value } of speedSamples) {
      events.push({
        ts,
        msg: "Speed test",
        status: `[ ${formatSI(value, this._speedUnit)} ]`,
        color: "var(--color-teal)",
      });
    }

    events.sort((a, b) => b.ts - a.ts);

    this.consoleEl.innerHTML = events
      .slice(0, MAX_LINES)
      .map(
        (e) =>
          `<div class="row"><time>${formatLocalTime(e.ts)}</time>` +
          `<span class="msg">${e.msg}</span>` +
          `<span class="status" style="color:${e.color}">${e.status}</span></div>`,
      )
      .join("");
  }

  /** @param {string} text */
  showEmpty(text) {
    this.timelineEl.innerHTML = "";
    this.consoleEl.innerHTML = "";
    this.emptyEl.textContent = text;
    this.emptyEl.className = "empty";
    this.emptyEl.style.display = "block";
  }

  /**
   * Shows a fetch fault as an error (red, bracketed) rather than a
   * muted empty state — a 400 from the History API means the request
   * or provider failed, which the user should notice.
   *
   * @param {string} text
   */
  showError(text) {
    this.timelineEl.innerHTML = "";
    this.consoleEl.innerHTML = "";
    this.emptyEl.textContent = `[ FAIL ] ${text}`;
    this.emptyEl.className = "empty error";
    this.emptyEl.style.display = "block";
  }
}

customElements.define("si-history-log", SiHistoryLog);

export { HISTORY_BASE, SiHistoryLog, SPEED_PATH, STATE_PATH };
