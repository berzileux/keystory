import { describe, expect, it } from 'vitest';
import type { KeyPress } from '../src/engine';
import { analyse, heat } from '../src/ui/analysis';

const press = (key: string, dt: number, correct = true): KeyPress => ({ key, correct, dt, cls: 'alt-hand' });
function many(key: string, n: number, dt: number, errors = 0): KeyPress[] {
  return Array.from({ length: n }, (_, i) => press(key, dt, i >= errors));
}

describe('analyse', () => {
  it('handles empty history', () => {
    const a = analyse([], 0, 'speed', null);
    expect(a.banner.level).toBe('early');
    expect(a.missing).toHaveLength(30);
    expect(a.insight1).toBe('');
    expect(a.slowKeys).toEqual([]);
    expect(a.rows).toHaveLength(3);
  });

  it('reports the slowest finger and hand', () => {
    const presses = [...many('a', 30, 300), ...many('f', 30, 150), ...many('j', 30, 150), ...many('k', 30, 160)];
    const a = analyse(presses, 6, 'speed', null);
    expect(a.banner.level).toBe('fingers');
    expect(a.insight1).toContain('L pinky');
    expect(a.slowKeys[0]).toBe('a');
    expect(a.detail.key).toBe('a');
  });

  it('shows error rates in errors mode', () => {
    const presses = [...many('a', 20, 200, 4), ...many('s', 20, 200)];
    const a = analyse(presses, 3, 'errors', 'a');
    expect(a.legend.hi).toBe('more errors');
    expect(a.detail.errors).toBe('20.0%');
  });

  it('keeps colour out of keys below the sample threshold', () => {
    const a = analyse(many('q', 1, 200), 1, 'speed', 'q');
    expect(a.detail.note).toMatch(/Not enough/);
  });

  it('heat clamps out of range input', () => {
    expect(heat(-5)).toBe(heat(0));
    expect(heat(9)).toBe(heat(1));
  });
});
