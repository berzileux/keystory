import { describe, expect, it } from 'vitest';
import {
  WINDOW_AHEAD,
  WINDOW_BEHIND,
  WINDOW_STEP,
  charRangeForWordRange,
  windowRange,
  wordBoundaries,
  wordIndexAt,
} from '../src/ui/window';

const SIZES = [1, 5, 80, 200, 3000];
const MAX_WINDOW = WINDOW_BEHIND + WINDOW_STEP + WINDOW_AHEAD;

describe('windowRange', () => {
  it('keeps a real cursor word (cursor < total) inside [start, end)', () => {
    for (const total of SIZES) {
      for (let cursor = 0; cursor < total; cursor++) {
        const { start, end } = windowRange(cursor, total);
        expect(cursor).toBeGreaterThanOrEqual(start);
        expect(cursor).toBeLessThan(end);
      }
    }
  });

  it('at cursor === total (passage finished), the window still ends exactly at total', () => {
    // There is no word AT index `total` (words are 0..total-1), so "inside [start, end)"
    // isn't meaningful there - the sensible property is that the window reaches the end.
    for (const total of SIZES) {
      const { start, end } = windowRange(total, total);
      expect(end).toBe(total);
      expect(start).toBeLessThanOrEqual(end);
    }
  });

  it('start is a non-negative multiple of WINDOW_STEP and never exceeds the cursor', () => {
    for (const total of SIZES) {
      for (let cursor = 0; cursor <= total; cursor++) {
        const { start } = windowRange(cursor, total);
        expect(start).toBeGreaterThanOrEqual(0);
        expect(start % WINDOW_STEP).toBe(0);
        expect(start).toBeLessThanOrEqual(cursor);
      }
    }
  });

  it('start is non-decreasing as the cursor advances, and purity means going back restores the earlier value', () => {
    for (const total of SIZES) {
      let prevStart = 0;
      const starts: number[] = [];
      for (let cursor = 0; cursor <= total; cursor++) {
        const { start } = windowRange(cursor, total);
        expect(start).toBeGreaterThanOrEqual(prevStart);
        prevStart = start;
        starts.push(start);
      }
      // "going back" is just calling the pure function again with an earlier cursor.
      for (let cursor = 0; cursor <= total; cursor++) {
        expect(windowRange(cursor, total).start).toBe(starts[cursor]);
      }
    }
  });

  it('includes at least WINDOW_BEHIND words before the cursor whenever that many exist', () => {
    for (const total of SIZES) {
      for (let cursor = 0; cursor <= total; cursor++) {
        const { start } = windowRange(cursor, total);
        if (cursor >= WINDOW_BEHIND) {
          expect(cursor - start).toBeGreaterThanOrEqual(WINDOW_BEHIND);
        } else {
          expect(start).toBe(0);
        }
      }
    }
  });

  it('end never exceeds total and the window never exceeds the maximum size', () => {
    for (const total of SIZES) {
      for (let cursor = 0; cursor <= total; cursor++) {
        const { start, end } = windowRange(cursor, total);
        expect(end).toBeLessThanOrEqual(total);
        expect(end - start).toBeLessThanOrEqual(MAX_WINDOW);
      }
    }
  });

  it('the first window of a fresh passage starts at 0', () => {
    for (const total of SIZES) {
      expect(windowRange(0, total).start).toBe(0);
    }
  });

  it('an empty passage returns { start: 0, end: 0 } without throwing', () => {
    expect(windowRange(0, 0)).toEqual({ start: 0, end: 0 });
  });
});

describe('wordBoundaries / wordIndexAt', () => {
  const text = 'hello world';
  const words = wordBoundaries(text);

  it('maps the first character to word 0', () => {
    expect(wordIndexAt(words, 0)).toBe(0);
  });

  it('maps the last character to the last word', () => {
    expect(wordIndexAt(words, text.length - 1)).toBe(1);
  });

  it('gives a defined result for an index sitting on a space (the upcoming word)', () => {
    expect(wordIndexAt(words, text.indexOf(' '))).toBe(1);
  });

  it('gives a defined result for an index in a double space', () => {
    const doubleSpaced = 'hello  world';
    const w = wordBoundaries(doubleSpaced);
    expect(wordIndexAt(w, 5)).toBe(1);
    expect(wordIndexAt(w, 6)).toBe(1);
  });

  it('gives a defined result for a trailing space', () => {
    const trailing = 'hello world ';
    const w = wordBoundaries(trailing);
    expect(wordIndexAt(w, trailing.length - 1)).toBe(w.length);
  });

  it('gives a defined result for an index equal to the text length', () => {
    expect(wordIndexAt(words, text.length)).toBe(words.length);
  });

  it('an empty passage maps any index to word 0', () => {
    expect(wordIndexAt(wordBoundaries(''), 0)).toBe(0);
  });
});

describe('charRangeForWordRange', () => {
  const text = 'one two three four five';
  const words = wordBoundaries(text);

  it('covers exactly the chosen words, start to end', () => {
    expect(charRangeForWordRange(words, { start: 1, end: 3 })).toEqual({ start: 4, end: 13 });
    expect(text.slice(4, 13)).toBe('two three');
  });

  it('covers the whole text when the range is the whole word list', () => {
    const r = charRangeForWordRange(words, { start: 0, end: words.length });
    expect(r).toEqual({ start: 0, end: text.length });
  });

  it('returns an empty range for an empty word range or no words', () => {
    expect(charRangeForWordRange(words, { start: 2, end: 2 })).toEqual({ start: 0, end: 0 });
    expect(charRangeForWordRange([], { start: 0, end: 0 })).toEqual({ start: 0, end: 0 });
  });
});
