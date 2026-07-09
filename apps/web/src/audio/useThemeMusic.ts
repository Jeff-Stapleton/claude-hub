/**
 * React binding for the theme music: a module-level singleton engine
 * (safe under StrictMode double-mount), localStorage persistence for
 * volume/mute, and autoplay-unlock fallback — browsers keep the
 * AudioContext suspended until the first user gesture, so if resume()
 * is blocked on load we retry on the first pointerdown/keydown anywhere.
 */

import { useCallback, useEffect, useState } from 'react';
import { ThemeMusicEngine } from './engine.js';
import { THEME_SCORE } from './score.js';

const STORAGE_KEY = 'claude-hub:music';

interface MusicSettings {
  readonly volume: number;
  readonly muted: boolean;
}

const DEFAULT_SETTINGS: MusicSettings = { volume: 0.5, muted: false };

function loadSettings(): MusicSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'volume' in parsed &&
      'muted' in parsed &&
      typeof parsed.volume === 'number' &&
      typeof parsed.muted === 'boolean' &&
      Number.isFinite(parsed.volume)
    ) {
      return { volume: Math.min(1, Math.max(0, parsed.volume)), muted: parsed.muted };
    }
  } catch {
    // Corrupt or unavailable storage — fall through to defaults.
  }
  return DEFAULT_SETTINGS;
}

function saveSettings(settings: MusicSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage full/unavailable — playback still works, just not persisted.
  }
}

let engineSingleton: ThemeMusicEngine | null = null;

function getEngine(): ThemeMusicEngine {
  if (!engineSingleton) {
    engineSingleton = new ThemeMusicEngine(THEME_SCORE);
    const settings = loadSettings();
    engineSingleton.setVolume(settings.volume);
    engineSingleton.setMuted(settings.muted);
  }
  return engineSingleton;
}

export interface ThemeMusic {
  readonly volume: number;
  readonly muted: boolean;
  /** True while the browser's autoplay policy is still blocking playback. */
  readonly blocked: boolean;
  setVolume(volume: number): void;
  toggleMuted(): void;
}

export function useThemeMusic(): ThemeMusic {
  const [settings, setSettings] = useState<MusicSettings>(loadSettings);
  const [blocked, setBlocked] = useState(true);

  useEffect(() => {
    const engine = getEngine();
    const sync = (): void => {
      const running = engine.contextState === 'running';
      setBlocked(!running);
      if (running) removeUnlockListeners();
    };
    const unlock = (): void => engine.start();
    const removeUnlockListeners = (): void => {
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
    };

    engine.onStateChange = sync;
    // Gesture fallback: any first interaction unlocks playback.
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
    engine.start();
    sync();

    return removeUnlockListeners;
  }, []);

  const setVolume = useCallback((volume: number): void => {
    // Dragging the slider is an explicit "I want to hear it" — unmute.
    const next: MusicSettings = { volume: Math.min(1, Math.max(0, volume)), muted: false };
    const engine = getEngine();
    engine.setVolume(next.volume);
    engine.setMuted(false);
    setSettings(next);
    saveSettings(next);
  }, []);

  const toggleMuted = useCallback((): void => {
    setSettings((prev) => {
      const next: MusicSettings = { volume: prev.volume, muted: !prev.muted };
      getEngine().setMuted(next.muted);
      saveSettings(next);
      return next;
    });
  }, []);

  return { volume: settings.volume, muted: settings.muted, blocked, setVolume, toggleMuted };
}
