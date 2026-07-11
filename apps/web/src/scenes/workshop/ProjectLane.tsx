import { useEffect, useRef, useState } from 'react';
import type { TriggerActivityEntry } from '../../api.js';
import type { PipelineConfig, Project, WorkItem } from '../../types.js';
import { DepthSorted, iso, type SceneEntity } from '../iso.js';
import { Belt } from './Belt.jsx';
import { GapZone } from './GapZone.jsx';
import { GateArch } from './GateArch.jsx';
import { GhostSlot } from './GhostSlot.jsx';
import { LaneHeadMachine } from './LaneHeadMachine.jsx';
import { LaneWorkItemBox } from './LaneWorkItemBox.jsx';
import {
  BELT_LOCAL_Y,
  HEAD_LOCAL_Y,
  HEAD_X,
  LANE_BELT_X0,
  SLOT_LOCAL_Y,
  deriveMachineActivity,
  itemSlot,
  laneGeometry,
  laneY,
} from './layout.js';
import { Machine } from './StageMachine.jsx';

/**
 * One project's assembly lane: head machine, belt, installed machines,
 * approval gates, live work items, and the hover-insert gap zones. Mousing
 * over any open belt run previews a ghost machine in that gap; clicking it
 * opens the add-machine panel at that insertion index. Everything
 * floor-standing is routed through DepthSorted; layers keep the flat belt
 * under the gap zones under the thin gates under the volumetric boxes, per
 * the repo's iso z-order convention.
 */
export function ProjectLane({
  project,
  laneIndex,
  config,
  items,
  beltX1,
  triggerActivity,
  selectedMachineKey,
  selectedItemId,
  removing,
  onSelectMachine,
  onSelectItem,
  onOpenIntake,
  onOpenAddMachine,
  onOpenSettings,
  onRemove,
}: {
  project: Project;
  laneIndex: number;
  config: PipelineConfig;
  items: WorkItem[];
  /** Belt end == floor width; shared by every lane (the right wall). */
  beltX1: number;
  triggerActivity: TriggerActivityEntry[];
  selectedMachineKey: string | null;
  selectedItemId: string | null;
  removing: boolean;
  onSelectMachine: (key: string) => void;
  onSelectItem: (itemId: string) => void;
  onOpenIntake: () => void;
  onOpenAddMachine: (insertIndex: number) => void;
  onOpenSettings: () => void;
  onRemove: () => void;
}): JSX.Element {
  const y0 = laneY(laneIndex);
  const beltY = y0 + BELT_LOCAL_Y;
  const slotY = y0 + SLOT_LOCAL_Y;
  const label = project.name;
  const machines = config.machines;
  const machineKeys = machines.map((m) => m.key);
  const geo = laneGeometry(machines.length, beltX1);
  const activity = deriveMachineActivity(items);
  const anythingRunning = items.some((it) => it.status === 'running');

  // Hovered gap index (null = no ghost). Moving the pointer from the flat
  // gap quad onto the ghost projected above it fires the quad's mouseleave;
  // the short grace delay plus the keepalive handlers on the ghost keep the
  // preview stable instead of flickering.
  const [hoveredGap, setHoveredGap] = useState<number | null>(null);
  const clearTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(clearTimer.current), []);
  const hoverGap = (g: number, on: boolean): void => {
    window.clearTimeout(clearTimer.current);
    if (on) setHoveredGap(g);
    else {
      clearTimer.current = window.setTimeout(
        () => setHoveredGap((cur) => (cur === g ? null : cur)),
        120,
      );
    }
  };

  const entities: SceneEntity[] = [
    {
      key: 'belt',
      anchor: { x: LANE_BELT_X0, y: beltY },
      layer: 0,
      node: <Belt x0={LANE_BELT_X0} x1={geo.beltX1} y={beltY} moving={anythingRunning} />,
    },
    {
      key: 'head',
      anchor: { x: HEAD_X, y: y0 + HEAD_LOCAL_Y },
      layer: 2,
      node: (
        <LaneHeadMachine
          project={project}
          x={HEAD_X}
          y={y0 + HEAD_LOCAL_Y}
          variant={laneIndex}
          activity={triggerActivity}
          anythingRunning={anythingRunning}
          removing={removing}
          onOpenIntake={onOpenIntake}
          onOpenSettings={onOpenSettings}
          onRemove={onRemove}
        />
      ),
    },
  ];

  machines.forEach((machine, i) => {
    entities.push({
      key: `machine-${machine.key}`,
      anchor: { x: geo.slotXs[i]!, y: slotY },
      layer: 2,
      node: (
        <Machine
          machine={machine}
          x={geo.slotXs[i]!}
          y={slotY}
          activity={activity[machine.key]}
          selected={selectedMachineKey === machine.key}
          onSelect={() => onSelectMachine(machine.key)}
        />
      ),
    });

    if (machine.gate === 'approval') {
      entities.push({
        key: `gate-${machine.key}`,
        anchor: { x: geo.gateXs[i]!, y: beltY },
        layer: 1,
        node: (
          <GateArch
            x={geo.gateXs[i]!}
            beltY={beltY}
            held={items.some(
              (it) => it.status === 'waiting-approval' && it.currentStage === machine.key,
            )}
          />
        ),
      });
    }
  });

  // Hover-insert gap zones tile the open belt runs (machines.length + 1).
  for (const gap of geo.gaps) {
    const position =
      gap.index === 0
        ? 'at the start of'
        : gap.index === machines.length
          ? 'at the end of'
          : `at position ${gap.index + 1} on`;
    entities.push({
      key: `gap-${gap.index}`,
      anchor: { x: gap.x0, y: slotY },
      layer: 1,
      node: (
        <GapZone
          x0={gap.x0}
          x1={gap.x1}
          y={slotY}
          label={`Insert a machine ${position} ${label}'s line`}
          onHoverChange={(on) => hoverGap(gap.index, on)}
          onActivate={() => onOpenAddMachine(gap.index)}
        />
      ),
    });
  }

  if (hoveredGap !== null && geo.gaps[hoveredGap]) {
    const gap = geo.gaps[hoveredGap]!;
    entities.push({
      key: 'ghost',
      anchor: { x: gap.ghostX, y: slotY },
      layer: 2,
      node: (
        // Keepalive wrapper: hovering the ghost itself counts as hovering
        // its gap, cancelling the quad's pending clear.
        <g
          onMouseEnter={() => hoverGap(gap.index, true)}
          onMouseLeave={() => hoverGap(gap.index, false)}
        >
          <GhostSlot
            x={gap.ghostX}
            y={slotY}
            projectLabel={label}
            onActivate={() => onOpenAddMachine(gap.index)}
          />
        </g>
      ),
    });
  }

  for (const item of items) {
    const slot = itemSlot(item, machineKeys, geo);
    entities.push({
      key: `item-${item.id}`,
      anchor: { x: slot.x, y: y0 + slot.y, z: slot.z },
      layer: 2,
      node: (
        <LaneWorkItemBox
          item={item}
          slot={slot}
          laneOriginY={y0}
          selected={selectedItemId === item.id}
          onSelect={() => onSelectItem(item.id)}
        />
      ),
    });
  }

  const hint = iso((LANE_BELT_X0 + geo.beltX1) / 2, beltY - 0.25, 0.05);

  return (
    <g>
      <DepthSorted entities={entities} />
      {machines.length === 0 ? (
        <text x={hint.x} y={hint.y} textAnchor="middle" fontSize={11} fill="#c8a888" opacity={0.6} fontStyle="italic">
          empty line — hover the belt to add a machine
        </text>
      ) : null}
    </g>
  );
}
