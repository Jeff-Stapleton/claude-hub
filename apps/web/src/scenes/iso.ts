/**
 * Isometric projection helpers for the workshop scene.
 *
 * World axes: +X goes back-right (toward back-right wall), +Y goes
 * back-left (toward back-left wall), +Z goes up. The viewer is implicitly
 * at the front-bottom corner looking into the +X+Y+Z octant.
 *
 * SVG screen axes: +x is right, +y is DOWN. We anchor the front floor
 * corner at (ORIGIN_X, ORIGIN_Y) and project everything relative to that.
 *
 * Three faces of any box are visible to the viewer:
 *   - top face (z = max)
 *   - "right" side face (the face at MIN Y — pointing toward viewer's right)
 *   - "left" side face (the face at MIN X — pointing toward viewer's left)
 */

import { createElement, Fragment, type ReactElement, type ReactNode } from 'react';

export const UNIT = 58;
const COS30 = Math.cos(Math.PI / 6); // ≈ 0.866
const SIN30 = 0.5;
export const UNIT_X = UNIT * COS30;
export const UNIT_Y = UNIT * SIN30;
export const UNIT_Z = UNIT;

export const ORIGIN_X = 800;
export const ORIGIN_Y = 800;

/** Wall height in world units. Floor extents are computed per scene. */
export const WALL_H = 3;

export interface Pt {
  x: number;
  y: number;
}

/** World coordinate -> screen point. */
export function iso(x: number, y: number, z = 0): Pt {
  return {
    x: ORIGIN_X + (x - y) * UNIT_X,
    y: ORIGIN_Y - (x + y) * UNIT_Y - z * UNIT_Z,
  };
}

/** Join points into a "x1,y1 x2,y2 ..." string for <polygon>. */
export function poly(...pts: Pt[]): string {
  return pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
}

export interface IsoFaceColors {
  top: string;
  right: string;
  left: string;
  /** Outline color; defaults to a near-black. */
  stroke?: string;
  /** Outline thickness; defaults to 1. */
  strokeWidth?: number;
}

/**
 * An axis-aligned box on the floor with footprint (x..x+w, y..y+d) and
 * height h. Renders the three visible faces with shaded fills.
 *
 * Pass via children if you want to render decorations on the top face —
 * callers project further world points themselves.
 */
export function isoBoxPoints(
  x: number,
  y: number,
  w: number,
  d: number,
  h: number,
): {
  topFace: Pt[];
  rightFace: Pt[];
  leftFace: Pt[];
} {
  // F = front corner of the footprint (closest to viewer)
  // R = back-right (along +X)
  // L = back-left (along +Y)
  // B = back corner (hidden)
  const F0 = iso(x, y, 0);
  const R0 = iso(x + w, y, 0);
  const L0 = iso(x, y + d, 0);
  const F1 = iso(x, y, h);
  const R1 = iso(x + w, y, h);
  const L1 = iso(x, y + d, h);
  const B1 = iso(x + w, y + d, h);

  return {
    topFace: [F1, R1, B1, L1],
    rightFace: [F0, R0, R1, F1],
    leftFace: [F0, L0, L1, F1],
  };
}

/** A floor-standing object participating in painter's-order depth sorting. */
export interface SceneEntity {
  key: string;
  /** World-space FRONT corner (min x, min y) of the entity's footprint. */
  anchor: { x: number; y: number; z?: number };
  /**
   * Coarse paint layer within one sorted group; lower paints first
   * (further behind). Use sparingly — e.g. a flat belt (0) under thin
   * gates (1) under volumetric boxes (2). Default 0.
   */
  layer?: number;
  node: ReactNode;
}

/**
 * Back-to-front paint order for floor-standing objects. iso() maps larger
 * x+y higher on screen, i.e. farther back, so SVG document order must emit
 * descending x+y: the entity nearest world (0,0) paints LAST and shows
 * front-most. Never hand-order floor-standing elements — route them
 * through this.
 *
 * Order: layer asc → x+y desc → z asc (raised objects paint on top) →
 * key (deterministic stability).
 */
export function depthSort(entities: readonly SceneEntity[]): SceneEntity[] {
  return [...entities].sort((a, b) => {
    const layer = (a.layer ?? 0) - (b.layer ?? 0);
    if (layer !== 0) return layer;
    const depth = b.anchor.x + b.anchor.y - (a.anchor.x + a.anchor.y);
    if (depth !== 0) return depth;
    const z = (a.anchor.z ?? 0) - (b.anchor.z ?? 0);
    if (z !== 0) return z;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
}

/** Renders entities in depth-sorted paint order. */
export function DepthSorted({ entities }: { entities: readonly SceneEntity[] }): ReactElement {
  return createElement(
    Fragment,
    null,
    depthSort(entities).map((e) => createElement(Fragment, { key: e.key }, e.node)),
  );
}
