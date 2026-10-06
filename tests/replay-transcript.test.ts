import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { parseTranscript, segmentsOf } from '../tools/replay/transcript.js';

const fixture = readFileSync(new URL('./fixtures/transcript.jsonl', import.meta.url), 'utf8');

describe('replay transcript parser', () => {
  const parsed = parseTranscript(fixture);

  it('merges assistant lines sharing a message id and pairs tool_use with tool_result', () => {
    const assistant = parsed.messages[1]!;
    expect(assistant.role).toBe('assistant');
    expect(assistant.text).toBe('Reading it.');
    expect(assistant.toolUses.map((use) => [use.tool_use_id, use.tool])).toEqual([
      ['tu1', 'Read'],
      ['tu2', 'Bash'],
    ]);
    const results = parsed.messages[2]!.toolResults!;
    expect(results.map((r) => [r.tool_use_id, r.text, r.isError])).toEqual([
      ['tu1', 'export function parseWidget_v2(input) {}', false],
      ['tu2', 'abc12345def first commit', false],
    ]);
  });

  it('skips sidechain entries and counts malformed lines', () => {
    expect(parsed.malformedLines).toBe(1);
    expect(parsed.messages.some((m) => m.toolUses.some((u) => u.tool_use_id === 'tu3'))).toBe(false);
  });

  it('records compact boundaries and splits segments there', () => {
    expect(parsed.boundaries).toEqual([4]);
    expect(segmentsOf(parsed)).toEqual([
      { start: 0, end: 4 },
      { start: 4, end: parsed.messages.length },
    ]);
    expect(parsed.messages[4]!.text).toBe('Summary of the earlier session');
  });

  it('collects logged decisions, joining (i/n) parts into one event', () => {
    expect(parsed.recorded).toHaveLength(2);
    const [first, second] = parsed.recorded;
    expect(first!.messageIndex).toBe(parsed.messages.length);
    expect(first!.entries).toEqual([
      { id: 't1', tool: 'Grep', action: 'drop_call', keepCall: 0.21, keepResult: 0.11 },
      { id: 't2', tool: 'Read', action: 'keep', keepCall: 0.9, keepResult: 0.8 },
      { id: 't3', tool: 'mcp__x__y', action: 'stub_call', keepCall: 0.3, keepResult: 0.05 },
    ]);
    expect(second!.entries).toHaveLength(1);
  });
});
