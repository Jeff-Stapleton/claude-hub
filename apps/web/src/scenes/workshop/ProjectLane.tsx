import type { ActivityEntry } from '../../api.js';
import type { PipelineConfig, PipelineStageId, Project, WorkItem } from '../../types.js';
import { PIPELINE_STAGE_ORDER } from '../../types.js';
import { DepthSorted, iso, type SceneEntity } from '../iso.js';
import { Belt } from './Belt.jsx';
import { GateArch } from './GateArch.jsx';
import { GhostSlot } from './GhostSlot.jsx';
import { LaneHeadMachine } from './LaneHeadMachine.jsx';
import { LaneWorkItemBox } from './LaneWorkItemBox.jsx';
import {
  BELT_LOCAL_Y,
  HEAD_LOCAL_Y,
  HEAD_X,
  LANE_BELT_X0,
  LANE_BELT_X1,
  SLOT_LOCAL_Y,
  deriveStageActivity,
  gateX,
  ghostSlotIndex,
  itemSlot,
  laneY,
  slotX,
} from './layout.js';
import { StageMachine } from './StageMachine.jsx';

/**
 * One project's assembly lane: head machine, belt, installed stage
 * machines, approval gates, live work items, and the "+" ghost slot.
 * Everything floor-standing is routed through DepthSorted; layers keep
 * the flat belt under the thin gates under the volumetric boxes, per the
 * repo's iso z-order convention.
 */
export function ProjectLane({
  project,
  laneIndex,
  config,
  items,
  triggerActivity,
  selectedStage,
  selectedItemId,
  removing,
  onSelectStage,
  onSelectItem,
  onOpenIntake,
  onOpenAddStage,
  onRemove,
}: {
  project: Project;
  laneIndex: number;
  config: PipelineConfig;
  items: WorkItem[];
  triggerActivity: ActivityEntry[];
  selectedStage: PipelineStageId | null;
  selectedItemId: string | null;
  removing: boolean;
  onSelectStage: (stage: PipelineStageId) => void;
  onSelectItem: (itemId: string) => void;
  onOpenIntake: () => void;
  onOpenAddStage: () => void;
  onRemove: () => void;
}): JSX.Element {
  const y0 = laneY(laneIndex);
  const beltY = y0 + BELT_LOCAL_Y;
  const slotY = y0 + SLOT_LOCAL_Y;
  const label = project.alias ?? basename(project.path);
  const stageActivity = deriveStageActivity(items);
  const anythingRunning = items.some((it) => it.status === 'running');
  const ghostIndex = ghostSlotIndex(config.stages);
  const installedCount = PIPELINE_STAGE_ORDER.filter((s) => config.stages[s].enabled).length;

  const entities: SceneEntity[] = [
    {
      key: 'belt',
      anchor: { x: LANE_BELT_X0, y: beltY },
      layer: 0,
      node: <Belt x0={LANE_BELT_X0} x1={LANE_BELT_X1} y={beltY} moving={anythingRunning} />,
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
          onRemove={onRemove}
        />
      ),
    },
  ];

  for (let i = 0; i < PIPELINE_STAGE_ORDER.length; i++) {
    const stage = PIPELINE_STAGE_ORDER[i]!;
    const stageConfig = config.stages[stage];
    if (!stageConfig.enabled) continue;

    entities.push({
      key: `machine-${stage}`,
      anchor: { x: slotX(i), y: slotY },
      layer: 2,
      node: (
        <StageMachine
          stage={stage}
          x={slotX(i)}
          y={slotY}
          config={stageConfig}
          activity={stageActivity[stage]}
          selected={selectedStage === stage}
          onSelect={() => onSelectStage(stage)}
        />
      ),
    });

    if (stageConfig.gate === 'approval') {
      entities.push({
        key: `gate-${stage}`,
        anchor: { x: gateX(i), y: beltY },
        layer: 1,
        node: (
          <GateArch
            x={gateX(i)}
            beltY={beltY}
            held={items.some((it) => it.status === 'waiting-approval' && it.currentStage === stage)}
          />
        ),
      });
    }
  }

  if (ghostIndex !== null) {
    entities.push({
      key: 'ghost',
      anchor: { x: slotX(ghostIndex), y: slotY },
      layer: 2,
      node: (
        <GhostSlot
          x={slotX(ghostIndex)}
          y={slotY}
          projectLabel={label}
          onActivate={onOpenAddStage}
        />
      ),
    });
  }

  for (const item of items) {
    const slot = itemSlot(item);
    entities.push({
      key: `item-${item.id}`,
      anchor: { x: slot.x, y: y0 + slot.y, z: slot.z },
      layer: 2,
      node: (
        <LaneWorkItemBox
          item={item}
          laneOriginY={y0}
          selected={selectedItemId === item.id}
          onSelect={() => onSelectItem(item.id)}
        />
      ),
    });
  }

  const hint = iso((LANE_BELT_X0 + LANE_BELT_X1) / 2, beltY - 0.25, 0.05);

  return (
    <g>
      <DepthSorted entities={entities} />
      {installedCount === 0 ? (
        <text x={hint.x} y={hint.y} textAnchor="middle" fontSize={11} fill="#c8a888" opacity={0.6} fontStyle="italic">
          empty line — click the + slot to install a machine
        </text>
      ) : null}
    </g>
  );
}

function basename(path: string): string {
  const norm = path.replace(/[\\/]+$/, '');
  const idx = Math.max(norm.lastIndexOf('/'), norm.lastIndexOf('\\'));
  return idx >= 0 ? norm.slice(idx + 1) : norm;
}
