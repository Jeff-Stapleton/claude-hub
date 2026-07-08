import type { KeyboardEvent } from 'react';
import { iso, poly } from '../iso.js';
import { SLOT_D } from './layout.js';

/**
 * Invisible hover hit-zone over one open belt run (the gap between two
 * machines, or before the first / after the last). Hovering it makes the
 * lane preview a ghost machine in the gap; clicking (or Enter/Space — the
 * zones are tabbable, and a tap activates directly on touch) opens the
 * add-machine panel with this gap's insertion index.
 *
 * A flat quad at z≈0.02 with fill="transparent" (not "none" — the quad
 * must receive pointer events). Rendered at layer 1 so machines and item
 * boxes painted later win pointer hits where they overlap on screen.
 */
export function GapZone({
  x0,
  x1,
  y,
  label,
  onHoverChange,
  onActivate,
}: {
  x0: number;
  x1: number;
  /** Lane-local machine-band front edge (laneY + SLOT_LOCAL_Y). */
  y: number;
  label: string;
  onHoverChange: (hovering: boolean) => void;
  onActivate: () => void;
}): JSX.Element {
  const quad = [
    iso(x0, y, 0.02),
    iso(x1, y, 0.02),
    iso(x1, y + SLOT_D, 0.02),
    iso(x0, y + SLOT_D, 0.02),
  ];
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
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
      onFocus={() => onHoverChange(true)}
      onBlur={() => onHoverChange(false)}
      style={{ cursor: 'copy', outline: 'none' }}
    >
      <title>{label}</title>
      <polygon points={poly(...quad)} fill="transparent" />
    </g>
  );
}
