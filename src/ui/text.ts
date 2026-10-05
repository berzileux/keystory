import type { Entry } from './corpus';
import type { Prefs } from './storage';

function wordCount(text: string): number {
  return text.split(' ').filter((w) => /[A-Za-z]/.test(w)).length;
}

export interface Segment {
  start: number;
  // Exclusive; the joining space between passages belongs to no segment.
  end: number;
  entry: Entry;
}

export interface Built {
  text: string;
  segments: Segment[];
}

type Rnd = () => number;

// Enough text that a fast typist (about 144 wpm) cannot finish a timed test early.
const CHARS_PER_SECOND = 12;

function shuffled<T>(xs: T[], rnd: Rnd): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export function poolFor(entries: Entry[], difficulty: Prefs['difficulty']): Entry[] {
  const pool = difficulty === 'all' ? entries : entries.filter((e) => e.difficulty === difficulty);
  return pool.length > 0 ? pool : entries;
}

function single(entry: Entry): Built {
  return { text: entry.text, segments: [{ start: 0, end: entry.text.length, entry }] };
}

// Excluding recently-seen entries never leaves an empty pool: if that would happen,
// the exclusion is dropped entirely for this build rather than returning less text
// than required or failing.
function avoidingRecent(pool: Entry[], recent: ReadonlySet<string>): Entry[] {
  if (recent.size === 0) return pool;
  const avoided = pool.filter((e) => !recent.has(e.id));
  return avoided.length > 0 ? avoided : pool;
}

export function buildText(entries: Entry[], prefs: Prefs, rnd: Rnd = Math.random, recent: ReadonlySet<string> = new Set()): Built {
  if (entries.length === 0) throw new Error('No passages to build from');
  const difficultyPool = poolFor(entries, prefs.difficulty);
  if (prefs.mode === 'passage') {
    if (prefs.length !== 'short') return buildToLength(difficultyPool, recent, rnd, prefs.length);
    const pool = avoidingRecent(difficultyPool, recent);
    return single(pool[Math.floor(rnd() * pool.length)]!);
  }

  const pool = avoidingRecent(difficultyPool, recent);
  const order = shuffled(pool, rnd);
  const target = prefs.seconds * CHARS_PER_SECOND;
  let text = '';
  const segments: Segment[] = [];
  for (let i = 0; text.length < target; i++) {
    const entry = order[i % order.length]!;
    if (text) text += ' ';
    const start = text.length;
    text += entry.text;
    segments.push({ start, end: text.length, entry });
  }
  return { text, segments };
}

export function segmentAt(built: Built, index: number): Segment {
  return built.segments.find((s) => index < s.end) ?? built.segments[built.segments.length - 1]!;
}

// Below this many characters remaining after the cursor, time mode should append more
// text so a fast typist never catches up to the end of the buffer.
export const EXTEND_THRESHOLD = 200;

export function needsMoreText(built: Built, typedLength: number): boolean {
  return built.text.length - typedLength < EXTEND_THRESHOLD;
}

// Adds one passage to a Built: one joining space, then the passage, then a new segment.
// Existing text and segments are left exactly as they were (a new array, not mutated).
export function appendEntry(built: Built, entry: Entry): Built {
  const text = `${built.text} ${entry.text}`;
  const start = built.text.length + 1;
  return { text, segments: [...built.segments, { start, end: text.length, entry }] };
}

// Avoids both recently-seen entries and ones already used in this Built. If that leaves
// nothing, first fall back to ignoring "recently seen" (but still avoiding in-Built
// repeats); if that also leaves nothing (a pool of one), recycle - never returns empty.
function eligibleCandidates(pool: Entry[], recent: ReadonlySet<string>, usedIds: ReadonlySet<string>): Entry[] {
  const fresh = pool.filter((e) => !recent.has(e.id) && !usedIds.has(e.id));
  const notUsed = pool.filter((e) => !usedIds.has(e.id));
  return fresh.length > 0 ? fresh : notUsed.length > 0 ? notUsed : pool;
}

// Chooses the next passage to append, using the same eligibility rules as buildToLength
// below (difficulty filter is the caller's `pool`, recent-avoidance and the three-tier
// fallback are eligibleCandidates).
export function pickNext(pool: Entry[], recent: ReadonlySet<string>, built: Built, rnd: Rnd = Math.random): Entry {
  const used = new Set(built.segments.map((s) => s.entry.id));
  const candidates = eligibleCandidates(pool, recent, used);
  return candidates[Math.floor(rnd() * candidates.length)]!;
}

// Fisher-Yates partial shuffle: the first `n` elements (or all of them, if fewer than n)
// are a random sample without replacement.
function sampleDistinct<T>(xs: T[], n: number, rnd: Rnd): T[] {
  const a = [...xs];
  const take = Math.min(n, a.length);
  for (let i = 0; i < take; i++) {
    const j = i + Math.floor(rnd() * (a.length - i));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a.slice(0, take);
}

const MAX_CANDIDATES_PER_STEP = 12;
// How far below the target the running word count may stay once building stops - the
// upper side is bounded for free by this same number, since the loop only ever adds one
// more passage while still more than this many words short, and no passage exceeds the
// corpus's own 60-word maximum: worst case the final addition overshoots by at most
// 60 - (TARGET_TOLERANCE_BELOW + 1), comfortably under any passage's maximum length.
const TARGET_TOLERANCE_BELOW = 12;

// Joins whole passages - reusing the exact same difficulty/recent/fallback rules pickNext
// uses for time mode's extension - until the running word count is close to `targetWords`.
// At each step, samples up to 12 eligible candidates and keeps the one whose word count
// brings the running total closest to the target; never cuts a passage.
function buildToLength(pool: Entry[], recent: ReadonlySet<string>, rnd: Rnd, targetWords: number): Built {
  let built: Built | null = null;
  let runningWords = 0;
  while (true) {
    const used: Set<string> = built ? new Set(built.segments.map((s) => s.entry.id)) : new Set<string>();
    const sample: Entry[] = sampleDistinct(eligibleCandidates(pool, recent, used), MAX_CANDIDATES_PER_STEP, rnd);
    let best: Entry = sample[0]!;
    let bestDiff = Math.abs(runningWords + wordCount(best.text) - targetWords);
    for (const candidate of sample.slice(1)) {
      const diff = Math.abs(runningWords + wordCount(candidate.text) - targetWords);
      if (diff < bestDiff) {
        best = candidate;
        bestDiff = diff;
      }
    }
    built = built ? appendEntry(built, best) : single(best);
    runningWords += wordCount(best.text);
    if (runningWords >= targetWords - TARGET_TOLERANCE_BELOW) return built;
  }
}

// What counts as "seen" for the no-repeat rule: in passage mode, the one passage built,
// whether or not any of it was typed; in time mode, only passages whose segment start
// the typist actually reached.
export function seenEntryIds(built: Built, mode: Prefs['mode'], typedLength: number): string[] {
  // The old passage-mode behaviour (count the one passage regardless of how much was
  // typed) only applies when there is genuinely just one passage to count - a 'short'
  // build. A multi-passage build (phase 12's length option) reuses the same reached rule
  // time mode already uses, rather than inventing a second mechanism (D4).
  if (mode === 'passage' && built.segments.length === 1) return [built.segments[0]!.entry.id];
  return built.segments.filter((s) => typedLength > s.start).map((s) => s.entry.id);
}

// Picks a passage dense in the given keys, choosing among the best few so drills vary.
export function buildDrill(entries: Entry[], keys: string[], rnd: Rnd = Math.random): Built {
  if (keys.length === 0) return single(entries[Math.floor(rnd() * entries.length)]!);
  const set = new Set(keys);
  const score = (e: Entry) => [...e.text.toLowerCase()].filter((c) => set.has(c)).length / e.text.length;
  const best = [...entries].sort((a, b) => score(b) - score(a)).slice(0, 5);
  return single(best[Math.floor(rnd() * best.length)]!);
}
