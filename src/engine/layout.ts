export const ROWS = ['qwertyuiop', 'asdfghjkl;', 'zxcvbnm,./'] as const;

export type Finger =
  | 'L-pinky'
  | 'L-ring'
  | 'L-middle'
  | 'L-index'
  | 'R-index'
  | 'R-middle'
  | 'R-ring'
  | 'R-pinky'
  | 'thumb';

export type Hand = 'L' | 'R';

// Shifted symbols map to the finger of their base key. The shift key itself is not modelled.
const FINGER_KEYS: Record<Exclude<Finger, 'thumb'>, string> = {
  'L-pinky': 'qaz!',
  'L-ring': 'wsx',
  'L-middle': 'edc',
  'L-index': 'rtfgvb',
  'R-index': 'yuhjnm',
  'R-middle': 'ik,',
  'R-ring': 'ol.(',
  'R-pinky': `p;/'")-:?`,
};

const FINGER_OF = new Map<string, Finger>();
for (const [finger, keys] of Object.entries(FINGER_KEYS)) {
  for (const k of keys) FINGER_OF.set(k, finger as Finger);
}

export function keyOf(ch: string): string {
  return ch.toLowerCase();
}

export function fingerOf(ch: string): Finger | null {
  const key = keyOf(ch);
  if (key === ' ') return 'thumb';
  return FINGER_OF.get(key) ?? null;
}

export function handOf(finger: Finger | null): Hand | null {
  if (!finger || finger === 'thumb') return null;
  return finger.startsWith('L') ? 'L' : 'R';
}

export function rowOf(ch: string): number | null {
  const key = keyOf(ch);
  const i = ROWS.findIndex((r) => r.includes(key));
  return i >= 0 ? i : null;
}

export type TransitionClass = 'none' | 'repeat' | 'space' | 'same-finger' | 'same-hand' | 'alt-hand' | 'other';

// The kind of finger movement between two presses. Latency depends heavily on this,
// so it is the baseline used to separate "hard movement" from "slow key".
export function transitionClass(prev: string, key: string): TransitionClass {
  if (keyOf(prev) === keyOf(key)) return 'repeat';
  const a = fingerOf(prev);
  const b = fingerOf(key);
  if (!a || !b) return 'other';
  if (a === 'thumb' || b === 'thumb') return 'space';
  if (a === b) return 'same-finger';
  return handOf(a) === handOf(b) ? 'same-hand' : 'alt-hand';
}
