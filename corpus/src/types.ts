export type SourceStatus = 'active' | 'archived' | 'retired';

export interface Source {
  id: string;
  title: string;
  // The exact title as it appears in the Gutenberg file's own header/banner
  // (what readTitle extracts) - compared for strict equality, not display text.
  gutenbergTitle: string;
  author: string;
  year: number;
  gutenbergId: number;
  // Text before the Nth occurrence of this marker is discarded before paragraph
  // splitting, to cut off front matter (dedications, prefaces, tables of contents).
  startMarker?: string;
  occurrence?: number;
  // Text from the Nth occurrence of this marker onward is discarded (the marker
  // itself excluded), to cut off a second work bundled after the one wanted.
  // Occurrences are counted in the already start-trimmed body.
  endMarker?: string;
  endOccurrence?: number;
  // Absent means 'active'. 'archived' is a reserve: excluded from the build, its raw
  // file kept and never touched, no network access. 'retired' is excluded from the
  // build and its raw file deleted; the entry itself always stays in sources.json.
  status?: SourceStatus;
  // Explains why a verified-but-unused candidate was retired instead of kept active
  // or archived (for example: reserve slots were already full).
  note?: string;
  // When true, a leading Roman-numeral prefix ("XVI. ") is stripped from each paragraph
  // before sentence splitting - opt-in per source, never a global rule.
  stripLeadingNumerals?: boolean;
}

export type Difficulty = 'easy' | 'medium' | 'hard';

export interface Passage {
  id: string;
  text: string;
  words: number;
  difficulty: Difficulty;
  score: number;
  sourceId: string;
  paragraph: number;
}

export interface Limits {
  min: number;
  max: number;
}
