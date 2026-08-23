/**
 * Server-side download speed test with metered/offline guards.
 *
 * Pulls a bounded amount of data over HTTPS and reports throughput. To
 * protect expensive satellite bandwidth, callers must check the current
 * connectivity state before invoking the actual download — {@link
 * guard} encodes the hard guards from the SPEC (403 when metered, 409
 * when offline) and is reused by the REST handler.
 *
 * Uses only `node:https` and `node:stream` — no runtime dependencies.
 *
 * @file speedtest.js
 */

const https = require("node:https");

/**
 * Maximum bytes downloaded during a test. The SPEC caps this at 5 MB to
 * keep satellite/ metered exposure bounded even if a guard is bypassed.
 */
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Hard timeout for the whole download, in ms.
 */
const DOWNLOAD_TIMEOUT_MS = 20000;

/**
 * CDN endpoint used for the download. Cloudflare's speed test file is a
 * reliable, globally-distributed target that allows streaming without
 * buffering it all in memory.
 */
const DEFAULT_DOWNLOAD_URL = `https://speed.cloudflare.com/__down?bytes=${MAX_BYTES}`;

/**
 * Guard error carrying an HTTP status code.
 */
class GuardError extends Error {
  /**
   * @param {number} status - HTTP status code
   * @param {string} message - Error description
   */
  constructor(status, message) {
    super(message);
    this.status = status;
    this.name = "GuardError";
  }
}

/**
 * Validates the current connectivity state against the speed-test guards.
 *
 * @param {"online"|"offline"|"metered"|"captive"} state - Current state
 * @returns {void}
 * @throws {GuardError} 403 when metered, 409 when offline
 */
function guard(state) {
  if (state === "metered") {
    throw new GuardError(403, "Speed test blocked on metered connection");
  }
  if (state === "offline") {
    throw new GuardError(409, "Speed test blocked while offline");
  }
}

/**
 * Result of a speed test.
 *
 * @typedef {Object} SpeedTestResult
 * @property {number} bytes - Bytes downloaded
 * @property {number} elapsedMs - Wall-clock download time in ms
 * @property {number} throughputMbps - Measured throughput in Mbit/s
 */

/**
 * Runs a bounded HTTPS download and reports throughput.
 *
 * The download is capped at {@link MAX_BYTES} and times out at
 * {@link DOWNLOAD_TIMEOUT_MS}. Returns the byte count, elapsed time and
 * throughput in Mbit/s.
 *
 * @param {Object} [options]
 * @param {string} [options.url=DEFAULT_DOWNLOAD_URL] - Download URL
 * @param {number} [options.maxBytes=MAX_BYTES] - Maximum bytes to download
 * @param {number} [options.timeoutMs=DOWNLOAD_TIMEOUT_MS] - Hard timeout
 * @returns {Promise<SpeedTestResult>}
 */
function runSpeedTest({
  url = DEFAULT_DOWNLOAD_URL,
  maxBytes = MAX_BYTES,
  timeoutMs = DOWNLOAD_TIMEOUT_MS,
} = {}) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    let bytes = 0;
    let settled = false;

    const finish = (err) => {
      if (settled) return;
      settled = true;
      req.destroy();
      if (timer) clearTimeout(timer);
      if (err) {
        reject(err);
        return;
      }
      const elapsedMs = Date.now() - start;
      const throughputMbps =
        elapsedMs > 0 ? (bytes * 8) / 1000000 / (elapsedMs / 1000) : 0;
      resolve({ bytes, elapsedMs, throughputMbps });
    };

    const timer = setTimeout(() => {
      finish(new Error(`Speed test timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      // Don't follow redirects to a captive portal — that would inflate
      // "success" on a metered captive network. A 3xx is treated as a
      // failure so the guard logic stays meaningful.
      if (res.statusCode && res.statusCode >= 300) {
        finish(new Error(`Download returned status ${res.statusCode}`));
        return;
      }
      res.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes >= maxBytes) {
          finish();
        }
      });
      res.on("end", () => finish());
      res.on("error", finish);
    });
    req.on("error", finish);
    req.on("timeout", () => {
      finish(new Error(`Speed test timed out after ${timeoutMs}ms`));
    });
  });
}

/**
 * Convenience: guard-then-run. Checks the state and, if allowed, runs the
 * speed test. Exported separately so the REST handler can apply the guard
 * before the (stateless) test and so tests can exercise the guard logic in
 * isolation.
 *
 * @param {"online"|"offline"|"metered"|"captive"} state - Current state
 * @param {Object} [options] - {@link runSpeedTest} options
 * @returns {Promise<SpeedTestResult>}
 */
async function guardedSpeedTest(state, options) {
  guard(state);
  return runSpeedTest(options);
}

module.exports = {
  guard,
  runSpeedTest,
  guardedSpeedTest,
  GuardError,
  MAX_BYTES,
  DOWNLOAD_TIMEOUT_MS,
  DEFAULT_DOWNLOAD_URL,
};
