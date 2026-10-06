import { describe, expect, it } from 'vitest';
import {
  compact,
  goalFromMessages,
  HOST_TEXT_MARKER_PREFIX,
  HOST_TEXT_PATTERNS,
  isHostText,
  reductionRatio,
  resolveOptions,
  stripHostText,
  trimHostText,
  type JevAsker,
  type Message,
} from '../src/index.js';
import { summarize } from '../hooks/fast-jev.js';

const user = (text: string): Message => ({ role: 'user', text, toolUses: [] });
const assistant = (text: string): Message => ({ role: 'assistant', text, toolUses: [] });
const reminder = (n: number): string => `<system-reminder>\n${'SessionStart hook additional context: rules. '.repeat(n)}\n</system-reminder>`;
const opts = (preserveRecentMessages: number, hostTextHeadChars = 200) => ({ preserveRecentMessages, hostTextHeadChars });
const noJev: JevAsker = { ask: async () => ({ answers: {} }) };

describe('trimHostText', () => {
  it('trims recognized blocks outside the pinned range and keeps a head and marker', () => {
    const big = reminder(40);
    const messages = [user('first prompt'), user(big), assistant('ok'), user('recent')];
    const out = trimHostText(messages, opts(1));
    expect(out.trimmed).toBe(1);
    expect(out.messages[1]!.text.length).toBeLessThan(big.length / 2);
    expect(out.messages[1]!.text).toContain(big.slice(0, 200));
    expect(out.messages[1]!.text).toContain(HOST_TEXT_MARKER_PREFIX);
    expect(out.messages[1]!.text.endsWith('</system-reminder>')).toBe(true);
    expect(out.charsCut).toBe(big.length - out.messages[1]!.text.length);
    expect(out.messages[0]).toBe(messages[0]);
  });

  it('covers every tagged pattern and the hook header', () => {
    for (const { name } of HOST_TEXT_PATTERNS) {
      const body = 'x'.repeat(600);
      const text =
        name === 'hook-output-header' ? `PostToolUse hook success: ${body}` : `<${name}>${body}</${name}>`;
      const out = trimHostText([user('a'), user(text), user('z')], opts(1));
      expect(out.trimmed, name).toBe(1);
    }
  });

  it('never touches pinned messages', () => {
    const big = reminder(40);
    const messages = [user(big), user('p'), user(big), user(big)];
    const out = trimHostText(messages, opts(2));
    expect(out.messages[2]).toBe(messages[2]);
    expect(out.messages[3]).toBe(messages[3]);
    expect(out.messages[1]).toBe(messages[1]);
  });

  it('trims message 0 only when it is itself host text', () => {
    const big = reminder(40);
    expect(trimHostText([user(big), user('b'), user('c')], opts(1)).trimmed).toBe(1);
    const mixed = user(`${big}\nfix the bug`);
    expect(trimHostText([mixed, user('b'), user('c')], opts(1)).messages[0]).toBe(mixed);
  });

  it('leaves free prose and short blocks alone', () => {
    const prose = 'The system reminder said to check the task notification; <system-reminder is just a word here. '.repeat(20);
    const messages = [user('a'), user(prose), user('<system-reminder>short</system-reminder>'), user('z')];
    const out = trimHostText(messages, opts(1));
    expect(out.trimmed).toBe(0);
    expect(out.messages[1]).toBe(messages[1]);
  });

  it('is idempotent', () => {
    const messages = [user('a'), user(`${reminder(40)} and a ${reminder(30)}`), user('z')];
    const once = trimHostText(messages, opts(1));
    const twice = trimHostText(once.messages, opts(1));
    expect(twice.trimmed).toBe(0);
    expect(twice.messages[1]!.text).toBe(once.messages[1]!.text);
  });

  it('keeps the user prompt that follows a reminder', () => {
    const prompt = 'Please rename the function parseFoo to parseBar in src/foo.ts.';
    const text = `<system-reminder>\n${'As you answer the user questions, you can use the following context: x. '.repeat(30)}\n</system-reminder>\n${prompt}`;
    const out = trimHostText([user('a'), user(text), user('z')], opts(1));
    expect(out.messages[1]!.text).toContain(prompt);
    expect(out.messages[1]!.text.length).toBeLessThan(text.length / 3);
  });

  it('does not touch tool results or assistant messages', () => {
    const result: Message = { role: 'user', text: reminder(40), toolUses: [], toolResults: [{ tool_use_id: 't', text: 'r' }] };
    const a = assistant(reminder(40));
    const out = trimHostText([user('a'), result, a, user('z')], opts(1));
    expect(out.trimmed).toBe(0);
  });
});

describe('goal', () => {
  it('excludes host text and keeps the prompt in a mixed message', () => {
    const goal = goalFromMessages([
      user('fix the flaky test'),
      user('<command-name>/compact</command-name>\n<command-message>compact</command-message>'),
      user(`${reminder(2)}\nadd a retry`),
      user('<task-notification>done</task-notification>'),
    ]);
    expect(goal).toBe('fix the flaky test\nadd a retry');
  });

  it('classifies host-only text', () => {
    expect(isHostText('<local-command-stdout>ok</local-command-stdout>')).toBe(true);
    expect(isHostText('<local-command-stdout>ok</local-command-stdout> and more')).toBe(false);
    expect(stripHostText('a<system-reminder>b</system-reminder>c')).toBe('ac');
  });
});

describe('compact with host text', () => {
  const messages = [user('start'), user(reminder(60)), assistant('ok'), user(reminder(60)), user('mid'), assistant('x'), user('y')];

  it('counts trimmed chars in the reduction ratio and the summary', async () => {
    const result = await compact(messages, noJev, { preserveRecentMessages: 2 });
    expect(result.stats.hostTextTrimmed).toBe(2);
    expect(result.stats.hostCharsTrimmed).toBeGreaterThan(3000);
    expect(reductionRatio(result)).toBeGreaterThan(0.5);
    expect(result.stats.messagesAfter).toBe(messages.length);
    expect(summarize(result)).toContain('2 host notices trimmed');
  });

  it('is a no-op with trimHostText false', async () => {
    const result = await compact(messages, noJev, { preserveRecentMessages: 2, trimHostText: false });
    expect(result.stats.hostTextTrimmed).toBe(0);
    expect(reductionRatio(result)).toBe(0);
  });

  it('validates the options', () => {
    expect(resolveOptions()).toMatchObject({ trimHostText: true, hostTextHeadChars: 200 });
    expect(resolveOptions({ trimHostText: false, hostTextHeadChars: -3.4 })).toMatchObject({ trimHostText: false, hostTextHeadChars: 0 });
    expect(resolveOptions({ hostTextHeadChars: Number.NaN }).hostTextHeadChars).toBe(200);
  });
});
