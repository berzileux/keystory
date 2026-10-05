import { DEFAULT_LIMITS } from './constants';
import type { Limits } from './types';

const ALLOWED = /^[A-Za-z .,;:'"!?()-]+$/;
const ABBREVIATIONS = ['Mr', 'Mrs', 'Ms', 'Dr', 'St', 'Messrs', 'Col', 'Capt', 'Gen', 'Rev', 'Hon', 'Sr', 'Jr'];

export interface Candidate {
  text: string;
  paragraph: number;
}

export function wordCount(text: string): number {
  return text.split(' ').filter((w) => /[A-Za-z]/.test(w)).length;
}

export function splitSentences(paragraph: string): string[] {
  let t = paragraph;
  for (const a of ABBREVIATIONS) t = t.replace(new RegExp(`\\b${a}\\.`, 'g'), `${a}\u0000`);
  return t
    .split(/(?<=[.!?]["']?)\s+(?=["'(]?[A-Z])/)
    .map((s) => s.replace(/\u0000/g, '.').trim())
    .filter((s) => s.length > 0);
}

// Passages stay inside one paragraph so they read as a coherent excerpt.
// A passage is emitted as soon as it reaches the minimum word count.
export function candidatesFrom(paragraphs: string[], limits: Limits = DEFAULT_LIMITS): Candidate[] {
  const out: Candidate[] = [];
  paragraphs.forEach((par, paragraph) => {
    let cur: string[] = [];
    let curWords = 0;
    for (const sentence of splitSentences(par)) {
      const w = wordCount(sentence);
      if (w > limits.max) {
        cur = [];
        curWords = 0;
        continue;
      }
      if (curWords + w > limits.max) {
        cur = [];
        curWords = 0;
      }
      cur.push(sentence);
      curWords += w;
      if (curWords >= limits.min) {
        out.push({ text: cur.join(' '), paragraph });
        cur = [];
        curWords = 0;
      }
    }
  });
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// One pattern per entry, cached across calls since the same blocklist is reused for every
// candidate in a build (and every passage in a ban run).
const entryPatternCache = new Map<string, RegExp>();

function entryPattern(entry: string): RegExp {
  let pattern = entryPatternCache.get(entry);
  if (!pattern) {
    // A multi-word/hyphenated entry matches with hyphen, space or any run of whitespace
    // standing in for its own separators - "half-caste" also matches "half caste" and
    // "half-\ncaste". A plain \b boundary (not \w, so it excludes apostrophes) is what
    // makes a possessive match for free: "darkey's" boundary-splits right after "darkey",
    // while a plain plural like "darkeys" does not - so plurals still need their own entry.
    const body = entry
      .trim()
      .toLowerCase()
      .split(/[\s-]+/)
      .map(escapeRegExp)
      .join('[\\s-]+');
    pattern = new RegExp(`\\b${body}\\b`, 'i');
    entryPatternCache.set(entry, pattern);
  }
  return pattern;
}

// The one matcher shared by the builder (rejectReason) and `corpus:ban`, so the two can
// never disagree about what counts as blocked.
export function findBlocked(text: string, blocklist: ReadonlySet<string>): string[] {
  const hits: string[] = [];
  for (const entry of blocklist) {
    if (entryPattern(entry).test(text)) hits.push(entry);
  }
  return hits;
}

export function rejectReason(text: string, blocklist: ReadonlySet<string>): string | null {
  if (!ALLOWED.test(text)) return 'characters';
  if (!/^["A-Z]/.test(text)) return 'start';
  if (!/[.!?]["']?$/.test(text)) return 'ending';
  if ((text.match(/"/g) ?? []).length % 2 !== 0) return 'quotes';
  if ((text.match(/\(/g) ?? []).length !== (text.match(/\)/g) ?? []).length) return 'parens';
  if (findBlocked(text, blocklist).length > 0) return 'blocklist';
  return null;
}

export function parseBlocklist(file: string): Set<string> {
  return new Set(
    file
      .split('\n')
      .map((l) => l.trim().toLowerCase())
      .filter((l) => l.length > 0 && !l.startsWith('#')),
  );
}
