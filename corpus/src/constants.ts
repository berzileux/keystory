import type { Limits } from './types';

// Works first published before this year are US public domain as of 2026.
// This is an engineering guard, not legal advice: copyright is decided per work
// and per jurisdiction, so confirm each source before publishing.
export const PD_CUTOFF_YEAR = 1931;

export const DEFAULT_LIMITS: Limits = { min: 25, max: 60 };

// Words outside the most frequent N in the corpus count as rare for difficulty scoring.
export const COMMON_WORD_COUNT = 2000;

export function gutenbergUrl(id: number): string {
  return `https://www.gutenberg.org/cache/epub/${id}/pg${id}.txt`;
}
