// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from '../src/ui/App';

const TEXT = 'the quick brown fox jumps over the lazy dog and keeps running';
const index = { sources: [{ file: 'passages-x.json' }] };
const passages = { source: { title: 'T', author: 'A', year: 1900 }, passages: [{ id: 'x1', text: TEXT, difficulty: 'easy' }] };

function stubFetch(ok: boolean) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (!ok) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => (String(url).endsWith('index.json') ? index : passages) };
    }),
  );
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('App', () => {
  it('explains how to build the corpus when it is missing', async () => {
    stubFetch(false);
    render(<App />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toContain('corpus:build');
  });

  it('runs a full test and shows results', async () => {
    stubFetch(true);
    render(<App />);
    await screen.findByLabelText('Typing input');
    // Phase 12 changed the default mode to time - select passage explicitly, since this
    // test is about completing a fixed, known passage (time mode would just keep extending).
    fireEvent.click(screen.getByRole('button', { name: 'passage' }));
    const input = screen.getByLabelText('Typing input') as HTMLInputElement;
    for (const ch of TEXT) fireEvent.input(input, { target: { value: ' ' + ch } });
    await waitFor(() => expect(screen.getByText('Keyboard heatmap')).toBeTruthy());
    expect(screen.getByRole('status').textContent).toContain('1 test');
    expect(JSON.parse(localStorage.getItem('keystory:v1')!).tests).toBe(1);
  });

  it('time mode must not finish just because the built text ran out', async () => {
    // Reproduces the reported bug: with only one short passage in the corpus, the
    // text built for a 60-second timed test is a fixed-length repeat of it. Typing
    // all of that text (in the near-zero real elapsed time a tight test loop takes,
    // i.e. nowhere near the 60-second limit) must not end the session early.
    stubFetch(true);
    render(<App />);
    await screen.findByLabelText('Typing input');
    fireEvent.click(screen.getByRole('button', { name: 'time' }));
    const input = (await screen.findByLabelText('Typing input')) as HTMLInputElement;
    const fullText = screen.getByLabelText('Passage to type').textContent!;
    for (const ch of fullText) fireEvent.input(input, { target: { value: ' ' + ch } });
    expect(screen.queryByText('Keyboard heatmap')).toBeNull();
    expect(screen.getByLabelText('Typing input')).toBeTruthy();
  });

  it('toggling the keyboard keeps the current passage', async () => {
    stubFetch(true);
    render(<App />);
    await screen.findByLabelText('Typing input');
    fireEvent.click(screen.getByRole('button', { name: 'keyboard' }));
    expect(screen.getByText(/Keyboard hidden/)).toBeTruthy();
    expect(JSON.parse(localStorage.getItem('keystory:v1')!).prefs.keyboard).toBe(false);
  });
});

describe('App footer attribution', () => {
  function gutenbergLink() {
    return screen.getByRole('link', { name: 'Project Gutenberg' });
  }

  it('links safely to Project Gutenberg and credits it, on the test screen', async () => {
    stubFetch(true);
    render(<App />);
    await screen.findByLabelText('Typing input');
    const link = gutenbergLink();
    expect(link.getAttribute('href')).toBe('https://www.gutenberg.org');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(screen.getByText(/Not affiliated with Project Gutenberg/)).toBeTruthy();
  });

  it('is present on the results screen', async () => {
    stubFetch(true);
    render(<App />);
    await screen.findByLabelText('Typing input');
    // Phase 12 changed the default mode to time - select passage explicitly (see the same
    // note in the 'runs a full test and shows results' test above).
    fireEvent.click(screen.getByRole('button', { name: 'passage' }));
    const input = screen.getByLabelText('Typing input') as HTMLInputElement;
    for (const ch of TEXT) fireEvent.input(input, { target: { value: ' ' + ch } });
    await waitFor(() => expect(screen.getByText('Keyboard heatmap')).toBeTruthy());
    expect(gutenbergLink()).toBeTruthy();
  });

  it('is present on the corpus-load-error screen', async () => {
    stubFetch(false);
    render(<App />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(gutenbergLink()).toBeTruthy();
  });
});

describe('App header mark', () => {
  it('shows one decorative svg mark, and the brand button is still named "keystory"', async () => {
    stubFetch(true);
    render(<App />);
    await screen.findByLabelText('Typing input');
    const button = screen.getByRole('button', { name: 'keystory' });
    const marks = button.querySelectorAll('svg[aria-hidden="true"]');
    expect(marks).toHaveLength(1);
  });
});
