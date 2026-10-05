// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_PREFS, RECENT_LIMIT, emptySaved, loadSaved, persist, withTest } from '../src/ui/storage';

beforeEach(() => localStorage.clear());

describe('recent passage ids', () => {
  it('defaults to an empty list on a fresh save', () => {
    expect(emptySaved().recent).toEqual([]);
  });

  it('loads data saved before this field existed, defaulting recent to empty', () => {
    localStorage.setItem('keystory:v1', JSON.stringify({ v: 1, tests: 3, presses: [], prefs: DEFAULT_PREFS }));
    const saved = loadSaved();
    expect(saved.recent).toEqual([]);
    expect(saved.tests).toBe(3);
  });

  it('round-trips through persist/loadSaved once recent has entries', () => {
    persist(withTest(emptySaved(), [], ['x', 'y']));
    expect(loadSaved().recent).toEqual(['x', 'y']);
  });

  it('appends newly seen ids, capping at RECENT_LIMIT and dropping the oldest first', () => {
    const full = { ...emptySaved(), recent: Array.from({ length: RECENT_LIMIT }, (_, i) => `old-${i}`) };
    const next = withTest(full, [], ['new-1', 'new-2']);
    expect(next.recent).toHaveLength(RECENT_LIMIT);
    expect(next.recent[0]).toBe('old-2');
    expect(next.recent[next.recent.length - 1]).toBe('new-2');
  });

  it('withTest called with no seen ids leaves recent unchanged', () => {
    const saved = { ...emptySaved(), recent: ['a', 'b'] };
    expect(withTest(saved, []).recent).toEqual(['a', 'b']);
  });
});
