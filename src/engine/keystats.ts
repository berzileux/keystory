import {
  LATENCY_CAP_MS,
  MIN_CLASS_SAMPLES,
  MIN_SAMPLES_SHOWN,
  MIN_SAMPLES_SOLID,
  TESTS_FOR_FINGERS,
  TESTS_FOR_KEYS,
} from './constants';
import { fingerOf, handOf, keyOf, rowOf, transitionClass, type TransitionClass } from './layout';
import type { Session } from './session';

export interface KeyPress {
  key: string;
  correct: boolean;
  // Clean typing interval in ms, or null when it cannot be trusted.
  dt: number | null;
  cls: TransitionClass;
}

export interface KeyStat {
  key: string;
  n: number;
  errors: number;
  errRate: number;
  nLat: number;
  rawMs: number | null;
  // Latency after removing the cost of the finger movement that led into the key.
  adjMs: number | null;
  // 0 = no usable data, 1 = provisional, 2 = solid. Based on timed presses.
  tier: 0 | 1 | 2;
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function tierOf(n: number): 0 | 1 | 2 {
  return n < MIN_SAMPLES_SHOWN ? 0 : n < MIN_SAMPLES_SOLID ? 1 : 2;
}

export type Confidence = 'early' | 'fingers' | 'keys';

export function confidence(tests: number): Confidence {
  return tests < TESTS_FOR_FINGERS ? 'early' : tests < TESTS_FOR_KEYS ? 'fingers' : 'keys';
}

// Errors are attributed to the key that was expected, not the key that was hit.
export function extractPresses(sessions: Session[]): KeyPress[] {
  const out: KeyPress[] = [];
  for (const s of sessions) {
    for (const e of s.log) {
      if (e.kind !== 'char') continue;
      const key = keyOf(e.expected);
      const prev = e.prevTyped === null ? null : keyOf(e.prevTyped);
      const clean = e.dt !== null && !e.afterBackspace && e.dt > 0 && e.dt <= LATENCY_CAP_MS;
      out.push({
        key,
        correct: e.correct,
        dt: clean ? e.dt : null,
        cls: prev === null ? 'none' : transitionClass(prev, key),
      });
    }
  }
  return out;
}

// Raw per-key latency mostly measures which keys tend to follow awkward movements.
// Each timed press is therefore compared with the typist's own median for that kind of
// movement, then re-centred on their overall median. Only correct presses are timed.
export function keyStats(presses: KeyPress[]): Record<string, KeyStat> {
  const timed = presses.filter(
    (p): p is KeyPress & { dt: number } => p.dt !== null && p.correct && p.cls !== 'none',
  );
  const byClass: Record<string, number[]> = {};
  for (const p of timed) (byClass[p.cls] ??= []).push(p.dt);
  const overall = timed.length ? median(timed.map((p) => p.dt)) : 0;
  const classMedian = (cls: string): number => {
    const xs = byClass[cls];
    return xs && xs.length >= MIN_CLASS_SAMPLES ? median(xs) : overall;
  };

  const result: Record<string, KeyStat> = {};
  for (const key of new Set(presses.map((p) => p.key))) {
    const all = presses.filter((p) => p.key === key);
    const lat = timed.filter((p) => p.key === key);
    const errors = all.filter((p) => !p.correct).length;
    result[key] = {
      key,
      n: all.length,
      errors,
      errRate: (100 * errors) / all.length,
      nLat: lat.length,
      rawMs: lat.length ? median(lat.map((p) => p.dt)) : null,
      adjMs: lat.length ? median(lat.map((p) => p.dt - classMedian(p.cls) + overall)) : null,
      tier: tierOf(lat.length),
    };
  }
  return result;
}

export interface GroupStat {
  adjMs: number | null;
  errRate: number | null;
  nLat: number;
  n: number;
}

export function groupSummary(
  stats: Record<string, KeyStat>,
  groupOf: (key: string) => string | null,
): Record<string, GroupStat> {
  const acc: Record<string, { sumMs: number; wLat: number; errors: number; n: number }> = {};
  for (const s of Object.values(stats)) {
    const g = groupOf(s.key);
    if (g === null) continue;
    const a = (acc[g] ??= { sumMs: 0, wLat: 0, errors: 0, n: 0 });
    if (s.tier >= 1 && s.adjMs !== null) {
      a.sumMs += s.adjMs * s.nLat;
      a.wLat += s.nLat;
    }
    if (s.n >= MIN_SAMPLES_SHOWN) {
      a.errors += s.errors;
      a.n += s.n;
    }
  }
  const out: Record<string, GroupStat> = {};
  for (const [g, a] of Object.entries(acc)) {
    out[g] = {
      adjMs: a.wLat ? a.sumMs / a.wLat : null,
      errRate: a.n ? (100 * a.errors) / a.n : null,
      nLat: a.wLat,
      n: a.n,
    };
  }
  return out;
}

export const fingerSummary = (stats: Record<string, KeyStat>) => groupSummary(stats, (k) => fingerOf(k));
export const handSummary = (stats: Record<string, KeyStat>) => groupSummary(stats, (k) => handOf(fingerOf(k)));
export const rowSummary = (stats: Record<string, KeyStat>) =>
  groupSummary(stats, (k) => {
    const r = rowOf(k);
    return r === null ? null : (['top', 'home', 'bottom'][r] ?? null);
  });
