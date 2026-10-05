const START = /\*\*\*\s*START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^\n]*/i;
const END = /\*\*\*\s*END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^\n]*/i;

function unifyNewlines(raw: string): string {
  return raw.replace(/\r\n?/g, '\n');
}

export function stripBoilerplate(raw: string): string {
  const text = unifyNewlines(raw);
  const start = START.exec(text);
  if (!start) throw new Error('Gutenberg START marker not found');
  const afterStart = text.slice(start.index + start[0].length);
  const end = END.exec(afterStart);
  if (!end) throw new Error('Gutenberg END marker not found');
  return afterStart.slice(0, end.index);
}

export function readTitle(raw: string): string | null {
  const text = unifyNewlines(raw);
  const start = START.exec(text);
  const header = start ? text.slice(0, start.index) : text.slice(0, 3000);
  const titleLine = /^Title:\s*(.+)$/im.exec(header);
  if (titleLine) return titleLine[1]!.trim();
  const banner = /Project Gutenberg eBook of (.+?)(?:,? by |\n|$)/i.exec(header);
  return banner ? banner[1]!.trim() : null;
}

function titleKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Guards against a wrong Gutenberg id silently feeding the wrong book into the corpus.
// Strict normalised equality: a bundled edition such as "Walden, and On The Duty Of
// Civil Disobedience" must NOT pass just because "Walden" is a substring of it.
export function assertTitle(raw: string, expected: string): void {
  const found = readTitle(raw);
  if (!found) throw new Error(`Could not read a title from the file (expected "${expected}")`);
  if (titleKey(found) !== titleKey(expected)) {
    throw new Error(`Title mismatch: expected "${expected}", file says "${found}"`);
  }
}

// Discards everything before the Nth occurrence of `marker` (keeping the marker
// itself), so declared front matter (dedications, prefaces, tables of contents)
// never reaches paragraph splitting. Throws if the Nth occurrence isn't found,
// rather than silently keeping the front matter.
export function applyStartMarker(body: string, marker: string, occurrence = 1): string {
  let idx = -1;
  let from = 0;
  for (let i = 0; i < occurrence; i++) {
    idx = body.indexOf(marker, from);
    if (idx === -1) {
      throw new Error(`Start marker "${marker}" (occurrence ${occurrence}) not found`);
    }
    from = idx + marker.length;
  }
  return body.slice(idx);
}

// Discards everything from the Nth occurrence of `marker` onward (the marker
// itself excluded, unlike applyStartMarker which keeps it), so a second work
// bundled after the one wanted never reaches paragraph splitting. Throws if
// the Nth occurrence isn't found, rather than silently keeping everything.
export function applyEndMarker(body: string, marker: string, occurrence = 1): string {
  let idx = -1;
  let from = 0;
  for (let i = 0; i < occurrence; i++) {
    idx = body.indexOf(marker, from);
    if (idx === -1) {
      throw new Error(`End marker "${marker}" (occurrence ${occurrence}) not found`);
    }
    from = idx + marker.length;
  }
  return body.slice(0, idx);
}

// Output is limited to what a person can type on a standard keyboard.
export function normalizeText(input: string): string {
  let s = input
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/\s*(?:—|―|–|--+)\s*/g, ' - ')
    .replace(/…/g, '...')
    .replace(/[   ]/g, ' ')
    .replace(/æ/g, 'ae')
    .replace(/Æ/g, 'Ae')
    .replace(/œ/g, 'oe')
    .replace(/Œ/g, 'Oe')
    .replace(/ß/g, 'ss')
    .replace(/_/g, '');
  s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
  return s.replace(/\s+/g, ' ').trim();
}

// A table of contents reads as a run of repeated "Chapter <numeral>." markers, unlike
// ordinary prose that merely mentions the word once or twice in passing.
const CHAPTER_MARKER = /\b(?:chapter|book|part|volume|letter)\s+[IVXLCDM0-9]+\.?/gi;

export function isHeading(p: string): boolean {
  const words = p.split(' ').length;
  if (/^(chapter|book|part|volume|letter|contents|illustration|preface|appendix)\b/i.test(p) && words <= 12) return true;
  if (/^[IVXLCDM]+\.?$/.test(p)) return true;
  if (/[[\]*]/.test(p)) return true;
  if ((p.match(CHAPTER_MARKER) ?? []).length >= 2) return true;
  const letters = p.replace(/[^A-Za-z]/g, '');
  return letters.length > 0 && words <= 12 && letters === letters.toUpperCase();
}

// A Roman-numeral section prefix (for example "XVI. "), as some translations use to number
// each entry - requires the full stop and following whitespace, uppercase only, so an
// ordinary word like "I" or "Mix" at the start of a sentence is never touched. Matched at
// the very start of the paragraph OR right after a sentence boundary (the same boundary
// splitSentences itself uses: terminal punctuation, an optional closing quote, whitespace),
// since consecutive numbered entries are not reliably split into their own paragraphs in
// the source text - one can start mid-paragraph, immediately after the previous one's
// closing sentence, with no blank line between them.
const LEADING_NUMERAL = /(?:^|(?<=[.!?]['"]?\s))[IVXLCDM]{1,8}\.\s+/g;

export function stripLeadingNumeral(p: string): string {
  return p.replace(LEADING_NUMERAL, '');
}

export function toParagraphs(body: string): string[] {
  return unifyNewlines(body)
    .split(/\n\s*\n/)
    .map((p) => normalizeText(p.replace(/\n/g, ' ')))
    .filter((p) => p.length > 0 && !isHeading(p));
}
