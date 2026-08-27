/**
 * Shared formatting helpers for the Internet Monitor webapp.
 *
 * Implements the visual spec's data-handling rules: values are formatted
 * with SI prefixes instead of hardcoded magnitudes, units come from the
 * Signal K `meta` tree rather than being baked into the UI, and times
 * render as local ship time with no timezone suffix (spec §2).
 *
 * Pure functions only (no DOM), so they are unit-testable in Node.
 *
 * @file format.js
 */

/**
 * Scales a numeric value with ISO prefixes for readability and appends
 * the unit (e.g. `1200 W` -> `1.2 kW`, `7340000 bit/s` -> `7.3 Mbit/s`).
 *
 * @param {number|null} value - Value in base units
 * @param {string} [unit] - Unit symbol from the path's `meta.units`
 * @returns {string} Formatted string, or `—` for missing values
 */
function formatSI(value, unit = "") {
  if (value == null || Number.isNaN(value)) return "—";
  const steps = [
    [1e9, "G"],
    [1e6, "M"],
    [1e3, "k"],
  ];
  const abs = Math.abs(value);
  for (const [factor, prefix] of steps) {
    if (abs >= factor) {
      return `${trim(value / factor)} ${prefix}${unit}`;
    }
  }
  return `${trim(value)} ${unit}`.trim();
}

/**
 * Drops a trailing `.0` so scaled values read like telemetry
 * (`1.2` not `1.20`, `940` not `940.0`).
 *
 * @param {number} n
 * @returns {string}
 */
function trim(n) {
  return String(Number(n.toFixed(1)));
}

/**
 * Formats a timestamp as local ship time: `YYYY-MM-DD HH:mm`, with no
 * timezone specifier and ISO-style dates (spec §2).
 *
 * @param {number|string|Date} ts - Epoch ms, ISO string, or Date
 * @returns {string}
 */
function formatLocalTime(ts) {
  const d = ts instanceof Date ? ts : new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(
    d.getHours(),
  )}:${p(d.getMinutes())}`;
}

/**
 * Fetches a path's `meta.units` from the Signal K REST tree (v1) so the
 * UI does not hardcode units (spec §2). Reads the enclosing branch (small
 * subtree) and walks down to the leaf, since branch responses carry the
 * nested `meta` objects.
 *
 * Returns `null` on any failure so callers can apply their own fallback.
 *
 * @param {string} branchPath - Branch path relative to `vessels.self`
 *   (e.g. `network/internet`)
 * @param {string} leafPath - Leaf below the branch, dot-separated
 *   (e.g. `speed.download`)
 * @returns {Promise<string|null>} Unit symbol, or null when unavailable
 */
async function fetchUnits(branchPath, leafPath) {
  try {
    const res = await fetch(`/signalk/v1/api/vessels/self/${branchPath}`);
    if (!res.ok) return null;
    let node = await res.json();
    for (const part of leafPath.split(".")) {
      if (!node || typeof node !== "object") return null;
      node = node[part];
    }
    return node?.meta?.units ?? null;
  } catch {
    return null;
  }
}

export { fetchUnits, formatLocalTime, formatSI };
