import type { KeyPress } from '../engine';

export type Mode = 'passage' | 'time';
export type Difficulty = 'all' | 'easy' | 'medium' | 'hard';
export type Seconds = 15 | 30 | 60 | 120;
// 'short' is exactly one passage (today's only behaviour); the others join whole
// passages until the running word count is close to that many words.
export type Length = 'short' | 100 | 250 | 500;

export interface Prefs {
  mode: Mode;
  seconds: Seconds;
  difficulty: Difficulty;
  keyboard: boolean;
  length: Length;
}

export interface Saved {
  v: 1;
  tests: number;
  presses: KeyPress[];
  prefs: Prefs;
  // Most-recently-seen passage ids last, so a rebuilt corpus just means stale ids that
  // never match anything again - never a crash, since nothing else keys off this list.
  recent: string[];
}

export const DEFAULT_PREFS: Prefs = { mode: 'time', seconds: 60, difficulty: 'all', keyboard: true, length: 'short' };

const KEY = 'keystory:v1';
// Keeps the stored history comfortably inside the browser's storage quota.
export const MAX_PRESSES = 15000;
// How many recently-seen passage ids are remembered for the no-repeat rule.
export const RECENT_LIMIT = 200;
const VALID_LENGTHS: readonly Length[] = ['short', 100, 250, 500];

export function emptySaved(): Saved {
  return { v: 1, tests: 0, presses: [], prefs: DEFAULT_PREFS, recent: [] };
}

export function loadSaved(): Saved {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptySaved();
    const data = JSON.parse(raw) as Partial<Saved>;
    if (data.v !== 1 || typeof data.tests !== 'number' || !Array.isArray(data.presses)) return emptySaved();
    const prefs = { ...DEFAULT_PREFS, ...data.prefs };
    if (!VALID_LENGTHS.includes(prefs.length)) prefs.length = DEFAULT_PREFS.length;
    return {
      v: 1,
      tests: data.tests,
      presses: data.presses,
      prefs,
      recent: Array.isArray(data.recent) ? data.recent : [],
    };
  } catch {
    return emptySaved();
  }
}

export function persist(saved: Saved): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(saved));
  } catch {
    // Storage can be unavailable or full; the app keeps working for this visit.
  }
}

export function withTest(saved: Saved, presses: KeyPress[], seenIds: string[] = []): Saved {
  return {
    ...saved,
    tests: saved.tests + 1,
    presses: [...saved.presses, ...presses].slice(-MAX_PRESSES),
    recent: [...saved.recent, ...seenIds].slice(-RECENT_LIMIT),
  };
}
