import { useMemo, useState } from 'react';
import type { KeyPress, SessionResult } from '../engine';
import { analyse, type Bar, type Metric } from './analysis';
import type { Length, Mode, Seconds } from './storage';

interface Props {
  presses: KeyPress[];
  tests: number;
  last: SessionResult | null;
  // The mode/limit/length that produced `last` - null until a test has ever finished.
  lastMode: Mode | null;
  lastSeconds: Seconds | null;
  lastLength: Length | null;
  canDrill: boolean;
  onNext: () => void;
  onRepeat: () => void;
  onDrill: (keys: string[]) => void;
  onClear: () => void;
}

// "passage" (short) or "passage <length>" for passage mode; the limit for time mode, for
// example "time 60s" - so a result can always be read back to which mode produced it.
export function modeLabel(mode: Mode, seconds: Seconds, length: Length): string {
  if (mode === 'time') return `time ${seconds}s`;
  return length === 'short' ? 'passage' : `passage ${length}`;
}

// The heatmap's old margin was `row.pad * 52px`, a plain pixel number. --hk (styles.css) is
// 0.08px at the desktop cap, the unit that turns every current pixel value - including these
// margins - into an exact integer, so this reproduces today's layout exactly while emitting
// no pixel value itself.
const HEAT_UNIT_PX = 0.08;
function heatMarginUnits(pad: number): number {
  return Math.round((pad * 52) / HEAT_UNIT_PX);
}

function Bars({ title, bars }: { title: string; bars: Bar[] }) {
  return (
    <section className="card">
      <h3>{title}</h3>
      <ul className="bars">
        {bars.map((b) => (
          <li key={b.name}>
            <span className="bar-name">{b.name}</span>
            <span className="bar-track">
              <span className="bar-fill" style={{ width: b.w, background: b.bg }} />
            </span>
            <span className="bar-val">{b.val}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Results({ presses, tests, last, lastMode, lastSeconds, lastLength, canDrill, onNext, onRepeat, onDrill, onClear }: Props) {
  const [metric, setMetric] = useState<Metric>('speed');
  const [selected, setSelected] = useState<string | null>(null);
  const a = useMemo(() => analyse(presses, tests, metric, selected), [presses, tests, metric, selected]);
  const segs = Math.min(10, tests);

  return (
    <div className="results">
      {last && (
        <div className="summary">
          <div>
            <span className="label">wpm</span>
            <span className="big">{Math.round(last.wpm)}</span>
          </div>
          <div>
            <span className="label">accuracy</span>
            <span className="big">{Math.round(last.accuracy)}%</span>
          </div>
          <div className="minor">
            <span className="label">raw</span>
            <span>{Math.round(last.rawWpm)}</span>
          </div>
          <div className="minor">
            <span className="label">consistency</span>
            <span>{Math.round(last.consistency)}%</span>
          </div>
          <div className="minor">
            <span className="label">time</span>
            <span>{Math.round(last.durationMs / 1000)}s</span>
          </div>
          {lastMode !== null && lastSeconds !== null && lastLength !== null && (
            <div className="minor">
              <span className="label">mode</span>
              <span>{modeLabel(lastMode, lastSeconds, lastLength)}</span>
            </div>
          )}
        </div>
      )}

      <div className={`banner ${a.banner.level}`} role="status">
        <div>
          <strong>{a.banner.title}</strong>
          <p>{a.banner.text}</p>
        </div>
        <div className="meter" aria-label={`${segs} of 10 tests`}>
          {Array.from({ length: 10 }, (_, i) => (
            <span key={i} className={i < segs ? 'on' : ''} />
          ))}
        </div>
      </div>

      <section className="card">
        <div className="card-head">
          <h3>Keyboard heatmap</h3>
          <div className="grp">
            <button type="button" className="pill" aria-pressed={metric === 'speed'} onClick={() => setMetric('speed')}>
              speed
            </button>
            <button type="button" className="pill" aria-pressed={metric === 'errors'} onClick={() => setMetric('errors')}>
              errors
            </button>
          </div>
        </div>
        <div className="kb heat">
          {a.rows.map((row, ri) => (
            <div key={ri} className={`kb-row r${ri}`} style={{ marginLeft: `calc(var(--hk) * ${heatMarginUnits(row.pad)})` }}>
              {row.keys.map((k) => (
                <button
                  key={k.key}
                  type="button"
                  className={`key${k.selected ? ' sel' : ''}`}
                  style={{ background: k.bg, color: k.fg }}
                  aria-label={k.aria}
                  aria-pressed={k.selected}
                  onClick={() => setSelected(k.key)}
                >
                  {k.label}
                </button>
              ))}
            </div>
          ))}
        </div>
        <div className="legend">
          <span>{a.legend.lo}</span>
          <span className="ramp" />
          <span>{a.legend.hi}</span>
        </div>
        <div className="detail">
          <span className="detail-key" style={{ background: a.detail.bg, color: a.detail.fg }}>
            {a.detail.label}
          </span>
          <dl>
            <div><dt>latency</dt><dd>{a.detail.latency}</dd></div>
            <div><dt>vs average</dt><dd>{a.detail.delta}</dd></div>
            <div><dt>errors</dt><dd>{a.detail.errors}</dd></div>
            <div><dt>samples</dt><dd>{a.detail.samples}</dd></div>
          </dl>
          {a.detail.note && <p className="note">{a.detail.note}</p>}
        </div>
        {a.missing.length > 0 && <p className="note">No data yet: {a.missing.join(' ')}</p>}
      </section>

      {(a.insight1 || a.insight2) && (
        <section className="card insight">
          {a.insight1 && <p>{a.insight1}</p>}
          {a.insight2 && <p>{a.insight2}</p>}
        </section>
      )}

      <div className="two">
        <Bars title="By finger" bars={a.fingers} />
        <Bars title="By hand and row" bars={a.groups} />
      </div>

      <div className="actions">
        <button type="button" className="primary" onClick={onNext}>
          Next passage
        </button>
        <button type="button" onClick={onRepeat}>
          Repeat
        </button>
        <button type="button" disabled={!canDrill || a.slowKeys.length === 0} onClick={() => onDrill(a.slowKeys)}>
          Practice slowest keys{a.slowKeys.length ? ` (${a.slowKeys.join(' ').toUpperCase()})` : ''}
        </button>
        <button
          type="button"
          className="danger"
          onClick={() => {
            if (window.confirm('Clear all saved history on this device?')) onClear();
          }}
        >
          Clear history
        </button>
      </div>
    </div>
  );
}
