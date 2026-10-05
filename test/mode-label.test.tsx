// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { App } from '../src/ui/App';
import { modeLabel } from '../src/ui/Results';

const TEXT = 'the quick brown fox jumps over the lazy dog and keeps running past the hedge';
const index = { sources: [{ file: 'passages-x.json' }] };
const passages = { source: { title: 'T', author: 'A', year: 1900 }, passages: [{ id: 'x1', text: TEXT, difficulty: 'easy' }] };

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({ ok: true, status: 200, json: async () => (String(url).endsWith('index.json') ? index : passages) })),
  );
}

// jsdom's synthetic Event.timeStamp is Date.now()-epoch-based, not performance.now()-based
// as a real browser's is (see the phase 9 output file) - override it so a scripted keystroke
// sequence can drive a real deadline without waiting real seconds.
function typeWithTimestamp(input: HTMLInputElement, value: string, timeStamp: number) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  const ev = new Event('input', { bubbles: true });
  Object.defineProperty(ev, 'timeStamp', { value: timeStamp, configurable: true });
  fireEvent(input, ev);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('modeLabel (pure)', () => {
  // phase 12 added a third argument, length, so passage mode can report its length too
  // (D9) - every call below is updated to the new 3-arg signature.
  it('is "passage" for passage mode with length short, regardless of seconds', () => {
    expect(modeLabel('passage', 60, 'short')).toBe('passage');
    expect(modeLabel('passage', 15, 'short')).toBe('passage');
  });

  it('is "passage <length>" for passage mode at 100, 250 and 500 words', () => {
    expect(modeLabel('passage', 60, 100)).toBe('passage 100');
    expect(modeLabel('passage', 60, 250)).toBe('passage 250');
    expect(modeLabel('passage', 60, 500)).toBe('passage 500');
  });

  it('is "time <N>s" for time mode, at every selectable limit, regardless of length', () => {
    expect(modeLabel('time', 15, 'short')).toBe('time 15s');
    expect(modeLabel('time', 30, 'short')).toBe('time 30s');
    expect(modeLabel('time', 60, 'short')).toBe('time 60s');
    expect(modeLabel('time', 120, 'short')).toBe('time 120s');
    expect(modeLabel('time', 60, 500)).toBe('time 60s');
  });
});

describe('results screen mode label', () => {
  it('shows "passage" after a short passage-mode test', async () => {
    localStorage.clear();
    stubFetch();
    render(<App />);
    await screen.findByLabelText('Typing input');
    // Phase 12 changed the default mode to time - select passage explicitly.
    fireEvent.click(screen.getByRole('button', { name: 'passage' }));
    const input = screen.getByLabelText('Typing input') as HTMLInputElement;
    for (const ch of TEXT) fireEvent.input(input, { target: { value: ' ' + ch } });
    await screen.findByText('Keyboard heatmap');
    const modeStat = screen.getByText('mode').nextSibling;
    expect(modeStat?.textContent).toBe('passage');
  });

  it('shows "time 60s" after a time-mode test with a 60s limit', async () => {
    localStorage.clear();
    stubFetch();
    render(<App />);
    await screen.findByLabelText('Typing input');
    fireEvent.click(screen.getByRole('button', { name: 'time' }));
    fireEvent.click(screen.getByRole('button', { name: '60' }));
    // Switching mode remounts TypingTest (a fresh `key`), so the capture input must be
    // re-queried after the clicks above - the earlier reference would be a detached node.
    const input = screen.getByLabelText('Typing input') as HTMLInputElement;
    // Disable both timer-based deadline mechanisms - installed only now, after the async
    // findBy* queries above have already resolved, since React Testing Library's own
    // polling relies on a real window.setTimeout internally. From here on, only the
    // per-keystroke expire() check (driven by the scripted timestamps below) can end the
    // test - isolating it from real wall-clock time, the technique phase 9 established.
    vi.spyOn(window, 'setInterval').mockImplementation(() => 0 as unknown as ReturnType<typeof setInterval>);
    vi.spyOn(window, 'setTimeout').mockImplementation(() => 0 as unknown as ReturnType<typeof setTimeout>);
    const base = 1_000_000;
    typeWithTimestamp(input, ' t', base);
    typeWithTimestamp(input, ' h', base + 61_000); // well past the 60s deadline
    vi.restoreAllMocks();
    const modeStat = screen.getByText('mode').nextSibling;
    expect(modeStat?.textContent).toBe('time 60s');
  });
});
