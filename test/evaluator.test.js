const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

const { createEvaluator, DEFAULT_STATE } = require("../lib/evaluator.js");

function makeConfig(rules = {}, mappings = []) {
  return {
    stateHeuristics: rules.heuristics || [],
    connectionMappings: mappings,
  };
}

describe("evaluator", () => {
  test("defaults to offline when nothing matches and no probe configured", () => {
    const ev = createEvaluator({ config: makeConfig() });
    assert.strictEqual(ev.current().state, DEFAULT_STATE);
  });

  test("manual override wins and is published immediately", () => {
    const seen = [];
    const ev = createEvaluator({
      config: makeConfig(),
      onState: (state) => seen.push(state),
    });
    ev.setOverride("metered");
    assert.strictEqual(ev.current().state, "metered");
    assert.deepStrictEqual(seen, ["metered"]);
    assert.strictEqual(ev.getOverride(), "metered");
  });

  test("clearing override falls through to rules", () => {
    const ev = createEvaluator({
      config: makeConfig({
        heuristics: [
          {
            path: "watch.state.onWatch",
            triggerValue: "true",
            resultingState: "metered",
          },
        ],
      }),
    });
    ev.setOverride("offline");
    assert.strictEqual(ev.current().state, "offline");

    // Seed the heuristic value before clearing the override so the rule
    // matches on the re-evaluation triggered by setOverride(null).
    ev.set("watch.state.onWatch", true);
    ev.setOverride(null);
    assert.strictEqual(ev.current().state, "metered");
    assert.strictEqual(ev.getOverride(), null);
  });

  test("heuristic rule matches a watched path", () => {
    const ev = createEvaluator({
      config: makeConfig({
        heuristics: [
          {
            path: "watch.state.onWatch",
            triggerValue: "true",
            resultingState: "metered",
          },
        ],
      }),
    });
    ev.set("watch.state.onWatch", true);
    assert.strictEqual(ev.current().state, "metered");
  });

  test("negated heuristic matches when value differs from triggerValue", () => {
    const ev = createEvaluator({
      config: makeConfig({
        heuristics: [
          {
            path: "watch.state.onWatch",
            triggerValue: "true",
            negate: true,
            resultingState: "metered",
          },
        ],
      }),
    });
    ev.set("watch.state.onWatch", false);
    assert.strictEqual(ev.current().state, "metered");
  });

  test("negated heuristic does not match the trigger value itself", () => {
    const seen = [];
    const ev = createEvaluator({
      config: makeConfig({
        heuristics: [
          {
            path: "watch.state.onWatch",
            triggerValue: "true",
            negate: true,
            resultingState: "metered",
          },
        ],
      }),
      onState: (state) => seen.push(state),
    });
    ev.set("watch.state.onWatch", true);
    // Trigger value itself must NOT match; stays at the default state.
    assert.strictEqual(ev.current().state, DEFAULT_STATE);
  });

  test("negated heuristic does not match an absent value", () => {
    const seen = [];
    const ev = createEvaluator({
      config: makeConfig({
        heuristics: [
          {
            path: "networking.lte.connectionText",
            triggerValue: "No service",
            negate: true,
            resultingState: "online",
          },
        ],
      }),
      onState: (state) => seen.push(state),
    });
    ev.reevaluate();
    // No value set yet — a NOT rule still needs a value to negate against.
    assert.deepStrictEqual(seen, []);
  });

  test("hardware up mapping triggers a targeted verify probe", async () => {
    const calls = [];
    const probe = async () => {
      calls.push("probe");
      return { state: "online", ping: 42 };
    };
    const seen = [];
    const ev = createEvaluator({
      config: makeConfig({}, [
        {
          path: "network.providers.starlink.status",
          matchValue: "connected",
          resultingState: "online",
        },
      ]),
      onState: (state, ping) => seen.push({ state, ping }),
      probe,
    });
    ev.set("network.providers.starlink.status", "connected");
    // No immediate publish — the uplink "up" must be verified first.
    assert.deepStrictEqual(seen, []);
    await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(calls.length, 1);
    assert.deepStrictEqual(seen, [{ state: "online", ping: 42 }]);
  });

  test("negated hardware mapping matches any operator except the configured value", async () => {
    const calls = [];
    const probe = async () => {
      calls.push("probe");
      return { state: "online", ping: 50 };
    };
    const seen = [];
    const ev = createEvaluator({
      config: makeConfig({}, [
        {
          path: "networking.lte.connectionText",
          matchValue: "No service",
          negate: true,
          resultingState: "online",
        },
      ]),
      onState: (state, ping) => seen.push({ state, ping }),
      probe,
    });
    // An actual operator name differs from "No service" -> match.
    ev.set("networking.lte.connectionText", "Telia");
    assert.deepStrictEqual(seen, []);
    await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(calls.length, 1);
    assert.deepStrictEqual(seen, [{ state: "online", ping: 50 }]);
  });

  test("negated hardware mapping does not match the excluded value", () => {
    const seen = [];
    const ev = createEvaluator({
      config: makeConfig({}, [
        {
          path: "networking.lte.connectionText",
          matchValue: "No service",
          negate: true,
          resultingState: "offline",
        },
      ]),
      onState: (state, ping) => seen.push({ state, ping }),
    });
    ev.set("networking.lte.connectionText", "No service");
    // The excluded value must NOT match.
    assert.deepStrictEqual(seen, []);
  });

  test("negated hardware down mapping transitions to offline for any other value", () => {
    const seen = [];
    const ev = createEvaluator({
      config: makeConfig({}, [
        {
          path: "network.providers.starlink.status",
          matchValue: "disconnected",
          negate: true,
          resultingState: "offline",
        },
      ]),
      onState: (state, ping) => seen.push({ state, ping }),
    });
    ev.setOverride("online");
    seen.length = 0;
    ev.set("network.providers.starlink.status", "connected");
    ev.setOverride(null);
    assert.deepStrictEqual(seen, [{ state: "offline", ping: null }]);
  });

  test("hardware down mapping transitions to offline instantly (0ms)", () => {
    const seen = [];
    const ev = createEvaluator({
      config: makeConfig({}, [
        {
          path: "network.providers.starlink.status",
          matchValue: "disconnected",
          resultingState: "offline",
        },
      ]),
      onState: (state, ping) => seen.push({ state, ping }),
    });
    // Establish a non-offline state so the down transition is observable.
    ev.setOverride("online");
    seen.length = 0;
    // Seed the down value, then clear the override so the hardware rule
    // fires on re-evaluation.
    ev.set("network.providers.starlink.status", "disconnected");
    ev.setOverride(null);
    // Instant down: published synchronously with no probe, null ping.
    assert.deepStrictEqual(seen, [{ state: "offline", ping: null }]);
  });

  test("unwatched path does not trigger a re-evaluation", () => {
    const seen = [];
    const ev = createEvaluator({
      config: makeConfig(),
      onState: (state) => seen.push(state),
    });
    ev.set("some.unrelated.path", 42);
    assert.deepStrictEqual(seen, []);
  });

  test("probe fallback is used when no rule matches", async () => {
    const calls = [];
    const probe = async () => {
      calls.push("probe");
      return { state: "online", ping: 12 };
    };
    const seen = [];
    const ev = createEvaluator({
      config: makeConfig(),
      onState: (state, ping) => seen.push({ state, ping }),
      probe,
    });
    ev.reevaluate();
    // Probe runs async; give it a tick to settle.
    await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(calls.length, 1);
    assert.deepStrictEqual(seen, [{ state: "online", ping: 12 }]);
    assert.strictEqual(ev.current().state, "online");
    assert.strictEqual(ev.current().ping, 12);
  });

  test("override beats a matching heuristic", () => {
    const ev = createEvaluator({
      config: makeConfig({
        heuristics: [
          {
            path: "watch.state.onWatch",
            triggerValue: "true",
            resultingState: "metered",
          },
        ],
      }),
    });
    ev.set("watch.state.onWatch", true);
    ev.setOverride("online");
    assert.strictEqual(ev.current().state, "online");
  });

  test("forceProbe re-runs the probe and publishes", async () => {
    let n = 0;
    const probe = async () => ({ state: "online", ping: ++n });
    const seen = [];
    const ev = createEvaluator({
      config: makeConfig(),
      onState: (state, ping) => seen.push({ state, ping }),
      probe,
    });
    await ev.forceProbe();
    await ev.forceProbe();
    assert.deepStrictEqual(seen, [
      { state: "online", ping: 1 },
      { state: "online", ping: 2 },
    ]);
  });
});
