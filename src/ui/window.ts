// Words before the cursor word that the rendered window always keeps.
export const WINDOW_BEHIND = 30;
// Words after the cursor word that the rendered window always keeps.
export const WINDOW_AHEAD = 80;
// The window start only moves in steps of this many words, so the rendered block
// changes roughly every WINDOW_STEP words instead of on every keystroke.
export const WINDOW_STEP = 10;

export interface WordRange {
  start: number;
  end: number;
}

// Pure function of the cursor's word position and the passage's total word count - it
// holds no state, so a backspace that moves the cursor back needs no special handling:
// calling this again with the earlier cursor position reproduces the earlier window.
export function windowRange(cursorWord: number, totalWords: number): WordRange {
  if (totalWords <= 0) return { start: 0, end: 0 };
  const cursor = Math.max(0, Math.min(cursorWord, totalWords));
  const start = Math.max(0, Math.floor((cursor - WINDOW_BEHIND) / WINDOW_STEP) * WINDOW_STEP);
  const end = Math.min(totalWords, cursor + WINDOW_AHEAD);
  return { start, end };
}

export interface WordBoundary {
  start: number;
  end: number;
}

// Words are the whitespace-separated tokens of the passage text.
export function wordBoundaries(text: string): WordBoundary[] {
  const words: WordBoundary[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) words.push({ start: m.index, end: m.index + m[0].length });
  return words;
}

// Maps a character index to the word it falls inside. An index sitting in whitespace
// (including a trailing space, or the text length itself) maps to the upcoming word's
// index, or to `words.length` if there is no word left ahead - i.e. "at or past the end".
export function wordIndexAt(words: readonly WordBoundary[], charIndex: number): number {
  for (let i = 0; i < words.length; i++) {
    if (charIndex < words[i]!.end) return i;
  }
  return words.length;
}

export interface CharRange {
  start: number;
  end: number;
}

// Converts a word-index window into the character range that covers it. The caller is
// responsible for clamping `start` down to the cursor's own character position if needed
// (never required with the default constants, since WINDOW_BEHIND keeps the window's
// first word well before the cursor, but cheap insurance if the constants are ever tuned).
export function charRangeForWordRange(words: readonly WordBoundary[], range: WordRange): CharRange {
  if (words.length === 0 || range.start >= range.end) return { start: 0, end: 0 };
  const start = words[range.start]!.start;
  const end = words[Math.min(range.end, words.length) - 1]!.end;
  return { start, end };
}
