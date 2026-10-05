// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from '../src/ui/App';
import { ROWS } from '../src/engine';

const TEXT = 'the quick brown fox jumps over the lazy dog and keeps running';
const index = { sources: [{ file: 'passages-x.json' }] };
const passages = { source: { title: 'T', author: 'A', year: 1900 }, passages: [{ id: 'x1', text: TEXT, difficulty: 'easy' }] };

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({ ok: true, status: 200, json: async () => (String(url).endsWith('index.json') ? index : passages) })),
  );
}

async function reachResults() {
  stubFetch();
  render(<App />);
  await screen.findByLabelText('Typing input');
  // Phase 12 changed the default mode to time - select passage explicitly, since this
  // helper types a fixed, known passage through to completion.
  fireEvent.click(screen.getByRole('button', { name: 'passage' }));
  const input = screen.getByLabelText('Typing input') as HTMLInputElement;
  for (const ch of TEXT) fireEvent.input(input, { target: { value: ' ' + ch } });
  await waitFor(() => expect(screen.getByText('Keyboard heatmap')).toBeTruthy());
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('results heatmap layout', () => {
  it('expresses each row\'s stagger with the --hk variable, never a pixel value', async () => {
    await reachResults();
    const rows = document.querySelectorAll('.kb.heat .kb-row');
    expect(rows).toHaveLength(ROWS.length);
    for (const row of rows) {
      const ml = (row as HTMLElement).style.marginLeft;
      expect(ml).toContain('var(--hk');
      expect(ml).not.toContain('px');
    }
  });

  it('keeps the same stagger proportions as the current row.pad values, recorded as unit multiples', async () => {
    await reachResults();
    const rows = Array.from(document.querySelectorAll('.kb.heat .kb-row')) as HTMLElement[];
    // Recorded from the current code: ROW_PAD = [0, 0.26, 0.74] in analysis.ts, each times the
    // old 52px multiplier, divided by the heatmap's new 0.08px unit (--hk at the desktop cap) -
    // the only unit that makes every one of today's pixel literals (46, 6, 14, and these two
    // margins) an exact integer multiple, so the proportions cannot silently drift.
    const expectedUnits = [0, 169, 481];
    const units = rows.map((row) => {
      const m = row.style.marginLeft.match(/calc\(var\(--hk\)\s*\*\s*(-?\d+)\)/);
      return m ? Number(m[1]) : NaN;
    });
    expect(units).toEqual(expectedUnits);
  });

  it('still renders every key of every row, in order, after the layout change', async () => {
    await reachResults();
    const keys = Array.from(document.querySelectorAll('.kb.heat .key'));
    const labels = keys.map((k) => k.textContent).join('');
    expect(labels).toBe(ROWS.join('').toUpperCase());
    // Layout-only: every key still carries its heat background/text colour inline.
    for (const k of keys) {
      const style = (k as HTMLElement).style;
      expect(style.backgroundColor).not.toBe('');
      expect(style.color).not.toBe('');
    }
  });
});
