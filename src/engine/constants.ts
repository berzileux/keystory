// Starting defaults chosen for a usable first version. They are not statistically
// derived; tune them against real sessions.

// Fewer samples than this and a key is shown as "no usable data".
export const MIN_SAMPLES_SHOWN = 3;
// Below this a key is shown, but marked provisional.
export const MIN_SAMPLES_SOLID = 10;

export const TESTS_FOR_FINGERS = 5;
export const TESTS_FOR_KEYS = 10;

// Gaps longer than this are pauses, not typing speed.
export const LATENCY_CAP_MS = 2000;

// A transition class needs this many timed presses before it is used to adjust latency.
export const MIN_CLASS_SAMPLES = 20;
