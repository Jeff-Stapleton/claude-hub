import { describe, expect, it } from 'vitest';
import { midiToFreq } from './engine.js';
import { scoreTotalSteps, THEME_SCORE } from './score.js';

describe('midiToFreq', () => {
  it('maps A4 (69) to 440 Hz', () => {
    expect(midiToFreq(69)).toBeCloseTo(440);
  });

  it('maps octaves to frequency doublings', () => {
    expect(midiToFreq(81)).toBeCloseTo(880);
    expect(midiToFreq(57)).toBeCloseTo(220);
  });
});

describe('THEME_SCORE', () => {
  const totalSteps = scoreTotalSteps(THEME_SCORE);

  it('loops after roughly one minute', () => {
    const seconds = (totalSteps * 60) / THEME_SCORE.bpm / THEME_SCORE.stepsPerBeat;
    expect(seconds).toBeGreaterThan(55);
    expect(seconds).toBeLessThan(70);
  });

  it('keeps every note inside the loop', () => {
    for (const track of THEME_SCORE.tracks) {
      for (const [step, , lenSteps] of track.notes) {
        expect(step).toBeGreaterThanOrEqual(0);
        expect(step).toBeLessThan(totalSteps);
        expect(lenSteps).toBeGreaterThan(0);
        expect(step + lenSteps).toBeLessThanOrEqual(totalSteps);
      }
    }
  });

  it('keeps tonal notes in a sane MIDI range and velocities in 0..1', () => {
    for (const track of THEME_SCORE.tracks) {
      for (const [, midi, , vel] of track.notes) {
        if (track.channel !== 'noise') {
          expect(midi).toBeGreaterThanOrEqual(36); // C2
          expect(midi).toBeLessThanOrEqual(96); // C7
        }
        if (vel !== undefined) {
          expect(vel).toBeGreaterThan(0);
          expect(vel).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('has all four chiptune channels', () => {
    const channels = THEME_SCORE.tracks.map((t) => t.channel);
    expect(channels).toEqual(['pulse1', 'pulse2', 'triangle', 'noise']);
    for (const track of THEME_SCORE.tracks) {
      expect(track.notes.length).toBeGreaterThan(0);
    }
  });
});
