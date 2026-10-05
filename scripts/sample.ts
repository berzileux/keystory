import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

interface Passage {
  id: string;
  text: string;
  words: number;
  difficulty: string;
  score: number;
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

const dir = arg('corpus', 'public/corpus');
const n = Number(arg('n', '15'));

const index = JSON.parse(await readFile(join(dir, 'index.json'), 'utf8')) as {
  sources: { id: string; title: string; file: string }[];
};

const all: Passage[] = [];
console.log('Passages per source:');
for (const s of index.sources) {
  const file = JSON.parse(await readFile(join(dir, s.file), 'utf8')) as { passages: Passage[] };
  const byDifficulty: Record<string, number> = {};
  for (const p of file.passages) byDifficulty[p.difficulty] = (byDifficulty[p.difficulty] ?? 0) + 1;
  const avg = file.passages.length ? file.passages.reduce((a, p) => a + p.words, 0) / file.passages.length : 0;
  console.log(`  ${s.title}: ${file.passages.length} (${JSON.stringify(byDifficulty)}, avg ${avg.toFixed(0)} words)`);
  all.push(...file.passages);
}
console.log(`Total: ${all.length}\n`);

console.log(`${Math.min(n, all.length)} random passages to read through:\n`);
const picked = [...all].sort(() => Math.random() - 0.5).slice(0, n);
for (const p of picked) console.log(`[${p.id} | ${p.difficulty} | ${p.words} words]\n${p.text}\n`);

// Every distinct word with its count, so offensive or odd terms can be spotted and
// added to corpus/blocklist.txt.
const freq = new Map<string, number>();
for (const p of all) for (const w of p.text.toLowerCase().match(/[a-z']+/g) ?? []) freq.set(w, (freq.get(w) ?? 0) + 1);
await mkdir('.tmp', { recursive: true });
await writeFile(
  '.tmp/corpus-words.txt',
  [...freq.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([w, c]) => `${w} ${c}`)
    .join('\n') + '\n',
  'utf8',
);
console.log(`Wrote ${freq.size} distinct words to .tmp/corpus-words.txt. Scan it and add anything unsuitable to corpus/blocklist.txt, then rebuild.`);
