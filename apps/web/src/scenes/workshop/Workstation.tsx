import { useState, type ReactNode, type KeyboardEvent } from 'react';

/**
 * Generic SVG workstation hotspot. Wraps visual children in a clickable,
 * keyboard-accessible group with a subtle hover/focus glow for
 * discoverability. The workshop is the only navigation in the app, so
 * every interactive zone uses this wrapper to look the same.
 *
 * Children render at the wrapper's local coordinates (no nested SVG —
 * we're inside the workshop's root <svg>).
 */
export function Workstation({
  x,
  y,
  width,
  height,
  label,
  onActivate,
  children,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  onActivate: () => void;
  children: ReactNode;
}): JSX.Element {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const highlighted = hover || focus;

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
      style={{ cursor: 'pointer', outline: 'none' }}
    >
      <title>{label}</title>
      {/* Soft glow behind the workstation when hovered/focused. */}
      <rect
        x={x - 6}
        y={y - 6}
        width={width + 12}
        height={height + 12}
        rx={10}
        fill={highlighted ? 'rgba(232, 214, 176, 0.10)' : 'transparent'}
        stroke={highlighted ? 'rgba(232, 214, 176, 0.55)' : 'transparent'}
        strokeWidth={1.5}
        style={{ transition: 'fill 150ms, stroke 150ms' }}
      />
      {children}
      {/* Transparent hit target on top so the entire box is clickable
          even where the visual children leave gaps. */}
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill="transparent"
        pointerEvents="all"
      />
    </g>
  );
}
