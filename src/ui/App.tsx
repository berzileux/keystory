import { useCallback, useEffect, useRef, useState } from 'react';
import { extractPresses, sessionResult, type KeyPress, type Session, type SessionResult } from '../engine';
import { TypingTest } from './TypingTest';
import { Results } from './Results';
import { loadCorpus, type Entry } from './corpus';
import { emptySaved, loadSaved, persist, withTest, type Length, type Mode, type Prefs, type Saved, type Seconds } from './storage';
import { buildDrill, buildText, seenEntryIds, type Built } from './text';

type Load = { s: 'loading' } | { s: 'error'; msg: string } | { s: 'ready'; entries: Entry[] };

export function App() {
  const [load, setLoad] = useState<Load>({ s: 'loading' });
  const [saved, setSaved] = useState<Saved>(() => loadSaved());
  const [built, setBuilt] = useState<Built | null>(null);
  const [round, setRound] = useState(0);
  const [view, setView] = useState<'test' | 'results'>('test');
  const [last, setLast] = useState<SessionResult | null>(null);
  // The mode/seconds that produced `last` - captured at finish time, since prefs can
  // change before the results screen is next read (passage mode's "seconds" is unused).
  const [lastMode, setLastMode] = useState<Mode | null>(null);
  const [lastSeconds, setLastSeconds] = useState<Seconds | null>(null);
  const [lastLength, setLastLength] = useState<Length | null>(null);
  const savedRef = useRef(saved);
  savedRef.current = saved;

  useEffect(() => {
    loadCorpus()
      .then((entries) => {
        setLoad({ s: 'ready', entries });
        setBuilt(buildText(entries, savedRef.current.prefs, Math.random, new Set(savedRef.current.recent)));
      })
      .catch((e: unknown) => setLoad({ s: 'error', msg: e instanceof Error ? e.message : String(e) }));
  }, []);

  const entries = load.s === 'ready' ? load.entries : [];

  const fresh = useCallback(
    (prefs: Prefs) => {
      if (entries.length === 0) return;
      setBuilt(buildText(entries, prefs, Math.random, new Set(savedRef.current.recent)));
      setRound((r) => r + 1);
      setView('test');
    },
    [entries],
  );

  const onPrefs = useCallback(
    (patch: Partial<Prefs>) => {
      const prefs = { ...savedRef.current.prefs, ...patch };
      const next = { ...savedRef.current, prefs };
      setSaved(next);
      persist(next);
      if ('keyboard' in patch && Object.keys(patch).length === 1) return;
      fresh(prefs);
    },
    [fresh],
  );

  const onRestart = useCallback(() => fresh(savedRef.current.prefs), [fresh]);

  const onFinish = useCallback((session: Session, built: Built) => {
    const presses: KeyPress[] = extractPresses([session]);
    const seenIds = seenEntryIds(built, savedRef.current.prefs.mode, session.typed.length);
    const next = withTest(savedRef.current, presses, seenIds);
    setSaved(next);
    persist(next);
    setLast(sessionResult(session));
    setLastMode(savedRef.current.prefs.mode);
    setLastSeconds(savedRef.current.prefs.seconds);
    setLastLength(savedRef.current.prefs.length);
    setView('results');
  }, []);

  const onClear = useCallback(() => {
    const next = { ...emptySaved(), prefs: savedRef.current.prefs };
    setSaved(next);
    persist(next);
    setLast(null);
  }, []);

  return (
    <div className="app">
      <header>
        <button type="button" className="brand" onClick={onRestart}>
          {/* Decorative "ks" mark - keep in sync with public/favicon.svg by hand, no shared build step. */}
          <svg width="24" height="24" viewBox="0 0 64 64" aria-hidden="true" className="mark">
            <rect width="64" height="64" rx="14" fill="#0f1216" />
            <g fill="none" stroke="#ff9a62" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 13V51" />
              <path d="M31 25L18 38" />
              <path d="M23 33L32 51" />
              <path d="M53 30C50 25 38 25 38 32C38 39 54 38 54 45C54 52 41 52 37 46" />
            </g>
          </svg>
          keystory
        </button>
        <span className="tag">type through public-domain literature</span>
      </header>
      <main>
        {load.s === 'loading' && <p className="msg">Loading passages...</p>}
        {load.s === 'error' && (
          <div className="msg error" role="alert">
            <p>Could not load the passage corpus ({load.msg}).</p>
            <p>
              Run <code>npm run corpus:build</code> (or <code>npm run corpus:fixture</code> and copy <code>.tmp</code> output to{' '}
              <code>public/corpus</code>) and reload.
            </p>
          </div>
        )}
        {load.s === 'ready' && built && view === 'test' && (
          <TypingTest
            key={round}
            built={built}
            entries={entries}
            recent={new Set(saved.recent)}
            prefs={saved.prefs}
            onPrefs={onPrefs}
            onRestart={onRestart}
            onFinish={onFinish}
          />
        )}
        {load.s === 'ready' && view === 'results' && (
          <Results
            presses={saved.presses}
            tests={saved.tests}
            last={last}
            lastMode={lastMode}
            lastSeconds={lastSeconds}
            lastLength={lastLength}
            canDrill={entries.length > 0}
            onNext={onRestart}
            onRepeat={() => {
              setRound((r) => r + 1);
              setView('test');
            }}
            onDrill={(keys) => {
              setBuilt(buildDrill(entries, keys));
              setRound((r) => r + 1);
              setView('test');
            }}
            onClear={onClear}
          />
        )}
      </main>
      <footer>
        Texts from{' '}
        <a href="https://www.gutenberg.org" target="_blank" rel="noopener noreferrer">
          Project Gutenberg
        </a>{' '}
        - edited excerpts of public-domain books. Not affiliated with Project Gutenberg.
      </footer>
    </div>
  );
}
