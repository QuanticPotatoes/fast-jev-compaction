# Changelog

All notable changes to this fork are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.7.0]

### Added

- `trimHostText` (default true) and `hostTextHeadChars` (default 200): outside
  the pinned recent messages, host-generated blocks in user turns
  (`<system-reminder>`, `<task-notification>`, local and `!` command echoes and
  output, untagged hook output) are cut to their head plus a
  `[fast-jev-compaction trimmed N chars of host notice]` marker. Recognition is
  by complete tag pairs or an anchored hook header only; free prose is never
  trimmed. Upstream issue #70 measured 54% of retained user text as host text,
  the main source of the rising post-compaction floor.
- The Jev goal is built from user text with host blocks removed, so `/compact`
  echoes and reminders no longer steer the keep decisions.
- The compaction summary line reports host notices trimmed.

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
