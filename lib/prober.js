/**
 * Active internet probing: DNS resolution and HTTP captive-portal
 * detection.
 *
 * Uses only Node.js native modules (`node:dns`, `node:https`,
 * `node:timers/promises`) to keep the plugin dependency-free.
 *
 * The probe resolves a known hostname and fetches a captive-portal
 * detection endpoint. If the HTTP response body matches the expected
 * "success" marker, the connection is `online`; if DNS or the request
 * fails outright it is `offline`; if the request succeeds but the body
 * does not match, the connection is behind a `captive` portal.
 *
 * @file prober.js
 */

const dns = require("node:dns/promises");
const https = require("node:https");
const { setTimeout: sleep } = require("node:timers/promises");

/**
 * Default hostname to resolve for the DNS check.
 */
const DEFAULT_DNS_HOST = "captive.apple.com";

/**
 * Default captive-portal detection URL. Apple's hotspot-detect endpoint
 * returns a known body when there is unfettered internet access.
 */
const DEFAULT_CAPTIVE_URL = "https://captive.apple.com/hotspot-detect.html";

/**
 * Expected response body fragment indicating an open connection.
 *
 * The Apple captive endpoint returns `<HTML><HEAD><TITLE>Success</TITLE>`
 * when the device can reach the internet directly.
 */
const SUCCESS_MARKER = "Success";

/**
 * Per-request timeout in milliseconds.
 */
const REQUEST_TIMEOUT_MS = 5000;

/**
 * Result of a probe.
 *
 * @typedef {Object} ProbeResult
 * @property {"online"|"offline"|"captive"} state - Resolved connectivity
 * @property {number|null} ping - Round-trip latency in ms, or null on failure
 */

/**
 * Fetches a URL with a hard timeout, returning the body string and the
 * round-trip time in milliseconds.
 *
 * @param {string} url - URL to fetch
 * @param {number} [timeoutMs=REQUEST_TIMEOUT_MS] - Timeout in ms
 * @returns {Promise<{body: string, ping: number}>}
 * @throws {Error} on network failure or timeout
 */
function fetchWithTimeout(url, timeoutMs = REQUEST_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      // A captive portal often answers 200/302 with the wrong body; we
      // consume the body regardless of status and let the caller inspect it.
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        resolve({ body, ping: Date.now() - start });
      });
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy(new Error(`Request timed out after ${timeoutMs}ms`));
    });
  });
}

/**
 * Runs a single internet probe: DNS lookup + captive-portal HTTP fetch.
 *
 * @param {Object} [options]
 * @param {string} [options.dnsHost=DEFAULT_DNS_HOST] - Hostname to resolve
 * @param {string} [options.captiveUrl=DEFAULT_CAPTIVE_URL] - Captive URL
 * @param {number} [options.timeoutMs=REQUEST_TIMEOUT_MS] - Per-step timeout
 * @returns {Promise<ProbeResult>}
 */
async function probe({
  dnsHost = DEFAULT_DNS_HOST,
  captiveUrl = DEFAULT_CAPTIVE_URL,
  timeoutMs = REQUEST_TIMEOUT_MS,
} = {}) {
  // DNS resolution: failure means offline.
  try {
    await dns.resolve4(dnsHost);
  } catch (_err) {
    return { state: "offline", ping: null };
  }

  // HTTP captive check with the same hard timeout.
  try {
    const { body, ping } = await fetchWithTimeout(captiveUrl, timeoutMs);
    if (body.includes(SUCCESS_MARKER)) {
      return { state: "online", ping };
    }
    // Reachable but not the expected body -> captive portal intercepting.
    return { state: "captive", ping };
  } catch (_err) {
    return { state: "offline", ping: null };
  }
}

/**
 * Runs a probe with a short retry backoff. Two attempts back-to-back reduce
 * false negatives from transient DNS hiccups on flaky uplinks.
 *
 * @param {Object} [options] - Same as {@link probe}
 * @returns {Promise<ProbeResult>}
 */
async function probeWithRetry(options) {
  const first = await probe(options);
  if (first.state !== "offline") {
    return first;
  }
  await sleep(1000);
  return probe(options);
}

module.exports = {
  probe,
  probeWithRetry,
  fetchWithTimeout,
  DEFAULT_DNS_HOST,
  DEFAULT_CAPTIVE_URL,
  SUCCESS_MARKER,
  REQUEST_TIMEOUT_MS,
};
