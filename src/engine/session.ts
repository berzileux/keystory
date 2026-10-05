export interface CharPress {
  kind: 'char';
  // Milliseconds since the first key press.
  t: number;
  expected: string;
  typed: string;
  correct: boolean;
  // Gap since the previous log entry, null for the first press.
  dt: number | null;
  // The gap includes a backspace, so it is not a clean typing interval.
  afterBackspace: boolean;
  prevTyped: string | null;
}

export interface BackspacePress {
  kind: 'backspace';
  t: number;
}

export type LogEntry = CharPress | BackspacePress;

export interface Session {
  passage: string;
  typed: string;
  log: LogEntry[];
  startedAt: number | null;
  finishedAt: number | null;
}

export function createSession(passage: string): Session {
  return { passage, typed: '', log: [], startedAt: null, finishedAt: null };
}

// `now` is passed in (for example performance.now()) so the logic stays pure and testable.
export function typeChar(s: Session, ch: string, now: number): Session {
  if (s.finishedAt !== null || ch.length !== 1) return s;
  if (s.typed.length >= s.passage.length) return s;
  const startedAt = s.startedAt ?? now;
  const t = now - startedAt;
  const last = s.log[s.log.length - 1];
  const expected = s.passage[s.typed.length]!;
  const press: CharPress = {
    kind: 'char',
    t,
    expected,
    typed: ch,
    correct: ch === expected,
    dt: last ? t - last.t : null,
    afterBackspace: last?.kind === 'backspace',
    prevTyped: s.typed.length > 0 ? s.typed[s.typed.length - 1]! : null,
  };
  const typed = s.typed + ch;
  return {
    ...s,
    typed,
    log: [...s.log, press],
    startedAt,
    finishedAt: typed.length === s.passage.length ? now : null,
  };
}

export function backspace(s: Session, now: number): Session {
  if (s.finishedAt !== null || s.startedAt === null || s.typed.length === 0) return s;
  return {
    ...s,
    typed: s.typed.slice(0, -1),
    log: [...s.log, { kind: 'backspace', t: now - s.startedAt }],
  };
}

// Ends a timed test whose clock ran out before the passage was complete.
export function finish(s: Session, now: number): Session {
  if (s.startedAt === null || s.finishedAt !== null) return s;
  return { ...s, finishedAt: now };
}

// Ends the session at exactly the limit if `now` is past it, so late input is never counted.
export function expire(s: Session, now: number, limitMs: number | null): Session {
  if (limitMs === null || s.startedAt === null || s.finishedAt !== null) return s;
  return now - s.startedAt >= limitMs ? finish(s, s.startedAt + limitMs) : s;
}

// Grows the passage so typing can continue past its old end - used by time mode so
// the session never finishes just because the buffer ran out, only via expire/restart.
export function extend(s: Session, more: string): Session {
  if (s.finishedAt !== null || more.length === 0) return s;
  return { ...s, passage: s.passage + more };
}

// Applies several characters that arrived together and therefore share one timestamp.
export function typeChars(s: Session, chars: string, now: number, limitMs: number | null = null): Session {
  let next = s;
  for (const ch of chars) {
    next = expire(next, now, limitMs);
    next = typeChar(next, ch, now);
  }
  return next;
}
