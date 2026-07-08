import {
  type BuiltinMachineSlug,
  type PipelineConfig,
  type PipelineMachine,
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

/**
 * Machine slots straddle the belt: each machine is centered on the belt's
 * depth axis so the belt bisects its footprint and runs through a tunnel
 * in its body — work enters the mouth on the -X side and re-emerges past
 * the +X face. Machines are distributed EQUALLY along the belt, so
 * inserting one re-spaces the whole lane; MIN_STEP keeps the open belt run
 * between machines where gates and parked items stay visible (a parked box
 * only clears the previous machine's front face once it is ~0.72 world
 * units past it, because the iso view ray is (1,1,-1)).
 */
export const SLOT_W = 1.15;
export const SLOT_D = 1.2;
/** Belt inset from the machine's front/back edges (belt centered). */
export const MACHINE_BELT_OFFSET = (SLOT_D - BELT_D) / 2;
export const SLOT_LOCAL_Y = BELT_LOCAL_Y - MACHINE_BELT_OFFSET;
/** Tunnel mouth cut into the machine's -X face for the belt. */
export const TUNNEL_H = 0.62;
export const TUNNEL_CLEAR = 0.1;

/**
 * Narrowest open belt run allowed on either side of a machine. Derived
 * from the occlusion floor: a parked box (queued at slot − 0.9) only
 * clears the previous machine's front face 0.72+ world units past it, so
 * the gap must stay ≥ 0.9 + 0.72 with margin.
 */
export const MIN_GAP = 1.7;
/** Center-to-center floor below which machines would occlude parked items. */
export const MIN_STEP = SLOT_W + MIN_GAP;
/** The classic six-slot room length; lanes keep this size until crowded. */
export const BASE_BELT_LENGTH = 17.3;

/**
 * Belt length for a lane with `count` machines under the equal-gap rule
 * (count + 1 identical open runs). The baseline room fits up to five
 * machines; beyond that the belt grows just enough to keep every gap at
 * MIN_GAP.
 */
export function beltLength(count: number): number {
  return Math.max(BASE_BELT_LENGTH, count * SLOT_W + (count + 1) * MIN_GAP);
}

/**
 * Floor width for the workshop: the widest lane's belt runs flush into the
 * right wall, where each lane's SHIPPED chute opening sits (ExitChute), so
 * finished work rides straight out of the workshop. All lanes share the
 * same belt end (the wall); lanes with fewer machines spread them wider.
 */
export function floorWidth(maxMachineCount: number): number {
  return LANE_BELT_X0 + beltLength(maxMachineCount);
}

/** One hover-insert gap on the open belt between machines (or the ends). */
export interface LaneGap {
  /** Insertion index: a machine installed here lands at machines[index]. */
  index: number;
  x0: number;
  x1: number;
  /** Left edge for the ghost machine previewed inside this gap. */
  ghostX: number;
}

export interface LaneGeometry {
  /** Belt end == the right wall's x. */
  beltX1: number;
  /** Machine left edges, one per installed machine. */
  slotXs: number[];
  /** Approval-gate x per machine (across the belt just before it). */
  gateXs: number[];
  /** Where monitoring items park, by the exit end of the belt. */
  exitParkX: number;
  /** machineCount + 1 hover zones tiling the open belt runs. */
  gaps: LaneGap[];
}

/**
 * Per-lane slot geometry: machines distributed so the count + 1 open belt
 * runs (start → first machine, between machines, last machine → wall) are
 * all the same width. One machine sits dead center; the gap never drops
 * below MIN_GAP because beltLength grows first (beltX1 must come from
 * floorWidth so the belt already grew).
 */
export function laneGeometry(machineCount: number, beltX1: number): LaneGeometry {
  const gapWidth = (beltX1 - LANE_BELT_X0 - machineCount * SLOT_W) / (machineCount + 1);
  const slotXs = Array.from(
    { length: machineCount },
    (_, i) => LANE_BELT_X0 + gapWidth * (i + 1) + SLOT_W * i,
  );
  const gaps: LaneGap[] = [];
  for (let g = 0; g <= machineCount; g++) {
    const x0 = g === 0 ? LANE_BELT_X0 : slotXs[g - 1]! + SLOT_W;
    const x1 = g === machineCount ? beltX1 - 0.2 : slotXs[g]!;
    const mid = (x0 + x1) / 2 - SLOT_W / 2;
    const ghostX = Math.min(Math.max(mid, x0 + 0.05), Math.max(x0 + 0.05, x1 - SLOT_W - 0.05));
    gaps.push({ index: g, x0, x1, ghostX });
  }
  return {
    beltX1,
    slotXs,
    gateXs: slotXs.map((x) => x - 0.5),
    exitParkX: beltX1 - 0.45,
    gaps,
  };
}

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
export const VAULT_X = 5.95; // TOOLBOX_X + TOOLBOX_W + a 0.5 gap
export const VAULT_W = 1.0;
export const VAULT_D = 1.0;
export const VAULT_H = 1.1;

/** Front-corner y of the console, its back face flush with the wall. */
export function consoleY(floorD: number): number {
  return floorD - CONSOLE_D;
}

/** Front-corner y of the tool box, its back face flush with the wall. */
export function toolboxY(floorD: number): number {
  return floorD - TOOLBOX_D;
}

/** Front-corner y of the vault, its back face flush with the wall. */
export function vaultY(floorD: number): number {
  return floorD - VAULT_D;
}

export function laneY(laneIndex: number): number {
  return APRON_D + laneIndex * LANE_D;
}

/** Floor depth for n project lanes (a blank room still has one band). */
export function floorDepth(laneCount: number): number {
  return APRON_D + Math.max(1, laneCount) * LANE_D + BACK_MARGIN;
}

/** The ghost project lane sits in the band after the last real lane. */
export function ghostLaneY(projectCount: number): number {
  return laneY(projectCount);
}

/**
 * Workshop floor depth including the ghost lane's band, so the ghost is
 * always inside the room — creating a project grows the room and the next
 * ghost appears in the new space.
 */
export function workshopFloorDepth(projectCount: number): number {
  return floorDepth(projectCount + 1);
}

/**
 * Lane-local belt slot for a live work item, keyed off its machine +
 * status: queued and held items wait on the open belt run before the
 * machine, running items ride INSIDE the machine (the body occludes them —
 * work went in the mouth and will come out the other side), failed items
 * are spat back out at the mouth, and monitoring items park by the belt
 * exit. The lane adds laneY(k) to the returned y. An unknown machine key
 * (edited out from under the item) clamps to the belt start.
 */
export function itemSlot(
  item: Pick<WorkItem, 'currentStage' | 'status'>,
  machineKeys: readonly string[],
  geo: LaneGeometry,
): { x: number; y: number; z: number } {
  const idx = Math.max(0, machineKeys.indexOf(item.currentStage));
  const sx = geo.slotXs[idx] ?? LANE_BELT_X0 + MIN_GAP;
  const gx = geo.gateXs[idx] ?? sx - 0.5;
  const y = BELT_LOCAL_Y + 0.06;
  const z = BELT_H;
  const onBelt = (x: number): { x: number; y: number; z: number } => ({
    x: Math.min(geo.beltX1 - 0.35, Math.max(LANE_BELT_X0 + 0.05, x)),
    y,
    z,
  });
  switch (item.status) {
    case 'waiting-approval':
      return onBelt(gx - 0.45);
    case 'running':
      return onBelt(sx + SLOT_W / 2 - 0.14);
    case 'failed':
      return onBelt(sx - 0.45);
    case 'monitoring':
      return onBelt(geo.exitParkX);
    case 'queued':
    default:
      return onBelt(sx - 0.9);
  }
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
 * Aggregate per-machine status across one project's live items so a
 * machine's screen/lamp reflects whatever is happening at it right now.
 * Priority: failure > held > running > recent success. Keys are machine
 * keys (== WorkItem.stages keys).
 */
export function deriveMachineActivity(items: WorkItem[]): Record<string, StageRunStatus> {
  const activity: Record<string, StageRunStatus> = {};
  const priority: Record<string, number> = { failed: 4, 'waiting-approval': 3, running: 2, success: 1 };
  const bump = (key: string, status: StageRunStatus): void => {
    const current = activity[key];
    if (!current || priority[status]! > priority[current]!) activity[key] = status;
  };
  for (const item of items) {
    for (const [key, result] of Object.entries(item.stages)) {
      const status = result?.status;
      if (status && status in priority) bump(key, status);
    }
    // A parked monitoring item reads as active work at its machine.
    if (item.status === 'monitoring') bump(item.currentStage, 'running');
  }
  return activity;
}

/** Labels/blurbs for the built-in template gallery + machine tooltips. */
export const TEMPLATE_META: Record<BuiltinMachineSlug, { label: string; blurb: string }> = {
  intake: { label: 'INTAKE', blurb: 'triage incoming requests' },
  spec: { label: 'SPEC', blurb: 'plan the work' },
  code: { label: 'CODE', blurb: 'implement the change' },
  test: { label: 'TEST', blurb: 'validate the build' },
  deploy: { label: 'DEPLOY', blurb: 'ship it' },
  monitor: { label: 'MONITOR', blurb: 'watch production' },
};

/** Machine nameplate text: the display name, uppercased and clamped. */
export function machineLabel(machine: Pick<PipelineMachine, 'name' | 'key'>): string {
  return (machine.name || machine.key).toUpperCase().slice(0, 14);
}

/**
 * Unique-in-line machine key from a display name: slugified, `-2`-suffixed
 * on collision (`code`, `code-2`, …). Mirrors MACHINE_KEY_PATTERN.
 */
export function machineKeyFor(name: string, existing: readonly string[]): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'machine';
  if (!existing.includes(base)) return base;
  let n = 2;
  while (existing.includes(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/**
 * Blank-line default, mirroring the server (packages/pipeline/src/
 * defaults.ts): no machines until the user installs one. The server's
 * config always wins once state arrives.
 */
export function defaultPipeline(projectId: string): PipelineConfig {
  return { projectId, machines: [], updatedAt: '' };
}
