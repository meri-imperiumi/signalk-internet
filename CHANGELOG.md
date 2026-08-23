# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `negate` option on contextual heuristic and hardware mapping rules to
  match when a string value **differs** from the configured trigger/match
  value (a NOT matcher). Lets you treat e.g. any LTE operator other than
  "No service" as `online`.

## [0.1.0] - 2026-08-23

### Added
- Initial version
