import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { banCorpus } from '../corpus/src/ban';

async function fixture(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'keystory-ban-'));
  const index = {
    version: 1,
    limits: { min: 25, max: 60 },
    difficulty: { easy: 2, medium: 1, hard: 1 },
    sources: [
      { id: 'book-a', title: 'Book A', file: 'passages-book-a.json', passages: 3 },
      { id: 'book-b', title: 'Book B', file: 'passages-book-b.json', passages: 1 },
    ],
  };
  const bookA = {
    source: { title: 'Book A', author: 'Author A', year: 1900 },
    passages: [
      { id: 'book-a-0000', text: 'A perfectly ordinary clean sentence here.', words: 6, difficulty: 'easy', score: 0, sourceId: 'book-a', paragraph: 0 },
      { id: 'book-a-0001', text: 'A savage fight broke out that evening.', words: 7, difficulty: 'medium', score: 0, sourceId: 'book-a', paragraph: 1 },
      { id: 'book-a-0002', text: "It was the darkey's boat, moored by the shore.", words: 9, difficulty: 'hard', score: 0, sourceId: 'book-a', paragraph: 2 },
    ],
  };
  const bookB = {
    source: { title: 'Book B', author: 'Author B', year: 1900 },
    passages: [
      { id: 'book-b-0000', text: 'He called him a half-caste, a cruel word.', words: 8, difficulty: 'easy', score: 0, sourceId: 'book-b', paragraph: 0 },
    ],
  };
  await writeFile(join(dir, 'index.json'), JSON.stringify(index, null, 2) + '\n', 'utf8');
  await writeFile(join(dir, 'passages-book-a.json'), JSON.stringify(bookA, null, 2) + '\n', 'utf8');
  await writeFile(join(dir, 'passages-book-b.json'), JSON.stringify(bookB, null, 2) + '\n', 'utf8');
  return dir;
}

const BLOCKLIST = new Set(['savage', 'darkey', 'half-caste']);
const tempDirs: string[] = [];
afterEach(async () => {
  for (const d of tempDirs.splice(0)) await rm(d, { recursive: true, force: true });
});

async function makeFixture(): Promise<string> {
  const dir = await fixture();
  tempDirs.push(dir);
  return dir;
}

describe('banCorpus', () => {
  it('removes matching passages and only those, keeping surviving ids unchanged', async () => {
    const dir = await makeFixture();
    const report = await banCorpus(dir, BLOCKLIST);
    expect(report.totalBefore).toBe(4);
    expect(report.totalRemoved).toBe(3);
    expect(report.totalAfter).toBe(1);

    const bookA = JSON.parse(await readFile(join(dir, 'passages-book-a.json'), 'utf8'));
    expect(bookA.passages.map((p: { id: string }) => p.id)).toEqual(['book-a-0000']);
    const bookB = JSON.parse(await readFile(join(dir, 'passages-book-b.json'), 'utf8'));
    expect(bookB.passages).toEqual([]);
  });

  it('recomputes index.json counts to agree with the surviving passages', async () => {
    const dir = await makeFixture();
    await banCorpus(dir, BLOCKLIST);
    const index = JSON.parse(await readFile(join(dir, 'index.json'), 'utf8'));
    const a = index.sources.find((s: { id: string }) => s.id === 'book-a');
    const b = index.sources.find((s: { id: string }) => s.id === 'book-b');
    expect(a.passages).toBe(1);
    expect(b.passages).toBe(0);
    expect(index.difficulty).toEqual({ easy: 1, medium: 0, hard: 0 });
  });

  it('reports per-term counts', async () => {
    const dir = await makeFixture();
    const report = await banCorpus(dir, BLOCKLIST);
    expect(report.perTerm).toEqual({ savage: 1, darkey: 1, 'half-caste': 1 });
  });

  it('--dry-run (dryRun option) changes no file', async () => {
    const dir = await makeFixture();
    const before = await readFile(join(dir, 'passages-book-a.json'), 'utf8');
    const beforeIndex = await readFile(join(dir, 'index.json'), 'utf8');
    const report = await banCorpus(dir, BLOCKLIST, { dryRun: true });
    expect(report.totalRemoved).toBe(3);
    expect(await readFile(join(dir, 'passages-book-a.json'), 'utf8')).toBe(before);
    expect(await readFile(join(dir, 'index.json'), 'utf8')).toBe(beforeIndex);
  });

  it('is idempotent: a second run removes nothing and leaves files unchanged', async () => {
    const dir = await makeFixture();
    await banCorpus(dir, BLOCKLIST);
    const afterFirst = await readFile(join(dir, 'passages-book-a.json'), 'utf8');
    const report2 = await banCorpus(dir, BLOCKLIST);
    expect(report2.totalRemoved).toBe(0);
    expect(await readFile(join(dir, 'passages-book-a.json'), 'utf8')).toBe(afterFirst);
  });

  it('removes phrase entries and possessive forms', async () => {
    const dir = await makeFixture();
    const report = await banCorpus(dir, BLOCKLIST);
    const bookA = JSON.parse(await readFile(join(dir, 'passages-book-a.json'), 'utf8'));
    expect(bookA.passages.some((p: { id: string }) => p.id === 'book-a-0002')).toBe(false);
    const bookB = JSON.parse(await readFile(join(dir, 'passages-book-b.json'), 'utf8'));
    expect(bookB.passages.some((p: { id: string }) => p.id === 'book-b-0000')).toBe(false);
  });

  it('fails loudly on a missing passages file and writes nothing', async () => {
    const dir = await makeFixture();
    const index = JSON.parse(await readFile(join(dir, 'index.json'), 'utf8'));
    index.sources.push({ id: 'book-c', title: 'Book C', file: 'passages-book-c.json', passages: 0 });
    await writeFile(join(dir, 'index.json'), JSON.stringify(index, null, 2) + '\n', 'utf8');
    const before = await readFile(join(dir, 'passages-book-a.json'), 'utf8');
    await expect(banCorpus(dir, BLOCKLIST)).rejects.toThrow();
    expect(await readFile(join(dir, 'passages-book-a.json'), 'utf8')).toBe(before);
  });

  it('fails loudly on a missing index.json', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'keystory-ban-empty-'));
    tempDirs.push(dir);
    await expect(banCorpus(dir, BLOCKLIST)).rejects.toThrow();
  });
});

describe('corpus:ban CLI', () => {
  it('--check exits 1 when matches exist and 0 once clean', async () => {
    const dir = await makeFixture();
    const blocklistPath = join(dir, 'blocklist.txt');
    await writeFile(blocklistPath, 'savage\ndarkey\nhalf-caste\n', 'utf8');
    const run = (...extra: string[]) =>
      execFileSync('npx', ['tsx', 'corpus/src/ban.ts', '--dir', dir, '--blocklist', blocklistPath, ...extra], {
        cwd: join(__dirname, '..'),
        encoding: 'utf8',
      });
    expect(() => run('--check')).toThrow();
    await banCorpus(dir, BLOCKLIST);
    expect(() => run('--check')).not.toThrow();
  });
});
