/**
 * History log: queries the standard Signal K v2 History API for
 * `network.internet.state` and renders a timeline of connectivity
 * changes. Works with any history provider (e.g. signalk-history-sqlite)
 * — no custom database needed.
 *
 * @file history-log.js
 */

const HISTORY_PATH = "network.internet.state";
const HISTORY_BASE = "/signalk/v2/api/history/values";
// Default to the last 7 days. The v2 API accepts from/to ISO timestamps.
const DEFAULT_DAYS = 7;

const STATE_COLORS = {
  online: "var(--online)",
  offline: "var(--offline)",
  metered: "var(--metered)",
  captive: "var(--captive)",
};

class SiHistoryLog extends HTMLElement {
  constructor() {
    super();
    const shadow = this.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host { display: block; }
        h2 { font-size: 1.1rem; margin: 0 0 0.75rem; }
        .controls {
          display: flex;
          gap: 0.5rem;
          align-items: center;
          margin-bottom: 0.75rem;
          font-size: 0.9rem;
        }
        select, button {
          font: inherit;
          padding: 0.3rem 0.5rem;
          border-radius: 0.35rem;
          border: 1px solid var(--border);
          background: var(--bg);
          color: var(--fg);
        }
        .timeline {
          display: flex;
          height: 1.75rem;
          border-radius: 0.35rem;
          overflow: hidden;
          border: 1px solid var(--border);
        }
        .segment {
          flex: 1 0 auto;
          min-width: 2px;
        }
        .legend {
          display: flex;
          flex-wrap: wrap;
          gap: 0.75rem;
          margin-top: 0.6rem;
          font-size: 0.85rem;
          color: var(--muted);
        }
        .legend span {
          display: inline-flex;
          align-items: center;
          gap: 0.3rem;
        }
        .swatch {
          width: 0.7rem;
          height: 0.7rem;
          border-radius: 50%;
          display: inline-block;
        }
        .events {
          margin-top: 1rem;
          font-size: 0.85rem;
          list-style: none;
          padding: 0;
          max-height: 12rem;
          overflow-y: auto;
        }
        .events li {
          padding: 0.25rem 0;
          border-bottom: 1px solid var(--border);
        }
        .events time {
          color: var(--muted);
          margin-right: 0.5rem;
        }
        .empty { color: var(--muted); font-size: 0.9rem; }
      </style>
      <h2>Connection history</h2>
      <div class="controls">
        <label>
          Window:
          <select id="window">
            <option value="1">24h</option>
            <option value="7" selected>7d</option>
            <option value="30">30d</option>
          </select>
        </label>
        <button id="refresh">Refresh</button>
      </div>
      <div class="timeline" id="timeline"></div>
      <div class="legend" id="legend"></div>
      <ul class="events" id="events"></ul>
      <p class="empty" id="empty">No history available.</p>
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
    const items = [
      ["online", "Online"],
      ["metered", "Metered"],
      ["captive", "Captive"],
      ["offline", "Offline"],
    ];
    this.legendEl.innerHTML = items
      .map(
        ([key, label]) =>
          `<span><i class="swatch" style="background:${STATE_COLORS[key]}"></i>${label}</span>`,
      )
      .join("");
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
          `<div class="segment" style="width:${s.width}%;background:${STATE_COLORS[s.value] || "var(--muted)"}" title="${s.value}"></div>`,
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
        return `<li><time>${time}</time><span style="color:${STATE_COLORS[t.value] || "var(--muted)"}">●</span> ${t.value}</li>`;
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
