import { iso, isoBoxPoints, poly } from '../iso.js';
import { TOOLBOX_D, TOOLBOX_H, TOOLBOX_W, TOOLBOX_X } from './layout.js';
import { Workstation } from './Workstation.jsx';

/**
 * The workshop tool box: a red mechanic's chest against the back-left
 * wall, next to the orchestrator console. Clicking it opens the toolbox
 * panel where skills and MCP servers are created and tagged; machines
 * only get the tools explicitly assigned to them in their station config.
 * Position math lives in layout.ts (TOOLBOX_X / toolboxY(floorD)).
 */
export function ToolboxCrate({
  toolCount,
  y,
  onOpen,
}: {
  toolCount: number;
  /** Front-corner y from toolboxY(floorD) — back face flush with the wall. */
  y: number;
  onOpen: () => void;
}): JSX.Element {
  const bx = TOOLBOX_X;
  const by = y;
  const bw = TOOLBOX_W;
  const bd = TOOLBOX_D;
  const bh = TOOLBOX_H;

  const { topFace, rightFace, leftFace } = isoBoxPoints(bx, by, bw, bd, bh);

  return (
    <Workstation label={`Tool box (${toolCount} tools)`} onActivate={onOpen}>
      {/* Chest body — mechanic's red */}
      <polygon points={poly(...leftFace)} fill="#4a1a14" stroke="#1a0806" strokeWidth={1} />
      <polygon points={poly(...rightFace)} fill="#6a241a" stroke="#1a0806" strokeWidth={1} />
      <polygon points={poly(...topFace)} fill="#8a3020" stroke="#1a0806" strokeWidth={1.5} />

      {/* Drawer seams + handles on the front-right face (the face at MIN Y) */}
      {[0.28, 0.52].map((z) => {
        const a = iso(bx + 0.08, by, z);
        const b = iso(bx + bw - 0.08, by, z);
        return (
          <line key={z} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#1a0806" strokeWidth={1.2} />
        );
      })}
      {[0.16, 0.4, 0.64].map((z) => {
        const a = iso(bx + bw / 2 - 0.28, by, z);
        const b = iso(bx + bw / 2 + 0.28, by, z);
        return (
          <line
            key={z}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke="#d8b060"
            strokeWidth={2.4}
            strokeLinecap="round"
          />
        );
      })}

      {/* Tools poking out of the open top tray */}
      {(() => {
        const wrenchBase = iso(bx + 0.35, by + bd / 2, bh);
        const wrenchTip = iso(bx + 0.5, by + bd / 2, bh + 0.45);
        const driverBase = iso(bx + bw - 0.45, by + bd / 2, bh);
        const driverTip = iso(bx + bw - 0.6, by + bd / 2, bh + 0.38);
        return (
          <g>
            <line
              x1={wrenchBase.x}
              y1={wrenchBase.y}
              x2={wrenchTip.x}
              y2={wrenchTip.y}
              stroke="#9aa0a8"
              strokeWidth={3}
              strokeLinecap="round"
            />
            <circle cx={wrenchTip.x} cy={wrenchTip.y} r={4} fill="none" stroke="#9aa0a8" strokeWidth={2.5} />
            <line
              x1={driverBase.x}
              y1={driverBase.y}
              x2={driverTip.x}
              y2={driverTip.y}
              stroke="#c8a888"
              strokeWidth={3}
              strokeLinecap="round"
            />
            <circle cx={driverTip.x} cy={driverTip.y} r={3} fill="#5a3a22" stroke="#1a0806" strokeWidth={1} />
          </g>
        );
      })()}

      {/* Nameplate */}
      {(() => {
        const c = iso(bx + bw / 2, by, TOOLBOX_H + 0.02);
        return (
          <text
            x={c.x}
            y={c.y + 26}
            textAnchor="middle"
            fontSize={9}
            fontFamily="monospace"
            fill="#c8a888"
          >
            TOOL BOX
          </text>
        );
      })()}
    </Workstation>
  );
}
