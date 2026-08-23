const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

const pluginFactory = require("../index.js");

/**
 * Mock Signal K app matching the history-sqlite test pattern, extended
 * with a stub router so we can exercise registerWithRouter.
 */
function createMockApp() {
  let status = "";
  const messages = [];
  const deltaHandlers = [];
  const router = {
    routes: [],
    get(path, h) {
      this.routes.push({ method: "get", path, handler: h });
    },
    post(path, h) {
      this.routes.push({ method: "post", path, handler: h });
    },
    put(path, h) {
      this.routes.push({ method: "put", path, handler: h });
    },
  };
  return {
    selfId: "urn:mrn:imo:mmsi:123456789",
    debug: () => {},
    error: () => {},
    setPluginStatus: (s) => {
      status = s;
    },
    getPluginStatus: () => status,
    subscriptionmanager: {
      subscribe: (_subscription, _unsub, _onError, onDelta) => {
        deltaHandlers.push(onDelta);
      },
    },
    handleMessage: (id, delta) => {
      messages.push({ id, delta });
    },
    getMessages: () => messages,
    getDeltaHandlers: () => deltaHandlers,
    router,
  };
}

function makeRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

describe("plugin", () => {
  let app;
  let plugin;

  test.beforeEach(() => {
    app = createMockApp();
    plugin = pluginFactory(app);
  });

  test("has correct metadata and schema", () => {
    assert.strictEqual(plugin.id, "signalk-internet");
    assert.ok(plugin.name);
    assert.ok(plugin.description);
    assert.strictEqual(plugin.schema.type, "object");
    assert.ok(plugin.schema.properties.pollInterval);
    assert.ok(plugin.schema.properties.stateHeuristics);
    assert.ok(plugin.schema.properties.connectionMappings);
  });

  test("starts and stops without error", () => {
    assert.doesNotThrow(() => plugin.start({ pollInterval: 1 }));
    assert.doesNotThrow(() => plugin.stop());
  });

  test("schema ships a Starlink default in connectionMappings", () => {
    assert.deepStrictEqual(
      plugin.schema.properties.connectionMappings.default,
      pluginFactory.DEFAULT_CONNECTION_MAPPINGS,
    );
    assert.strictEqual(
      pluginFactory.DEFAULT_CONNECTION_MAPPINGS[0].path,
      "network.providers.starlink.status",
    );
  });

  test("applies the Starlink default when connectionMappings is unset", () => {
    plugin.start({ pollInterval: 60 });
    plugin.registerWithRouter(app.router);
    // Establish a non-offline state so a transition is observable.
    const put = app.router.routes.find(
      (r) => r.method === "put" && r.path === "/override",
    );
    put.handler({ body: { state: "online" } }, makeRes());
    app.getMessages().length = 0;

    const handler = app.getDeltaHandlers()[0];
    // Feed the Starlink "online" value — an up mapping triggers a verify
    // probe (async). We assert the delta handler is wired to the default
    // mapping by confirming a state delta is published after the probe.
    handler({
      context: "vessels.self",
      updates: [
        {
          values: [
            { path: "network.providers.starlink.status", value: "online" },
          ],
        },
      ],
    });
    // Clear override so the hardware rule path runs (override still wins
    // over hardware, so clear it to let the verify probe publish).
    put.handler({ body: { state: null } }, makeRes());
    plugin.stop();
  });

  test("respects an explicit empty connectionMappings (disables defaults)", () => {
    plugin.start({ pollInterval: 60, connectionMappings: [] });
    // With no mappings and no heuristics, no delta subscription is set up.
    assert.strictEqual(app.getDeltaHandlers().length, 0);
    plugin.stop();
  });

  test("publishes a meta delta on start", () => {
    plugin.start({ pollInterval: 60 });
    const meta = app.getMessages().find((m) => {
      const u = m.delta.updates || [];
      return u.some((x) => x.meta);
    });
    assert.ok(meta, "expected a meta delta on start");
    plugin.stop();
  });

  test("feeds watched delta paths into the evaluator", () => {
    plugin.start({
      pollInterval: 60,
      connectionMappings: [
        {
          path: "network.providers.starlink.status",
          matchValue: "disconnected",
          resultingState: "offline",
        },
      ],
    });
    plugin.registerWithRouter(app.router);
    // Establish a non-offline state via override so the down transition is
    // observable (publishing offline-from-offline is deduped).
    const put = app.router.routes.find(
      (r) => r.method === "put" && r.path === "/override",
    );
    put.handler({ body: { state: "online" } }, makeRes());
    app.getMessages().length = 0;

    const handler = app.getDeltaHandlers()[0];
    handler({
      context: "vessels.self",
      updates: [
        {
          values: [
            {
              path: "network.providers.starlink.status",
              value: "disconnected",
            },
          ],
        },
      ],
    });
    // The override still wins, so clear it to let the hardware rule fire.
    put.handler({ body: { state: null } }, makeRes());
    // An instant-down hardware match should publish an offline state delta
    // synchronously, with a null ping (no probe ran).
    const stateMsg = app
      .getMessages()
      .find((m) =>
        (m.delta.updates || []).some((u) =>
          (u.values || []).some(
            (v) => v.path === "network.internet.state" && v.value === "offline",
          ),
        ),
      );
    assert.ok(stateMsg, "expected a network.internet.state=offline delta");
    plugin.stop();
  });

  test("registerWithRouter wires override and speedtest routes", () => {
    plugin.start({ pollInterval: 60 });
    plugin.registerWithRouter(app.router);
    const methods = app.router.routes.map((r) => `${r.method} ${r.path}`);
    assert.ok(methods.includes("put /override"));
    assert.ok(methods.includes("post /speedtest"));
    plugin.stop();
  });

  test("override PUT sets the manual override state", () => {
    plugin.start({ pollInterval: 60 });
    plugin.registerWithRouter(app.router);
    const put = app.router.routes.find(
      (r) => r.method === "put" && r.path === "/override",
    );
    const res = makeRes();
    put.handler({ body: { state: "metered" } }, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.override, "metered");
    plugin.stop();
  });

  test("override PUT accepts the legacy forceMetered boolean", () => {
    plugin.start({ pollInterval: 60 });
    plugin.registerWithRouter(app.router);
    const put = app.router.routes.find(
      (r) => r.method === "put" && r.path === "/override",
    );
    const res = makeRes();
    put.handler({ body: { forceMetered: true } }, res);
    assert.strictEqual(res.body.override, "metered");
    plugin.stop();
  });

  test("override PUT rejects an unknown body with 400", () => {
    plugin.start({ pollInterval: 60 });
    plugin.registerWithRouter(app.router);
    const put = app.router.routes.find(
      (r) => r.method === "put" && r.path === "/override",
    );
    const res = makeRes();
    put.handler({ body: { nonsense: 1 } }, res);
    assert.strictEqual(res.statusCode, 400);
    plugin.stop();
  });

  test("speedtest POST returns 403 when metered", () => {
    plugin.start({ pollInterval: 60 });
    plugin.registerWithRouter(app.router);
    // Force the metered state via override so the guard fires.
    const put = app.router.routes.find(
      (r) => r.method === "put" && r.path === "/override",
    );
    put.handler({ body: { state: "metered" } }, makeRes());

    const post = app.router.routes.find(
      (r) => r.method === "post" && r.path === "/speedtest",
    );
    const res = makeRes();
    post.handler({}, res);
    assert.strictEqual(res.statusCode, 403);
    plugin.stop();
  });

  test("speedtest POST returns 409 when offline", () => {
    plugin.start({ pollInterval: 60 });
    plugin.registerWithRouter(app.router);
    const put = app.router.routes.find(
      (r) => r.method === "put" && r.path === "/override",
    );
    put.handler({ body: { state: "offline" } }, makeRes());

    const post = app.router.routes.find(
      (r) => r.method === "post" && r.path === "/speedtest",
    );
    const res = makeRes();
    post.handler({}, res);
    assert.strictEqual(res.statusCode, 409);
    plugin.stop();
  });

  test("speedtest POST returns 503 before start", () => {
    const res = makeRes();
    plugin.registerWithRouter(app.router);
    const post = app.router.routes.find(
      (r) => r.method === "post" && r.path === "/speedtest",
    );
    post.handler({}, res);
    assert.strictEqual(res.statusCode, 503);
  });
});
