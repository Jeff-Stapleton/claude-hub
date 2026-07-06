import {
  PIPELINE_STAGE_ORDER,
  type PipelineConfig,
  type PipelineStageId,
  type StageConfig,
  type StageRunStatus,
  type WorkItem,
} from '../../types.js';
import { ORIGIN_X, ORIGIN_Y, UNIT_X, UNIT_Y, UNIT_Z, WALL_H } from '../iso.js';

/**
 * World-coordinate layout for the merged workshop: one assembly lane per
 * project, running along +X, stacked along +Y. Lane 0 (the first project)
 * is front-most. The floor's width is fixed; its depth grows with the
 * number of projects and the whole scene scales down to fit the stage.
 * Pure constants + functions so the math is unit-testable without SVG.
 */

/** Depth of one lane band. Lane content must stay inside it. */
export const LANE_D = 3.0;
/** Small empty front margin (the console/tool box live at the back wall). */
export const APRON_D = 0.7;
/**
 * Back band between the last lane and the back-left wall; hosts the
 * orchestrator console and the tool box, both standing flush against
 * the wall. Must exceed the deepest of their footprints.
 */
export const BACK_MARGIN = 1.7;

/** Project head machine (the lane's nameplate) at the left end. */
export const HEAD_X = 0.4;
export const HEAD_LOCAL_Y = 0.35;
export const HEAD_W = 1.35;
export const HEAD_D = 1.0;
export const HEAD_H = 1.25;

/** The lane's conveyor, lane-local. */
export const BELT_LOCAL_Y = 0.55;
export const BELT_D = 0.4;
export const BELT_H = 0.18;
export const LANE_BELT_X0 = HEAD_X + HEAD_W + 0.25;

/** Stage machine slots behind the belt (+Y side), fixed per stage index. */
export const SLOT_LOCAL_Y = 1.35;
export const SLOT_W = 1.5;
export const SLOT_D = 1.2;
export const SLOT_STEP = 2.05;

export function slotX(index: number): number {
  return LANE_BELT_X0 + 0.7 + index * SLOT_STEP;
}

/** Approval gates sit across the belt just BEFORE the stage they guard. */
export function gateX(index: number): number {
  return slotX(index) - 0.5;
}

export const LANE_BELT_X1 = slotX(PIPELINE_STAGE_ORDER.length - 1) + SLOT_W + 0.3;
/** Where monitoring items park, by the exit end of the belt. */
export const EXIT_PARK_X = LANE_BELT_X1 - 0.6;

/** Fixed floor width: the longest possible lane plus a right margin. */
export const FLOOR_W = LANE_BELT_X1 + 0.85;

/**
 * Orchestrator console + tool box: side by side against the back-left
 * wall (y = floorD), inside the BACK_MARGIN band. Their y anchors depend
 * on the floor depth, so they're functions of floorD rather than
 * constants — the machines stay glued to the wall as lanes are added.
 */
export const CONSOLE_X = 1.1;
export const CONSOLE_W = 1.8;
export const CONSOLE_D = 1.45;
export const TOOLBOX_X = 4.1;
export const TOOLBOX_W = 1.35;
export const TOOLBOX_D = 1.0;
export const TOOLBOX_H = 0.8;

/** Front-corner y of the console, its back face flush with the wall. */
export function consoleY(floorD: number): number {
  return floorD - CONSOLE_D;
}

/** Front-corner y of the tool box, its back face flush with the wall. */
export function toolboxY(floorD: number): number {
  return floorD - TOOLBOX_D;
}

export function laneY(laneIndex: number): number {
  return APRON_D + laneIndex * LANE_D;
}

/** Floor depth for n project lanes (a blank room still has one band). */
export function floorDepth(laneCount: number): number {
  return APRON_D + Math.max(1, laneCount) * LANE_D + BACK_MARGIN;
}

export function stageIndex(stage: PipelineStageId): number {
  const idx = PIPELINE_STAGE_ORDER.indexOf(stage);
  return idx >= 0 ? idx : 0;
}

/**
 * Lane-local belt slot for a live work item, keyed off its stage + status:
 * queued behind the slot, running under it, held at the gate, monitoring
 * parked by the exit. The lane adds laneY(k) to the returned y. Slots are
 * fixed by stage index regardless of which machines are installed, so an
 * item transiting a skipped stage still has a well-defined position.
 */
export function itemSlot(item: Pick<WorkItem, 'currentStage' | 'status'>): {
  x: number;
  y: number;
  z: number;
} {
  const i = stageIndex(item.currentStage);
  const y = BELT_LOCAL_Y + 0.06;
  const z = BELT_H;
  const onBelt = (x: number): { x: number; y: number; z: number } => ({
    x: Math.min(LANE_BELT_X1 - 0.35, Math.max(LANE_BELT_X0 + 0.05, x)),
    y,
    z,
  });
  switch (item.status) {
    case 'waiting-approval':
      return onBelt(gateX(i) - 0.45);
    case 'running':
    case 'failed':
      return onBelt(slotX(i) + SLOT_W / 2 - 0.14);
    case 'monitoring':
      return onBelt(EXIT_PARK_X - 0.6);
    case 'queued':
    default:
      return onBelt(slotX(i) - 0.9);
  }
}

/**
 * Where the lane's "+" ghost slot sits: the first not-yet-installed
 * stage's slot, or null when every machine is installed.
 */
export function ghostSlotIndex(stages: PipelineConfig['stages']): number | null {
  for (let i = 0; i < PIPELINE_STAGE_ORDER.length; i++) {
    if (!stages[PIPELINE_STAGE_ORDER[i]!].enabled) return i;
  }
  return null;
}

/** Horizontal strip reserved for the docked panels (x 28..~500). */
const PANEL_RESERVE = 280;

/**
 * Scale-to-fit transform for the whole scene: the projected bounding box
 * of the floor plus walls (with headroom for labels above them), fitted
 * into the 1600×900 stage and centered in the region right of the
 * panel dock so lane heads stay clear of it. iso() is linear, so a
 * uniform translate+scale wrapper is exact.
 */
export function sceneTransform(
  floorW: number,
  floorD: number,
  pad = 40,
): { s: number; tx: number; ty: number } {
  const left = ORIGIN_X - floorD * UNIT_X;
  const right = ORIGIN_X + floorW * UNIT_X;
  const top = ORIGIN_Y - (floorW + floorD) * UNIT_Y - (WALL_H + 0.8) * UNIT_Z;
  const bottom = ORIGIN_Y + 0.2 * UNIT_Z;
  const cx = (PANEL_RESERVE + (1600 - pad)) / 2;
  const s = Math.min(
    1,
    (1600 - pad - PANEL_RESERVE) / (right - left),
    (900 - 2 * pad) / (bottom - top),
  );
  return {
    s,
    tx: cx - (s * (left + right)) / 2,
    ty: 450 - (s * (top + bottom)) / 2,
  };
}

/**
 * Aggregate per-stage status across one project's live items so a
 * station's screen/lamp reflects whatever is happening at it right now.
 * Priority: failure > held > running > recent success.
 */
export function deriveStageActivity(
  items: WorkItem[],
): Partial<Record<PipelineStageId, StageRunStatus>> {
  const activity: Partial<Record<PipelineStageId, StageRunStatus>> = {};
  const priority: Record<string, number> = { failed: 4, 'waiting-approval': 3, running: 2, success: 1 };
  for (const item of items) {
    for (const stage of PIPELINE_STAGE_ORDER) {
      let status = item.stages[stage]?.status;
      if (item.status === 'monitoring' && stage === 'monitor') status = 'running';
      if (!status || !(status in priority)) continue;
      const current = activity[stage];
      if (!current || priority[status]! > priority[current]!) activity[stage] = status;
    }
  }
  return activity;
}

export interface StageMeta {
  id: PipelineStageId;
  label: string;
  blurb: string;
}

export const STAGE_META: Record<PipelineStageId, StageMeta> = {
  intake: { id: 'intake', label: 'INTAKE', blurb: 'triage incoming requests' },
  spec: { id: 'spec', label: 'SPEC', blurb: 'plan the work' },
  code: { id: 'code', label: 'CODE', blurb: 'implement the change' },
  test: { id: 'test', label: 'TEST', blurb: 'validate the build' },
  deploy: { id: 'deploy', label: 'DEPLOY', blurb: 'ship it' },
  monitor: { id: 'monitor', label: 'MONITOR', blurb: 'watch production' },
};

/**
 * Mirror of the server's defaults (packages/pipeline/src/defaults.ts) so
 * a lane renders sensibly before a project has stored config. Blank line:
 * every stage disabled until its machine is installed. The server's
 * effective config always wins once state arrives.
 */
export function defaultPipeline(projectId: string): PipelineConfig {
  const stage = (overrides?: Partial<StageConfig>): StageConfig => ({
    enabled: false,
    gate: 'auto',
    ...overrides,
  });
  return {
    projectId,
    stages: {
      intake: stage(),
      spec: stage(),
      code: stage(),
      test: stage(),
      deploy: stage({ gate: 'approval' }),
      monitor: stage({ intervalMinutes: 30, maxChecks: 3 }),
    },
    updatedAt: '',
  };
}
