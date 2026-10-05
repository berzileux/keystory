import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCorpus } from '../corpus/src/build';
import { applyEndMarker, applyStartMarker, assertTitle, isHeading, normalizeText, stripBoilerplate, toParagraphs } from '../corpus/src/clean';
import { assignDifficulty } from '../corpus/src/difficulty';
import { candidatesFrom, findBlocked, parseBlocklist, rejectReason, splitSentences } from '../corpus/src/passages';
import type { Source } from '../corpus/src/types';

const fixtureRaw = await readFile('corpus/fixtures/raw/test-book.txt', 'utf8');

describe('clean', () => {
  it('strips the Gutenberg header and footer', () => {
    const body = stripBoilerplate(fixtureRaw);
    expect(body).toContain('CHAPTER I');
    expect(body).not.toContain('Project Gutenberg');
    expect(body).not.toContain('Licence text');
  });

  it('throws when markers are missing', () => {
    expect(() => stripBoilerplate('no markers here')).toThrow(/START marker/);
  });

  it('rejects a title mismatch and accepts a match', () => {
    expect(() => assertTitle(fixtureRaw, 'Test Book')).not.toThrow();
    expect(() => assertTitle(fixtureRaw, 'Some Other Book')).toThrow(/Title mismatch/);
  });

  const rawWithTitle = (title: string) =>
    `The Project Gutenberg eBook of ${title}\n\nTitle: ${title}\n\n` +
    '*** START OF THE PROJECT GUTENBERG EBOOK TEST ***\nbody\n*** END OF THE PROJECT GUTENBERG EBOOK TEST ***';

  it('rejects a bundled edition even though the expected title is a substring of it', () => {
    // The real defect this guards: Gutenberg id 205's title is "Walden, and On The Duty Of
    // Civil Disobedience" - a bundle of two different works, not "Walden" alone. The old
    // substring-containment check let this kind of mismatch through silently.
    const bundled = rawWithTitle('Walden, and On The Duty Of Civil Disobedience');
    expect(() => assertTitle(bundled, 'Walden')).toThrow(/Title mismatch/);
  });

  it('accepts an exact title match', () => {
    expect(() => assertTitle(rawWithTitle('Walden'), 'Walden')).not.toThrow();
  });

  it('accepts a title differing only by case, punctuation or whitespace', () => {
    expect(() => assertTitle(rawWithTitle('WALDEN,'), ' walden ')).not.toThrow();
  });

  it('normalises typography to typeable ASCII', () => {
    const out = normalizeText('“Café” — it’s _very_ good… æther');
    expect(out).toBe('"Cafe" - it\'s very good... aether');
    expect(/^[\x20-\x7E]+$/.test(out)).toBe(true);
  });

  it('drops headings and joins hard-wrapped lines', () => {
    const paragraphs = toParagraphs(stripBoilerplate(fixtureRaw));
    expect(paragraphs.some((p) => /^CHAPTER/.test(p))).toBe(false);
    expect(paragraphs.some((p) => p === 'THE END')).toBe(false);
    expect(paragraphs.every((p) => !p.includes('\n'))).toBe(true);
    expect(paragraphs[0]).toMatch(/^The morning came in grey and slow, and the old harbour master/);
  });

  it('recognises a table-of-contents paragraph as a heading even past 12 words', () => {
    // Reproduces public/corpus/passages-alices-adventures.json's real "alices-adventures-0000"
    // and "-0001" leak: a single paragraph listing every chapter title, which is far longer
    // than 12 words and mixed case, so neither existing isHeading rule caught it.
    const toc =
      'CHAPTER I. Down the Rabbit-Hole CHAPTER II. The Pool of Tears CHAPTER III. A Caucus-Race ' +
      'and a Long Tale CHAPTER IV. The Rabbit Sends in a Little Bill CHAPTER V. Advice from a ' +
      'Caterpillar CHAPTER VI. Pig and Pepper CHAPTER VII. A Mad Tea-Party CHAPTER VIII. The ' +
      "Queen's Croquet-Ground CHAPTER IX. The Mock Turtle's Story CHAPTER X. The Lobster Quadrille";
    expect(isHeading(toc)).toBe(true);
  });

  it('does not treat ordinary prose that mentions "chapter" as a heading', () => {
    const prose =
      'This chapter of her life felt impossibly long, and the next chapter would be longer ' +
      'still, she thought, chapter after chapter stretching ahead of her like a corridor with ' +
      'no end in sight, each door leading only to another identical hallway of quiet years.';
    expect(isHeading(prose)).toBe(false);
  });
});

describe('applyStartMarker', () => {
  it('cuts everything before the first occurrence, keeping the marker itself', () => {
    expect(applyStartMarker('junk before MARK keep after', 'MARK')).toBe('MARK keep after');
  });

  it('selects the Nth occurrence, so a table of contents mentioning the marker is skipped', () => {
    const body = 'TOC: CHAPTER I. preview text CHAPTER I.\nDown the Rabbit-Hole, real story';
    expect(applyStartMarker(body, 'CHAPTER I.', 2)).toBe('CHAPTER I.\nDown the Rabbit-Hole, real story');
  });

  it('throws when the marker is not found at all', () => {
    expect(() => applyStartMarker('no marker in here', 'MARK')).toThrow(/not found/);
  });

  it('throws when fewer occurrences exist than the requested one', () => {
    expect(() => applyStartMarker('only one MARK here', 'MARK', 2)).toThrow(/not found/);
  });
});

describe('applyEndMarker', () => {
  it('cuts everything from the first occurrence onward, excluding the marker itself', () => {
    expect(applyEndMarker('keep this END discard that', 'END')).toBe('keep this ');
  });

  it('selects the Nth occurrence, so an earlier mention of the marker is skipped', () => {
    const body = 'keep this END keep this too END discard that';
    expect(applyEndMarker(body, 'END', 2)).toBe('keep this END keep this too ');
  });

  it('throws when the marker is not found at all', () => {
    expect(() => applyEndMarker('no marker in here', 'END')).toThrow(/not found/);
  });

  it('throws when fewer occurrences exist than the requested one', () => {
    expect(() => applyEndMarker('only one END here', 'END', 2)).toThrow(/not found/);
  });
});

describe('passages', () => {
  it('does not split sentences after titles such as Mr.', () => {
    const s = splitSentences('Mr. Hale left early. He was tired.');
    expect(s).toEqual(['Mr. Hale left early.', 'He was tired.']);
  });

  it('combines sentences up to the minimum and never crosses paragraphs', () => {
    const a = 'One two three four five six seven eight nine ten. Eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty.';
    const b = 'Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega again.';
    const c = candidatesFrom([a, b], { min: 15, max: 40 });
    expect(c).toHaveLength(2);
    expect(c[0]!.paragraph).toBe(0);
    expect(c[1]!.paragraph).toBe(1);
  });

  it('applies rejection rules', () => {
    const none = new Set<string>();
    expect(rejectReason('It had 3 parts.', none)).toBe('characters');
    expect(rejectReason('it started lowercase.', none)).toBe('start');
    expect(rejectReason('It never ends', none)).toBe('ending');
    expect(rejectReason('He said "stop.', none)).toBe('quotes');
    expect(rejectReason('A word (open.', none)).toBe('parens');
    expect(rejectReason('A zzbadword here.', new Set(['zzbadword']))).toBe('blocklist');
    expect(rejectReason('A clean sentence, with a comma.', none)).toBeNull();
  });

  it('parses a blocklist file, ignoring comments', () => {
    expect([...parseBlocklist('# note\n\nFoo\nbar \n')]).toEqual(['foo', 'bar']);
  });

  it('blocklist match is whole-word, not substring', () => {
    const list = new Set(['savage']);
    expect(rejectReason('He fought with savage fury today.', list)).toBe('blocklist');
    expect(rejectReason('He fought with savagery and great fury today.', list)).toBeNull();
  });
});

describe('findBlocked', () => {
  it('matches a whole word, case-insensitively, and returns the matched entry', () => {
    expect(findBlocked('A Savage fight broke out.', new Set(['savage']))).toEqual(['savage']);
  });

  it('does not match a longer word that merely contains the entry', () => {
    expect(findBlocked('His savagery was well known.', new Set(['savage']))).toEqual([]);
  });

  it('matches the possessive form of an entry', () => {
    expect(findBlocked("It was the darkey's boat.", new Set(['darkey']))).toEqual(['darkey']);
  });

  it('matches the trailing-apostrophe plural-possessive form of an entry', () => {
    expect(findBlocked("It was the darkeys' boat.", new Set(['darkeys']))).toEqual(['darkeys']);
  });

  it('does not infer a plain plural that is not separately listed', () => {
    expect(findBlocked('Several darkeys walked by.', new Set(['darkey']))).toEqual([]);
  });

  it('matches a hyphenated phrase entry written with a hyphen, a space, or whitespace', () => {
    const list = new Set(['half-caste']);
    expect(findBlocked('He called him a half-caste.', list)).toEqual(['half-caste']);
    expect(findBlocked('He called him a half caste.', list)).toEqual(['half-caste']);
    expect(findBlocked('He called him a half-\ncaste.', list)).toEqual(['half-caste']);
  });

  it('returns every matched entry, empty when clean', () => {
    const list = new Set(['savage', 'heathen']);
    expect(findBlocked('A savage, heathen crowd.', list).sort()).toEqual(['heathen', 'savage']);
    expect(findBlocked('A perfectly ordinary sentence.', list)).toEqual([]);
  });
});

describe('difficulty', () => {
  it('buckets into terciles', () => {
    expect(assignDifficulty([1, 2, 3, 4, 5, 6])).toEqual(['easy', 'easy', 'medium', 'medium', 'hard', 'hard']);
    expect(assignDifficulty([])).toEqual([]);
  });
});

describe('buildCorpus on the fixture', () => {
  const sources: Source[] = [
    { id: 'test-book', title: 'Test Book', gutenbergTitle: 'Test Book', author: 'Test Author', year: 1900, gutenbergId: 0 },
  ];

  it('accepts, rejects and de-duplicates as expected', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'keystory-'));
    const report = await buildCorpus({
      sources,
      rawDir: 'corpus/fixtures/raw',
      outDir,
      blocklist: new Set(['zzbadword']),
    });
    const r = report.sources[0]!;
    expect(r.accepted).toBe(3);
    expect(r.duplicates).toBe(1);
    expect(r.rejected).toEqual({ characters: 1, blocklist: 1 });

    const file = JSON.parse(await readFile(join(outDir, 'passages-test-book.json'), 'utf8'));
    expect(file.passages).toHaveLength(3);
    for (const p of file.passages) {
      expect(/^[\x20-\x7E]+$/.test(p.text)).toBe(true);
      expect(p.words).toBeGreaterThanOrEqual(25);
      expect(['easy', 'medium', 'hard']).toContain(p.difficulty);
    }
    const second = file.passages.find((p: { text: string }) => p.text.startsWith('"Is it true, Mr. Hale'));
    expect(second.text).toContain('cafe');
    expect(second.text).toContain('girl - and then');

    const index = JSON.parse(await readFile(join(outDir, 'index.json'), 'utf8'));
    expect(index.sources[0].passages).toBe(3);
  });

  it('refuses sources published after the public-domain cutoff', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'keystory-'));
    await expect(
      buildCorpus({
        sources: [{ ...sources[0]!, year: 1950 }],
        rawDir: 'corpus/fixtures/raw',
        outDir,
        blocklist: new Set(),
      }),
    ).rejects.toThrow(/not before/);
  });

  it('fetches a missing raw file through the injected fetcher', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'keystory-'));
    const urls: string[] = [];
    await buildCorpus({
      sources: [{ ...sources[0]!, id: 'fetched-book', gutenbergId: 4242 }],
      rawDir: join(dir, 'raw'),
      outDir: join(dir, 'out'),
      blocklist: new Set(),
      fetchText: async (url) => {
        urls.push(url);
        return fixtureRaw;
      },
    });
    expect(urls).toEqual(['https://www.gutenberg.org/cache/epub/4242/pg4242.txt']);
    expect((await readFile(join(dir, 'raw', 'fetched-book.txt'), 'utf8')).length).toBeGreaterThan(0);
  });
});
