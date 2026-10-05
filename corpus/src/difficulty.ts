import { COMMON_WORD_COUNT } from './constants';
import type { Difficulty } from './types';

function wordsOf(text: string): string[] {
  return text.toLowerCase().match(/[a-z']+/g) ?? [];
}

export function commonWords(texts: string[]): Set<string> {
  const freq = new Map<string, number>();
  for (const t of texts) for (const w of wordsOf(t)) freq.set(w, (freq.get(w) ?? 0) + 1);
  return new Set(
    [...freq.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, COMMON_WORD_COUNT)
      .map(([w]) => w),
  );
}

// Longer words, denser punctuation and rarer vocabulary all slow a typist down.
export function score(text: string, common: ReadonlySet<string>): number {
  const words = wordsOf(text);
  if (words.length === 0) return 0;
  const avgWordLen = words.reduce((n, w) => n + w.length, 0) / words.length;
  const punctRate = (text.match(/[,.;:'"!?()-]/g) ?? []).length / text.length;
  const rareRate = words.filter((w) => !common.has(w)).length / words.length;
  return avgWordLen - 4.2 + punctRate * 10 + rareRate * 3;
}

// Buckets are terciles of this corpus, so they describe relative difficulty only.
export function assignDifficulty(scores: number[]): Difficulty[] {
  if (scores.length === 0) return [];
  const sorted = [...scores].sort((a, b) => a - b);
  const t1 = sorted[Math.floor(sorted.length / 3)]!;
  const t2 = sorted[Math.floor((sorted.length * 2) / 3)]!;
  return scores.map((s) => (s < t1 ? 'easy' : s < t2 ? 'medium' : 'hard'));
}
