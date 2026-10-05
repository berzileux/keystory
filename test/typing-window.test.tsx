// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { App } from '../src/ui/App';
import { WINDOW_AHEAD, WINDOW_BEHIND, WINDOW_STEP } from '../src/ui/window';

// A 1,000-word passage, well beyond the window's maximum size, so the windowing behaviour
// is actually exercised (not just trivially satisfied by a short stub passage).
const WORDS = Array.from({ length: 1000 }, (_, i) => `word${i}`);
const LONG_TEXT = `${WORDS.join(' ')}.`;
const index = { sources: [{ file: 'passages-long.json' }] };
const passages = {
  source: { title: 'Long Book', author: 'Author', year: 1900 },
  passages: [{ id: 'long-0000', text: LONG_TEXT, difficulty: 'easy' }],
};

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () => (String(url).endsWith('index.json') ? index : passages),
    })),
  );
}

function typeInto(input: HTMLInputElement, chars: string) {
  for (const ch of chars) fireEvent.input(input, { target: { value: ' ' + ch } });
}

function backspaceTimes(input: HTMLInputElement, n: number) {
  for (let i = 0; i < n; i++) fireEvent.input(input, { target: { value: '' } });
}

function renderedWordCount(): number {
  return screen
    .getByLabelText('Passage to type')
    .textContent!.split(/\s+/)
    .filter(Boolean).length;
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('windowed passage rendering', () => {
  it('renders fewer words than the full passage while typing, with the cursor always in the DOM', async () => {
    stubFetch();
    render(<App />);
    const input = (await screen.findByLabelText('Typing input')) as HTMLInputElement;
    typeInto(input, LONG_TEXT.slice(0, 200));
    expect(renderedWordCount()).toBeLessThan(1000);
    expect(document.querySelector('[data-cur]')).toBeTruthy();
  });

  it('never renders more words than the window maximum, even deep into a long passage', async () => {
    stubFetch();
    render(<App />);
    const input = (await screen.findByLabelText('Typing input')) as HTMLInputElement;
    typeInto(input, LONG_TEXT.slice(0, 500));
    expect(renderedWordCount()).toBeLessThanOrEqual(WINDOW_BEHIND + WINDOW_STEP + WINDOW_AHEAD);
  });

  it('backspacing across a step boundary keeps the cursor in the DOM and does not throw', async () => {
    stubFetch();
    render(<App />);
    const input = (await screen.findByLabelText('Typing input')) as HTMLInputElement;
    // Type past more than one WINDOW_STEP worth of words, then back up across that boundary.
    typeInto(input, LONG_TEXT.slice(0, 300));
    expect(() => backspaceTimes(input, 100)).not.toThrow();
    expect(document.querySelector('[data-cur]')).toBeTruthy();
  });
});
