import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { applyEndMarker, applyStartMarker, assertTitle, stripBoilerplate, stripLeadingNumeral, toParagraphs } from './clean';
import { DEFAULT_LIMITS, PD_CUTOFF_YEAR, gutenbergUrl } from './constants';
import { assignDifficulty, commonWords, score } from './difficulty';
import { candidatesFrom, rejectReason, wordCount } from './passages';
import type { Limits, Passage, Source, SourceStatus } from './types';

export interface BuildOptions {
  sources: Source[];
  rawDir: string;
  outDir: string;
  blocklist: ReadonlySet<string>;
  limits?: Limits;
  // Called only when an active source's raw file is missing. Omit it to run fully
  // offline. Never called for an archived or retired source, regardless of this.
  fetchText?: (url: string) => Promise<string>;
  // Reports what would be deleted and fetched; writes nothing, deletes nothing.
  dryRun?: boolean;
}

export interface SourceReport {
  id: string;
  paragraphs: number;
  candidates: number;
  accepted: number;
  duplicates: number;
  rejected: Record<string, number>;
}

export interface ExclusionReport {
  id: string;
  title: string;
  status: 'archived' | 'retired';
  // The raw file path a retired source's file was (or, in a dry run, would be) deleted
  // from. Absent for archived sources, since their file is never touched.
  deletedPath?: string;
}

export interface BuildReport {
  sources: SourceReport[];
  total: number;
  difficulty: Record<string, number>;
  excluded: ExclusionReport[];
  counts: { active: number; archived: number; retired: number };
  // Active sources whose raw file was missing in a dry run (never fetched, never written).
  wouldFetch: string[];
}

const VALID_STATUSES: readonly SourceStatus[] = ['active', 'archived', 'retired'];

// Pure: every field besides ttl/status passes through unchanged, and running it again
// on its own output changes nothing further (ttl is already gone; an already-set status,
// 'active' or otherwise, is never overwritten - only a source with neither key at all
// gets a status, and only ever to 'active').
export function migrateTtl(sources: readonly Source[]): Source[] {
  return sources.map((s) => {
    const { ttl, ...rest } = s as Source & { ttl?: number };
    if (!('ttl' in s)) return rest.status === undefined ? { ...rest, status: 'active' } : rest;
    return { ...rest, status: ttl === 1 ? 'retired' : 'active' };
  });
}

function statusOf(s: Source): SourceStatus {
  if ('ttl' in s) {
    throw new Error(`${s.id}: has a leftover "ttl" key - this was replaced by "status" (D1b); migrate it first`);
  }
  // Only a genuinely absent status defaults to active - an explicit null, number, wrong
  // case or typo must fail loudly rather than silently coalesce into a valid value.
  const status = s.status === undefined ? 'active' : s.status;
  if (!VALID_STATUSES.includes(status as SourceStatus)) {
    throw new Error(`${s.id}: invalid status ${JSON.stringify(s.status)} - must be one of ${VALID_STATUSES.join(', ')}`);
  }
  return status;
}

const MISSING_RAW = Symbol('missing-raw-in-dry-run');

async function loadRaw(o: BuildOptions, s: Source): Promise<string | typeof MISSING_RAW> {
  const path = join(o.rawDir, `${s.id}.txt`);
  try {
    return await readFile(path, 'utf8');
  } catch {
    if (o.dryRun) return MISSING_RAW;
    if (!o.fetchText) throw new Error(`Missing raw file ${path} and no fetcher provided`);
    const text = await o.fetchText(gutenbergUrl(s.gutenbergId));
    await mkdir(o.rawDir, { recursive: true });
    await writeFile(path, text, 'utf8');
    return text;
  }
}

export async function buildCorpus(o: BuildOptions): Promise<BuildReport> {
  const limits = o.limits ?? DEFAULT_LIMITS;
  const seen = new Set<string>();
  const kept: { source: Source; text: string; paragraph: number }[] = [];
  const reports: SourceReport[] = [];

  // Every source's id and status is validated up front, for every source regardless of
  // status, before any file is read, fetched, deleted or written - so an invalid status
  // or a leftover ttl key never leaves a half-finished build on disk.
  const statusById = new Map<string, SourceStatus>();
  for (const source of o.sources) {
    if (!/^[a-z0-9-]+$/.test(source.id)) throw new Error(`Unsafe source id: ${source.id}`);
    statusById.set(source.id, statusOf(source));
    if (source.stripLeadingNumerals !== undefined && typeof source.stripLeadingNumerals !== 'boolean') {
      throw new Error(`${source.id}: stripLeadingNumerals must be a boolean, got ${JSON.stringify(source.stripLeadingNumerals)}`);
    }
  }

  const excluded: ExclusionReport[] = [];
  const statusCounts = { active: 0, archived: 0, retired: 0 };
  for (const source of o.sources) {
    const status = statusById.get(source.id)!;
    statusCounts[status] += 1;
    if (status === 'retired') {
      const path = join(o.rawDir, `${source.id}.txt`);
      if (!o.dryRun) await rm(path, { force: true }); // force: true -> missing file is not an error
      excluded.push({ id: source.id, title: source.title, status: 'retired', deletedPath: path });
      console.log(`excluded ${source.id} (${source.title}): retired, raw file removed (${path})`);
    } else if (status === 'archived') {
      excluded.push({ id: source.id, title: source.title, status: 'archived' });
      console.log(`excluded ${source.id} (${source.title}): archived`);
    }
  }

  const wouldFetch: string[] = [];
  for (const source of o.sources) {
    if (statusById.get(source.id) !== 'active') continue;
    if (source.year >= PD_CUTOFF_YEAR) {
      throw new Error(`${source.id}: year ${source.year} is not before ${PD_CUTOFF_YEAR}`);
    }
    const loaded = await loadRaw(o, source);
    if (loaded === MISSING_RAW) {
      wouldFetch.push(source.id);
      console.log(`${source.id}: raw file missing, would fetch ${gutenbergUrl(source.gutenbergId)}`);
      continue;
    }
    const raw = loaded;
    assertTitle(raw, source.gutenbergTitle);
    let body = stripBoilerplate(raw);
    if (source.startMarker) body = applyStartMarker(body, source.startMarker, source.occurrence ?? 1);
    if (source.endMarker) body = applyEndMarker(body, source.endMarker, source.endOccurrence ?? 1);
    let paragraphs = toParagraphs(body);
    if (source.stripLeadingNumerals) paragraphs = paragraphs.map(stripLeadingNumeral);
    const candidates = candidatesFrom(paragraphs, limits);
    const report: SourceReport = {
      id: source.id,
      paragraphs: paragraphs.length,
      candidates: candidates.length,
      accepted: 0,
      duplicates: 0,
      rejected: {},
    };
    for (const c of candidates) {
      const reason = rejectReason(c.text, o.blocklist);
      if (reason) {
        report.rejected[reason] = (report.rejected[reason] ?? 0) + 1;
        continue;
      }
      if (seen.has(c.text)) {
        report.duplicates += 1;
        continue;
      }
      seen.add(c.text);
      kept.push({ source, text: c.text, paragraph: c.paragraph });
      report.accepted += 1;
    }
    reports.push(report);
  }

  const common = commonWords(kept.map((k) => k.text));
  const scores = kept.map((k) => score(k.text, common));
  const difficulty = assignDifficulty(scores);

  const bySource = new Map<string, Passage[]>();
  kept.forEach((k, i) => {
    const list = bySource.get(k.source.id) ?? [];
    list.push({
      id: `${k.source.id}-${String(list.length).padStart(4, '0')}`,
      text: k.text,
      words: wordCount(k.text),
      difficulty: difficulty[i]!,
      score: Math.round(scores[i]! * 1000) / 1000,
      sourceId: k.source.id,
      paragraph: k.paragraph,
    });
    bySource.set(k.source.id, list);
  });

  const difficultyCounts: Record<string, number> = { easy: 0, medium: 0, hard: 0 };
  for (const d of difficulty) difficultyCounts[d] = (difficultyCounts[d] ?? 0) + 1;

  // Only active sources are ever written to outDir - an archived or retired source's
  // entry never appears in index.json and never gets its own passages-<id>.json file.
  const activeSources = o.sources.filter((s) => statusById.get(s.id) === 'active');
  if (!o.dryRun) {
    await mkdir(o.outDir, { recursive: true });
    const index = {
      version: 1,
      limits,
      difficulty: difficultyCounts,
      sources: activeSources.map((s) => ({
        ...s,
        file: `passages-${s.id}.json`,
        passages: bySource.get(s.id)?.length ?? 0,
      })),
    };
    for (const s of activeSources) {
      await writeFile(
        join(o.outDir, `passages-${s.id}.json`),
        JSON.stringify({ source: s, passages: bySource.get(s.id) ?? [] }, null, 2) + '\n',
        'utf8',
      );
    }
    await writeFile(join(o.outDir, 'index.json'), JSON.stringify(index, null, 2) + '\n', 'utf8');
  }

  console.log(`active ${statusCounts.active}, archived ${statusCounts.archived}, retired ${statusCounts.retired}`);

  return { sources: reports, total: kept.length, difficulty: difficultyCounts, excluded, counts: statusCounts, wouldFetch };
}
