// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { App } from '../src/ui/App';
import { DIFFICULTY_HINT, modeHint } from '../src/ui/TypingTest';

const TEXT = 'the quick brown fox jumps over the lazy dog and keeps running past the hedge';
const index = { sources: [{ file: 'passages-x.json' }] };
const passages = { source: { title: 'T', author: 'A', year: 1900 }, passages: [{ id: 'x1', text: TEXT, difficulty: 'easy' }] };

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({ ok: true, status: 200, json: async () => (String(url).endsWith('index.json') ? index : passages) })),
  );
}

function hintText(): string {
  return document.querySelector('.mode-hint')!.textContent!;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('modeHint (pure)', () => {
  it('matches the exact D7 wording for time mode', () => {
    expect(modeHint('time', 60, 'short')).toBe('Type for 60 seconds. New text keeps coming until the clock reaches 0:00.');
    expect(modeHint('time', 30, 'short')).toBe('Type for 30 seconds. New text keeps coming until the clock reaches 0:00.');
  });

  it('matches the exact D7 wording for passage mode, short', () => {
    expect(modeHint('passage', 60, 'short')).toBe('Type one passage to the end. There is no time limit; your time is however long it takes.');
  });

  it('matches the exact D7 wording for passage mode, 100/250/500', () => {
    expect(modeHint('passage', 60, 100)).toBe('Type about 100 words to the end. There is no time limit; your time is however long it takes.');
    expect(modeHint('passage', 60, 250)).toBe('Type about 250 words to the end. There is no time limit; your time is however long it takes.');
    expect(modeHint('passage', 60, 500)).toBe('Type about 500 words to the end. There is no time limit; your time is however long it takes.');
  });
});

describe('difficulty hint wording (pure)', () => {
  it('is filled from what the corpus scoring function actually measures', () => {
    expect(DIFFICULTY_HINT).toMatch(/^Difficulty: easy, medium and hard are thirds of the library ranked by /);
    expect(DIFFICULTY_HINT).toMatch(/Mixed picks from all three\.$/);
  });
});

describe('pill groups and hint line in the real UI', () => {
  it('shows the seconds pills and time hint in time mode (the default); length pills are hidden', async () => {
    stubFetch();
    render(<App />);
    await screen.findByLabelText('Typing input');
    expect(screen.getByRole('button', { name: '60' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '250' })).toBeNull();
    expect(hintText()).toContain(modeHint('time', 60, 'short'));
  });

  it('switching to passage shows length pills and the passage hint; seconds pills hide; the passage box does not move', async () => {
    stubFetch();
    render(<App />);
    await screen.findByLabelText('Typing input');
    const passageBoxBefore = document.querySelector('.passage')!.getBoundingClientRect().top;
    fireEvent.click(screen.getByRole('button', { name: 'passage' }));
    expect(screen.queryByRole('button', { name: '60' })).toBeNull();
    expect(screen.getByRole('button', { name: '250' })).toBeTruthy();
    expect(hintText()).toContain(modeHint('passage', 60, 'short'));
    const passageBoxAfter = document.querySelector('.passage')!.getBoundingClientRect().top;
    expect(passageBoxAfter).toBe(passageBoxBefore);
  });

  it('selecting a passage length shows the matching hint', async () => {
    stubFetch();
    render(<App />);
    await screen.findByLabelText('Typing input');
    fireEvent.click(screen.getByRole('button', { name: 'passage' }));
    fireEvent.click(screen.getByRole('button', { name: '250' }));
    expect(hintText()).toContain(modeHint('passage', 60, 250));
  });

  it('the difficulty pill shows "mixed" but stores "all"', async () => {
    stubFetch();
    render(<App />);
    await screen.findByLabelText('Typing input');
    const mixedPill = screen.getByRole('button', { name: 'mixed' });
    expect(mixedPill).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'all' })).toBeNull();
    fireEvent.click(mixedPill);
    expect(JSON.parse(localStorage.getItem('keystory:v1')!).prefs.difficulty).toBe('all');
  });

  it('the difficulty hint is present in the hint line, and the four difficulty pills plus the two mode pills have title attributes', async () => {
    stubFetch();
    render(<App />);
    await screen.findByLabelText('Typing input');
    expect(hintText()).toContain(DIFFICULTY_HINT);
    for (const name of ['mixed', 'easy', 'medium', 'hard']) {
      const pill = screen.getByRole('button', { name });
      expect(pill.getAttribute('title')).toBeTruthy();
    }
    for (const name of ['passage', 'time']) {
      const pill = screen.getByRole('button', { name });
      expect(pill.getAttribute('title')).toBeTruthy();
    }
  });

  it('the hint line reflects a changed seconds value within time mode', async () => {
    stubFetch();
    render(<App />);
    await screen.findByLabelText('Typing input');
    fireEvent.click(screen.getByRole('button', { name: '30' }));
    expect(hintText()).toContain(modeHint('time', 30, 'short'));
  });
});
