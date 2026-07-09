import { useRef, useState } from 'react';
import { useThemeMusic } from './useThemeMusic.js';

/**
 * Corner audio control: a fixed pill in the bottom-right, above the
 * letterboxed stage. Hover or keyboard focus expands a volume slider
 * leftward; clicking the speaker toggles mute (slider position kept).
 * While autoplay is still blocked the icon renders dimmed, and the
 * click that would unlock playback does not also mute it.
 */
export function MusicControl(): JSX.Element {
  const { volume, muted, blocked, setVolume, toggleMuted } = useThemeMusic();
  const [open, setOpen] = useState(false);
  // Whether autoplay was still blocked when the click gesture began; the
  // capture-phase unlock listener flips `blocked` before onClick fires.
  const wasBlocked = useRef(false);

  const silent = muted || volume === 0;

  return (
    <div
      style={{ ...pill, ...(open ? pillOpen : {}) }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <div style={{ ...sliderWrap, ...(open ? sliderWrapOpen : {}) }}>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(volume * 100)}
          onChange={(e) => setVolume(Number(e.target.value) / 100)}
          style={slider}
          aria-label="Music volume"
          tabIndex={open ? 0 : -1}
        />
      </div>
      <button
        style={{ ...iconButton, color: open ? '#ffd28a' : '#c8a888', opacity: blocked ? 0.45 : 1 }}
        onPointerDown={() => {
          wasBlocked.current = blocked;
        }}
        onClick={() => {
          if (!wasBlocked.current) toggleMuted();
          wasBlocked.current = false;
        }}
        aria-pressed={muted}
        aria-label={muted ? 'Unmute music' : 'Mute music'}
        title={blocked ? 'Start music' : muted ? 'Unmute music' : 'Mute music'}
      >
        <SpeakerIcon silent={silent} />
      </button>
    </div>
  );
}

function SpeakerIcon({ silent }: { silent: boolean }): JSX.Element {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 9h4l5-4v14l-5-4H3z" fill="currentColor" stroke="none" />
      {silent ? (
        <>
          <line x1="15" y1="9" x2="21" y2="15" />
          <line x1="21" y1="9" x2="15" y2="15" />
        </>
      ) : (
        <>
          <path d="M15 9.5a3.5 3.5 0 0 1 0 5" />
          <path d="M17.5 7.5a7 7 0 0 1 0 9" />
        </>
      )}
    </svg>
  );
}

// ---------- styles ----------

const pill: React.CSSProperties = {
  position: 'fixed',
  right: 16,
  bottom: 16,
  zIndex: 10,
  display: 'flex',
  alignItems: 'center',
  background: '#1f1610',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: '#4a3624',
  borderRadius: 999,
  padding: '4px 6px',
  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.4)',
};

const pillOpen: React.CSSProperties = {
  borderColor: '#6a4e34',
};

const sliderWrap: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  width: 0,
  opacity: 0,
  overflow: 'hidden',
  // Neutralized automatically by the prefers-reduced-motion override in
  // index.html (transition-duration: 0.001ms !important).
  transition: 'width 150ms ease, opacity 150ms ease',
};

const sliderWrapOpen: React.CSSProperties = {
  width: 96,
  opacity: 1,
};

const slider: React.CSSProperties = {
  width: 88,
  margin: '0 4px',
  accentColor: '#ffd28a',
  cursor: 'pointer',
};

const iconButton: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  width: 28,
  height: 28,
  padding: 0,
  display: 'grid',
  placeItems: 'center',
  cursor: 'pointer',
};
