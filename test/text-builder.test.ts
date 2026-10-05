import { describe, expect, it } from 'vitest';
import type { Entry } from '../src/ui/corpus';
import { DEFAULT_PREFS } from '../src/ui/storage';
import { buildText } from '../src/ui/text';

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function wordCount(text: string): number {
  return text.split(' ').filter((w) => /[A-Za-z]/.test(w)).length;
}

// A synthetic pool whose passages span the real corpus's 25-60 word range, several per
// difficulty, so the difficulty filter and the recent/no-repeat rules have real variety
// to work with.
function mkEntry(id: string, words: number, difficulty: Entry['difficulty']): Entry {
  const text = Array.from({ length: words }, (_, i) => `w${id}${i}`).join(' ') + '.';
  return { id, text, difficulty, source: { title: id, author: 'A', year: 1900 } };
}

function makePool(): Entry[] {
  const pool: Entry[] = [];
  let n = 0;
  for (const difficulty of ['easy', 'medium', 'hard'] as const) {
    for (let w = 25; w <= 60; w += 5) {
      pool.push(mkEntry(`${difficulty}-${n++}`, w, difficulty));
    }
  }
  return pool;
}

const pool = makePool();

describe('buildText with a numeric length (phase 12, passage mode)', () => {
  it('"short" still returns exactly one passage, unchanged from before', () => {
    const b = buildText(pool, { ...DEFAULT_PREFS, mode: 'passage', length: 'short' }, mulberry32(1));
    expect(b.segments).toHaveLength(1);
    expect(b.text).toBe(b.segments[0]!.entry.text);
  });

  it.each([100, 250, 500] as const)('length %i: total word count lands within target-12 and target+60, over many seeds', (target) => {
    for (let seed = 0; seed < 60; seed++) {
      const b = buildText(pool, { ...DEFAULT_PREFS, mode: 'passage', length: target }, mulberry32(seed + 1000 * target));
      const total = wordCount(b.text);
      expect(total).toBeGreaterThanOrEqual(target - 12);
      expect(total).toBeLessThanOrEqual(target + 60);
    }
  });

  it('never repeats a passage within one build', () => {
    for (let seed = 0; seed < 30; seed++) {
      const b = buildText(pool, { ...DEFAULT_PREFS, mode: 'passage', length: 500 }, mulberry32(seed));
      const ids = b.segments.map((s) => s.entry.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('respects the difficulty filter', () => {
    const b = buildText(pool, { ...DEFAULT_PREFS, mode: 'passage', length: 250, difficulty: 'hard' }, mulberry32(7));
    for (const s of b.segments) expect(s.entry.difficulty).toBe('hard');
  });

  it('avoids recently-seen entries when enough others remain', () => {
    const recent = new Set(pool.slice(0, pool.length - 3).map((e) => e.id));
    const b = buildText(pool, { ...DEFAULT_PREFS, mode: 'passage', length: 100 }, mulberry32(3), recent);
    for (const s of b.segments) expect(recent.has(s.entry.id)).toBe(false);
  });

  it('segments are contiguous and accurate, same shape as the time-mode builder', () => {
    const b = buildText(pool, { ...DEFAULT_PREFS, mode: 'passage', length: 250 }, mulberry32(42));
    for (const s of b.segments) expect(b.text.slice(s.start, s.end)).toBe(s.entry.text);
    expect(b.segments.length).toBeGreaterThan(1);
  });
});
