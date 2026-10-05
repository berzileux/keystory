import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { findBlocked, parseBlocklist } from './passages';
import type { Difficulty, Passage } from './types';

interface IndexSource {
  id: string;
  file: string;
  passages: number;
  [key: string]: unknown;
}

interface IndexFile {
  difficulty: Record<string, number>;
  sources: IndexSource[];
  [key: string]: unknown;
}

interface PassagesFile {
  source: unknown;
  passages: Passage[];
}

export interface SourceBanReport {
  id: string;
  before: number;
  after: number;
  removed: number;
}

export interface BanReport {
  sources: SourceBanReport[];
  totalBefore: number;
  totalAfter: number;
  totalRemoved: number;
  perTerm: Record<string, number>;
}

async function readJson<T>(path: string): Promise<T> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (e) {
    throw new Error(`Cannot read ${path}: ${(e as Error).message}`);
  }
  try {
    return JSON.parse(raw) as T;
  } catch (e) {
    throw new Error(`Malformed JSON in ${path}: ${(e as Error).message}`);
  }
}

// Write-then-rename so a crash mid-run never leaves a half-written file behind.
async function writeJsonAtomic(path: string, data: unknown): Promise<void> {
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await rename(tmp, path);
}

// Scans every passage in every source listed by index.json, first to last, against the
// shared matcher (the same one rejectReason uses at build time, so build and ban can never
// disagree). Every file is read and validated BEFORE anything is written, so a missing or
// malformed file fails loudly with nothing on disk touched. Difficulty LABELS on surviving
// passages are kept as-is (not recomputed); only the index.json totals are recounted.
export async function banCorpus(dir: string, blocklist: ReadonlySet<string>, opts: { dryRun?: boolean } = {}): Promise<BanReport> {
  const indexPath = join(dir, 'index.json');
  const index = await readJson<IndexFile>(indexPath);

  const sourceReports: SourceBanReport[] = [];
  const perTerm: Record<string, number> = {};
  const updatedSources: IndexSource[] = [];
  const difficultyCounts: Record<Difficulty, number> = { easy: 0, medium: 0, hard: 0 };
  const pendingWrites: { path: string; data: PassagesFile }[] = [];
  let totalBefore = 0;
  let totalAfter = 0;

  for (const s of index.sources) {
    const filePath = join(dir, s.file);
    const file = await readJson<PassagesFile>(filePath);
    const before = file.passages.length;
    const kept: Passage[] = [];
    for (const p of file.passages) {
      const hits = findBlocked(p.text, blocklist);
      if (hits.length > 0) {
        for (const h of hits) perTerm[h] = (perTerm[h] ?? 0) + 1;
        continue;
      }
      kept.push(p);
      difficultyCounts[p.difficulty] = (difficultyCounts[p.difficulty] ?? 0) + 1;
    }
    totalBefore += before;
    totalAfter += kept.length;
    sourceReports.push({ id: s.id, before, after: kept.length, removed: before - kept.length });
    updatedSources.push({ ...s, passages: kept.length });
    pendingWrites.push({ path: filePath, data: { source: file.source, passages: kept } });
  }

  if (!opts.dryRun) {
    for (const w of pendingWrites) await writeJsonAtomic(w.path, w.data);
    await writeJsonAtomic(indexPath, { ...index, difficulty: difficultyCounts, sources: updatedSources });
  }

  return { sources: sourceReports, totalBefore, totalAfter, totalRemoved: totalBefore - totalAfter, perTerm };
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

function printReport(report: BanReport): void {
  for (const s of report.sources) console.log(`${s.id}: ${s.before} -> ${s.after} (removed ${s.removed})`);
  const terms = Object.entries(report.perTerm)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
  console.log(`total: ${report.totalBefore} -> ${report.totalAfter} (removed ${report.totalRemoved})` + (terms ? `, terms: ${terms}` : ''));
}

async function main(): Promise<void> {
  const dir = arg('dir', 'public/corpus');
  const blocklistPath = arg('blocklist', 'corpus/blocklist.txt');
  const check = process.argv.includes('--check');
  const dryRun = check || process.argv.includes('--dry-run');

  const blocklist = parseBlocklist(await readFile(blocklistPath, 'utf8'));
  const report = await banCorpus(dir, blocklist, { dryRun });
  printReport(report);

  if (check) {
    if (report.totalRemoved > 0) {
      console.error(`corpus:ban --check: ${report.totalRemoved} passage(s) still match the blocklist`);
      process.exitCode = 1;
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  });
}
