const { test, describe, before } = require("node:test");
const assert = require("node:assert/strict");

// The format helpers are pure ESM (loaded by the browser as modules);
// Node >=22 detects the module syntax on dynamic import.
let formatSI;
let formatLocalTime;

describe("format helpers", () => {
  before(async () => {
    ({ formatSI, formatLocalTime } = await import("../public/format.js"));
  });

  describe("formatSI", () => {
    test("scales with SI prefixes (spec §2 examples)", () => {
      assert.strictEqual(formatSI(1200, "W"), "1.2 kW");
      assert.strictEqual(formatSI(15000, "Wh"), "15 kWh");
    });

    test("formats speed-test throughput in bit/s", () => {
      assert.strictEqual(formatSI(7_340_000, "bit/s"), "7.3 Mbit/s");
      assert.strictEqual(formatSI(940, "bit/s"), "940 bit/s");
      assert.strictEqual(formatSI(1_200_000_000, "bit/s"), "1.2 Gbit/s");
    });

    test("leaves sub-1000 values unprefixed and drops trailing .0", () => {
      assert.strictEqual(formatSI(42, "ms"), "42 ms");
      assert.strictEqual(formatSI(940.4, "bit/s"), "940.4 bit/s");
    });

    test("handles negative values and a missing unit", () => {
      assert.strictEqual(formatSI(-1_500_000, "bit/s"), "-1.5 Mbit/s");
      assert.strictEqual(formatSI(5), "5");
    });

    test("renders missing values as a dash", () => {
      assert.strictEqual(formatSI(null, "ms"), "—");
      assert.strictEqual(formatSI(Number.NaN, "ms"), "—");
    });
  });

  describe("formatLocalTime", () => {
    test("formats local ship time as YYYY-MM-DD with no timezone suffix (spec §2)", () => {
      const ts = new Date(2026, 7, 26, 14, 5);
      assert.strictEqual(formatLocalTime(ts), "2026-08-26 14:05");
    });

    test("accepts epoch milliseconds and ISO strings", () => {
      const d = new Date(2026, 0, 2, 9, 30);
      assert.strictEqual(formatLocalTime(d.getTime()), "2026-01-02 09:30");
      assert.strictEqual(formatLocalTime(d.toISOString()), "2026-01-02 09:30");
    });
  });
});
