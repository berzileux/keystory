import { describe, expect, it } from 'vitest';
import type { Entry } from '../src/ui/corpus';
import { EXTEND_THRESHOLD, appendEntry, buildDrill, buildText, needsMoreText, pickNext, seenEntryIds, segmentAt } from '../src/ui/text';
import { DEFAULT_PREFS } from '../src/ui/storage';

const mk = (id: string, text: string, difficulty: Entry['difficulty']): Entry => ({
  id,
  text,
  difficulty,
  source: { title: id, author: 'A', year: 1900 },
});
const entries = [mk('a', 'the quick brown fox jumps over the lazy dog again', 'easy'), mk('b', 'zebras quiz jazz and buzz with xylophones', 'hard')];
const seq = (...v: number[]) => { let i = 0; return () => v[i++ % v.length]!; };

describe('buildText', () => {
  // mode: 'passage' is now explicit in every test below, since phase 12 changed
  // DEFAULT_PREFS.mode to 'time' - these tests are about passage mode's own
  // behaviour specifically, which used to be implicit via the old default.
  it('passage mode picks one entry and respects difficulty', () => {
    const b = buildText(entries, { ...DEFAULT_PREFS, mode: 'passage', difficulty: 'hard' }, seq(0));
    expect(b.text).toBe(entries[1]!.text);
    expect(b.segments).toHaveLength(1);
  });

  it('falls back to all entries when a difficulty has none', () => {
    const b = buildText([entries[0]!], { ...DEFAULT_PREFS, mode: 'passage', difficulty: 'hard' }, seq(0));
    expect(b.text).toBe(entries[0]!.text);
  });

  it('time mode chains passages to enough length with contiguous segments', () => {
    const b = buildText(entries, { ...DEFAULT_PREFS, mode: 'time', seconds: 15 }, seq(0.3, 0.7));
    expect(b.text.length).toBeGreaterThanOrEqual(15 * 12);
    for (const s of b.segments) expect(b.text.slice(s.start, s.end)).toBe(s.entry.text);
    expect(segmentAt(b, 0)).toBe(b.segments[0]);
    expect(segmentAt(b, b.text.length + 50)).toBe(b.segments[b.segments.length - 1]);
  });

  it('throws on an empty corpus', () => {
    expect(() => buildText([], DEFAULT_PREFS)).toThrow();
  });
});

describe('buildDrill', () => {
  it('prefers passages dense in the requested keys', () => {
    expect(buildDrill(entries, ['z', 'x', 'q'], seq(0)).text).toBe(entries[1]!.text);
  });
});

describe('buildText recent-id exclusion', () => {
  it('avoids a recently seen entry when another is still available', () => {
    const b = buildText(entries, { ...DEFAULT_PREFS, mode: 'passage' }, seq(0), new Set(['a']));
    expect(b.text).toBe(entries[1]!.text);
  });

  it('falls back to the full pool when every entry has been recently seen', () => {
    const b = buildText(entries, { ...DEFAULT_PREFS, mode: 'passage' }, seq(0), new Set(['a', 'b']));
    expect(b.text).toBe(entries[0]!.text);
  });

  it('with no recent set at all, behaves exactly as before', () => {
    const b = buildText(entries, { ...DEFAULT_PREFS, mode: 'passage', difficulty: 'hard' }, seq(0));
    expect(b.text).toBe(entries[1]!.text);
  });
});

describe('seenEntryIds', () => {
  it('passage mode counts the built passage as seen even with zero typed characters', () => {
    const built = buildText(entries, { ...DEFAULT_PREFS, mode: 'passage', difficulty: 'hard' }, seq(0));
    expect(seenEntryIds(built, 'passage', 0)).toEqual(['b']);
  });

  it('time mode only counts passages whose segment start the typist actually reached', () => {
    const built = buildText(entries, { ...DEFAULT_PREFS, mode: 'time', seconds: 15 }, seq(0.3, 0.7));
    const secondStart = built.segments[1]!.start;
    expect(seenEntryIds(built, 'time', secondStart - 1)).toEqual([built.segments[0]!.entry.id]);
    expect(seenEntryIds(built, 'time', secondStart + 1)).toEqual([built.segments[0]!.entry.id, built.segments[1]!.entry.id]);
  });

  it('a multi-passage test (phase 12, passage mode with length) reuses the same reached rule as time mode', () => {
    const built = buildText(entries, { ...DEFAULT_PREFS, mode: 'time', seconds: 15 }, seq(0.3, 0.7));
    expect(built.segments.length).toBeGreaterThan(1);
    const secondStart = built.segments[1]!.start;
    // Passed mode: 'passage' deliberately, with a Built that happens to have several
    // segments (exactly the shape buildToLength produces) - proves the reached rule is
    // keyed off the Built's own shape, the same mechanism, not a second one for passage mode.
    expect(seenEntryIds(built, 'passage', secondStart - 1)).toEqual([built.segments[0]!.entry.id]);
    expect(seenEntryIds(built, 'passage', secondStart + 1)).toEqual([built.segments[0]!.entry.id, built.segments[1]!.entry.id]);
    expect(seenEntryIds(built, 'passage', built.text.length)).toEqual(built.segments.map((s) => s.entry.id));
  });
});

describe('needsMoreText', () => {
  it('is true once the remaining characters after the cursor drop below the threshold', () => {
    const built = { text: 'x'.repeat(300), segments: [] };
    expect(needsMoreText(built, 300 - EXTEND_THRESHOLD + 1)).toBe(true);
    expect(needsMoreText(built, 300 - EXTEND_THRESHOLD - 1)).toBe(false);
  });
});

describe('appendEntry', () => {
  it('appends one joining space plus the passage, with an accurate new segment and unchanged existing ones', () => {
    const base = buildText([entries[0]!], { ...DEFAULT_PREFS, mode: 'passage' }, seq(0));
    const appended = appendEntry(base, entries[1]!);
    expect(appended.text).toBe(`${base.text} ${entries[1]!.text}`);
    expect(appended.segments).toHaveLength(2);
    expect(appended.segments[0]).toEqual(base.segments[0]);
    const seg2 = appended.segments[1]!;
    expect(seg2.start).toBe(base.text.length + 1);
    expect(seg2.end).toBe(appended.text.length);
    expect(seg2.entry).toBe(entries[1]);
  });

  it('keeps segmentAt and seenEntryIds working across the appended segment', () => {
    const base = buildText([entries[0]!], { ...DEFAULT_PREFS, mode: 'passage' }, seq(0));
    const appended = appendEntry(base, entries[1]!);
    const seg2 = appended.segments[1]!;
    expect(segmentAt(appended, seg2.start)).toBe(seg2);
    expect(seenEntryIds(appended, 'time', seg2.start - 1)).toEqual([entries[0]!.id]);
    expect(seenEntryIds(appended, 'time', seg2.start + 1)).toEqual([entries[0]!.id, entries[1]!.id]);
  });
});

describe('pickNext', () => {
  const c = { id: 'c', text: 'more words to type here for the test', difficulty: 'easy' as const, source: { title: 'c', author: 'A', year: 1900 } };
  const three = [entries[0]!, entries[1]!, c];

  it('avoids recent and already-used-in-this-built entries when enough others remain', () => {
    const built = { text: entries[0]!.text, segments: [{ start: 0, end: entries[0]!.text.length, entry: entries[0]! }] };
    expect(pickNext(three, new Set(['b']), built, seq(0)).id).toBe('c');
  });

  it('falls back to ignoring recent but still avoiding in-built repeats when that leaves nothing', () => {
    const two = [entries[0]!, entries[1]!];
    const built = { text: entries[0]!.text, segments: [{ start: 0, end: entries[0]!.text.length, entry: entries[0]! }] };
    expect(pickNext(two, new Set(['b']), built, seq(0)).id).toBe('b');
  });

  it('recycles when every entry is already in this built (a pool of one never fails)', () => {
    const one = [entries[0]!];
    const built = { text: entries[0]!.text, segments: [{ start: 0, end: entries[0]!.text.length, entry: entries[0]! }] };
    expect(pickNext(one, new Set(), built, seq(0)).id).toBe('a');
  });
});
