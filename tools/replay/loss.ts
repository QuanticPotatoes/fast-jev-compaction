// Replay harness: "lost-and-needed" detection. The distinctive-token idea (paths, identifiers,
// hashes, long numbers) follows considerITman/fast-systemone-compaction `tools/replay/replay.ts` (MIT);
// the rules below (first-seen-in-assistant, K-turn window) are this harness's own.
import type { Message } from '../../src/index.js';

/** Distinct tokens kept per degraded result; bounds cost on megabyte outputs. */
export const MAX_TOKENS_PER_RESULT = 500;
export const DEFAULT_WINDOW_TURNS = 20;

const PATH = /[\w@.~+-]*\/[\w@.+/-]{4,}/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const HEX = /\b[0-9a-f]{8,}\b/gi;
const IDENT = /\b[A-Za-z_$][\w$]{7,}\b/g;
const NUMBER = /\b\d{5,}\b/g;

function distinctiveIdent(word: string): boolean {
  return /[_\d]/.test(word) || /[a-z][A-Z]/.test(word);
}

/** Distinctive tokens of a text, in first-occurrence order, capped at `limit` distinct ones. */
export function extractTokens(text: string, limit = Number.POSITIVE_INFINITY): Set<string> {
  const found = new Set<string>();
  const add = (token: string): boolean => {
    found.add(token);
    return found.size >= limit;
  };
  for (const match of text.matchAll(PATH)) {
    const token = match[0].replace(/[.,;:]+$/, '');
    if (token.length >= 8 && add(token)) return found;
  }
  for (const match of text.matchAll(UUID)) if (add(match[0].toLowerCase())) return found;
  for (const match of text.matchAll(HEX)) {
    if (/\d/.test(match[0]) && add(match[0].toLowerCase())) return found;
  }
  for (const match of text.matchAll(IDENT)) {
    if (distinctiveIdent(match[0]) && add(match[0])) return found;
  }
  for (const match of text.matchAll(NUMBER)) if (add(match[0])) return found;
  return found;
}

function stringLeaves(value: unknown, out: string[]): void {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const item of value) stringLeaves(item, out);
  else if (typeof value === 'object' && value !== null) {
    for (const item of Object.values(value)) stringLeaves(item, out);
  }
}

/** Every string of a call's input, joined: the surface where a recalled value shows up. */
export function inputText(input: Record<string, unknown>): string {
  const leaves: string[] = [];
  stringLeaves(input, leaves);
  return leaves.join('\n');
}

/** All text of a message the model could read (or wrote). */
export function messageText(message: Message): string {
  const parts = [message.text];
  for (const use of message.toolUses) parts.push(inputText(use.input));
  for (const result of message.toolResults ?? []) parts.push(result.text);
  return parts.join('\n');
}

export function stableInput(input: Record<string, unknown>): string {
  try {
    return JSON.stringify(input, Object.keys(input).sort());
  } catch {
    return '';
  }
}

export interface DegradedCall {
  tool_use_id: string;
  tool: string;
  input: Record<string, unknown>;
  /** The full result text before degradation. */
  resultText: string;
}

export interface LossVerdict {
  tool_use_id: string;
  tool: string;
  /** Distinct tokens of the result that the compacted history no longer holds. */
  lostTokens: number;
  /** Lost tokens the model later typed into a tool call before seeing them again. */
  neededTokens: number;
  lostAndNeeded: boolean;
  /** The same tool with an identical input was issued again inside the window. */
  rerun: boolean;
}

/** The messages from `from` up to the `turns`-th assistant message, never past `until`. */
function windowOf(original: readonly Message[], from: number, until: number, turns: number): Message[] {
  const out: Message[] = [];
  let assistants = 0;
  for (let i = from; i < Math.min(until, original.length) && assistants < turns; i++) {
    const message = original[i]!;
    if (message.role === 'assistant') assistants++;
    out.push(message);
  }
  return out;
}

/**
 * For each degraded (dropped or stubbed) result: which of its distinctive tokens are gone from
 * the compacted history, and did the model, within the next `turns` assistant turns of the
 * ORIGINAL transcript, type one of them into a tool call input before any message (result,
 * user text, earlier assistant text) showed it again? That is a value the model had to recall
 * from a result the compaction took away. Also flags identical re-issued calls.
 */
export function detectLoss(args: {
  original: readonly Message[];
  /** Index in `original` of the first message after the compaction point. */
  from: number;
  /** Exclusive end of the window in `original` (e.g. the segment end); defaults to the transcript end. */
  until?: number;
  compacted: readonly Message[];
  degraded: readonly DegradedCall[];
  turns?: number;
}): LossVerdict[] {
  const { original, from, compacted, degraded, turns = DEFAULT_WINDOW_TURNS, until = original.length } = args;
  if (degraded.length === 0) return [];
  const window = windowOf(original, from, until, turns);

  const kept = new Set<string>();
  for (const message of compacted) for (const token of extractTokens(messageText(message))) kept.add(token);

  const lost = degraded.map((call) => {
    const tokens = [...extractTokens(call.resultText, MAX_TOKENS_PER_RESULT)].filter((t) => !kept.has(t));
    return new Set(tokens);
  });
  const owners = new Map<string, number[]>();
  lost.forEach((tokens, index) => {
    for (const token of tokens) owners.set(token, [...(owners.get(token) ?? []), index]);
  });

  const needed = degraded.map(() => new Set<string>());
  const seen = new Set<string>();
  const issued = new Set<string>();
  for (const message of window) {
    if (message.role === 'assistant') {
      for (const use of message.toolUses) {
        issued.add(`${use.tool}\u0000${stableInput(use.input)}`);
        for (const token of extractTokens(inputText(use.input))) {
          if (seen.has(token)) continue;
          for (const index of owners.get(token) ?? []) needed[index]!.add(token);
        }
      }
    }
    for (const token of extractTokens(messageText(message))) seen.add(token);
  }

  return degraded.map((call, index) => ({
    tool_use_id: call.tool_use_id,
    tool: call.tool,
    lostTokens: lost[index]!.size,
    neededTokens: needed[index]!.size,
    lostAndNeeded: needed[index]!.size > 0,
    rerun: issued.has(`${call.tool}\u0000${stableInput(call.input)}`),
  }));
}
