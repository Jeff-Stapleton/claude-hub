/**
 * Framework-agnostic chiptune playback engine. Synthesizes a Score live
 * with Web Audio oscillators: duty-cycle pulse waves (the NES sound) for
 * melody/arpeggio, a triangle for bass, filtered white noise for drums.
 *
 * Scheduling is the standard lookahead pattern ("a tale of two clocks"):
 * a coarse setInterval walks a monotonically increasing step counter and
 * schedules every event due within the lookahead window on the sample-
 * accurate audio clock. The step index never wraps — the modulo only
 * selects which events play — so the loop is seamless by construction.
 *
 * The constructor never touches AudioContext (unit-testable); the context
 * is created lazily in start(), which is idempotent and safe to call from
 * autoplay-unlock gesture handlers.
 */

import type { NoteEvent, Score, Track } from './score.js';
import { DRUM_HAT, scoreTotalSteps } from './score.js';

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

interface ScheduledNote {
  readonly channel: Track['channel'];
  readonly duty: number;
  readonly gain: number;
  readonly midi: number;
  readonly lenSteps: number;
  readonly vel: number;
}

const TICK_MS = 50;
const LOOKAHEAD_S = 0.3;
/** Hidden tabs throttle timers to >=1s; schedule far ahead when hiding. */
const HIDDEN_LOOKAHEAD_S = 2.5;
/** Gain-change smoothing to avoid clicks on mute/volume. */
const SMOOTH_S = 0.03;

export type EngineState = 'unstarted' | 'suspended' | 'running';

export class ThemeMusicEngine {
  private readonly eventsByStep = new Map<number, ScheduledNote[]>();
  private readonly totalSteps: number;
  private readonly secondsPerStep: number;

  private ctx: AudioContext | null = null;
  private volumeGain: GainNode | null = null;
  private muteGain: GainNode | null = null;
  private readonly waves = new Map<number, PeriodicWave>();
  private noiseBuffer: AudioBuffer | null = null;

  /** Audio-clock time of step 0; set once the context first runs. */
  private startTime: number | null = null;
  private nextStep = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  private desiredVolume = 0.5;
  private desiredMuted = false;

  /** Fired whenever contextState may have changed. */
  onStateChange: (() => void) | undefined;

  constructor(score: Score) {
    this.totalSteps = scoreTotalSteps(score);
    this.secondsPerStep = 60 / score.bpm / score.stepsPerBeat;
    for (const track of score.tracks) {
      for (const note of track.notes) {
        this.addEvent(track, note);
      }
    }
  }

  private addEvent(track: Track, [step, midi, lenSteps, vel]: NoteEvent): void {
    const event: ScheduledNote = {
      channel: track.channel,
      duty: track.duty ?? 0.5,
      gain: track.gain,
      midi,
      lenSteps,
      vel: vel ?? 1,
    };
    const bucket = this.eventsByStep.get(step);
    if (bucket) bucket.push(event);
    else this.eventsByStep.set(step, [event]);
  }

  get contextState(): EngineState {
    if (!this.ctx) return 'unstarted';
    return this.ctx.state === 'running' ? 'running' : 'suspended';
  }

  /** Create the context if needed and try to (re)start playback. */
  start(): void {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.buildGraph(this.ctx);
      this.ctx.onstatechange = () => {
        this.onRunning();
        this.onStateChange?.();
      };
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) this.tick(HIDDEN_LOOKAHEAD_S);
      });
    }
    if (this.ctx.state !== 'running') {
      void this.ctx.resume().then(() => {
        this.onRunning();
        this.onStateChange?.();
      });
    } else {
      this.onRunning();
    }
  }

  setVolume(volume: number): void {
    this.desiredVolume = Math.min(1, Math.max(0, volume));
    if (this.ctx && this.volumeGain) {
      // Squared for a perceptual taper.
      this.volumeGain.gain.setTargetAtTime(
        this.desiredVolume * this.desiredVolume,
        this.ctx.currentTime,
        SMOOTH_S,
      );
    }
  }

  setMuted(muted: boolean): void {
    this.desiredMuted = muted;
    if (this.ctx && this.muteGain) {
      this.muteGain.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, SMOOTH_S);
    }
  }

  // ---------- internals ----------

  private buildGraph(ctx: AudioContext): void {
    this.volumeGain = ctx.createGain();
    this.volumeGain.gain.value = this.desiredVolume * this.desiredVolume;
    this.muteGain = ctx.createGain();
    this.muteGain.gain.value = this.desiredMuted ? 0 : 1;
    this.volumeGain.connect(this.muteGain);
    this.muteGain.connect(ctx.destination);

    // 1s of white noise, reused for every drum hit at a random offset.
    const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = noise;
  }

  /** Anchor the song clock and start the scheduler once actually running. */
  private onRunning(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || this.startTime !== null) return;
    this.startTime = ctx.currentTime + 0.1;
    this.nextStep = 0;
    this.timer = setInterval(() => this.tick(LOOKAHEAD_S), TICK_MS);
    this.tick(LOOKAHEAD_S);
  }

  private stepTime(step: number): number {
    return (this.startTime ?? 0) + step * this.secondsPerStep;
  }

  private tick(lookahead: number): void {
    const ctx = this.ctx;
    if (!ctx || this.startTime === null) return;
    while (this.stepTime(this.nextStep) < ctx.currentTime + lookahead) {
      const events = this.eventsByStep.get(this.nextStep % this.totalSteps);
      if (events) {
        const when = this.stepTime(this.nextStep);
        for (const event of events) this.scheduleNote(event, when);
      }
      this.nextStep++;
    }
  }

  private scheduleNote(note: ScheduledNote, when: number): void {
    if (note.channel === 'noise') this.scheduleDrum(note, when);
    else this.scheduleTone(note, when);
  }

  private scheduleTone(note: ScheduledNote, when: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.volumeGain) return;

    const osc = ctx.createOscillator();
    if (note.channel === 'triangle') osc.type = 'triangle';
    else osc.setPeriodicWave(this.pulseWave(ctx, note.duty));
    osc.frequency.value = midiToFreq(note.midi);

    const peak = note.gain * note.vel;
    const holdEnd = when + note.lenSteps * this.secondsPerStep - 0.02;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(peak, when + 0.005);
    env.gain.linearRampToValueAtTime(peak * 0.75, when + 0.08);
    env.gain.setValueAtTime(peak * 0.75, Math.max(when + 0.08, holdEnd));
    env.gain.setTargetAtTime(0, Math.max(when + 0.08, holdEnd), SMOOTH_S);

    osc.connect(env);
    env.connect(this.volumeGain);
    osc.start(when);
    osc.stop(holdEnd + 0.25);
    osc.onended = () => {
      osc.disconnect();
      env.disconnect();
    };
  }

  private scheduleDrum(note: ScheduledNote, when: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.volumeGain || !this.noiseBuffer) return;

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const filter = ctx.createBiquadFilter();
    if (note.midi === DRUM_HAT) {
      filter.type = 'highpass';
      filter.frequency.value = 6000;
    } else {
      filter.type = 'bandpass';
      filter.frequency.value = 2000;
      filter.Q.value = 1;
    }

    const peak = note.gain * note.vel;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(peak, when + 0.002);
    env.gain.setTargetAtTime(0, when + 0.005, 0.02);

    src.connect(filter);
    filter.connect(env);
    env.connect(this.volumeGain);
    const offset = Math.random() * (this.noiseBuffer.duration - 0.2);
    src.start(when, offset, 0.15);
    src.onended = () => {
      src.disconnect();
      filter.disconnect();
      env.disconnect();
    };
  }

  /** Band-limited pulse wave for a given duty cycle, built once per duty. */
  private pulseWave(ctx: AudioContext, duty: number): PeriodicWave {
    const cached = this.waves.get(duty);
    if (cached) return cached;
    const HARMONICS = 32;
    const real = new Float32Array(HARMONICS + 1);
    const imag = new Float32Array(HARMONICS + 1);
    for (let n = 1; n <= HARMONICS; n++) {
      // Fourier coefficients of a rectangular pulse; |sin(nπd)| weighting
      // is what gives each duty cycle its characteristic timbre.
      real[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * duty);
    }
    const wave = ctx.createPeriodicWave(real, imag);
    this.waves.set(duty, wave);
    return wave;
  }
}
