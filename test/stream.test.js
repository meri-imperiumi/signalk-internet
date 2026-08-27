const { test, describe, before } = require("node:test");
const assert = require("node:assert/strict");

// Only the pure backoff helper is exercised here; the SignalKStream
// class itself needs a DOM/WebSocket environment.
let backoffDelay;

describe("stream backoff", () => {
  before(async () => {
    ({ backoffDelay } = await import("../public/signalk-stream.js"));
  });

  test("doubles the delay per failed attempt (spec §2)", () => {
    assert.strictEqual(backoffDelay(0), 1000);
    assert.strictEqual(backoffDelay(1), 2000);
    assert.strictEqual(backoffDelay(2), 4000);
    assert.strictEqual(backoffDelay(4), 16000);
  });

  test("caps the delay at 30s", () => {
    assert.strictEqual(backoffDelay(5), 30000);
    assert.strictEqual(backoffDelay(20), 30000);
  });
});
