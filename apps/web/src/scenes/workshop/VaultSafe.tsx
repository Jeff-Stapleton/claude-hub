import { iso, isoBoxPoints, poly } from '../iso.js';
import { VAULT_D, VAULT_H, VAULT_W, VAULT_X } from './layout.js';
import { Workstation } from './Workstation.jsx';

/**
 * The workshop vault: a steel safe against the back-left wall, next to the
 * tool box. It holds the hub's key-value config (tokens, API keys) that
 * skills and MCP servers draw from at run time. The lamp above it pulses
 * amber while any declared key is still unset — the "something isn't
 * configured yet" signal. Position math lives in layout.ts
 * (VAULT_X / vaultY(floorD)).
 */
export function VaultSafe({
  keyCount,
  unsetCount,
  y,
  onOpen,
}: {
  keyCount: number;
  unsetCount: number;
  /** Front-corner y from vaultY(floorD) — back face flush with the wall. */
  y: number;
  onOpen: () => void;
}): JSX.Element {
  const bx = VAULT_X;
  const by = y;
  const bw = VAULT_W;
  const bd = VAULT_D;
  const bh = VAULT_H;

  const { topFace, rightFace, leftFace } = isoBoxPoints(bx, by, bw, bd, bh);

  // Combination dial + handle on the front-right face (the face at MIN Y).
  const dial = iso(bx + bw * 0.38, by, bh * 0.55);
  const handle = iso(bx + bw * 0.78, by, bh * 0.55);
  const lamp = iso(bx + bw / 2, by + bd / 2, bh + 0.16);
  const nameplate = iso(bx + bw / 2, by, bh + 0.02);

  const label =
    unsetCount > 0
      ? `Vault (${keyCount} keys, ${unsetCount} not configured)`
      : `Vault (${keyCount} keys)`;

  return (
    <Workstation label={label} onActivate={onOpen}>
      {/* Safe body — gunmetal steel */}
      <polygon points={poly(...leftFace)} fill="#232830" stroke="#0c0e12" strokeWidth={1} />
      <polygon points={poly(...rightFace)} fill="#39414c" stroke="#0c0e12" strokeWidth={1} />
      <polygon points={poly(...topFace)} fill="#4a545f" stroke="#0c0e12" strokeWidth={1.5} />

      {/* Door outline on the front face */}
      {(() => {
        const a = iso(bx + 0.1, by, 0.1);
        const b = iso(bx + bw - 0.1, by, 0.1);
        const c = iso(bx + bw - 0.1, by, bh - 0.12);
        const d = iso(bx + 0.1, by, bh - 0.12);
        return (
          <polygon
            points={poly(a, b, c, d)}
            fill="none"
            stroke="#0c0e12"
            strokeWidth={1.4}
          />
        );
      })()}

      {/* Hinges along the door's left edge */}
      {[0.3, 0.75].map((z) => {
        const a = iso(bx + 0.14, by, z * bh);
        return (
          <circle key={z} cx={a.x} cy={a.y} r={2.2} fill="#5a646f" stroke="#0c0e12" strokeWidth={0.8} />
        );
      })}

      {/* Combination dial with tick marks */}
      <circle cx={dial.x} cy={dial.y} r={7.5} fill="#171b20" stroke="#5a646f" strokeWidth={1.6} />
      {[0, 60, 120, 180, 240, 300].map((deg) => {
        const rad = (deg * Math.PI) / 180;
        return (
          <line
            key={deg}
            x1={dial.x + Math.cos(rad) * 4.2}
            y1={dial.y + Math.sin(rad) * 4.2}
            x2={dial.x + Math.cos(rad) * 6.4}
            y2={dial.y + Math.sin(rad) * 6.4}
            stroke="#8a949f"
            strokeWidth={1}
          />
        );
      })}
      <circle cx={dial.x} cy={dial.y} r={1.6} fill="#8a949f" />

      {/* Door handle */}
      <line
        x1={handle.x}
        y1={handle.y - 5}
        x2={handle.x}
        y2={handle.y + 5}
        stroke="#8a949f"
        strokeWidth={2.6}
        strokeLinecap="round"
      />

      {/* Warning lamp: pulsing amber while any declared key is unset. */}
      <circle
        cx={lamp.x}
        cy={lamp.y}
        r={5}
        fill={unsetCount > 0 ? '#e8b04a' : '#3a3128'}
        stroke="#15100c"
        strokeWidth={1}
        style={
          unsetCount > 0 ? { animation: 'workshop-led 1.1s ease-in-out infinite' } : undefined
        }
      />

      {/* Nameplate */}
      <text
        x={nameplate.x}
        y={nameplate.y + 26}
        textAnchor="middle"
        fontSize={9}
        fontFamily="monospace"
        fill="#aab4bf"
      >
        VAULT
      </text>
    </Workstation>
  );
}
