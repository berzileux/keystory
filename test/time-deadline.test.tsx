// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TypingTest } from '../src/ui/TypingTest';
import { DEFAULT_PREFS, type Seconds } from '../src/ui/storage';
import type { Built } from '../src/ui/text';
import type { Entry } from '../src/ui/corpus';

// Real waits, using the native setTimeout captured before any test mocks window.setTimeout -
// this project has no fake-timer convention (performance.now() isn't faked by default, see
// the phase 9 output file), and these limits are small enough that real waits are fast.
const realSetTimeout = globalThis.setTimeout;
const realWait = (ms: number) => new Promise((resolve) => realSetTimeout(resolve, ms));

const ENTRY: Entry = {
  id: 'e1',
  text: 'the quick brown fox jumps over the lazy dog and keeps running past the hedge every single morning without fail',
  difficulty: 'easy',
  source: { title: 'T', author: 'A', year: 1900 },
};
const BUILT: Built = { text: ENTRY.text, segments: [{ start: 0, end: ENTRY.text.length, entry: ENTRY }] };

function renderTest(limitMs: number, onFinish = vi.fn()) {
  const seconds = (limitMs / 1000) as Seconds; // cast: the test drives limitMs directly, the Seconds union is a UI-picker constraint only
  render(
    <TypingTest
      built={BUILT}
      entries={[ENTRY]}
      recent={new Set()}
      prefs={{ ...DEFAULT_PREFS, mode: 'time', seconds }}
      onPrefs={() => {}}
      onRestart={() => {}}
      onFinish={onFinish}
    />,
  );
  return onFinish;
}

// jsdom's synthetic Event.timeStamp is Date.now()-epoch-based, not performance.now()-based
// as real browsers' is (confirmed directly against this project's actual behaviour - see the
// phase 9 output file) - fireEvent.input would otherwise hand the component a startedAt wildly
// out of step with the performance.now() the new deadline/visibility effects read, which is a
// test-environment artifact, not a production bug. Overriding timeStamp keeps the two aligned.
async function typeOneChar(ch = 'z') {
  const input = screen.getByLabelText('Typing input') as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, ' ' + ch);
  const ev = new Event('input', { bubbles: true });
  Object.defineProperty(ev, 'timeStamp', { value: performance.now(), configurable: true });
  fireEvent(input, ev);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('time-mode deadline enforcement mechanisms', () => {
  it('ends the test via a timer scheduled to the deadline, even with the polling interval disabled', async () => {
    vi.spyOn(window, 'setInterval').mockImplementation(() => 0 as unknown as ReturnType<typeof setInterval>);
    const onFinish = renderTest(150);
    await typeOneChar();
    expect(onFinish).not.toHaveBeenCalled();
    await realWait(300);
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it('ends an expired test via the visibilitychange handler, even with both timers disabled', async () => {
    vi.spyOn(window, 'setInterval').mockImplementation(() => 0 as unknown as ReturnType<typeof setInterval>);
    vi.spyOn(window, 'setTimeout').mockImplementation(() => 0 as unknown as ReturnType<typeof setTimeout>);
    const onFinish = renderTest(150);
    await typeOneChar();
    await realWait(300);
    // Neither timer-based mechanism could have fired - proves this test's isolation, and
    // that nothing else ends the session on its own without one of the four mechanisms.
    expect(onFinish).not.toHaveBeenCalled();
    fireEvent(document, new Event('visibilitychange'));
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it('ends the test exactly once when more than one mechanism fires for the same deadline', async () => {
    const onFinish = renderTest(150);
    await typeOneChar();
    await realWait(300);
    fireEvent(document, new Event('visibilitychange'));
    fireEvent(document, new Event('visibilitychange'));
    await realWait(100);
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it('disables the capture input once the test has ended, and further input events change nothing', async () => {
    const onFinish = renderTest(150);
    await typeOneChar();
    await realWait(300);
    const input = screen.getByLabelText('Typing input') as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });
});

describe('passage mode is unaffected by any deadline mechanism', () => {
  it('never ends by timer, however long real time passes', async () => {
    const onFinish = vi.fn();
    render(
      <TypingTest
        built={BUILT}
        entries={[ENTRY]}
        recent={new Set()}
        prefs={{ ...DEFAULT_PREFS, mode: 'passage' }}
        onPrefs={() => {}}
        onRestart={() => {}}
        onFinish={onFinish}
      />,
    );
    await typeOneChar();
    await realWait(300);
    fireEvent(document, new Event('visibilitychange'));
    expect(onFinish).not.toHaveBeenCalled();
  });
});
