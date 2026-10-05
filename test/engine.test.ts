import { describe, expect, it } from 'vitest';
import {
  backspace,
  confidence,
  consistency,
  createSession,
  extractPresses,
  fingerOf,
  fingerSummary,
  finish,
  handOf,
  handSummary,
  keyStats,
  rowSummary,
  sessionResult,
  tierOf,
  transitionClass,
  typeChar,
  typeChars,
  type KeyPress,
  type Session,
} from '../src/engine';

function typeAll(passage: string, stepMs: number, startAt = 1000): Session {
  let s = createSession(passage);
  let now = startAt;
  for (const ch of passage) {
    s = typeChar(s, ch, now);
    now += stepMs;
  }
  return s;
}

describe('layout', () => {
  it('maps keys to fingers and hands', () => {
    expect(fingerOf('q')).toBe('L-pinky');
    expect(fingerOf('P')).toBe('R-pinky');
    expect(fingerOf(' ')).toBe('thumb');
    expect(fingerOf('9')).toBeNull();
    expect(handOf(fingerOf('f'))).toBe('L');
    expect(handOf(fingerOf('j'))).toBe('R');
    expect(handOf('thumb')).toBeNull();
  });

  it('classifies finger movement', () => {
    expect(transitionClass('d', 'e')).toBe('same-finger');
    expect(transitionClass('k', 't')).toBe('alt-hand');
    expect(transitionClass('a', 's')).toBe('same-hand');
    expect(transitionClass('a', 'a')).toBe('repeat');
    expect(transitionClass('e', ' ')).toBe('space');
  });
});

describe('session', () => {
  it('records presses, starts the clock on the first key and finishes at the last', () => {
    const s = typeAll('hello world', 200);
    expect(s.startedAt).toBe(1000);
    expect(s.finishedAt).toBe(1000 + 10 * 200);
    expect(s.log).toHaveLength(11);
    expect(s.log[0]).toMatchObject({ t: 0, dt: null, prevTyped: null });
    expect(s.log[1]).toMatchObject({ t: 200, dt: 200, prevTyped: 'h' });
  });

  it('flags wrong keys and keeps going', () => {
    let s = createSession('cat');
    s = typeChar(s, 'c', 0);
    s = typeChar(s, 'x', 100);
    expect(s.log[1]).toMatchObject({ expected: 'a', typed: 'x', correct: false });
    s = typeChar(s, 't', 200);
    expect(s.typed).toBe('cxt');
    expect(s.finishedAt).toBe(200);
  });

  it('marks the press after a backspace so it is not timed', () => {
    let s = createSession('cat');
    s = typeChar(s, 'c', 0);
    s = typeChar(s, 'x', 100);
    s = backspace(s, 300);
    s = typeChar(s, 'a', 400);
    const last = s.log[s.log.length - 1];
    expect(last).toMatchObject({ kind: 'char', afterBackspace: true, correct: true });
    expect(s.typed).toBe('ca');
  });

  it('ignores input after finishing and non-single-character keys', () => {
    let s = typeAll('hi', 100);
    const before = s;
    s = typeChar(s, 'x', 5000);
    expect(s).toBe(before);
    expect(typeChar(createSession('hi'), 'Enter', 0).log).toHaveLength(0);
  });

  it('can end a timed test early', () => {
    let s = createSession('hello');
    s = typeChar(s, 'h', 0);
    s = finish(s, 5000);
    expect(s.finishedAt).toBe(5000);
  });
});

describe('result', () => {
  it('computes wpm, accuracy and character counts', () => {
    const s = typeAll('hello world', 200);
    const r = sessionResult(s);
    expect(r.durationMs).toBe(2000);
    expect(r.wpm).toBeCloseTo(66, 5);
    expect(r.rawWpm).toBeCloseTo(66, 5);
    expect(r.accuracy).toBe(100);
    expect(r.chars).toEqual({ correct: 11, incorrect: 0 });
  });

  it('counts a corrected mistake against accuracy but not against final characters', () => {
    let s = createSession('cat');
    s = typeChar(s, 'c', 0);
    s = typeChar(s, 'x', 100);
    s = backspace(s, 200);
    s = typeChar(s, 'a', 300);
    s = typeChar(s, 't', 400);
    const r = sessionResult(s);
    expect(r.chars).toEqual({ correct: 3, incorrect: 0 });
    expect(r.accuracy).toBeCloseTo(75, 5);
  });

  it('refuses an unfinished session', () => {
    expect(() => sessionResult(createSession('hi'))).toThrow(/not finished/);
  });

  it('scores perfectly steady typing as fully consistent and erratic typing lower', () => {
    expect(consistency([60, 60, 60, 60])).toBeCloseTo(100, 5);
    expect(consistency([20, 100, 20, 100])).toBeLessThan(60);
  });
});

function presses(key: string, cls: KeyPress['cls'], dt: number, n: number): KeyPress[] {
  return Array.from({ length: n }, () => ({ key, correct: true, dt, cls }));
}

describe('keystats', () => {
  it('removes the effect of awkward movement from per-key latency', () => {
    const data = [
      ...presses('e', 'same-finger', 300, 30),
      ...presses('t', 'alt-hand', 150, 30),
      ...presses('q', 'alt-hand', 250, 30),
    ];
    const stats = keyStats(data);
    expect(stats.e!.rawMs).toBe(300);
    expect(stats.t!.rawMs).toBe(150);
    expect(stats.t!.adjMs!).toBeLessThan(stats.e!.adjMs!);
    expect(stats.e!.adjMs!).toBeLessThan(stats.q!.adjMs!);
  });

  it('gives identical adjusted latency to keys that differ only in movement type', () => {
    const stats = keyStats([...presses('e', 'same-finger', 300, 30), ...presses('t', 'alt-hand', 150, 30)]);
    expect(stats.e!.adjMs).toBe(stats.t!.adjMs);
  });

  it('computes error rate against the expected key', () => {
    const data: KeyPress[] = [
      ...presses('z', 'alt-hand', 200, 8),
      { key: 'z', correct: false, dt: 200, cls: 'alt-hand' },
      { key: 'z', correct: false, dt: null, cls: 'none' },
    ];
    const z = keyStats(data).z!;
    expect(z.n).toBe(10);
    expect(z.errors).toBe(2);
    expect(z.errRate).toBe(20);
    expect(z.nLat).toBe(8);
  });

  it('marks thin keys as provisional or unusable', () => {
    expect(tierOf(2)).toBe(0);
    expect(tierOf(3)).toBe(1);
    expect(tierOf(9)).toBe(1);
    expect(tierOf(10)).toBe(2);
  });

  it('reports confidence from the number of tests', () => {
    expect(confidence(1)).toBe('early');
    expect(confidence(4)).toBe('early');
    expect(confidence(5)).toBe('fingers');
    expect(confidence(9)).toBe('fingers');
    expect(confidence(10)).toBe('keys');
  });

  it('extracts timed presses from sessions and drops untrustworthy gaps', () => {
    let s = createSession('cat');
    s = typeChar(s, 'c', 0);
    s = typeChar(s, 'x', 100);
    s = backspace(s, 200);
    s = typeChar(s, 'a', 300);
    s = typeChar(s, 't', 5000);
    const p = extractPresses([s]);
    expect(p).toHaveLength(4);
    expect(p[0]).toMatchObject({ key: 'c', dt: null, cls: 'none' });
    expect(p[1]).toMatchObject({ key: 'a', correct: false, dt: 100 });
    expect(p[2]).toMatchObject({ key: 'a', correct: true, dt: null });
    expect(p[3]).toMatchObject({ key: 't', dt: null });
  });

  it('summarises by finger, hand and row, weighting by samples', () => {
    const data = [
      ...presses('q', 'alt-hand', 250, 12),
      ...presses('a', 'alt-hand', 150, 12),
      ...presses('j', 'alt-hand', 150, 12),
      ...presses('k', 'alt-hand', 150, 12),
    ];
    const stats = keyStats(data);
    const fingers = fingerSummary(stats);
    expect(fingers['L-pinky']!.adjMs!).toBeGreaterThan(fingers['R-index']!.adjMs!);
    const hands = handSummary(stats);
    expect(hands.L!.adjMs!).toBeGreaterThan(hands.R!.adjMs!);
    const rows = rowSummary(stats);
    expect(rows.top!.n).toBeGreaterThan(0);
    expect(rows.home!.n).toBeGreaterThan(0);
    expect(rows.bottom).toBeUndefined();
  });
});

// Phase 7 wired a windowed passage renderer into TypingTest.tsx, touching nothing in
// src/engine/**. This pins the exact session/result/press values a scripted input
// sequence produced BEFORE that UI change, as the proof: the window is a rendering
// concern only, and this value must stay byte-identical regardless of how the UI renders.
describe('session/result equivalence across the phase 7 rendering change', () => {
  it('reproduces the recorded pre-phase-7 result for a scripted type/backspace/retype sequence', () => {
    const passage = 'the quick brown fox jumps over the lazy dog';
    let s = createSession(passage);
    let t = 1000;
    s = typeChars(s, 'the quick', t);
    t += 500;
    s = backspace(s, t);
    t += 120;
    s = typeChars(s, 'k brown fox jumps over the lazy dog', t);

    const result = sessionResult(s);
    const presses = extractPresses([s]);

    expect(result).toEqual({
      wpm: 832.258064516129,
      rawWpm: 832.258064516129,
      accuracy: 100,
      consistency: 100,
      durationMs: 620,
      chars: { correct: 43, incorrect: 0 },
    });
    expect(presses).toHaveLength(44);
    expect(presses[0]).toMatchObject({ key: 't', correct: true, dt: null, cls: 'none' });
    expect(presses[presses.length - 1]).toMatchObject({ key: 'g', correct: true, dt: null, cls: 'alt-hand' });
  });
});
