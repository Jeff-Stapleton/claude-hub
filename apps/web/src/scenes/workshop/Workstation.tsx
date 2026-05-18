import { useState, type ReactNode, type KeyboardEvent } from 'react';

/**
 * Generic SVG workstation hotspot. Wraps any visible children (boxes,
 * polygons, etc.) in a clickable, keyboard-accessible group. When the
 * user hovers or focuses, a warm drop-shadow glow outlines whatever the
 * children paint — works for both isometric floor volumes and flat
 * wall-mounted plaques.
 *
 * Hit detection is the natural pointer-events of the visible children;
 * SVG fills accept clicks by default, so anywhere on a painted face
 * activates the hotspot.
 */
export function Workstation({
  label,
  onActivate,
  children,
}: {
  label: string;
  onActivate: () => void;
  children: ReactNode;
}): JSX.Element {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const lit = hover || focus;

  const onKey = (e: KeyboardEvent<SVGGElement>): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onActivate();
    }
  };

  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={label}
      onClick={onActivate}
      onKeyDown={onKey}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      style={{
        cursor: 'pointer',
        outline: 'none',
        filter: lit
          ? 'drop-shadow(0 0 8px rgba(255, 210, 138, 0.75))'
          : 'none',
        transition: 'filter 150ms',
      }}
    >
      <title>{label}</title>
      {children}
    </g>
  );
}
