import { describe, expect, it } from 'vitest';
import { createSession, expire, sessionResult, typeChars } from '../src/engine';

describe('expire and typeChars', () => {
  it('does nothing before the first key or without a limit', () => {
    const s = createSession('hello');
    expect(expire(s, 99999, 1000)).toBe(s);
    const t = typeChars(s, 'he', 1000);
    expect(expire(t, 99999, null)).toBe(t);
  });

  it('finishes exactly at the limit', () => {
    const s = typeChars(createSession('hello world'), 'h', 1000);
    const done = expire(s, 2500, 1000);
    expect(done.finishedAt).toBe(2000);
    expect(expire(done, 9999, 1000)).toBe(done);
  });

  it('drops characters that arrive after the limit', () => {
    const s = typeChars(createSession('hello world'), 'h', 1000);
    const next = typeChars(s, 'ello', 2600, 1000);
    expect(next.finishedAt).toBe(2000);
    expect(next.typed).toBe('h');
  });

  it('ends a passage when the last character is typed', () => {
    const s = typeChars(createSession('hi'), 'hi', 1000);
    expect(s.finishedAt).not.toBeNull();
  });

  // The deadline is startedAt + limitMs exactly; a keystroke the instant before it is still
  // counted, the keystroke that lands on or after it is not.
  it('counts a keystroke at deadline - 1ms, drops one at the deadline itself', () => {
    const started = typeChars(createSession('hello world'), 'h', 1000); // startedAt = 1000, deadline = 2000 (limitMs 1000)
    const justBefore = typeChars(started, 'e', 1999, 1000);
    expect(justBefore.typed).toBe('he');
    expect(justBefore.finishedAt).toBeNull();

    const atDeadline = typeChars(started, 'e', 2000, 1000);
    expect(atDeadline.typed).toBe('h');
    expect(atDeadline.finishedAt).toBe(2000);
  });

  it('an expired time-mode result has durationMs exactly equal to the limit, and wpm is computed over it', () => {
    const s = typeChars(createSession('hello world'), 'hello', 1000, 5000);
    const expired = expire(s, 9999, 5000); // startedAt 1000, limit 5000 -> deadline 6000
    const r = sessionResult(expired);
    expect(r.durationMs).toBe(5000);
    expect(r.wpm).toBeCloseTo(5 / 5 / (5000 / 60000), 10);
  });
});
