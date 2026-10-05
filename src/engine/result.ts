import type { Session } from './session';

export interface SessionResult {
  wpm: number;
  rawWpm: number;
  accuracy: number;
  consistency: number;
  durationMs: number;
  chars: { correct: number; incorrect: number };
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

// Maps the coefficient of variation of per-second speed to a 0-100 score.
export function consistency(perSecondWpm: number[]): number {
  if (perSecondWpm.length < 2) return 100;
  const m = mean(perSecondWpm);
  if (m === 0) return 0;
  const sd = Math.sqrt(mean(perSecondWpm.map((x) => (x - m) ** 2)));
  const cv = sd / m;
  return 100 * (1 - Math.tanh(cv + cv ** 3 / 3 + cv ** 5 / 5));
}

export function sessionResult(s: Session): SessionResult {
  if (s.startedAt === null || s.finishedAt === null) throw new Error('Session is not finished');
  const durationMs = s.finishedAt - s.startedAt;
  const minutes = durationMs / 60000;

  let correct = 0;
  for (let i = 0; i < s.typed.length; i++) if (s.typed[i] === s.passage[i]) correct += 1;
  const incorrect = s.typed.length - correct;

  const presses = s.log.filter((e) => e.kind === 'char');
  const accuracy = presses.length ? (100 * presses.filter((p) => p.correct).length) / presses.length : 0;

  const seconds = Math.max(1, Math.ceil(durationMs / 1000));
  const buckets = new Array<number>(seconds).fill(0);
  for (const p of presses) {
    const i = Math.min(seconds - 1, Math.floor(p.t / 1000));
    buckets[i] = buckets[i]! + 1;
  }
  const perSecond = buckets.map((n) => (n / 5) * 60);

  return {
    wpm: minutes > 0 ? correct / 5 / minutes : 0,
    rawWpm: minutes > 0 ? s.typed.length / 5 / minutes : 0,
    accuracy,
    consistency: consistency(perSecond),
    durationMs,
    chars: { correct, incorrect },
  };
}
