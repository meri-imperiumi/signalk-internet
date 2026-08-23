/**
 * Signal K Internet Connectivity Monitor plugin.
 *
 * Centralizes internet-state detection so downstream plugins can pause
 * heavy operations when the vessel goes offline or hits a metered link.
 * Publishes a unified `network.internet.state` + `network.internet.ping`
 * delta via a top-down rules engine: manual override → contextual
 * heuristics → hardware uplink mappings → active DNS/HTTP probing.
 *
 * @file index.js
 */

/** @typedef {import("@signalk/server-api").ServerAPI} ServerAPI */
/** @typedef {import("@signalk/server-api").Plugin} Plugin */

const { createEvaluator } = require("./lib/evaluator.js");
const { probeWithRetry } = require("./lib/prober.js");
const { guard, runSpeedTest, GuardError } = require("./lib/speedtest.js");

/**
 * Signal K paths published by this plugin.
 */
const STATE_PATH = "network.internet.state";
const PING_PATH = "network.internet.ping";

/**
 * Plugin identifier (matches package name without the scope).
 */
const PLUGIN_ID = "signalk-internet";

/**
 * Default hardware uplink mappings shipped out of the box.
 *
 * `signalk-starlink` publishes `network.providers.starlink.status` with
 * the string value `"online"` when the dish has internet routing. We
 * pre-seed this so a Starlink-equipped vessel gets correct state without
 * any configuration; the user can still override or extend the list.
 */
const DEFAULT_CONNECTION_MAPPINGS = [
  {
    path: "network.providers.starlink.status",
    matchValue: "online",
    resultingState: "online",
  },
];

/**
 * @param {ServerAPI} app - Signal K server API
 * @returns {Plugin}
 */
module.exports = (app) => {
  const setStatus = (app.setPluginStatus || app.setProviderStatus)?.bind(app);
  const unsubscribes = [];
  let evaluator = null;
  let pollInterval = null;

  const plugin = {
    id: PLUGIN_ID,
    name: "Internet Connectivity Monitor",
    description:
      "Centralized internet connectivity state detection with fallback active probing",

    schema: {
      type: "object",
      properties: {
        pollInterval: {
          type: "integer",
          title: "Fallback Ping Interval (seconds)",
          default: 30,
        },
        stateHeuristics: {
          type: "array",
          title: "Contextual State Rules",
          items: {
            type: "object",
            properties: {
              path: { type: "string", title: "Signal K Path" },
              triggerValue: { type: "string", title: "Trigger Value" },
              resultingState: {
                type: "string",
                enum: ["online", "metered", "offline"],
              },
            },
          },
        },
        connectionMappings: {
          type: "array",
          title: "Hardware Delta Mappings",
          default: DEFAULT_CONNECTION_MAPPINGS,
          items: {
            type: "object",
            properties: {
              path: { type: "string", title: "Hardware Path" },
              matchValue: { type: "string", title: "Value to Match" },
              resultingState: {
                type: "string",
                enum: ["online", "metered", "offline"],
              },
            },
          },
        },
      },
    },

    start: (options) => {
      const raw = options || {};
      // Fall back to the shipped Starlink mapping when the user hasn't
      // configured any (undefined). An explicit empty array means the user
      // disabled hardware mappings, so we respect that.
      const config = {
        ...raw,
        connectionMappings:
          raw.connectionMappings === undefined
            ? DEFAULT_CONNECTION_MAPPINGS
            : raw.connectionMappings,
      };

      /**
       * Publishes a connectivity delta to the Signal K bus.
       *
       * @param {"online"|"offline"|"metered"|"captive"} state
       * @param {number|null} ping - Round-trip latency in ms
       */
      function publish(state, ping) {
        app.handleMessage(PLUGIN_ID, {
          context: "vessels.self",
          updates: [
            {
              source: { label: PLUGIN_ID, src: "internet" },
              timestamp: new Date().toISOString(),
              values: [
                { path: STATE_PATH, value: state },
                { path: PING_PATH, value: ping },
              ],
            },
          ],
        });
        setStatus(`Internet: ${state}${ping != null ? ` (${ping}ms)` : ""}`);
      }

      /**
       * Active probe wrapper used by the evaluator. Uses the retrying
       * variant to ride through transient DNS hiccups.
       */
      const probe = () => probeWithRetry();

      evaluator = createEvaluator({ config, onState: publish, probe });

      // Subscribe to the Signal K paths the heuristic and hardware rules
      // watch, so the evaluator's stream cache stays current.
      const watchedPaths = collectWatchedPaths(config);
      if (watchedPaths.length > 0) {
        const subscription = {
          context: "vessels.self",
          subscribe: watchedPaths.map((path) => ({ path, policy: "instant" })),
        };
        app.subscriptionmanager.subscribe(
          subscription,
          unsubscribes,
          (err) => app.error(`Subscription error: ${err}`),
          (delta) => feedDelta(delta, evaluator),
        );
      }

      // Adaptive timer loop: periodic re-verification even when a hardware
      // rule is stable, and the sole source of state when no hardware
      // plugin is configured.
      const intervalMs = (config.pollInterval || 30) * 1000;
      pollInterval = setInterval(() => {
        evaluator.forceProbe();
      }, intervalMs);

      // Kick off an initial probe so the state settles quickly on start.
      evaluator.forceProbe();

      // Send meta so consumers know the units and meaning of our paths.
      app.handleMessage(PLUGIN_ID, {
        context: "vessels.self",
        updates: [
          {
            meta: [
              {
                path: STATE_PATH,
                value: {
                  displayName: "Internet state",
                  description:
                    "Unified internet connectivity state: online, offline, metered, or captive",
                },
              },
              {
                path: PING_PATH,
                value: {
                  units: "ms",
                  displayName: "Internet ping",
                  description:
                    "Round-trip latency to the verification endpoint",
                },
              },
            ],
          },
        ],
      });

      setStatus("Internet monitor started");
    },

    stop: () => {
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
      for (const f of unsubscribes) f();
      unsubscribes.length = 0;
      evaluator = null;
      setStatus("Internet monitor stopped");
    },
  };

  /**
   * Collects every Signal K path referenced by the configured heuristic
   * and hardware rules, de-duplicated.
   *
   * @param {object} config - Plugin configuration
   * @returns {string[]}
   */
  function collectWatchedPaths(config) {
    const paths = new Set();
    for (const rule of config.stateHeuristics || []) {
      if (rule.path) paths.add(rule.path);
    }
    for (const rule of config.connectionMappings || []) {
      if (rule.path) paths.add(rule.path);
    }
    return [...paths];
  }

  /**
   * Feeds a Signal K delta into the evaluator's stream cache. Only paths
   * the evaluator watches cause a re-evaluation.
   *
   * @param {object} delta - Signal K delta
   * @param {object} ev - Evaluator instance
   */
  function feedDelta(delta, ev) {
    if (!delta?.updates) return;
    for (const update of delta.updates) {
      if (!update.values) continue;
      for (const v of update.values) {
        ev.set(v.path, v.value);
      }
    }
  }

  // --- REST API -----------------------------------------------------------
  // Mounted by the server at /plugins/<id>. We expose the override toggle
  // and the guarded speed test endpoint.

  /**
   * Registers REST routes on the plugin router.
   *
   * @param {object} router - Express router
   */
  plugin.registerWithRouter = (router) => {
    /**
     * PUT /override — set or clear the manual state override.
     * Body: `{ "state": "online"|"offline"|"metered"|"captive"|null }`
     * (the SPEC's `forceMetered` boolean is accepted for backwards
     * compatibility and maps to the metered state).
     */
    router.put("/override", (req, res) => {
      if (!evaluator) {
        res.status(503).json({ message: "Plugin not started" });
        return;
      }
      let body = req.body;
      if (body == null) {
        // Express may not have parsed JSON; try to parse manually
        try {
          body = JSON.parse(req.body);
        } catch {
          body = {};
        }
      }
      const state = resolveOverride(body);
      if (state === undefined) {
        res.status(400).json({ message: "Invalid override body" });
        return;
      }
      evaluator.setOverride(state);
      res.json({ override: evaluator.getOverride() });
    });

    /**
     * POST /speedtest — run a guarded server-side download test.
     * 403 when metered, 409 when offline.
     */
    router.post("/speedtest", (_req, res) => {
      if (!evaluator) {
        res.status(503).json({ message: "Plugin not started" });
        return;
      }
      const { state } = evaluator.current();
      try {
        guard(state);
      } catch (err) {
        if (err instanceof GuardError) {
          res.status(err.status).json({ message: err.message });
          return;
        }
        throw err;
      }
      runSpeedTest()
        .then((result) => res.json(result))
        .catch((err) => {
          app.error(`Speed test failed: ${err.message}`);
          res.status(500).json({ message: err.message });
        });
    });
  };

  return plugin;
};

/**
 * Resolves the override state from a request body, accepting both the
 * SPEC's `forceMetered` boolean and a direct `state` string.
 *
 * @param {object} body
 * @returns {"online"|"offline"|"metered"|"captive"|null|undefined} state,
 *   or `undefined` when the body is unrecognizable
 */
function resolveOverride(body) {
  if (!body || typeof body !== "object") return undefined;
  if (typeof body.state === "string") {
    const valid = ["online", "offline", "metered", "captive"];
    if (valid.includes(body.state)) return body.state;
    if (body.state === "") return null;
    return undefined;
  }
  if (body.state === null) return null;
  if (typeof body.forceMetered === "boolean") {
    return body.forceMetered ? "metered" : null;
  }
  if (body.forceMetered === null) return null;
  return undefined;
}

module.exports.PLUGIN_ID = PLUGIN_ID;
module.exports.STATE_PATH = STATE_PATH;
module.exports.PING_PATH = PING_PATH;
module.exports.DEFAULT_CONNECTION_MAPPINGS = DEFAULT_CONNECTION_MAPPINGS;
