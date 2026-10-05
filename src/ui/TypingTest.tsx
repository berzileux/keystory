import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { ROWS, backspace, createSession, expire, extend, keyOf, typeChars, type Session } from '../engine';
import type { Entry } from './corpus';
import type { Difficulty, Length, Mode, Prefs, Seconds } from './storage';
import { appendEntry, needsMoreText, pickNext, poolFor, segmentAt, type Built } from './text';
import { charRangeForWordRange, windowRange, wordBoundaries, wordIndexAt, type CharRange } from './window';

// The capture input always holds one space. Typing appends after it and Backspace removes
// it, so both are visible as input events even when no text has been typed yet.
const SENTINEL = ' ';

function resetInput(el: HTMLInputElement): void {
  el.value = SENTINEL;
  el.setSelectionRange(SENTINEL.length, SENTINEL.length);
}

const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

interface Props {
  built: Built;
  entries: Entry[];
  recent: ReadonlySet<string>;
  prefs: Prefs;
  onPrefs: (patch: Partial<Prefs>) => void;
  onRestart: () => void;
  onFinish: (session: Session, built: Built) => void;
}

const MODES: { id: Mode; label: string; title: string }[] = [
  { id: 'passage', label: 'passage', title: 'Type one passage (or a chosen length) with no time limit' },
  { id: 'time', label: 'time', title: 'Type for a fixed number of seconds; new text keeps coming until time runs out' },
];
const SECONDS: Seconds[] = [15, 30, 60, 120];
const LENGTHS: { id: Length; label: string }[] = [
  { id: 'short', label: 'short' },
  { id: 100, label: '100' },
  { id: 250, label: '250' },
  { id: 500, label: '500' },
];
// Display label 'mixed' instead of the stored value 'all' - SOUL found 'all' unclear
// (D8); the stored preference value itself is unchanged.
const DIFFICULTIES: { id: Difficulty; label: string; title: string }[] = [
  { id: 'all', label: 'mixed', title: 'No difficulty filter - passages from easy, medium and hard all mixed together' },
  { id: 'easy', label: 'easy', title: 'The easiest third of the library by typing difficulty' },
  { id: 'medium', label: 'medium', title: 'The middle third of the library by typing difficulty' },
  { id: 'hard', label: 'hard', title: 'The hardest third of the library by typing difficulty' },
];

// D7's exact wording, one function per mode/length combination.
export function modeHint(mode: Mode, seconds: Seconds, length: Length): string {
  if (mode === 'time') return `Type for ${seconds} seconds. New text keeps coming until the clock reaches 0:00.`;
  if (length === 'short') return 'Type one passage to the end. There is no time limit; your time is however long it takes.';
  return `Type about ${length} words to the end. There is no time limit; your time is however long it takes.`;
}

// D8: filled from what corpus/src/difficulty.ts's score() actually computes (Step 1.3) -
// average word length, punctuation density and how many words are outside the corpus's
// most common 2,000, not a general "difficulty" measure.
export const DIFFICULTY_HINT =
  'Difficulty: easy, medium and hard are thirds of the library ranked by word length, punctuation and how many rare words appear. Mixed picks from all three.';

// Renders only `range` (a window of the passage around the cursor, see src/ui/window.ts)
// instead of the whole text, so the number of DOM spans stays bounded regardless of how
// long the passage has grown (time mode can extend it indefinitely). Classes are computed
// against the full, absolute character indices exactly as before, so typed/error/cursor
// state for characters inside the window is unaffected by windowing.
const Passage = memo(function Passage({ text, typed, range }: { text: string; typed: string; range: CharRange }) {
  const nodes: ReactNode[] = [];
  for (let i = range.start; i < range.end; i++) {
    const ch = text[i]!;
    let cls = 'pending';
    if (i < typed.length) cls = typed[i] === ch ? 'ok' : ch === ' ' ? 'bad sp' : 'bad';
    else if (i === typed.length) cls = 'cur';
    nodes.push(
      <span key={i} className={cls} data-cur={i === typed.length ? '' : undefined}>
        {ch}
      </span>,
    );
  }
  return <>{nodes}</>;
});

const KEYBOARD_KEYS = new Set(ROWS.flatMap((r) => r.split('')));

const LiveKeyboard = memo(function LiveKeyboard({ next, wrong }: { next: string | null; wrong: string | null }) {
  const cls = (k: string) => `key${k === next ? ' next' : ''}${k === wrong ? ' wrong' : ''}`;
  return (
    <div className="kb" aria-hidden="true">
      {ROWS.map((row, ri) => (
        <div key={ri} className={`kb-row r${ri}`}>
          {row.split('').map((k) => (
            <div key={k} className={cls(k)}>
              {k.toUpperCase()}
            </div>
          ))}
        </div>
      ))}
      <div className="kb-row r3">
        <div className={`key space${next === ' ' ? ' next' : ''}${wrong === ' ' ? ' wrong' : ''}`} />
      </div>
    </div>
  );
});

export function TypingTest({ built, entries, recent, prefs, onPrefs, onRestart, onFinish }: Props) {
  // Grows in time mode as more text is appended, so the session never finishes just
  // because the original buffer ran out - only `built` itself is the fixed starting point.
  const [workingBuilt, setWorkingBuilt] = useState(built);
  const [session, setSession] = useState(() => createSession(workingBuilt.text));
  const [now, setNow] = useState(() => performance.now());
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef(false);
  const limitMs = prefs.mode === 'time' ? prefs.seconds * 1000 : null;

  useEffect(() => {
    const el = inputRef.current;
    if (el) {
      resetInput(el);
      el.focus();
    }
  }, []);

  // Esc starts a new passage; any printable key refocuses the capture input.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onRestart();
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1) {
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onRestart]);

  // Drives the on-screen clock and ends a timed test exactly at its limit. This polling
  // interval is one of four independent ways the deadline gets enforced (see the other two
  // effects below, plus expire() being called on every keystroke in typeChars/backspaceAt) -
  // browsers throttle timers in background tabs, so no single mechanism is trusted alone.
  const started = session.startedAt !== null && session.finishedAt === null;
  useEffect(() => {
    if (!started) return;
    const id = window.setInterval(() => {
      const t = performance.now();
      setNow(t);
      setSession((s) => expire(s, t, limitMs));
    }, 50);
    return () => window.clearInterval(id);
  }, [started, limitMs]);

  // A timer scheduled directly to the deadline (fires once), independent of the polling
  // interval above - if the interval is throttled or delayed, this still fires on time.
  useEffect(() => {
    if (!started || limitMs === null || session.startedAt === null) return;
    const remaining = limitMs - (performance.now() - session.startedAt);
    if (remaining <= 0) return;
    const id = window.setTimeout(() => {
      const t = performance.now();
      setNow(t);
      setSession((s) => expire(s, t, limitMs));
    }, remaining);
    return () => window.clearTimeout(id);
  }, [started, limitMs, session.startedAt]);

  // Catches the case where both timers above were throttled or paused while the tab was in
  // the background: as soon as the tab is visible again, check the deadline immediately
  // rather than waiting for a possibly-delayed timer to catch up.
  useEffect(() => {
    if (!started) return;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      const t = performance.now();
      setNow(t);
      setSession((s) => expire(s, t, limitMs));
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [started, limitMs]);

  useEffect(() => {
    if (session.finishedAt !== null && !doneRef.current) {
      doneRef.current = true;
      onFinish(session, workingBuilt);
    }
  }, [session, workingBuilt, onFinish]);

  // Time mode only: once the cursor is close enough to the end, append another passage
  // to both the working Built and the session's own passage, in lockstep, so the typist
  // never catches up to a hard stop before the time limit.
  useEffect(() => {
    if (prefs.mode !== 'time') return;
    if (!needsMoreText(workingBuilt, session.typed.length)) return;
    const pool = poolFor(entries, prefs.difficulty);
    const entry = pickNext(pool, recent, workingBuilt);
    const nextBuilt = appendEntry(workingBuilt, entry);
    const added = nextBuilt.text.slice(workingBuilt.text.length);
    setWorkingBuilt(nextBuilt);
    setSession((s) => extend(s, added));
  }, [prefs.mode, prefs.difficulty, session.typed.length, workingBuilt, entries, recent]);

  // useLayoutEffect, not useEffect: when the window shifts at a step boundary, the
  // rendered content's height changes (leading words drop out). Running this correction
  // synchronously before the browser paints, rather than after, is what keeps that shift
  // invisible - the user never sees a frame scrolled to the old (now-wrong) position.
  useLayoutEffect(() => {
    const box = textRef.current;
    const cur = box?.querySelector<HTMLElement>('[data-cur]');
    if (!box || !cur) return;
    const line = parseFloat(getComputedStyle(box).lineHeight) || 56;
    box.scrollTop = Math.max(0, cur.offsetTop - line);
  }, [session.typed.length]);

  const handle = (el: HTMLInputElement, ts: number) => {
    const v = el.value;
    resetInput(el);
    if (v.length < SENTINEL.length) setSession((s) => backspaceAt(s, ts, limitMs));
    else if (v.length > SENTINEL.length) setSession((s) => typeChars(s, v.slice(SENTINEL.length), ts, limitMs));
  };

  const onInput = (e: FormEvent<HTMLInputElement>) => {
    const native = e.nativeEvent as InputEvent;
    if (native.isComposing) return;
    handle(e.currentTarget, native.timeStamp);
  };

  const blockNav = (e: KeyboardEvent<HTMLInputElement>) => {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Delete', 'Enter'].includes(e.key)) {
      e.preventDefault();
    }
  };
  const blockClipboard = (e: ClipboardEvent<HTMLInputElement>) => e.preventDefault();

  const typed = session.typed;
  const elapsed = session.startedAt === null ? 0 : (session.finishedAt ?? now) - session.startedAt;
  const shownMs = limitMs !== null ? Math.max(0, limitMs - elapsed) : elapsed;

  let correct = 0;
  for (let i = 0; i < typed.length; i++) if (typed[i] === session.passage[i]) correct += 1;
  const presses = session.log.filter((e) => e.kind === 'char');
  const accuracy = presses.length ? (100 * presses.filter((p) => p.kind === 'char' && p.correct).length) / presses.length : 100;
  const wpm = elapsed >= 1000 ? correct / 5 / (elapsed / 60000) : 0;

  const last = session.log[session.log.length - 1];
  const nextChar = session.passage[typed.length];
  const next = nextChar !== undefined && (KEYBOARD_KEYS.has(keyOf(nextChar)) || nextChar === ' ') ? keyOf(nextChar) : null;
  const wrong = last && last.kind === 'char' && !last.correct && (KEYBOARD_KEYS.has(keyOf(last.typed)) || last.typed === ' ') ? keyOf(last.typed) : null;

  const seg = segmentAt(workingBuilt, Math.min(typed.length, session.passage.length - 1));

  // The rendered window: only this slice of the passage reaches the DOM, bounding span
  // count regardless of how long the passage has grown. Pure function of the cursor's
  // word position - see src/ui/window.ts for the invariants this relies on.
  const words = useMemo(() => wordBoundaries(workingBuilt.text), [workingBuilt.text]);
  const range = useMemo(() => {
    const cursorWord = wordIndexAt(words, typed.length);
    const wordRange = windowRange(cursorWord, words.length);
    return charRangeForWordRange(words, wordRange);
  }, [words, typed.length]);
  const chars = useMemo(() => <Passage text={workingBuilt.text} typed={typed} range={range} />, [workingBuilt.text, typed, range]);

  return (
    <div className="test">
      <div className="bar" role="toolbar" aria-label="Test options">
        <div className="grp">
          {MODES.map((m) => (
            <button key={m.id} type="button" className="pill" title={m.title} aria-pressed={prefs.mode === m.id} onClick={() => onPrefs({ mode: m.id })}>
              {m.label}
            </button>
          ))}
        </div>
        {prefs.mode === 'time' && (
          <div className="grp">
            {SECONDS.map((s) => (
              <button key={s} type="button" className="pill narrow" aria-pressed={prefs.seconds === s} onClick={() => onPrefs({ seconds: s })}>
                {s}
              </button>
            ))}
          </div>
        )}
        {prefs.mode === 'passage' && (
          <div className="grp">
            {LENGTHS.map((l) => (
              <button key={l.id} type="button" className="pill narrow" aria-pressed={prefs.length === l.id} onClick={() => onPrefs({ length: l.id })}>
                {l.label}
              </button>
            ))}
          </div>
        )}
        <div className="grp">
          {DIFFICULTIES.map((d) => (
            <button key={d.id} type="button" className="pill" title={d.title} aria-pressed={prefs.difficulty === d.id} onClick={() => onPrefs({ difficulty: d.id })}>
              {d.label}
            </button>
          ))}
        </div>
        <div className="grp">
          <button type="button" className="pill" aria-pressed={prefs.keyboard} onClick={() => onPrefs({ keyboard: !prefs.keyboard })}>
            keyboard
          </button>
        </div>
      </div>

      {/* Always rendered (never conditional) so switching modes never shifts the passage
          box below it - see styles.css for the reserved min-height. */}
      <p className="hint mode-hint">
        {modeHint(prefs.mode, prefs.seconds, prefs.length)} {DIFFICULTY_HINT}
      </p>

      <div className="live-row">
        <div className="live" aria-live="off">
          <span className="live-time">{mmss(shownMs)}</span>
          <span className="live-dim">{Math.round(wpm)} wpm</span>
          <span className="live-dim">{Math.round(accuracy)}%</span>
        </div>
        <div className="src">
          english literature &middot; {seg.entry.source.author}, {seg.entry.source.title} ({seg.entry.source.year})
        </div>
      </div>

      <div className={`passage${focused ? '' : ' blur'}`} ref={textRef} onClick={() => inputRef.current?.focus()}>
        <div className="chars" aria-label="Passage to type">
          {chars}
        </div>
        {!focused && <div className="focus-hint">Click here or press any key to focus</div>}
      </div>

      <input
        ref={inputRef}
        className="capture"
        aria-label="Typing input"
        disabled={session.finishedAt !== null}
        defaultValue={SENTINEL}
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        onInput={onInput}
        onCompositionEnd={(e) => handle(e.currentTarget, e.timeStamp)}
        onKeyDown={blockNav}
        onPaste={blockClipboard}
        onCut={blockClipboard}
        onDrop={(e) => e.preventDefault()}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />

      <div className="restart-row">
        <button type="button" className="icon-btn" aria-label="New passage" title="New passage (Esc)" onClick={onRestart}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 12a8 8 0 1 1-2.5-5.8" />
            <path d="M20 4v5h-5" />
          </svg>
        </button>
      </div>

      {prefs.keyboard ? (
        <div className="kb-wrap">
          <LiveKeyboard next={next} wrong={wrong} />
          <p className="hint">Each key press is timed as you type. Your results show which fingers and keys slow you down.</p>
        </div>
      ) : (
        <p className="hint">Keyboard hidden. Key timing is still recorded for your results.</p>
      )}
    </div>
  );
}

function backspaceAt(s: Session, ts: number, limitMs: number | null): Session {
  return backspace(expire(s, ts, limitMs), ts);
}
