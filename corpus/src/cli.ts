import { readFile } from 'node:fs/promises';
import { buildCorpus } from './build';
import { parseBlocklist } from './passages';
import type { Source } from './types';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': 'keystory-corpus-builder' } });
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
  return res.text();
}

const sourcesPath = arg('sources', 'corpus/sources.json');
const rawDir = arg('raw', 'corpus/raw');
const outDir = arg('out', 'public/corpus');
const blocklistPath = arg('blocklist', 'corpus/blocklist.txt');
const offline = process.argv.includes('--offline');
const dryRun = process.argv.includes('--dry-run');

const sources = JSON.parse(await readFile(sourcesPath, 'utf8')) as Source[];
const blocklist = parseBlocklist(await readFile(blocklistPath, 'utf8'));

const report = await buildCorpus({
  sources,
  rawDir,
  outDir,
  blocklist,
  fetchText: offline ? undefined : fetchText,
  dryRun,
});

for (const s of report.sources) {
  const rejected = Object.entries(s.rejected)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
  console.log(
    `${s.id}: ${s.paragraphs} paragraphs, ${s.candidates} candidates, ${s.accepted} accepted, ${s.duplicates} duplicates` +
      (rejected ? `, rejected: ${rejected}` : ''),
  );
}
console.log(
  `total passages: ${report.total} (${JSON.stringify(report.difficulty)})` + (dryRun ? ' (dry run, nothing written)' : ` -> ${outDir}`),
);
console.log(`sources: ${report.counts.active} active, ${report.counts.archived} archived, ${report.counts.retired} retired`);
if (dryRun && report.wouldFetch.length > 0) {
  console.log(`would fetch: ${report.wouldFetch.join(', ')}`);
}
