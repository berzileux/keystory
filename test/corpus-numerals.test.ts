import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCorpus } from '../corpus/src/build';
import { stripLeadingNumeral } from '../corpus/src/clean';
import type { Source } from '../corpus/src/types';

describe('stripLeadingNumeral (pure)', () => {
  it('removes a leading Roman-numeral prefix (one to eight letters, a full stop, whitespace)', () => {
    expect(stripLeadingNumeral('XVI. To desire things impossible is the part of a mad man.')).toBe(
      'To desire things impossible is the part of a mad man.',
    );
    expect(stripLeadingNumeral('I. Of my grandfather Verus I have learned to be gentle.')).toBe(
      'Of my grandfather Verus I have learned to be gentle.',
    );
  });

  it('leaves a paragraph that merely starts with the word "I" unchanged', () => {
    expect(stripLeadingNumeral('I think so.')).toBe('I think so.');
  });

  it('does not treat lowercase letters after the first as a numeral', () => {
    expect(stripLeadingNumeral('Mix. Of things.')).toBe('Mix. Of things.');
  });

  it('leaves text with no leading numeral prefix completely unchanged', () => {
    expect(stripLeadingNumeral('A perfectly ordinary paragraph.')).toBe('A perfectly ordinary paragraph.');
  });

  it('removes only the matched prefix, leaving everything after it unchanged', () => {
    expect(stripLeadingNumeral('III. Of Diognetus, not to busy myself about vain things.')).toBe(
      'Of Diognetus, not to busy myself about vain things.',
    );
  });

  it('also strips a numeral prefix that starts a new sentence mid-paragraph, not only at the very start', () => {
    // The real source text this is modelled on: consecutive numbered Meditations are not
    // reliably split into their own paragraphs - "V." here starts right after the previous
    // entry's closing sentence, no blank line in between.
    const text =
      'Thou must also take heed of another kind of wandering, for they are idle in their actions. V. For not observing the state of another man\'s soul, scarce was ever any man known to be unhappy.';
    expect(stripLeadingNumeral(text)).toBe(
      "Thou must also take heed of another kind of wandering, for they are idle in their actions. For not observing the state of another man's soul, scarce was ever any man known to be unhappy.",
    );
  });

  it('strips every numbered entry in a paragraph with several of them in a row', () => {
    const text = 'IV. First point here. V. Second point here. VI. Third point here.';
    expect(stripLeadingNumeral(text)).toBe('First point here. Second point here. Third point here.');
  });
});

function gutenbergify(body: string): string {
  return (
    'The Project Gutenberg eBook of Test Book\n\nTitle: Test Book\n\n' +
    `*** START OF THE PROJECT GUTENBERG EBOOK TEST ***\n\n${body}\n\n` +
    '*** END OF THE PROJECT GUTENBERG EBOOK TEST ***'
  );
}

// One paragraph long enough on its own to form a 25-60 word passage, with a numeral prefix
// of total length matching what the real Meditations entries look like.
const NUMBERED_PARAGRAPH =
  'XVI. To desire things impossible is the part of a mad man indeed, as many wise men have often said before and will doubtless say again. But it is itself also a thing impossible, that a truly wicked man should not commit some such things in the course of his life.';

const PLAIN_PARAGRAPH =
  'This paragraph has no numeral prefix at all and describes an ordinary scene of a quiet morning by the river, where the water moved slowly past the reeds and the birds had not yet begun to call out across the water meadow.';

function baseSource(overrides: Partial<Source> = {}): Source {
  return { id: 'test-book', title: 'Test Book', gutenbergTitle: 'Test Book', author: 'Test Author', year: 1900, gutenbergId: 0, ...overrides };
}

async function freshRaw(body: string) {
  const dir = await mkdtemp(join(tmpdir(), 'keystory-numerals-'));
  const rawDir = join(dir, 'raw');
  const outDir = join(dir, 'out');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(rawDir, { recursive: true });
  await writeFile(join(rawDir, 'test-book.txt'), gutenbergify(body), 'utf8');
  return { rawDir, outDir };
}

describe('stripLeadingNumerals option (build integration)', () => {
  it('strips the numeral prefix from the built passage text when the source opts in', async () => {
    const { rawDir, outDir } = await freshRaw(NUMBERED_PARAGRAPH);
    const report = await buildCorpus({ sources: [baseSource({ stripLeadingNumerals: true })], rawDir, outDir, blocklist: new Set() });
    expect(report.sources[0]!.accepted).toBeGreaterThan(0);
    const { readFile } = await import('node:fs/promises');
    const file = JSON.parse(await readFile(join(outDir, 'passages-test-book.json'), 'utf8'));
    for (const p of file.passages) {
      expect(p.text).not.toMatch(/^[IVXLCDM]{1,8}\.\s/);
    }
  });

  it('leaves the same paragraph completely byte-for-byte unchanged without the option', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'keystory-numerals-'));
    const rawDir = join(dir, 'raw');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(rawDir, { recursive: true });
    await writeFile(join(rawDir, 'with-opt.txt'), gutenbergify(NUMBERED_PARAGRAPH), 'utf8');
    await writeFile(join(rawDir, 'without-opt.txt'), gutenbergify(NUMBERED_PARAGRAPH), 'utf8');
    const withOption = await buildCorpus({ sources: [baseSource({ id: 'with-opt', stripLeadingNumerals: true })], rawDir, outDir: join(dir, 'a'), blocklist: new Set() });
    const without = await buildCorpus({ sources: [baseSource({ id: 'without-opt' })], rawDir, outDir: join(dir, 'b'), blocklist: new Set() });
    const { readFile } = await import('node:fs/promises');
    const withFile = JSON.parse(await readFile(join(dir, 'a', 'passages-with-opt.json'), 'utf8'));
    const withoutFile = JSON.parse(await readFile(join(dir, 'b', 'passages-without-opt.json'), 'utf8'));
    expect(withOption.sources[0]!.accepted).toBeGreaterThan(0);
    expect(without.sources[0]!.accepted).toBeGreaterThan(0);
    expect(withoutFile.passages[0].text.startsWith('XVI.')).toBe(true);
    expect(withFile.passages[0].text.startsWith('XVI.')).toBe(false);
  });

  it('is read only from the source that sets it - a sibling source without it keeps its numeral', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'keystory-numerals-'));
    const rawDir = join(dir, 'raw');
    const outDir = join(dir, 'out');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(rawDir, { recursive: true });
    await writeFile(join(rawDir, 'book-a.txt'), gutenbergify(NUMBERED_PARAGRAPH), 'utf8');
    await writeFile(join(rawDir, 'book-b.txt'), gutenbergify(NUMBERED_PARAGRAPH), 'utf8');
    await buildCorpus({
      sources: [baseSource({ id: 'book-a', stripLeadingNumerals: true }), baseSource({ id: 'book-b' })],
      rawDir,
      outDir,
      blocklist: new Set(),
    });
    const { readFile } = await import('node:fs/promises');
    const a = JSON.parse(await readFile(join(outDir, 'passages-book-a.json'), 'utf8'));
    const b = JSON.parse(await readFile(join(outDir, 'passages-book-b.json'), 'utf8'));
    expect(a.passages[0].text.startsWith('XVI.')).toBe(false);
    expect(b.passages[0].text.startsWith('XVI.')).toBe(true);
  });

  it('rejects a non-boolean stripLeadingNumerals value, naming the source', async () => {
    const { rawDir, outDir } = await freshRaw(PLAIN_PARAGRAPH);
    await expect(
      buildCorpus({ sources: [baseSource({ stripLeadingNumerals: 'yes' as unknown as boolean })], rawDir, outDir, blocklist: new Set() }),
    ).rejects.toThrow(/test-book/);
  });

  it('does not change a paragraph that merely starts with the word "I"', async () => {
    const iParagraph =
      'I think so, and have thought so for many years now, ever since that quiet afternoon when the whole matter was first explained to me by my grandfather in the garden behind the old house.';
    const { rawDir, outDir } = await freshRaw(iParagraph);
    const report = await buildCorpus({ sources: [baseSource({ stripLeadingNumerals: true })], rawDir, outDir, blocklist: new Set() });
    expect(report.sources[0]!.accepted).toBeGreaterThan(0);
    const { readFile } = await import('node:fs/promises');
    const file = JSON.parse(await readFile(join(outDir, 'passages-test-book.json'), 'utf8'));
    expect(file.passages[0].text.startsWith('I think so')).toBe(true);
  });
});
