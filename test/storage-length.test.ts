// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_PREFS, loadSaved } from '../src/ui/storage';

beforeEach(() => localStorage.clear());

describe('time-60s default and the length preference (phase 12)', () => {
  it('a fresh profile loads mode: time, seconds: 60, length: short', () => {
    expect(DEFAULT_PREFS.mode).toBe('time');
    expect(DEFAULT_PREFS.seconds).toBe(60);
    expect(DEFAULT_PREFS.length).toBe('short');
    const saved = loadSaved();
    expect(saved.prefs.mode).toBe('time');
    expect(saved.prefs.seconds).toBe(60);
    expect(saved.prefs.length).toBe('short');
  });

  it('stored data from before this phase (no length field) loads and keeps its saved mode and seconds', () => {
    localStorage.setItem(
      'keystory:v1',
      JSON.stringify({ v: 1, tests: 5, presses: [], prefs: { mode: 'passage', seconds: 30, difficulty: 'easy', keyboard: false } }),
    );
    const saved = loadSaved();
    expect(saved.prefs.mode).toBe('passage');
    expect(saved.prefs.seconds).toBe(30);
    expect(saved.prefs.difficulty).toBe('easy');
    expect(saved.prefs.keyboard).toBe(false);
    expect(saved.prefs.length).toBe('short');
  });

  it('an invalid stored length falls back to the default instead of crashing', () => {
    for (const bad of ['abc', 7, null, '', 100.5]) {
      localStorage.setItem('keystory:v1', JSON.stringify({ v: 1, tests: 0, presses: [], prefs: { ...DEFAULT_PREFS, length: bad } }));
      expect(() => loadSaved()).not.toThrow();
      expect(loadSaved().prefs.length).toBe('short');
    }
  });

  it('a valid stored length (100, 250 or 500) is kept as saved', () => {
    for (const len of [100, 250, 500]) {
      localStorage.setItem('keystory:v1', JSON.stringify({ v: 1, tests: 0, presses: [], prefs: { ...DEFAULT_PREFS, length: len } }));
      expect(loadSaved().prefs.length).toBe(len);
    }
  });

  it('a stored mode of passage is kept as saved, not overridden by the new default', () => {
    localStorage.setItem('keystory:v1', JSON.stringify({ v: 1, tests: 0, presses: [], prefs: { ...DEFAULT_PREFS, mode: 'passage' } }));
    expect(loadSaved().prefs.mode).toBe('passage');
  });
});
