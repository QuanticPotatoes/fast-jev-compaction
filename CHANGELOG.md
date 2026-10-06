# Changelog

All notable changes to this fork are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.6.0]

Changes relative to ferrisworks 0.5.4, the base of this fork.

### Added

- `keepMode: 'rank'` (new default) with `keepResultTokens` (12000) and
  `keepCallTokens` (4000): keep the best-scored tool results and inputs within
  token budgets instead of applying an absolute threshold, which kept 0 calls on
  measured sessions because Jev scores are compressed. `keepMode: 'threshold'`
  restores the previous behavior.
- `targetPercent` (default 45): when the estimated context after compaction would
  still exceed this percentage of the window, the Jev result is given up (built-in
  summary on automatic compactions, skipped otherwise).
- Regression test for headless sessions (upstream PR #125).
- Surrogate pairs kept whole when cutting text for the Jev state, plus a request
  backstop for lone surrogates (upstream PR #132).
- CI workflow (typecheck, tests, version consistency, version-bump check on pull
  requests), `scripts/check-version.mjs`, and a release workflow that tags and
  publishes a GitHub release for each new version on `main`.

### Changed

- Rebranded as the QuanticPotatoes fork: marketplace name, install commands and
  fork documentation.
- Version bumped to 0.6.0 so Claude Code delivers these changes: it updates an
  installed plugin only when its version string changes.

## [0.5.4]

ferrisworks/fast-jev-compaction 0.5.4, the integration base. See the README's
"About this fork" for what it merged from upstream.
