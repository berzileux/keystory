import {
  MIN_SAMPLES_SHOWN,
  ROWS,
  confidence,
  fingerSummary,
  handSummary,
  keyStats,
  rowSummary,
  tierOf,
  type Confidence,
  type KeyPress,
  type KeyStat,
} from '../engine';

export type Metric = 'speed' | 'errors';

const STOPS = [
  [31, 58, 82],
  [122, 95, 138],
  [255, 154, 98],
];

const clamp = (t: number) => Math.max(0, Math.min(1, t));

export function heat(t: number): string {
  const c = clamp(t);
  const i = c < 0.5 ? 0 : 1;
  const u = c < 0.5 ? c * 2 : (c - 0.5) * 2;
  const a = STOPS[i]!;
  const b = STOPS[i + 1]!;
  return `rgb(${[0, 1, 2].map((k) => Math.round(a[k]! + (b[k]! - a[k]!) * u)).join(',')})`;
}

export const textOn = (t: number) => (t < 0.58 ? '#dfe6ee' : '#1a1210');

export interface KeyCell {
  key: string;
  label: string;
  tier: 0 | 1 | 2;
  bg: string;
  fg: string;
  selected: boolean;
  aria: string;
}

export interface Bar {
  name: string;
  val: string;
  w: string;
  bg: string;
}

export interface Detail {
  key: string;
  label: string;
  bg: string;
  fg: string;
  latency: string;
  errors: string;
  samples: string;
  delta: string;
  note: string | null;
}

export interface Banner {
  level: Confidence;
  title: string;
  text: string;
}

export interface Analysis {
  rows: { pad: number; keys: KeyCell[] }[];
  fingers: Bar[];
  groups: Bar[];
  insight1: string;
  insight2: string;
  missing: string[];
  banner: Banner;
  legend: { lo: string; hi: string };
  detail: Detail;
  slowKeys: string[];
}

const ROW_PAD = [0, 0.26, 0.74];
const FINGER_ORDER = ['L-pinky', 'L-ring', 'L-middle', 'L-index', 'R-index', 'R-middle', 'R-ring', 'R-pinky'];
const NO_DATA_BG = '#171b21';
const NO_DATA_FG = '#5b6574';

function zeroStat(key: string): KeyStat {
  return { key, n: 0, errors: 0, errRate: 0, nLat: 0, rawMs: null, adjMs: null, tier: 0 };
}

const plural = (n: number) => (n === 1 ? '' : 's');

export function analyse(presses: KeyPress[], tests: number, metric: Metric, selected: string | null): Analysis {
  const stats = keyStats(presses);
  const allKeys = ROWS.flatMap((r) => r.split(''));
  const statOf = (k: string) => stats[k] ?? zeroStat(k);
  const tierFor = (s: KeyStat) => (metric === 'speed' ? s.tier : tierOf(s.n));
  const valueFor = (s: { adjMs: number | null; errRate: number | null }) => (metric === 'speed' ? s.adjMs : s.errRate);
  const fmt = (v: number) => (metric === 'speed' ? `${Math.round(v)} ms` : `${v.toFixed(1)}%`);

  // The colour scale follows the typist's own range, but never stretches a tiny spread
  // into a dramatic one: it is widened to a minimum span.
  const shown = allKeys
    .map(statOf)
    .filter((s) => tierFor(s) >= 1 && valueFor(s) !== null)
    .map((s) => valueFor(s)!);
  let lo = 0;
  let hi = 1;
  if (shown.length > 0) {
    if (metric === 'speed') {
      lo = Math.min(...shown);
      hi = Math.max(...shown);
      if (hi - lo < 50) {
        const mid = (lo + hi) / 2;
        lo = mid - 25;
        hi = mid + 25;
      }
    } else {
      lo = 0;
      hi = Math.max(5, ...shown);
    }
  }
  const tOf = (v: number) => clamp((v - lo) / (hi - lo));

  const solid = allKeys
    .map(statOf)
    .filter((s) => tierFor(s) === 2 && valueFor(s) !== null)
    .sort((a, b) => valueFor(b)! - valueFor(a)!);
  const selKey = selected && allKeys.includes(selected) ? selected : (solid[0]?.key ?? 'e');

  const rows = ROWS.map((row, ri) => ({
    pad: ROW_PAD[ri]!,
    keys: row.split('').map((k): KeyCell => {
      const s = statOf(k);
      const tier = tierFor(s);
      const v = valueFor(s);
      const label = k.toUpperCase();
      if (tier === 0 || v === null) {
        return { key: k, label, tier: 0, bg: NO_DATA_BG, fg: NO_DATA_FG, selected: k === selKey, aria: `${label}: not enough data` };
      }
      const t = tOf(v);
      const note = tier === 1 ? ', provisional' : '';
      return { key: k, label, tier, bg: heat(t), fg: textOn(t), selected: k === selKey, aria: `${label}: ${fmt(v)}${note}` };
    }),
  }));

  const pct = (v: number) => `${Math.round((0.1 + 0.9 * tOf(v)) * 100)}%`;
  const bar = (name: string, v: number | null): Bar => ({
    name,
    val: v === null ? 'no data' : fmt(v),
    w: v === null ? '0%' : pct(v),
    bg: v === null ? '#2c333d' : heat(tOf(v)),
  });

  const fingerStats = fingerSummary(stats);
  const fingerValues = FINGER_ORDER.map((f) => ({ name: f.replace('-', ' '), v: valueFor(fingerStats[f] ?? { adjMs: null, errRate: null }) }));
  const fingers = fingerValues.map((f) => bar(f.name, f.v));

  const hands = handSummary(stats);
  const rowStats = rowSummary(stats);
  const left = valueFor(hands.L ?? { adjMs: null, errRate: null });
  const right = valueFor(hands.R ?? { adjMs: null, errRate: null });
  const groups = [
    bar('Left hand', left),
    bar('Right hand', right),
    bar('Top row', valueFor(rowStats.top ?? { adjMs: null, errRate: null })),
    bar('Home row', valueFor(rowStats.home ?? { adjMs: null, errRate: null })),
    bar('Bottom row', valueFor(rowStats.bottom ?? { adjMs: null, errRate: null })),
  ];

  const withData = fingerValues.filter((f): f is { name: string; v: number } => f.v !== null);
  let insight1 = '';
  if (withData.length >= 2) {
    const sorted = [...withData].sort((a, b) => b.v - a.v);
    const worst = sorted[0]!;
    const best = sorted[sorted.length - 1]!;
    const ratio = best.v > 0 ? (worst.v / best.v).toFixed(1) : '0.0';
    const spread = best.v > 0 ? worst.v / best.v : 1;
    insight1 =
      spread < 1.15
        ? 'No finger stands out yet: all of them are within 15% of each other.'
        : metric === 'speed'
        ? `Slowest finger: ${worst.name}, averaging ${fmt(worst.v)} per key press. That is ${ratio}x your fastest finger (${best.name}, ${fmt(best.v)}).`
        : `Most errors: ${worst.name}, at ${fmt(worst.v)} of key presses. That is ${ratio}x your cleanest finger (${best.name}, ${fmt(best.v)}).`;
  }
  let insight2 = '';
  if (left !== null && right !== null) {
    const diff = Math.abs(left - right);
    if (diff < (metric === 'speed' ? 6 : 0.4)) {
      insight2 = `Your hands are evenly matched: ${fmt(left)} left, ${fmt(right)} right.`;
    } else {
      const side = left > right ? 'Left' : 'Right';
      const gap = metric === 'speed' ? `${Math.round(diff)} ms slower` : `${diff.toFixed(1)} points less accurate`;
      insight2 = `${side} hand is ${gap} on average (${fmt(left)} left, ${fmt(right)} right).`;
    }
  }

  const missing = allKeys.filter((k) => tierFor(statOf(k)) === 0).map((k) => k.toUpperCase());

  const c = confidence(tests);
  const banner: Banner = {
    level: c,
    title: { early: 'Early read', fingers: 'Getting reliable', keys: 'Reliable read' }[c],
    text: {
      early: `Based on ${tests} test${plural(tests)}. Complete at least 5 tests for finger-level patterns, and 10 for key-level detail.`,
      fingers: `Based on ${tests} tests. Finger-level patterns are usable now; ${10 - tests} more test${plural(10 - tests)} will firm up key-level detail.`,
      keys: `Based on ${tests} tests. Rare keys can still be thin, so practice drills help with those.`,
    }[c],
  };

  // Latency detail always uses the speed numbers, whichever metric colours the map.
  const timed = allKeys.map(statOf).filter((s) => s.tier >= 1 && s.adjMs !== null);
  const weight = timed.reduce((n, s) => n + s.nLat, 0);
  const avgMs = weight > 0 ? timed.reduce((n, s) => n + s.adjMs! * s.nLat, 0) / weight : null;
  const sel = statOf(selKey);
  const selTier = tierFor(sel);
  const selValue = valueFor(sel);
  const selT = selTier > 0 && selValue !== null ? tOf(selValue) : 0;
  const delta = sel.tier >= 1 && sel.adjMs !== null && avgMs !== null ? Math.round(sel.adjMs - avgMs) : null;
  const detail: Detail = {
    key: selKey,
    label: selKey.toUpperCase(),
    bg: selTier > 0 ? heat(selT) : NO_DATA_BG,
    fg: selTier > 0 ? textOn(selT) : NO_DATA_FG,
    latency: sel.tier >= 1 && sel.adjMs !== null ? `${Math.round(sel.adjMs)} ms` : '-',
    errors: sel.n >= MIN_SAMPLES_SHOWN ? `${sel.errRate.toFixed(1)}%` : '-',
    samples: String(metric === 'speed' ? sel.nLat : sel.n),
    delta: delta === null ? '-' : `${delta >= 0 ? '+' : '-'}${Math.abs(delta)} ms`,
    note:
      selTier === 0
        ? 'Not enough samples to judge this key yet.'
        : selTier === 1
          ? 'Provisional: fewer than 10 samples so far.'
          : null,
  };

  const slowKeys = timed
    .filter((s) => /^[a-z]$/.test(s.key))
    .sort((a, b) => b.adjMs! - a.adjMs!)
    .slice(0, 5)
    .map((s) => s.key);

  return {
    rows,
    fingers,
    groups,
    insight1,
    insight2,
    missing,
    banner,
    legend: metric === 'speed' ? { lo: 'faster', hi: 'slower' } : { lo: 'fewer errors', hi: 'more errors' },
    detail,
    slowKeys,
  };
}
