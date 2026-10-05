import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCorpus, migrateTtl } from '../corpus/src/build';
import type { Source } from '../corpus/src/types';

const fixtureRaw = await readFile('corpus/fixtures/raw/test-book.txt', 'utf8');

function baseSource(overrides: Partial<Source> = {}): Source {
  return { id: 'test-book', title: 'Test Book', gutenbergTitle: 'Test Book', author: 'Test Author', year: 1900, gutenbergId: 0, ...overrides };
}

async function freshDirs() {
  const dir = await mkdtemp(join(tmpdir(), 'keystory-status-'));
  const rawDir = join(dir, 'raw');
  const outDir = join(dir, 'out');
  return { dir, rawDir, outDir };
}

async function seedRaw(rawDir: string, id: string, text = fixtureRaw) {
  await mkdir(rawDir, { recursive: true });
  await writeFile(join(rawDir, `${id}.txt`), text, 'utf8');
}

describe('status field', () => {
  it('defaults to active when absent', async () => {
    const { rawDir, outDir } = await freshDirs();
    await seedRaw(rawDir, 'test-book');
    const report = await buildCorpus({ sources: [baseSource()], rawDir, outDir, blocklist: new Set() });
    expect(report.total).toBeGreaterThan(0);
    expect(report.counts).toEqual({ active: 1, archived: 0, retired: 0 });
  });

  it('rejects any status other than active/archived/retired, naming the source, before anything on disk changes', async () => {
    const { rawDir, outDir } = await freshDirs();
    await seedRaw(rawDir, 'test-book');
    for (const bad of ['Active', 'ACTIVE', 1, null, 'deleted', '']) {
      await expect(
        buildCorpus({ sources: [baseSource({ status: bad as never })], rawDir, outDir, blocklist: new Set() }),
      ).rejects.toThrow(/test-book/);
    }
    // Nothing was written - the out directory was never created.
    await expect(stat(outDir)).rejects.toThrow();
  });

  it('rejects a leftover ttl key with a message naming it as replaced by status', async () => {
    const { rawDir, outDir } = await freshDirs();
    await seedRaw(rawDir, 'test-book');
    const withTtl = { ...baseSource(), ttl: 0 } as Source;
    await expect(buildCorpus({ sources: [withTtl], rawDir, outDir, blocklist: new Set() })).rejects.toThrow(/ttl/i);
    await expect(buildCorpus({ sources: [withTtl], rawDir, outDir, blocklist: new Set() })).rejects.toThrow(/status/i);
  });

  it('excludes a retired source from the build and deletes its raw file, without erroring when the file is already missing', async () => {
    const { rawDir, outDir } = await freshDirs();
    await seedRaw(rawDir, 'test-book');
    const report = await buildCorpus({ sources: [baseSource({ status: 'retired' })], rawDir, outDir, blocklist: new Set() });
    expect(report.total).toBe(0);
    expect(report.counts).toEqual({ active: 0, archived: 0, retired: 1 });
    await expect(stat(join(rawDir, 'test-book.txt'))).rejects.toThrow();

    // Running again with the file already gone must not error.
    const second = await buildCorpus({ sources: [baseSource({ status: 'retired' })], rawDir, outDir, blocklist: new Set() });
    expect(second.total).toBe(0);
  });

  it('a retired source never deletes anything outside corpus/raw or belonging to another source', async () => {
    const { rawDir, outDir } = await freshDirs();
    await seedRaw(rawDir, 'test-book');
    await seedRaw(rawDir, 'other-book');
    await buildCorpus({
      sources: [baseSource({ status: 'retired' }), baseSource({ id: 'other-book', status: 'active' })],
      rawDir,
      outDir,
      blocklist: new Set(),
    });
    await expect(stat(join(rawDir, 'test-book.txt'))).rejects.toThrow();
    expect((await stat(join(rawDir, 'other-book.txt'))).isFile()).toBe(true);
  });

  it('excludes an archived source from the build, leaves its raw file byte-identical, and never fetches it even when missing', async () => {
    const { rawDir, outDir } = await freshDirs();
    // No raw file seeded at all - archived sources must never be fetched.
    let fetchCalls = 0;
    const report = await buildCorpus({
      sources: [baseSource({ status: 'archived' })],
      rawDir,
      outDir,
      blocklist: new Set(),
      fetchText: async () => {
        fetchCalls += 1;
        return fixtureRaw;
      },
    });
    expect(report.total).toBe(0);
    expect(report.counts).toEqual({ active: 0, archived: 1, retired: 0 });
    expect(fetchCalls).toBe(0);
    await expect(stat(join(rawDir, 'test-book.txt'))).rejects.toThrow();
  });

  it('leaves an archived source raw file byte-identical when it does exist', async () => {
    const { rawDir, outDir } = await freshDirs();
    await seedRaw(rawDir, 'test-book');
    const before = await readFile(join(rawDir, 'test-book.txt'), 'utf8');
    await buildCorpus({ sources: [baseSource({ status: 'archived' })], rawDir, outDir, blocklist: new Set() });
    const after = await readFile(join(rawDir, 'test-book.txt'), 'utf8');
    expect(after).toBe(before);
  });

  it('an active source with its raw file present never calls fetchText', async () => {
    const { rawDir, outDir } = await freshDirs();
    await seedRaw(rawDir, 'test-book');
    let called = false;
    await buildCorpus({
      sources: [baseSource({ status: 'active' })],
      rawDir,
      outDir,
      blocklist: new Set(),
      fetchText: async () => {
        called = true;
        return fixtureRaw;
      },
    });
    expect(called).toBe(false);
  });

  it('an active source with a missing raw file calls fetchText exactly once', async () => {
    const { rawDir, outDir } = await freshDirs();
    let calls = 0;
    await buildCorpus({
      sources: [baseSource({ status: 'active' })],
      rawDir,
      outDir,
      blocklist: new Set(),
      fetchText: async () => {
        calls += 1;
        return fixtureRaw;
      },
    });
    expect(calls).toBe(1);
  });

  it('changing archived to active includes the source on the next build with no network call when the raw file is present', async () => {
    const { rawDir, outDir } = await freshDirs();
    await seedRaw(rawDir, 'test-book');
    let called = false;
    const report = await buildCorpus({
      sources: [baseSource({ status: 'active' })],
      rawDir,
      outDir,
      blocklist: new Set(),
      fetchText: async () => {
        called = true;
        return fixtureRaw;
      },
    });
    expect(report.total).toBeGreaterThan(0);
    expect(called).toBe(false);
  });

  it('honours --offline (no fetcher): an active source with a missing raw file fails clearly instead of fetching', async () => {
    const { rawDir, outDir } = await freshDirs();
    await expect(buildCorpus({ sources: [baseSource({ status: 'active' })], rawDir, outDir, blocklist: new Set() })).rejects.toThrow(
      /Missing raw file/,
    );
  });
});

describe('migrateTtl (D1b, pure)', () => {
  it('converts ttl: 1 to retired, ttl: 0 and absent to active, and removes the ttl key', () => {
    const input = [
      { id: 'a', ttl: 1 },
      { id: 'b', ttl: 0 },
      { id: 'c' },
    ] as unknown as Source[];
    const out = migrateTtl(input);
    expect(out.map((s) => s.status)).toEqual(['retired', 'active', 'active']);
    for (const s of out) expect('ttl' in s).toBe(false);
  });

  it('leaves every other field byte-for-byte unchanged', () => {
    const input = [{ ...baseSource(), ttl: 1, extra: 'kept' }] as unknown as Source[];
    const [out] = migrateTtl(input);
    expect(out).toMatchObject({ id: 'test-book', title: 'Test Book', gutenbergTitle: 'Test Book', author: 'Test Author', year: 1900, gutenbergId: 0, status: 'retired' });
    expect((out as unknown as { extra: string }).extra).toBe('kept');
  });

  it('running it twice changes nothing further', () => {
    const input = [{ id: 'a', ttl: 1 }, { id: 'b' }] as unknown as Source[];
    const once = migrateTtl(input);
    const twice = migrateTtl(once);
    expect(twice).toEqual(once);
  });
});
