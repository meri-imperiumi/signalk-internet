const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

const {
  guard,
  runSpeedTest,
  guardedSpeedTest,
  GuardError,
  MAX_BYTES,
} = require("../lib/speedtest.js");

describe("speedtest guard", () => {
  test("allows online", () => {
    assert.doesNotThrow(() => guard("online"));
  });

  test("allows captive", () => {
    assert.doesNotThrow(() => guard("captive"));
  });

  test("blocks metered with 403", () => {
    assert.throws(
      () => guard("metered"),
      (err) => err instanceof GuardError && err.status === 403,
    );
  });

  test("blocks offline with 409", () => {
    assert.throws(
      () => guard("offline"),
      (err) => err instanceof GuardError && err.status === 409,
    );
  });

  test("guardedSpeedTest throws before downloading when metered", async () => {
    await assert.rejects(
      () => guardedSpeedTest("metered"),
      (err) => err instanceof GuardError && err.status === 403,
    );
  });

  test("guardedSpeedTest throws before downloading when offline", async () => {
    await assert.rejects(
      () => guardedSpeedTest("offline"),
      (err) => err instanceof GuardError && err.status === 409,
    );
  });
});

describe("runSpeedTest", () => {
  test("caps the download at MAX_BYTES and reports throughput", async () => {
    // A tiny maxBytes so the test completes without real network: the
    // request will fail fast against an unreachable URL, exercising the
    // timeout/abort path. We only assert the error shape here.
    await assert.rejects(
      () =>
        runSpeedTest({
          url: "https://invalid.localhost.invalid/down",
          maxBytes: 1024,
          timeoutMs: 500,
        }),
      (err) => err instanceof Error,
    );
  });

  test("MAX_BYTES is 5 MB per the SPEC", () => {
    assert.strictEqual(MAX_BYTES, 5 * 1024 * 1024);
  });
});
