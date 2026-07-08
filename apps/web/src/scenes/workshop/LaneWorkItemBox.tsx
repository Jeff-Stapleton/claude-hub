import type { WorkItem } from '../../types.js';
import { iso, isoBoxPoints, poly } from '../iso.js';
import { Workstation } from './Workstation.jsx';

const BOX_W = 0.3;
const BOX_D = 0.26;
const BOX_H = 0.26;

/**
 * A work item on a lane's belt. The box geometry is drawn once at the
 * world origin and positioned with a screen-space translate — exact
 * because iso() is linear — so a CSS transition makes it glide between
 * slots whenever a WS push moves the item's stage/status. The translate
 * lives inside the scene's uniform scale wrapper, so it scales exactly.
 */
export function LaneWorkItemBox({
  item,
  slot,
  laneOriginY,
  selected,
  onSelect,
}: {
  item: WorkItem;
  /** Lane-local belt slot (itemSlot), computed by the lane from its geometry. */
  slot: { x: number; y: number; z: number };
  /** World y of the lane band's front edge (laneY(k)). */
  laneOriginY: number;
  selected: boolean;
  onSelect: () => void;
}): JSX.Element {
  const origin = iso(0, 0, 0);
  const target = iso(slot.x, laneOriginY + slot.y, slot.z);
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;

  const box = isoBoxPoints(0, 0, BOX_W, BOX_D, BOX_H);
  const status = item.status;
  const right =
    status === 'running'
      ? '#e8b04a'
      : status === 'failed'
        ? '#9a4a40'
        : status === 'waiting-approval'
          ? '#b48ad6'
          : status === 'monitoring'
            ? '#5ec27a'
            : '#8a6840';
  const top =
    status === 'failed' ? '#cf7a70' : status === 'waiting-approval' ? '#d6bce8' : '#c8a25a';

  const badge = iso(BOX_W / 2, BOX_D / 2, BOX_H + 0.32);

  return (
    <g style={{ transform: `translate(${dx}px, ${dy}px)`, transition: 'transform 700ms ease-in-out' }}>
      <Workstation label={`Work item: ${item.title} (${item.status})`} onActivate={onSelect}>
        {/* Inner group carries looping animations so they never fight the
            positioning transform above. */}
        <g
          style={
            status === 'running'
              ? { animation: 'workshop-package 1.4s ease-in-out infinite' }
              : status === 'failed'
                ? { animation: 'workshop-flash 0.9s ease-in-out infinite' }
                : status === 'waiting-approval'
                  ? { animation: 'workshop-led 1.1s ease-in-out infinite' }
                  : undefined
          }
        >
          <g
            style={{
              filter: selected ? 'drop-shadow(0 0 8px rgba(255, 210, 138, 0.9))' : undefined,
            }}
          >
            <polygon points={poly(...box.leftFace)} fill="#4a3020" stroke="#1a110a" strokeWidth={0.6} />
            <polygon points={poly(...box.rightFace)} fill={right} stroke="#1a110a" strokeWidth={0.6} />
            <polygon points={poly(...box.topFace)} fill={top} stroke="#1a110a" strokeWidth={0.6} />
          </g>
          {status === 'waiting-approval' || status === 'failed' ? (
            <g>
              <circle cx={badge.x} cy={badge.y} r={7} fill={status === 'failed' ? '#5a1f1f' : '#3a2a48'} stroke="#15100c" strokeWidth={1} />
              <text x={badge.x} y={badge.y + 3.5} textAnchor="middle" fontSize={10} fontWeight={700} fill={status === 'failed' ? '#f2c0b8' : '#d6bce8'}>
                !
              </text>
            </g>
          ) : null}
        </g>
      </Workstation>
    </g>
  );
}
