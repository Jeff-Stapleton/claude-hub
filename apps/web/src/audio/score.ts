/**
 * The workshop theme, as data. A ~63s looping chiptune in F major:
 * 92 BPM, 4/4, 16th-note grid, 24 bars (384 steps). Form A A' B with a
 * V7 turnaround in the final bar so the loop seam lands on a phrase
 * boundary and resolves back to the tonic at step 0.
 *
 * Pure data — no DOM or Web Audio imports, so vitest can lint the score.
 */

export type ChannelName = 'pulse1' | 'pulse2' | 'triangle' | 'noise';

/** [step, midi, lengthInSteps, velocity?]. For the noise channel the midi
 * slot is a drum type instead: 0 = hi-hat, 1 = tick. */
export type NoteEvent = readonly [step: number, midi: number, lenSteps: number, vel?: number];

export interface Track {
  readonly channel: ChannelName;
  /** Pulse duty cycle; only meaningful for pulse channels. */
  readonly duty?: 0.125 | 0.25;
  /** Mix level for the whole track (0..1). */
  readonly gain: number;
  readonly notes: readonly NoteEvent[];
}

export interface Score {
  readonly bpm: number;
  readonly stepsPerBeat: number;
  readonly beatsPerBar: number;
  readonly bars: number;
  readonly tracks: readonly Track[];
}

export const DRUM_HAT = 0;
export const DRUM_TICK = 1;

export function scoreTotalSteps(score: Score): number {
  return score.bars * score.beatsPerBar * score.stepsPerBeat;
}

// ---------- note names ----------

const N = {
  F2: 41, G2: 43, A2: 45, Bb2: 46, C3: 48, D3: 50, E3: 52,
  F3: 53, G3: 55, A3: 57, Bb3: 58,
  C4: 60, D4: 62, E4: 64, F4: 65, G4: 67, A4: 69, Bb4: 70, B4: 71,
  C5: 72, D5: 74, E5: 76, F5: 77, G5: 79, A5: 81, Bb5: 82, C6: 84,
} as const;

const STEPS_PER_BAR = 16;

/** Offset a bar's worth of bar-relative events to absolute steps. */
function bar(barIdx: number, notes: readonly NoteEvent[]): NoteEvent[] {
  const o = barIdx * STEPS_PER_BAR;
  return notes.map(([s, m, l, v]): NoteEvent => (v === undefined ? [s + o, m, l] : [s + o, m, l, v]));
}

// ---------- harmony ----------

type Chord = 'F' | 'Dm' | 'Bb' | 'C' | 'Am' | 'Gm' | 'C7';

/** One chord per bar. A (I–vi–IV–V ×2), A' (same), B (IV–V–iii–vi, ii–IV–V7–V7). */
const CHORDS: readonly Chord[] = [
  'F', 'Dm', 'Bb', 'C', 'F', 'Dm', 'Bb', 'C',
  'F', 'Dm', 'Bb', 'C', 'F', 'Dm', 'Bb', 'C',
  'Bb', 'C', 'Am', 'Dm', 'Gm', 'Bb', 'C7', 'C7',
];

// ---------- melody (pulse1) ----------

// A phrase 1 (bars 0–3): opens on the 3rd, drifts down to the tonic.
const MEL_A1: readonly (readonly NoteEvent[])[] = [
  [[0, N.A4, 3], [3, N.G4, 1], [4, N.F4, 4], [8, N.C5, 4], [12, N.A4, 4]],
  [[0, N.D5, 3], [3, N.C5, 1], [4, N.A4, 6], [10, N.F4, 2], [12, N.G4, 2], [14, N.A4, 2]],
  [[0, N.Bb4, 3], [3, N.C5, 1], [4, N.D5, 4], [8, N.F5, 4], [12, N.D5, 2], [14, N.C5, 2]],
  [[0, N.C5, 10], [10, N.G4, 2], [12, N.A4, 2], [14, N.B4, 2]], // B natural: leading-tone sparkle
];

// A phrase 2 (bars 4–7): answers higher, settles on the dominant.
const MEL_A2: readonly (readonly NoteEvent[])[] = [
  [[0, N.C5, 3], [3, N.A4, 1], [4, N.F4, 4], [8, N.A4, 2], [10, N.C5, 6]],
  [[0, N.D5, 4], [4, N.E5, 2], [6, N.F5, 6], [12, N.E5, 2], [14, N.D5, 2]],
  [[0, N.C5, 3], [3, N.Bb4, 1], [4, N.A4, 4], [8, N.G4, 4], [12, N.Bb4, 4]],
  [[0, N.A4, 3], [3, N.G4, 1], [4, N.E4, 4], [8, N.G4, 8]],
];

// A' variation (bars 12–15): closes the section, 7th over V leads into B.
const MEL_A3: readonly (readonly NoteEvent[])[] = [
  [[0, N.C5, 3], [3, N.A4, 1], [4, N.F4, 4], [8, N.A4, 2], [10, N.C5, 6]],
  [[0, N.D5, 4], [4, N.C5, 2], [6, N.A4, 6], [12, N.G4, 2], [14, N.A4, 2]],
  [[0, N.G4, 3], [3, N.A4, 1], [4, N.Bb4, 4], [8, N.C5, 4], [12, N.D5, 4]],
  [[0, N.C5, 10], [10, N.G4, 2], [12, N.A4, 2], [14, N.Bb4, 2]],
];

// Bar 11 (A' fourth bar): reaches for the high G before the closing phrase.
const MEL_A1_VAR: readonly NoteEvent[] =
  [[0, N.E5, 3], [3, N.D5, 1], [4, N.C5, 4], [8, N.G5, 4], [12, N.E5, 2], [14, N.D5, 2]];

// B section (bars 16–23): lyrical contrast up high, turnaround home.
const MEL_B: readonly (readonly NoteEvent[])[] = [
  [[0, N.D5, 6], [6, N.C5, 2], [8, N.Bb4, 4], [12, N.F5, 4]],
  [[0, N.E5, 6], [6, N.D5, 2], [8, N.C5, 4], [12, N.G5, 4]],
  [[0, N.E5, 4], [4, N.C5, 2], [6, N.A4, 6], [12, N.B4, 2], [14, N.C5, 2]],
  [[0, N.D5, 6], [6, N.E5, 2], [8, N.F5, 8]],
  [[0, N.G5, 3], [3, N.F5, 1], [4, N.D5, 4], [8, N.Bb4, 4], [12, N.D5, 4]],
  [[0, N.C5, 4], [4, N.D5, 2], [6, N.F5, 6], [12, N.D5, 2], [14, N.C5, 2]],
  [[0, N.E5, 3], [3, N.D5, 1], [4, N.C5, 4], [8, N.Bb4, 4], [12, N.A4, 4]],
  [[0, N.G4, 4], [4, N.A4, 2], [6, N.Bb4, 2], [8, N.C5, 6], [14, N.G4, 2]],
];

const MELODY_BARS: readonly (readonly NoteEvent[])[] = [
  ...MEL_A1, ...MEL_A2,
  MEL_A1[0]!, MEL_A1[1]!, MEL_A1[2]!, MEL_A1_VAR,
  ...MEL_A3,
  ...MEL_B,
];

const melodyNotes: NoteEvent[] = MELODY_BARS.flatMap((notes, i) => bar(i, notes));

// ---------- arpeggio (pulse2) ----------

// Broken chord tones on the off-beat 8ths, one octave under the melody.
const ARP: Record<Chord, readonly [number, number, number, number]> = {
  F: [N.C4, N.F4, N.A4, N.F4],
  Dm: [N.D4, N.F4, N.A4, N.F4],
  Bb: [N.Bb3, N.D4, N.F4, N.D4],
  C: [N.C4, N.E4, N.G4, N.E4],
  Am: [N.A3, N.C4, N.E4, N.C4],
  Gm: [N.Bb3, N.D4, N.G4, N.D4],
  C7: [N.C4, N.E4, N.Bb4, N.G4],
};

// Enters at bar 2 so each loop pass gets a gentle two-bar open.
const arpNotes: NoteEvent[] = CHORDS.flatMap((chord, b) => {
  if (b < 2) return [];
  const [n1, n2, n3, n4] = ARP[chord];
  return bar(b, [[2, n1, 2, 0.9], [6, n2, 2, 0.9], [10, n3, 2, 0.9], [14, n4, 2, 0.9]]);
});

// ---------- bass (triangle) ----------

const BASS: Record<Chord, readonly [root: number, fifth: number]> = {
  F: [N.F2, N.C3],
  Dm: [N.D3, N.A2],
  Bb: [N.Bb2, N.F2],
  C: [N.C3, N.G2],
  Am: [N.A2, N.E3],
  Gm: [N.G2, N.D3],
  C7: [N.C3, N.G2],
};

// Section-final bars get a quarter-note walk into the next downbeat.
const BASS_WALKS: ReadonlyMap<number, readonly NoteEvent[]> = new Map([
  [7, [[0, N.C3, 4], [4, N.G2, 4], [8, N.A2, 4], [12, N.Bb2, 2], [14, N.C3, 2]]],
  [15, [[0, N.C3, 4], [4, N.G2, 4], [8, N.E3, 4], [12, N.G2, 2], [14, N.A2, 2]]],
  [23, [[0, N.C3, 4], [4, N.E3, 4], [8, N.G2, 4], [12, N.Bb2, 2], [14, N.C3, 2]]],
]);

const bassNotes: NoteEvent[] = CHORDS.flatMap((chord, b) => {
  const walk = BASS_WALKS.get(b);
  if (walk) return bar(b, walk);
  const [root, fifth] = BASS[chord];
  return bar(b, [[0, root, 7], [8, fifth, 7]]);
});

// ---------- percussion (noise) ----------

// Hats join at bar 4, soft ticks on beats 2/4 from bar 8 — a slow build
// that keeps the opening of every loop pass calm.
const noiseNotes: NoteEvent[] = [];
for (let b = 4; b < CHORDS.length; b++) {
  for (const s of [2, 6, 10, 14]) noiseNotes.push([b * STEPS_PER_BAR + s, DRUM_HAT, 1, 0.5]);
  if (b >= 8) {
    for (const s of [4, 12]) noiseNotes.push([b * STEPS_PER_BAR + s, DRUM_TICK, 1, 0.7]);
  }
}

// ---------- the score ----------

export const THEME_SCORE: Score = {
  bpm: 92,
  stepsPerBeat: 4,
  beatsPerBar: 4,
  bars: 24,
  tracks: [
    { channel: 'pulse1', duty: 0.25, gain: 0.22, notes: melodyNotes },
    { channel: 'pulse2', duty: 0.125, gain: 0.1, notes: arpNotes },
    { channel: 'triangle', gain: 0.28, notes: bassNotes },
    { channel: 'noise', gain: 0.05, notes: noiseNotes },
  ],
};
