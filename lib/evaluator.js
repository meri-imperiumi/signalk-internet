/**
 * Priority rules engine for internet connectivity state.
 *
 * The engine evaluates state top-down, the first matching rule winning:
 *
 *   1. Manual override (forced by REST / Web UI)
 *   2. Contextual heuristics (e.g. on-watch -> metered)
 *   3. Hardware uplink mappings (Starlink status, LTE operator)
 *   4. Active probing fallback (DNS + captive-portal HTTP)
 *
 * Hardware and heuristic rules feed off the live Signal K delta stream
 * cache maintained by the plugin; the evaluator exposes a `set` method to
 * push cached path values into it. When a hardware rule flips its uplink
 * to "down" the engine transitions to offline with zero delay; when it
 * flips to "up" the engine requests a single targeted probe to confirm
 * actual routing before publishing online.
 *
 * @file evaluator.js
 */

/**
 * Valid global connectivity states.
 * @typedef {"online"|"offline"|"metered"|"captive"} InternetState
 */

/**
 * Default connectivity state when nothing is known.
 */
const DEFAULT_STATE = "offline";

/**
 * Creates a new evaluator instance.
 *
 * @param {Object} options
 * @param {Object} options.config - Plugin configuration
 * @param {Function} [options.onState] - Called with the new state when it
 *   changes (signature: `(state, ping|null) => void`)
 * @param {Function} [options.probe] - Active probe function
 *   `(options) => Promise<{state, ping}>`; defaults to no-op
 */
function createEvaluator({ config, onState, probe } = {}) {
  /** @type {InternetState} */
  let state = DEFAULT_STATE;

  /** @type {number|null} */
  let ping = null;

  /** @type {InternetState|null} */
  let override = null;

  /** Path -> last seen value, fed by the delta stream */
  const streamCache = new Map();

  /**
   * Reads a numeric or string value for a path from the cache.
   * @param {string} path
   * @returns {unknown}
   */
  function get(path) {
    return streamCache.get(path);
  }

  /**
   * Returns the current resolved state and ping.
   * @returns {{state: InternetState, ping: number|null}}
   */
  function current() {
    return { state, ping };
  }

  /**
   * Sets or clears the manual override. Triggers a re-evaluation.
   *
   * @param {InternetState|null} value - State to force, or null to clear
   */
  function setOverride(value) {
    override = value;
    reevaluate();
  }

  /**
   * Returns the current manual override (null when not overridden).
   */
  function getOverride() {
    return override;
  }

  /**
   * Updates a cached stream value and re-evaluates if the path is watched
   * by a heuristic or hardware rule.
   *
   * @param {string} path - Signal K path
   * @param {unknown} value - Value (or null to remove)
   */
  function set(path, value) {
    if (value === null || value === undefined) {
      streamCache.delete(path);
    } else {
      streamCache.set(path, value);
    }
    if (isWatched(path)) {
      reevaluate();
    }
  }

  /**
   * Whether any configured rule reads this path.
   * @param {string} path
   * @returns {boolean}
   */
  function isWatched(path) {
    const heuristics = config.stateHeuristics || [];
    const mappings = config.connectionMappings || [];
    return (
      heuristics.some((r) => r.path === path) ||
      mappings.some((r) => r.path === path)
    );
  }

  /**
   * Evaluates the rule engine and updates the state, publishing via
   * `onState` when it changes.
   *
   * Per SPEC §4, hardware uplinks have event-driven semantics:
   *   - a mapping resolving to `offline` is an instant-down (0ms delay)
   *   - a mapping resolving to `online`/`metered`/`captive` is an uplink
   *     "up" signal: rather than trusting it, fire a single targeted
   *     probe to confirm actual routing before publishing.
   * Non-probe transitions (override, heuristic, instant-down) publish
   * with `ping = null` since no latency was measured.
   *
   * @returns {void}
   */
  function reevaluate() {
    // 1. Manual override wins outright.
    if (override !== null) {
      publish(override, null);
      return;
    }

    // 2. Contextual heuristics.
    const heuristic = matchHeuristic();
    if (heuristic) {
      publish(heuristic, null);
      return;
    }

    // 3. Hardware uplink mappings.
    const hardware = matchHardware();
    if (hardware) {
      if (hardware.state === "offline") {
        // Event-driven instant down — no probe, no delay.
        publish("offline", null);
        return;
      }
      // Uplink reports "up": verify actual routing with a targeted probe
      // before publishing. The state is left untouched until the probe
      // resolves so we never falsely claim online on a modem-up-but-
      // no-internet situation (obstructed dish, captive hotel wifi).
      triggerProbe();
      return;
    }

    // 4. Active probing fallback — runs asynchronously; the state is left
    //    untouched until the probe resolves so we never flicker to a wrong
    //    intermediate value.
    triggerProbe();
  }

  /**
   * Finds the first matching contextual heuristic rule.
   *
   * @returns {InternetState|null}
   */
  function matchHeuristic() {
    const rules = config.stateHeuristics || [];
    for (const rule of rules) {
      if (!rule.path) continue;
      const value = get(rule.path);
      if (value !== undefined && String(value) === String(rule.triggerValue)) {
        return rule.resultingState;
      }
    }
    return null;
  }

  /**
   * Finds the first matching hardware uplink mapping.
   *
   * @returns {{state: InternetState}|null}
   */
  function matchHardware() {
    const rules = config.connectionMappings || [];
    for (const rule of rules) {
      if (!rule.path) continue;
      const value = get(rule.path);
      if (value !== undefined && String(value) === String(rule.matchValue)) {
        return { state: rule.resultingState };
      }
    }
    return null;
  }

  /**
   * Triggers an active probe and publishes its result. Re-entrancy guard:
   * only one probe in flight at a time.
   */
  let probing = false;
  async function triggerProbe() {
    if (!probe || probing) return;
    probing = true;
    try {
      const result = await probe();
      publish(result.state, result.ping);
    } finally {
      probing = false;
    }
  }

  /**
   * Forces a fresh probe regardless of cached rule state. Used by the
   * adaptive timer loop and the "up verification" path after a hardware
   * uplink reports connected.
   */
  async function forceProbe() {
    if (!probe) return;
    probing = true;
    try {
      const result = await probe();
      publish(result.state, result.ping);
    } finally {
      probing = false;
    }
  }

  /**
   * Publishes a state change if it differs from the current one. Ping is
   * always carried along (null when unknown).
   *
   * @param {InternetState} newState
   * @param {number|null} newPing
   */
  function publish(newState, newPing) {
    if (newState === state && newPing === ping) return;
    state = newState;
    ping = newPing;
    if (onState) onState(state, ping);
  }

  return {
    current,
    set,
    setOverride,
    getOverride,
    reevaluate,
    forceProbe,
    // Exposed for tests / introspection
    _matchHeuristic: matchHeuristic,
    _matchHardware: matchHardware,
    _cache: streamCache,
  };
}

module.exports = {
  createEvaluator,
  DEFAULT_STATE,
};
