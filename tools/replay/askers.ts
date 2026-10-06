// Replay harness: offline askers (no network) and the guarded live one.
import {
  collectToolCalls,
  JevClient,
  type JevAnswer,
  type JevAsker,
  type JevQuestions,
  type JevResponse,
  type Message,
  type ToolCall,
} from '../../src/index.js';
import type { RecordedEvent } from './transcript.js';

export type AskerName = 'size' | 'zero' | 'one' | 'recorded' | 'jev';
export const ASKER_NAMES: readonly AskerName[] = ['size', 'zero', 'one', 'recorded', 'jev'];

export interface PointContext {
  /** The history about to be compacted. */
  messages: readonly Message[];
  /** Present when the point is a logged compaction. */
  event?: RecordedEvent;
}

/** Builds the asker for one compaction point; `null` means the point cannot be scored. */
export type AskerFactory = (context: PointContext) => JevAsker | null;

type Score = (call: ToolCall, index: number, calls: readonly ToolCall[]) => { keepCall: number; keepResult: number };

/** Answers `call_tN` / `result_tN` questions from a per-call score function. */
function scoring(calls: readonly ToolCall[], score: Score): JevAsker {
  const byId = new Map(calls.map((call, index) => [call.id, score(call, index, calls)]));
  return {
    async ask(_state, questions: JevQuestions): Promise<JevResponse> {
      const answers: Record<string, JevAnswer> = {};
      for (const name of Object.keys(questions)) {
        const match = /^(call|result)_(t\d+)$/.exec(name);
        const scores = match ? byId.get(match[2]!) : undefined;
        answers[name] = { noul: scores ? (match![1] === 'call' ? scores.keepCall : scores.keepResult) : 1 };
      }
      return { answers };
    },
  };
}

/** Percentile rank in [0, 1] of each element by `key` ascending; ties by position. */
function percentileRanks(calls: readonly ToolCall[], key: (call: ToolCall) => number): Map<string, number> {
  const order = calls.map((call, index) => ({ call, index })).sort((a, b) => key(a.call) - key(b.call) || a.index - b.index);
  const denominator = Math.max(1, calls.length - 1);
  return new Map(order.map(({ call }, rank) => [call.id, rank / denominator]));
}

/** "Keep the largest outputs" (upstream issue #26): result score = log-size rank, call score = recency. */
export const sizeAsker: AskerFactory = ({ messages }) => {
  const calls = collectToolCalls(messages, 0);
  const sizeRank = percentileRanks(calls, (call) => Math.log1p(call.resultChars));
  const denominator = Math.max(1, calls.length - 1);
  return scoring(calls, (call, index) => ({ keepCall: index / denominator, keepResult: sizeRank.get(call.id) ?? 0 }));
};

const constant = (value: number): AskerFactory => ({ messages }) =>
  scoring(collectToolCalls(messages, 0), () => ({ keepCall: value, keepResult: value }));

export const zeroAsker: AskerFactory = constant(0);
export const oneAsker: AskerFactory = constant(1);

/** Minimum share of recorded entries whose tool name matches the call with the same `tN` id. */
export const MIN_RECORDED_MATCH = 0.9;

/**
 * Replays the scores the hook logged. `tN` is the Nth call with a result, in transcript order;
 * a point is only usable when the tool names line up, since earlier in-place compactions can
 * shift the numbering. Calls the log does not list (pinned ones) keep their result.
 */
export const recordedAsker: AskerFactory = ({ messages, event }) => {
  if (!event || event.entries.length === 0) return null;
  const calls = collectToolCalls(messages, 0);
  const matching = event.entries.filter((entry) => calls.find((call) => call.id === entry.id)?.tool === entry.tool);
  if (matching.length / event.entries.length < MIN_RECORDED_MATCH) return null;
  const logged = new Map(matching.map((entry) => [entry.id, entry]));
  return scoring(calls, (call) => {
    const entry = logged.get(call.id);
    return entry ? { keepCall: entry.keepCall, keepResult: entry.keepResult } : { keepCall: 1, keepResult: 1 };
  });
};

/** Live Jev; refuses to build without both the flag and the key. */
export function liveJevAsker(allowNetwork: boolean): AskerFactory {
  if (!allowNetwork) throw new Error('--asker jev calls the TypeSafe API: pass --allow-network');
  if (!process.env.TYPESAFE_API_KEY) throw new Error('--asker jev needs TYPESAFE_API_KEY');
  const client = new JevClient();
  return () => client;
}

export function askerFor(name: AskerName, allowNetwork: boolean): AskerFactory {
  switch (name) {
    case 'size':
      return sizeAsker;
    case 'zero':
      return zeroAsker;
    case 'one':
      return oneAsker;
    case 'recorded':
      return recordedAsker;
    case 'jev':
      return liveJevAsker(allowNetwork);
  }
}
