import { iso, WALL_H } from '../iso.js';

/**
 * Dev-only coordinate reference overlay: floor/wall grid lines with world
 * coordinate numbers and axis arrows, so positions can be discussed by
 * number ("the radio spans y=1.15..3.45"). Rendered last in the scene SVG;
 * pointerEvents="none" keeps every workstation clickable underneath.
 */

const GRID = '#3ee6d0';
const LABEL = '#3ee6d0';
const AXIS = '#ff6ad5';
const FONT = 'ui-monospace, monospace';

export function DebugOverlay({ floorW, floorD }: { floorW: number; floorD: number }): JSX.Element {
  return (
    <g pointerEvents="none">
      <FloorGrid floorW={floorW} floorD={floorD} />
      <WallGrid floorW={floorW} floorD={floorD} />
      <AxisArrows floorW={floorW} floorD={floorD} />
      <text
        x={1580}
        y={22}
        textAnchor="end"
        fontSize={13}
        fontFamily={FONT}
        fill={AXIS}
        opacity={0.9}
      >
        DEBUG
      </text>
    </g>
  );
}

function Line({ a, b, opacity = 0.35 }: { a: Pt; b: Pt; opacity?: number }): JSX.Element {
  return <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={GRID} strokeWidth={0.8} opacity={opacity} />;
}

function Num({ at, text, color = LABEL }: { at: Pt; text: string; color?: string }): JSX.Element {
  return (
    <text
      x={at.x}
      y={at.y}
      textAnchor="middle"
      dominantBaseline="middle"
      fontSize={11}
      fontFamily={FONT}
      fill={color}
      opacity={0.85}
    >
      {text}
    </text>
  );
}

type Pt = ReturnType<typeof iso>;

function FloorGrid({ floorW, floorD }: { floorW: number; floorD: number }): JSX.Element {
  const lines: JSX.Element[] = [];
  const labels: JSX.Element[] = [];
  for (let i = 0; i <= Math.ceil(floorD); i++) {
    // Lines parallel to +X (constant y)
    lines.push(<Line key={`fy-${i}`} a={iso(0, i, 0)} b={iso(floorW, i, 0)} />);
    labels.push(<Num key={`ny-${i}`} at={iso(-0.35, i, 0)} text={String(i)} />);
  }
  for (let i = 0; i <= Math.ceil(floorW); i++) {
    // Lines parallel to +Y (constant x)
    lines.push(<Line key={`fx-${i}`} a={iso(i, 0, 0)} b={iso(i, floorD, 0)} />);
    labels.push(<Num key={`nx-${i}`} at={iso(i, -0.35, 0)} text={String(i)} />);
  }
  return (
    <g>
      {lines}
      {labels}
    </g>
  );
}

function WallGrid({ floorW, floorD }: { floorW: number; floorD: number }): JSX.Element {
  const lines: JSX.Element[] = [];
  const labels: JSX.Element[] = [];

  for (let i = 0; i <= Math.ceil(floorW); i++) {
    // Back-left wall (y = floorD): verticals at each x, numbered along the top
    lines.push(<Line key={`blv-${i}`} a={iso(i, floorD, 0)} b={iso(i, floorD, WALL_H)} />);
    labels.push(<Num key={`bln-${i}`} at={iso(i, floorD, WALL_H + 0.2)} text={String(i)} />);
  }
  for (let i = 0; i <= Math.ceil(floorD); i++) {
    // Back-right wall (x = floorW): verticals at each y, numbered along the top
    lines.push(<Line key={`brv-${i}`} a={iso(floorW, i, 0)} b={iso(floorW, i, WALL_H)} />);
    labels.push(<Num key={`brn-${i}`} at={iso(floorW, i, WALL_H + 0.2)} text={String(i)} />);
  }

  // z=0 is unlabeled: its numbers would collide with the floor-edge ones,
  // and the floor seam already marks that height.
  for (let z = 1; z <= WALL_H; z++) {
    lines.push(<Line key={`blh-${z}`} a={iso(0, floorD, z)} b={iso(floorW, floorD, z)} />);
    lines.push(<Line key={`brh-${z}`} a={iso(floorW, 0, z)} b={iso(floorW, floorD, z)} />);
    // Z-height numbers beside the outer edge of each wall
    labels.push(<Num key={`blz-${z}`} at={iso(-0.3, floorD, z)} text={String(z)} />);
    labels.push(<Num key={`brz-${z}`} at={iso(floorW, -0.3, z)} text={String(z)} />);
  }

  return (
    <g>
      {lines}
      {labels}
    </g>
  );
}

function AxisArrows({ floorW, floorD }: { floorW: number; floorD: number }): JSX.Element {
  const o = iso(0, 0, 0);
  const xEnd = iso(floorW + 0.7, 0, 0);
  const yEnd = iso(0, floorD + 0.7, 0);
  const zEnd = iso(0, 0, 1);
  return (
    <g>
      <line x1={iso(floorW, 0, 0).x} y1={iso(floorW, 0, 0).y} x2={xEnd.x} y2={xEnd.y} stroke={AXIS} strokeWidth={1.5} opacity={0.8} />
      <line x1={iso(0, floorD, 0).x} y1={iso(0, floorD, 0).y} x2={yEnd.x} y2={yEnd.y} stroke={AXIS} strokeWidth={1.5} opacity={0.8} />
      <line x1={o.x} y1={o.y} x2={zEnd.x} y2={zEnd.y} stroke={AXIS} strokeWidth={1.5} opacity={0.8} />
      <Num at={iso(floorW + 1.1, 0, 0)} text="+X" color={AXIS} />
      <Num at={iso(0, floorD + 1.1, 0)} text="+Y" color={AXIS} />
      <Num at={iso(0, 0, 1.25)} text="+Z" color={AXIS} />
    </g>
  );
}
