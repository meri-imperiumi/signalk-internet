const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

const {
  probe,
  probeWithRetry,
  DEFAULT_DNS_HOST,
  SUCCESS_MARKER,
} = require("../lib/prober.js");

describe("prober", () => {
  test("returns offline when DNS resolution fails", async () => {
    const result = await probe({
      dnsHost: "definitely-not-a-real-host.invalid",
      captiveUrl: "https://invalid.localhost.invalid/x",
      timeoutMs: 1000,
    });
    assert.strictEqual(result.state, "offline");
    assert.strictEqual(result.ping, null);
  });

  test("probeWithRetry returns offline on persistent DNS failure", async () => {
    const result = await probeWithRetry({
      dnsHost: "definitely-not-a-real-host.invalid",
      captiveUrl: "https://invalid.localhost.invalid/x",
      timeoutMs: 500,
    });
    assert.strictEqual(result.state, "offline");
  });

  test("defaults are sensible", () => {
    assert.strictEqual(DEFAULT_DNS_HOST, "captive.apple.com");
    assert.ok(SUCCESS_MARKER.length > 0);
  });
});
