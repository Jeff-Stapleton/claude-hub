import {
  PIPELINE_STAGE_ORDER,
  type PipelineConfig,
  type PipelineStageId,
  type StageConfig,
  type WorkItem,
} from '../../types.js';

/**
 * World-coordinate layout for the per-project assembly hall. Pure
 * constants + functions so slot math is unit-testable without the SVG.
 *
 * The hall is a long shallow room: the belt runs up-and-to-the-right
 * along +X with the six stations lined up behind it (+Y side). Items sit
 * on the belt and glide between slots as the server advances them.
 */

export const HALL_W = 14;
export const HALL_D = 5;
export const HALL_WALL_H = 2.6;

export const STATION_Y = 2.7;
export const STATION_W = 1.5;
export const STATION_D = 1.2;

export const BELT_Y = 2.1;
export const BELT_D = 0.4;
export const BELT_X0 = 0.6;
export const BELT_X1 = 13.4;
export const BELT_H = 0.18;

/** Where shipped items exit through the right wall. */
export const EXIT_X = 12.9;

export function stationX(index: number): number {
  return 1.1 + index * 2.05;
}

/** Approval gates sit across the belt just BEFORE the stage they guard. */
export function gateX(index: number): number {
  return stationX(index) - 0.5;
}

export function stageIndex(stage: PipelineStageId): number {
  const idx = PIPELINE_STAGE_ORDER.indexOf(stage);
  return idx >= 0 ? idx : 0;
}

/**
 * Belt slot for a live work item, keyed off its stage + status:
 * queued behind the station, running under it, held at the gate,
 * monitoring parked by the exit chute.
 */
export function itemSlot(item: Pick<WorkItem, 'currentStage' | 'status'>): {
  x: number;
  y: number;
  z: number;
} {
  const i = stageIndex(item.currentStage);
  const y = BELT_Y + 0.06;
  const z = BELT_H;
  const onBelt = (x: number): { x: number; y: number; z: number } => ({
    x: Math.min(BELT_X1 - 0.35, Math.max(BELT_X0 + 0.05, x)),
    y,
    z,
  });
  switch (item.status) {
    case 'waiting-approval':
      return onBelt(gateX(i) - 0.45);
    case 'running':
    case 'failed':
      return onBelt(stationX(i) + STATION_W / 2 - 0.14);
    case 'monitoring':
      return onBelt(EXIT_X - 0.6);
    case 'queued':
    default:
      return onBelt(stationX(i) - 0.9);
  }
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
 * the scene renders sensibly before a project has stored config. The
 * server's effective config always wins once state arrives.
 */
export function defaultPipeline(projectId: string): PipelineConfig {
  const stage = (overrides?: Partial<StageConfig>): StageConfig => ({
    enabled: true,
    gate: 'auto',
    ...overrides,
  });
  return {
    projectId,
    stages: {
      intake: stage({ enabled: false }),
      spec: stage(),
      code: stage(),
      test: stage(),
      deploy: stage({ gate: 'approval' }),
      monitor: stage({ intervalMinutes: 30, maxChecks: 3 }),
    },
    updatedAt: '',
  };
}
