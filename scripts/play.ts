import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  ROWS,
  backspace,
  confidence,
  createSession,
  extractPresses,
  fingerSummary,
  handSummary,
  keyStats,
  sessionResult,
  typeChar,
  type KeyPress,
  type KeyStat,
  type Session,
} from '../src/engine';

interface Entry {
  id: string;
  text: string;
  difficulty: string;
  source: { title: string; author: string; year: number };
}

interface Store {
  tests: number;
  presses: KeyPress[];
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

async function loadEntries(dir: string, difficulty: string): Promise<Entry[]> {
  const index = JSON.parse(await readFile(join(dir, 'index.json'), 'utf8')) as { sources: { file: string }[] };
  const out: Entry[] = [];
  for (const s of index.sources) {
    const file = JSON.parse(await readFile(join(dir, s.file), 'utf8')) as {
      source: Entry['source'];
      passages: { id: string; text: string; difficulty: string }[];
    };
    for (const p of file.passages) out.push({ ...p, source: file.source });
  }
  return difficulty ? out.filter((e) => e.difficulty === difficulty) : out;
}

async function readStore(path: string): Promise<Store> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as Store;
  } catch {
    return { tests: 0, presses: [] };
  }
}

async function writeStore(path: string, store: Store): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(store) + '\n', 'utf8');
}

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31;4m';
const INVERSE = '\x1b[7m';

function wrap(text: string, width: number): [number, number][] {
  const lines: [number, number][] = [];
  let start = 0;
  let lastSpace = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === ' ') lastSpace = i;
    if (i - start + 1 > width && lastSpace > start) {
      lines.push([start, lastSpace + 1]);
      start = lastSpace + 1;
      lastSpace = -1;
    }
  }
  lines.push([start, text.length]);
  return lines;
}

function render(s: Session, entry: Entry, lines: [number, number][]): void {
  let out = '\x1b[2J\x1b[H';
  out += `${entry.source.title} - ${entry.source.author} (${entry.source.year}) [${entry.difficulty}]\n\n`;
  for (const [a, b] of lines) {
    let row = '';
    for (let i = a; i < b; i++) {
      const ch = s.passage[i]!;
      if (i < s.typed.length) row += s.typed[i] === ch ? `${GREEN}${ch}${RESET}` : `${RED}${ch === ' ' ? '_' : ch}${RESET}`;
      else if (i === s.typed.length) row += `${INVERSE}${ch}${RESET}`;
      else row += `${DIM}${ch}${RESET}`;
    }
    out += row + '\n';
  }
  out += `\n${DIM}Ctrl-C to quit. Backspace works.${RESET}\n`;
  process.stdout.write(out);
}

const STOPS = [
  [31, 58, 82],
  [122, 95, 138],
  [255, 154, 98],
] as const;

function heat(t: number): [number, number, number] {
  const c = Math.max(0, Math.min(1, t));
  const i = c < 0.5 ? 0 : 1;
  const u = c < 0.5 ? c * 2 : (c - 0.5) * 2;
  const a = STOPS[i]!;
  const b = STOPS[i + 1]!;
  return [0, 1, 2].map((k) => Math.round(a[k]! + (b[k]! - a[k]!) * u)) as [number, number, number];
}

function cell(text: string, rgb: [number, number, number] | null, light: boolean): string {
  const padded = text.padStart(Math.ceil((5 + text.length) / 2)).padEnd(5);
  if (!rgb) return `${DIM}${padded}${RESET}`;
  const fg = light ? '\x1b[38;2;223;230;238m' : '\x1b[38;2;26;18;16m';
  return `\x1b[48;2;${rgb[0]};${rgb[1]};${rgb[2]}m${fg}${padded}${RESET}`;
}

function printAnalysis(store: Store): void {
  const stats = keyStats(store.presses);
  const timed = Object.values(stats).filter((k): k is KeyStat & { adjMs: number } => k.tier >= 1 && k.adjMs !== null);
  const lo = timed.length ? Math.min(...timed.map((k) => k.adjMs)) : 0;
  const hi = timed.length ? Math.max(...timed.map((k) => k.adjMs)) : 1;

  console.log('\nKey map (latency in ms, adjusted for finger movement; dim "." = not enough data)\n');
  const indent = [0, 2, 5];
  ROWS.forEach((row, ri) => {
    let top = ' '.repeat(indent[ri]!);
    let bottom = ' '.repeat(indent[ri]!);
    for (const key of row) {
      const k = stats[key];
      if (!k || k.tier === 0 || k.adjMs === null) {
        top += cell(key.toUpperCase(), null, true);
        bottom += cell('.', null, true);
      } else {
        const t = hi > lo ? (k.adjMs - lo) / (hi - lo) : 0;
        top += cell(key.toUpperCase() + (k.tier === 1 ? '?' : ''), heat(t), t < 0.58);
        bottom += cell(String(Math.round(k.adjMs)), heat(t), t < 0.58);
      }
    }
    console.log(top);
    console.log(bottom);
  });
  console.log(`${DIM}'?' marks a provisional key (fewer than 10 timed samples).${RESET}`);

  const fingers = Object.entries(fingerSummary(stats))
    .filter(([name, g]) => name !== 'thumb' && g.adjMs !== null)
    .sort((a, b) => b[1].adjMs! - a[1].adjMs!);
  if (fingers.length >= 2) {
    console.log('\nBy finger (slowest first):');
    for (const [name, g] of fingers) console.log(`  ${name.padEnd(9)} ${String(Math.round(g.adjMs!)).padStart(4)} ms  (${g.nLat} timed presses)`);
  }
  const hands = handSummary(stats);
  if (hands.L?.adjMs != null && hands.R?.adjMs != null) {
    console.log(`\nHands: left ${Math.round(hands.L.adjMs)} ms, right ${Math.round(hands.R.adjMs)} ms`);
  }

  const c = confidence(store.tests);
  const plural = store.tests === 1 ? '' : 's';
  const note = {
    early: `Early read, based on ${store.tests} test${plural}. Complete at least 5 for finger-level patterns, 10 for key-level detail.`,
    fingers: `Getting reliable, based on ${store.tests} tests. Finger-level patterns are usable; key-level detail needs 10.`,
    keys: `Reliable read, based on ${store.tests} tests. Rare keys can still be thin.`,
  }[c];
  console.log(`\n${note}\n`);
}

async function main(): Promise<void> {
  const corpusDir = arg('corpus', 'public/corpus');
  const storePath = arg('store', '.keystory/presses.json');

  if (process.argv.includes('--reset')) {
    await writeStore(storePath, { tests: 0, presses: [] });
    console.log(`Cleared saved tests in ${storePath}`);
    return;
  }

  let entries: Entry[];
  try {
    entries = await loadEntries(corpusDir, arg('difficulty', ''));
  } catch {
    console.error(`Could not read ${corpusDir}/index.json. Run "npm run corpus:build" first, or pass --corpus <dir>.`);
    process.exit(1);
  }
  if (entries.length === 0) {
    console.error('No passages match. Check --difficulty and the corpus directory.');
    process.exit(1);
  }
  const wanted = arg('id', '');
  const entry = wanted ? entries.find((e) => e.id === wanted) : entries[Math.floor(Math.random() * entries.length)];
  if (!entry) {
    console.error(`No passage with id ${wanted}`);
    process.exit(1);
  }

  let s = createSession(entry.text);
  const lines = wrap(entry.text, 70);
  render(s, entry, lines);

  const stdin = process.stdin;
  if (stdin.isTTY) stdin.setRawMode(true);
  stdin.setEncoding('utf8');
  stdin.resume();

  await new Promise<void>((resolve) => {
    stdin.on('data', (chunk: string) => {
      if (chunk === '\x03') {
        process.stdout.write('\n');
        process.exit(0);
      }
      if (chunk.startsWith('\x1b')) return;
      for (const ch of chunk) {
        const now = performance.now();
        if (ch === '\x7f' || ch === '\b') s = backspace(s, now);
        else if (ch >= ' ' && ch <= '~') s = typeChar(s, ch, now);
        if (s.finishedAt !== null) break;
      }
      render(s, entry, lines);
      if (s.finishedAt !== null) resolve();
    });
  });
  stdin.pause();

  const r = sessionResult(s);
  console.log(
    `\nwpm ${r.wpm.toFixed(0)}   raw ${r.rawWpm.toFixed(0)}   acc ${r.accuracy.toFixed(1)}%   consistency ${r.consistency.toFixed(0)}%   ` +
      `chars ${r.chars.correct}/${r.chars.incorrect}   time ${(r.durationMs / 1000).toFixed(1)}s`,
  );

  const store = await readStore(storePath);
  store.tests += 1;
  store.presses.push(...extractPresses([s]));
  await writeStore(storePath, store);
  printAnalysis(store);
}

await main();
