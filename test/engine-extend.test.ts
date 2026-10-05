import { describe, expect, it } from 'vitest';
import { createSession, expire, extend, typeChar, typeChars } from '../src/engine';

describe('extend', () => {
  it('appends more text to the passage, leaving everything else identical', () => {
    const s = createSession('hi');
    const extended = extend(s, ' there');
    expect(extended.passage).toBe('hi there');
    expect(extended.typed).toBe(s.typed);
    expect(extended.log).toBe(s.log);
    expect(extended.startedAt).toBe(s.startedAt);
    expect(extended.finishedAt).toBe(s.finishedAt);
  });

  it('lets typing continue past the old passage end instead of finishing there', () => {
    let s = createSession('hi');
    s = typeChar(s, 'h', 0);
    s = extend(s, 'there');
    s = typeChar(s, 'i', 100);
    expect(s.finishedAt).toBeNull();
    expect(s.typed).toBe('hi');
    s = typeChar(s, 't', 200);
    expect(s.typed).toBe('hit');
    expect(s.finishedAt).toBeNull();
  });

  it('is a no-op on a finished session', () => {
    let s = createSession('hi');
    s = typeChar(s, 'h', 0);
    s = typeChar(s, 'i', 100);
    expect(s.finishedAt).not.toBeNull();
    expect(extend(s, 'more')).toBe(s);
  });

  it('is a no-op when there is nothing to add', () => {
    const s = createSession('hi');
    expect(extend(s, '')).toBe(s);
  });

  it('does not mutate the input session', () => {
    const s = createSession('hi');
    const before = JSON.stringify(s);
    extend(s, 'more');
    expect(JSON.stringify(s)).toBe(before);
  });

  it('still finishes exactly at the time limit after being extended past the original end', () => {
    let s = typeChars(createSession('hello world'), 'h', 1000);
    s = extend(s, ' and more text added well past where the original passage ended');
    const done = expire(s, 2500, 1000);
    expect(done.finishedAt).toBe(2000);
    expect(expire(done, 9999, 1000)).toBe(done);
  });
});
