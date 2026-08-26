# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]
### Changed
- Restyled the plugin webapp (status card + connection history) to the
  "Tactical Sci-Fi" Signal K UI spec: dark canvas with the semantic-neon
  color system, flat geometry with corner-bracket framing, hardware-style
  inputs and bracket toggle buttons, monospace tabular-numeric telemetry,
  48px touch targets, and a fluid single-column-to-grid layout. The override
  control is now a select + explicit `[ Apply ]` button (enabled only when the
  selection differs from the applied value) so a stray tap can't change
  connectivity policy. The page now also passively listens to `vessels.self.environment.mode` and
  reflects `day`/`night` onto `<html data-mode>` for night-mode dimming.

## [0.2.0] - 2026-08-23

### Added
- `negate` option on contextual heuristic and hardware mapping rules to
  match when a string value **differs** from the configured trigger/match
  value (a NOT matcher). Lets you treat e.g. any LTE operator other than
  "No service" as `online`.
- Default contextual heuristic: while a watch schedule is running
  (`watch.state.onWatch === true`) the state is assumed `metered`, so
  downstream plugins hold off on bandwidth-heavy work offshore. Shipped
  as a pre-seeded `stateHeuristics` default; clear or edit the list to
  opt out.

### Changed
- Heuristics are now **modifiers**, not verdicts: they refine a
  reachability base that the hardware mapping / active probe establishes
  first, and can only make it more severe (`online < metered < captive <
  offline`). A "metered when on watch" rule no longer reports `metered`
  when the uplink is actually down — it stays `offline`.
- Manual overrides are now reachability-gated for non-`offline` states.
  Forcing `online`/`metered`/`captive` is honored only when the probe
  confirms a connection; with no uplink the state falls back to `offline`
  rather than claiming connectivity that isn't there. Forcing `offline`
  remains absolute and synchronous. The speed-test guard still honors an
  override's intent immediately (forced `metered` -> 403, forced `offline`
  -> 409) without waiting for the probe.
- Internal `probe` injection: `start({ probe })` lets tests inject a fake
  probe so the suite is deterministic and never hits the network.

## [0.1.0] - 2026-08-23

### Added
- Initial version
