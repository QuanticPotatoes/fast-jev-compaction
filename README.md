# fast-jev-compaction

Claude Code plugin that replaces the compaction summary with Jev decisions:
every tool call and result is scored in one fast request, stale ones are
dropped or truncated, everything kept stays verbatim. Also usable as an npm
library.

## About this fork

This is `QuanticPotatoes/fast-jev-compaction`. Lineage:
[tamaratran/fast-jev-compaction](https://github.com/tamaratran/fast-jev-compaction)
(upstream, frozen since 2026-09-17 with about 60 unmerged PRs) →
[ferrisworks/fast-jev-compaction](https://github.com/ferrisworks/fast-jev-compaction)
(integration fork that merged about 13 upstream PRs: secret redaction
([#98](https://github.com/tamaratran/fast-jev-compaction/pull/98)),
subagent/speculative compaction filter
([#112](https://github.com/tamaratran/fast-jev-compaction/pull/112)),
code-point-safe truncation
([#110](https://github.com/tamaratran/fast-jev-compaction/pull/110)),
Jev wait bound ([#117](https://github.com/tamaratran/fast-jev-compaction/pull/117)),
auto-only built-in fallback
([#103](https://github.com/tamaratran/fast-jev-compaction/pull/103)),
dense-token estimate ([#85](https://github.com/tamaratran/fast-jev-compaction/pull/85)),
stub-by-default dropped calls, and more) → this fork. Thanks to both for the
base. This fork adds:

- **`keepMode: 'rank'` (new default)** with `keepResultTokens` (12000) and
  `keepCallTokens` (4000): keep the best-scored results and inputs within token
  budgets, because Jev's scores are compressed. Measured on 4,603 decisions over
  60 sessions, `keepCall` was about 0.1–0.3 (max 0.58), so the absolute 0.5
  threshold kept 0 calls; upstream issues
  [#56](https://github.com/tamaratran/fast-jev-compaction/issues/56),
  [#26](https://github.com/tamaratran/fast-jev-compaction/issues/26) and
  [#52](https://github.com/tamaratran/fast-jev-compaction/issues/52) report the
  same. `keepMode: 'threshold'` keeps the old behavior.
- **`targetPercent` (default 45)**: the plugin estimates the post-compaction
  context percentage (usage percent × chars after / chars before) and, above
  the target, gives up the Jev result (built-in summary on automatic
  compactions, skip otherwise). All message text is kept verbatim, so the
  post-compaction floor rises with each compaction: reduction decayed
  77% → 68% → 82% → 63% → 46% → 32% → 30% within one session (upstream issue
  [#70](https://github.com/tamaratran/fast-jev-compaction/issues/70) reports
  36K → 87K tokens over 6 rounds).
- A regression test for headless sessions (upstream PR
  [#125](https://github.com/tamaratran/fast-jev-compaction/pull/125)) and
  surrogate pairs kept whole in state building plus a request backstop
  (upstream PR [#132](https://github.com/tamaratran/fast-jev-compaction/pull/132)).

Known gap: message text, including host-injected reminders (about 54% of the
retained "user" text per upstream issue [#70](https://github.com/tamaratran/fast-jev-compaction/issues/70)), is still never compacted.
Roadmap: cut host-generated notices (upstream PR
[#78](https://github.com/tamaratran/fast-jev-compaction/pull/78)),
replay-based measurement
(`tools/replay` in considerITman/fast-systemone-compaction), and fact salvage on
dropped calls (upstream issues [#118](https://github.com/tamaratran/fast-jev-compaction/issues/118) and [#105](https://github.com/tamaratran/fast-jev-compaction/issues/105)).

### Comparison

| | upstream (tamaratran 0.3.0) | ferrisworks 0.5.4 | this fork 0.6.0 |
| --- | --- | --- | --- |
| Tool calls kept | Absolute 0.5 threshold | Same | Rank within token budgets (`keepMode: 'rank'`); `threshold` available |
| Dropped calls | Deleted | Stub note (`dropCalls: false`) | Stub note (`dropCalls: false`) |
| Post-compaction size guard | Min 25% reduction only | Same | Same + `targetPercent` 45% |
| Built-in summary fallback | Always, on any failure or small reduction | `builtinFallback: auto` (automatic compactions only) | `builtinFallback: auto` |
| Secret redaction | No | Yes | Yes |
| Subagent and speculative compactions | Compacted | Skipped | Skipped |
| Jev wait bound | None | 15 s | 15 s |
| Headless sessions | Auto-compact retried every turn | Refusal detected, no retry | Same, with a regression test |
| Unicode safety | None | Truncated result heads | Result heads, Jev state and a request backstop |
| CI and versioned releases | No | No | Yes |

### Status of evidence

The problems this fork addresses are measured: the numbers above (0 calls kept
by the absolute threshold over 4,603 decisions, reduction decaying to 30% within
one session) come from real sessions. The improvement from rank mode and
`targetPercent` has not been measured end to end yet; a replay harness is the
next step.

### Updating

Claude Code updates an installed plugin only when its version changes. Enable
`autoUpdate: true` on the marketplace entry to receive new versions
automatically, or run `claude plugin marketplace update quanticpotatoes`.

## What and why

Most context compaction asks an LLM to summarize old turns. A summary is
lossy: a file path, exact error, constraint, or command can disappear even when
it matters later. This library never rewrites anything. It only deletes tool
calls and tool results Jev says are no longer needed, and it asks Jev while
showing it the whole conversation. User and assistant text stays verbatim and
in order.

The repository is both an npm package (`src/`) and a Claude Code plugin
(`hooks/`, `.claude-plugin/`) that uses the package to replace Claude Code's
built-in compaction summary with the original messages.

## How it works

1. Every `tool_use` is paired with its `tool_result` by `tool_use_id`. Calls in
   the first message or in the newest `preserveRecentMessages` messages are
   pinned and never touched.
2. The **state** sent to Jev is the whole conversation so far, oldest first,
   with every tool result replaced by a short note (`ok, 4213 chars (omitted)`).
   Tool inputs are included, texts are included, nothing is summarized.
3. The state is fitted into `maxStateTokens` (25k by default) in stages, each
   applied only if the previous one was not enough: tool inputs truncated to
   1000, then 200, then 60 characters; long texts abridged to head + tail,
   oldest non-pinned messages first; old non-pinned messages collapsed to a
   `[… N chars omitted …]` note; old tool calls reduced to one line each
   (`t12 Read file_path=src/a.ts → ok 480ch`); old call-less messages left
   out; runs of old call-only messages folded into one entry. If it still
   does not fit (long sessions), the calls are asked in contiguous windows,
   halved until each window's state fits: a window keeps the goal, the first
   message, the pinned newest messages and its own messages in full. A call
   whose window cannot fit even alone is not asked, so it stays. Tokens are estimated without a tokenizer (a
   word per six letters, half a token per digit, ~one per other symbol),
   calibrated to land a little above the counts Jev reports.
4. For every non-pinned call Jev gets two `noul` questions: should the **call**
   stay (knowing it was made, with its input, still matters), and should the
   **result** stay verbatim (its contents are still needed and re-running the
   tool would not do).
5. Questions are split into as many requests as needed so state plus questions
   stays under `maxRequestTokens` (30k by default, under Jev's 32k request
   limit). The same full state is resent with every request; requests run
   concurrently and their answers are merged.
6. Decisions per call. Jev's scores are compressed (keepCall rarely exceeds
   0.3), so the default `rank` mode ranks them instead of applying an absolute
   threshold: results are kept verbatim best-`keepResult`
   first within `keepResultTokens`, then the best-`keepCall` of the rest keep
   their input and a truncated result within `keepCallTokens`, the rest are
   removed (ties go to the more recent call). In `threshold` mode, against
   `keepThreshold`:
   - `keepResult ≥ threshold` → keep call and result;
   - else `keepCall ≥ threshold` → keep the call, truncate the result to its
     first `truncateHeadChars` characters plus a one-line note;
   - else → remove the call together with its result.
7. The message list is rebuilt: a message that loses all its content is
   removed, untouched messages are returned as the same objects, and no result
   is ever left without its call.

Jev failures, malformed answers or a missing key
throw; the caller (or the Claude Code hook) decides what to fall back to.

## Install and usage

```sh
npm install fast-jev-compaction
export TYPESAFE_API_KEY=...
```

```ts
import { compactMessages, reductionRatio, type Message } from 'fast-jev-compaction';

const transcript: Message[] = [
  { role: 'user', text: 'Fix the failing test. Never edit src/generated.', toolUses: [] },
  {
    role: 'assistant',
    text: '',
    toolUses: [{ tool_use_id: 'toolu_1', tool: 'Read', input: { file_path: 'src/a.ts' } }],
  },
  { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'toolu_1', text: '…file…' }] },
  // …
];

const result = await compactMessages(transcript, { preserveRecentMessages: 4 });
console.log(result.messages, result.decisions, result.stats);
if (reductionRatio(result) < 0.25) {
  // not worth it: keep the original transcript, or summarize instead
}
```

`Message` is a subset of Claude Code's `SessionMessage`, so a session transcript
can be passed in as is.

To bring your own transport, implement `JevAsker` (one `ask(state, questions)`
method) and call `compact(messages, asker, options)`; `buildJevRequest` and
`parseJevResponse` give you the HTTP request body and response validation.
The building blocks (`collectToolCalls`, `fitState`, `batchCalls`,
`decideCall`, `applyDecisions`) are exported too.

`apiKey` defaults to `process.env.TYPESAFE_API_KEY`. Never commit the key or
put it in a source file.

`baseUrl` picks the Jev endpoint. Left unset it is the TypeSafe one; the same
Jev model is also served through OpenRouter, at
`https://openrouter.ai/api/alpha/decisions`, with `model` left at
`jev-latest` and an OpenRouter key in place of a TypeSafe one.

## Options

| Option | Default | Description |
| --- | --- | --- |
| `apiKey` | `TYPESAFE_API_KEY` | TypeSafe API key (`compactMessages`/`JevClient`) |
| `model` | `jev-latest` | Jev model name |
| `baseUrl` | `https://api.typesafe.ai/v1/systemone` | System One endpoint |
| `fetch` | native `fetch` | Injectable fetch implementation for tests |
| `goal` | last 3 user prompts | Ongoing task description included in the state |
| `keepMode` | `rank` | `rank` keeps the best-scored calls within the token budgets below; `threshold` compares against `keepThreshold` |
| `keepThreshold` | `0.5` | Threshold mode: minimum keep probability for a call or result to stay |
| `keepResultTokens` | `12000` | Rank mode: estimated tokens of results kept verbatim |
| `keepCallTokens` | `4000` | Rank mode: estimated tokens of inputs plus truncated heads kept when the result is dropped |
| `preserveRecentMessages` | `6` | Newest messages never touched (the first is always kept) |
| `maxStateTokens` | `25000` | Estimated token ceiling for the state |
| `maxRequestTokens` | `30000` | Estimated ceiling for state plus one batch of questions |
| `truncateHeadChars` | `300` | Characters of a dropped tool result retained before its note |
| `dropCalls` | `false` | `true` removes a no-longer-needed call with its result; `false` leaves a stub of the call |

Plugin-only options (set as plugin options, see
[`hooks/README.md`](hooks/README.md)): `compactAtPercent` (60), `minReductionRatio`
(0.25), `compactionTimeoutMs` (15000), `builtinFallback` (`auto`),
`targetPercent` (45: above this estimated post-compaction context percentage,
the Jev result is given up for the built-in summary on automatic compactions,
or skipped otherwise), `envFile`.

`result.stats` reports message and character counts before and after, the
per-reason decision counts, the state size in estimated tokens, which fitting
stage was needed, and the number of requests.

## Limitations

- Only tool calls and results are candidates; text messages are never removed
  or shortened in the output (they are only abridged in the state Jev sees).
- Token sizes are estimates from character counts, not a tokenizer.
- Calibration is at the request level; a probability is not a proof that a
  result is safe to delete. The assistant can always re-run the tool.
- The full state is repeated with every request, so a history near the state
  ceiling costs one request per handful of questions.

## Claude Code plugin

The repository root is a Claude Code function-hook plugin: `hooks/fast-jev.ts`
is a thin adapter that feeds `session.compact` transcripts through `src/` and,
when Claude Code's own automatic compaction has to shrink the conversation,
falls back to Claude Code's built-in summary on errors or insufficient
reduction. See [`hooks/README.md`](hooks/README.md) for configuration and the
Claude Code 2.1.274 type reference.

### Install in Claude Code

Function hooks are an early-access Claude Code feature (2.1.274+), so the
opt-in flag must be set wherever Claude Code runs, e.g. in `~/.claude/settings.json`:

```json
{ "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1", "TYPESAFE_API_KEY": "<your key>" } }
```

Then add this repository as a plugin marketplace and install the plugin,
either from the shell or as slash commands inside a session:

```sh
claude plugin marketplace add QuanticPotatoes/fast-jev-compaction
claude plugin install fast-jev-compaction@quanticpotatoes
```

The install prompts for the plugin options (API key, thresholds, `truncateHeadChars`,
…); leave them at their defaults to use `TYPESAFE_API_KEY` from the environment.
Restart Claude Code or run `/reload-plugins`. From then on `/compact` (and
auto-compaction) goes through Jev: the toast reads
`fast-jev-compaction: kept N/M messages, no summary (…)` when the pruned history
replaced the built-in summary. When Jev could not remove enough (short
sessions, or when it fails) it reads `fallback to built-in summary (…)` during
Claude Code's automatic compaction, and `not compacted, no built-in summary (…)`
on `/compact` or the plugin's own request, which leave the conversation as it
is; `builtinFallback` changes which compactions fall back.

To run from a checkout without installing: `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir .`
from the repository root. No publishing step is required; the marketplace is
just the repo's `.claude-plugin/marketplace.json`.

## Development

```sh
npm install
npm run typecheck        # library + hook
npm test
npm run test:hooks:host  # native hook dispatcher tests; requires Claude Code
npm run build
npm run validate:plugin  # claude plugin validate
TYPESAFE_API_KEY="$(cat ~/.typesafe_key)" npm run demo
```

The unit tests use a fake Jev and never contact TypeSafe. The demo is the live
network check.

## Animated demo (macOS)

`demo/JevDemo` is a small native SwiftUI app that plays a scripted, dramatized
version of the compaction flow inside a Claude Code-style terminal: the tool
calls of a canned transcript are scored, results and calls Jev lets go turn red
and collapse away, and the rest stays verbatim. It never calls the API; it
exists to be screen recorded.

```sh
demo/JevDemo/build.sh   # builds demo/JevDemo/build/JevDemo.app and launches it
```

Press space in the app to replay from the start.
