import { describe, expect, it } from 'vitest';
import {
  APRON_D,
  BACK_MARGIN,
  BELT_D,
  BELT_H,
  BELT_LOCAL_Y,
  CONSOLE_D,
  CONSOLE_W,
  CONSOLE_X,
  HEAD_X,
  HEAD_W,
  LANE_BELT_X0,
  LANE_D,
  MIN_GAP,
  MIN_STEP,
  SLOT_D,
  SLOT_LOCAL_Y,
  SLOT_W,
  TOOLBOX_D,
  TOOLBOX_W,
  TOOLBOX_X,
  TUNNEL_H,
  VAULT_D,
  VAULT_W,
  VAULT_X,
  consoleY,
  defaultPipeline,
  deriveMachineActivity,
  floorDepth,
  floorWidth,
  ghostLaneY,
  itemSlot,
  laneGeometry,
  laneY,
  machineKeyFor,
  sceneTransform,
  toolboxY,
  vaultY,
  workshopFloorDepth,
} from '../src/scenes/workshop/layout.js';
import type { WorkItem } from '../src/types.js';

/** The classic six-machine floor width — the baseline room. */
const BASE_FLOOR_W = floorWidth(0);

const COUNTS = [0, 1, 2, 6, 10, 14];

function keysFor(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `m${i}`);
}

describe('workshop lane layout (equal-distribution machines)', () => {
  it('keeps the baseline room at the classic width until machines crowd it', () => {
    // The classic six-slot room: LANE_BELT_X0 + BASE_BELT_LENGTH = 19.3.
    expect(BASE_FLOOR_W).toBeCloseTo(19.3, 10);
    for (const n of [0, 1, 5]) expect(floorWidth(n)).toBe(BASE_FLOOR_W);
    // Equal gaps at MIN_GAP need more room from six machines on, and each
    // extra machine costs exactly one machine + one gap.
    expect(floorWidth(6)).toBeCloseTo(LANE_BELT_X0 + 6 * SLOT_W + 7 * MIN_GAP, 10);
    expect(floorWidth(7) - floorWidth(6)).toBeCloseTo(MIN_STEP, 10);
  });

  it('splits the belt into count+1 equal gaps around the machines', () => {
    for (const count of COUNTS) {
      const beltX1 = floorWidth(count);
      const geo = laneGeometry(count, beltX1);
      expect(geo.slotXs).toHaveLength(count);
      // Gap widths: start -> first, between machines, last -> wall.
      const edges = [
        LANE_BELT_X0,
        ...geo.slotXs.flatMap((x) => [x, x + SLOT_W]),
        beltX1,
      ];
      const gapWidth = (beltX1 - LANE_BELT_X0 - count * SLOT_W) / (count + 1);
      for (let g = 0; g <= count; g++) {
        expect(edges[2 * g + 1]! - edges[2 * g]!).toBeCloseTo(gapWidth, 9);
      }
      // Gaps never drop below the occlusion floor; once the room has to
      // grow they sit at exactly MIN_GAP.
      expect(gapWidth).toBeGreaterThanOrEqual(MIN_GAP - 1e-9);
      if (count >= 6) expect(gapWidth).toBeCloseTo(MIN_GAP, 9);
      if (count >= 2) {
        const step = geo.slotXs[1]! - geo.slotXs[0]!;
        expect(step).toBeGreaterThanOrEqual(MIN_STEP - 1e-9);
      }
      if (count === 1) {
        // A single machine sits dead center on the belt.
        expect(geo.slotXs[0]!).toBeCloseTo((LANE_BELT_X0 + beltX1 - SLOT_W) / 2, 10);
      }
    }
  });

  it('tiles the open belt with count+1 gap zones, each fitting the ghost', () => {
    for (const count of COUNTS) {
      const beltX1 = floorWidth(count);
      const geo = laneGeometry(count, beltX1);
      expect(geo.gaps).toHaveLength(count + 1);
      for (const [g, gap] of geo.gaps.entries()) {
        expect(gap.index).toBe(g);
        // Zones start where the previous machine ends and end where the
        // next begins — no dead space and no machine overlap.
        const expectedX0 = g === 0 ? LANE_BELT_X0 : geo.slotXs[g - 1]! + SLOT_W;
        const expectedX1 = g === count ? beltX1 - 0.2 : geo.slotXs[g]!;
        expect(gap.x0).toBeCloseTo(expectedX0, 10);
        expect(gap.x1).toBeCloseTo(expectedX1, 10);
        expect(gap.x1).toBeGreaterThan(gap.x0);
        // The previewed ghost sits inside the gap.
        expect(gap.ghostX).toBeGreaterThanOrEqual(gap.x0);
        if (gap.x1 - gap.x0 > SLOT_W + 0.1) {
          expect(gap.ghostX + SLOT_W).toBeLessThanOrEqual(gap.x1 + 1e-9);
        }
      }
    }
  });

  it('keeps the head machine left of the belt', () => {
    expect(HEAD_X + HEAD_W).toBeLessThanOrEqual(LANE_BELT_X0);
  });

  it('bisects each machine with the belt', () => {
    // The belt runs through the machine: same depth-axis center, and the
    // machine overhangs the belt on both sides.
    expect(SLOT_LOCAL_Y + SLOT_D / 2).toBeCloseTo(BELT_LOCAL_Y + BELT_D / 2, 10);
    expect(SLOT_LOCAL_Y).toBeLessThan(BELT_LOCAL_Y);
    expect(SLOT_LOCAL_Y + SLOT_D).toBeGreaterThan(BELT_LOCAL_Y + BELT_D);
    // The tunnel mouth clears a work item riding on the belt (box h 0.26).
    expect(TUNNEL_H).toBeGreaterThan(BELT_H + 0.26);
  });

  it('keeps gates and parked items on the open belt between machines', () => {
    // A parked box only clears the previous machine's front face once it
    // is ~0.72 units past its +X face (iso view ray is (1,1,-1)).
    for (const count of [2, 6, 10]) {
      const keys = keysFor(count);
      const geo = laneGeometry(count, floorWidth(count));
      for (let i = 1; i < count; i++) {
        const prevExit = geo.slotXs[i - 1]! + SLOT_W;
        expect(geo.gateXs[i]!).toBeGreaterThan(prevExit);
        expect(geo.gateXs[i]!).toBeLessThan(geo.slotXs[i]!);
        expect(
          itemSlot({ currentStage: keys[i]!, status: 'queued' }, keys, geo).x,
        ).toBeGreaterThan(prevExit + 0.72);
        expect(
          itemSlot({ currentStage: keys[i]!, status: 'waiting-approval' }, keys, geo).x,
        ).toBeGreaterThan(prevExit + 0.72);
      }
    }
  });

  it('puts running items inside the machine and failed items back at its mouth', () => {
    for (const count of [1, 6, 10]) {
      const keys = keysFor(count);
      const geo = laneGeometry(count, floorWidth(count));
      for (let i = 0; i < count; i++) {
        const running = itemSlot({ currentStage: keys[i]!, status: 'running' }, keys, geo);
        expect(running.x).toBeGreaterThan(geo.slotXs[i]!);
        expect(running.x).toBeLessThan(geo.slotXs[i]! + SLOT_W);
        const failed = itemSlot({ currentStage: keys[i]!, status: 'failed' }, keys, geo);
        expect(failed.x).toBeLessThan(geo.slotXs[i]!);
      }
    }
  });

  it('keeps lane content inside its band so lanes sort independently', () => {
    // Stations reach the deepest into the band; they must not cross into
    // the next lane's band or per-lane depth sorting would be wrong.
    expect(SLOT_LOCAL_Y + SLOT_D).toBeLessThan(LANE_D);
    expect(laneY(1) - laneY(0)).toBe(LANE_D);
    expect(laneY(0)).toBe(APRON_D);
  });

  it('keeps every item slot on the belt, including unknown machine keys', () => {
    const statuses = ['queued', 'running', 'waiting-approval', 'failed', 'monitoring'] as const;
    for (const count of COUNTS) {
      const keys = keysFor(count);
      const geo = laneGeometry(count, floorWidth(count));
      for (const currentStage of [...keys, 'machine-since-removed']) {
        for (const status of statuses) {
          const slot = itemSlot({ currentStage, status }, keys, geo);
          expect(slot.x).toBeGreaterThanOrEqual(LANE_BELT_X0);
          expect(slot.x).toBeLessThanOrEqual(geo.beltX1);
        }
      }
    }
  });

  it('parks held items before the gate that guards their machine', () => {
    const count = 6;
    const keys = keysFor(count);
    const geo = laneGeometry(count, floorWidth(count));
    for (let i = 1; i < count; i++) {
      const slot = itemSlot({ currentStage: keys[i]!, status: 'waiting-approval' }, keys, geo);
      expect(slot.x).toBeLessThan(geo.gateXs[i]!);
      expect(geo.gateXs[i]!).toBeLessThan(geo.slotXs[i]!);
    }
  });

  it('runs the belt flush into the right wall, where the SHIPPED chute sits', () => {
    for (const count of COUNTS) {
      const geo = laneGeometry(count, floorWidth(count));
      expect(geo.beltX1).toBe(floorWidth(count));
    }
  });

  it('parks monitoring items past the last machine, by the exit', () => {
    for (const count of [1, 6, 10]) {
      const keys = keysFor(count);
      const geo = laneGeometry(count, floorWidth(count));
      const slot = itemSlot(
        { currentStage: keys[count - 1]!, status: 'monitoring' },
        keys,
        geo,
      );
      expect(slot.x).toBeGreaterThan(geo.slotXs[count - 1]! + SLOT_W);
      expect(slot.x).toBeLessThanOrEqual(geo.beltX1);
    }
  });

  it('derives machine keys from names with -2 suffixing on collision', () => {
    expect(machineKeyFor('Code', [])).toBe('code');
    expect(machineKeyFor('Code', ['code'])).toBe('code-2');
    expect(machineKeyFor('Code', ['code', 'code-2'])).toBe('code-3');
    expect(machineKeyFor('Security scan!', [])).toBe('security-scan');
    expect(machineKeyFor('  ', [])).toBe('machine');
  });

  it('aggregates machine activity by key with failure > held > running > success', () => {
    const item = (
      stages: Record<string, { status: 'pending' | 'running' | 'success' | 'failed' | 'waiting-approval' }>,
      status: WorkItem['status'] = 'running',
      currentStage = Object.keys(stages)[0] ?? 'a',
    ): WorkItem => ({
      id: 'x',
      projectId: 'p',
      title: 't',
      request: 'r',
      source: 'manual',
      status,
      currentStage,
      stages,
      createdAt: '',
      updatedAt: '',
    });
    const activity = deriveMachineActivity([
      item({ code: { status: 'success' } }),
      item({ code: { status: 'failed' }, 'code-2': { status: 'running' } }),
    ]);
    expect(activity.code).toBe('failed');
    expect(activity['code-2']).toBe('running');
    // A monitoring item lights its current machine as running.
    const monitoring = deriveMachineActivity([
      item({ soak: { status: 'pending' } }, 'monitoring', 'soak'),
    ]);
    expect(monitoring.soak).toBe('running');
  });

  it('stands the console and tool box against the back wall, clear of the lanes', () => {
    for (const n of [1, 3, 9]) {
      const floorD = floorDepth(n);
      // Back faces flush with the back-left wall (y = floorD).
      expect(consoleY(floorD) + CONSOLE_D).toBe(floorD);
      expect(toolboxY(floorD) + TOOLBOX_D).toBe(floorD);
      // Front faces clear of the deepest lane's machines.
      const laneContentBack = laneY(n - 1) + SLOT_LOCAL_Y + SLOT_D;
      expect(consoleY(floorD)).toBeGreaterThan(laneContentBack);
      expect(toolboxY(floorD)).toBeGreaterThan(laneContentBack);
      // Both footprints fit inside the back band.
      expect(CONSOLE_D).toBeLessThanOrEqual(BACK_MARGIN);
      expect(TOOLBOX_D).toBeLessThanOrEqual(BACK_MARGIN);
    }
    // Side by side without overlap, inside the floor.
    expect(TOOLBOX_X).toBeGreaterThan(CONSOLE_X + CONSOLE_W);
    expect(TOOLBOX_X + TOOLBOX_W).toBeLessThan(BASE_FLOOR_W);
  });

  it('stands the vault against the back wall, right of the tool box', () => {
    for (const n of [1, 3, 9]) {
      const floorD = floorDepth(n);
      // Back face flush with the back-left wall (y = floorD).
      expect(vaultY(floorD) + VAULT_D).toBe(floorD);
      // Front face clear of the deepest lane's machines.
      expect(vaultY(floorD)).toBeGreaterThan(laneY(n - 1) + SLOT_LOCAL_Y + SLOT_D);
      // Footprint fits inside the back band.
      expect(VAULT_D).toBeLessThanOrEqual(BACK_MARGIN);
    }
    // Next to the tool box without overlap, inside the floor.
    expect(VAULT_X).toBeGreaterThan(TOOLBOX_X + TOOLBOX_W);
    expect(VAULT_X + VAULT_W).toBeLessThan(BASE_FLOOR_W);
  });

  it('grows the floor depth linearly with lane count, with a one-band minimum', () => {
    expect(floorDepth(0)).toBe(floorDepth(1));
    expect(floorDepth(1)).toBe(APRON_D + LANE_D + BACK_MARGIN);
    expect(floorDepth(5) - floorDepth(4)).toBe(LANE_D);
  });

  it('scale-to-fit keeps the projected scene inside the stage across sizes', () => {
    for (const n of [1, 3, 9]) {
      for (const machineCount of [0, 6, 14]) {
        const floorW = floorWidth(machineCount);
        const floorD = floorDepth(n);
        const { s, tx, ty } = sceneTransform(floorW, floorD);
        expect(s).toBeGreaterThan(0);
        expect(s).toBeLessThanOrEqual(1);
        // Recompute the world bbox and verify its transformed corners fit
        // (horizontally: right of the reserved panel strip).
        const cornersX = [800 - floorD * 50.229, 800 + floorW * 50.229];
        const cornersY = [800 - (floorW + floorD) * 29 - 3.8 * 58, 800 + 0.2 * 58];
        for (const x of cornersX) {
          expect(s * x + tx).toBeGreaterThanOrEqual(280 - 1e-6);
          expect(s * x + tx).toBeLessThanOrEqual(1600 + 1e-6);
        }
        for (const y of cornersY) {
          expect(s * y + ty).toBeGreaterThanOrEqual(-1e-6);
          expect(s * y + ty).toBeLessThanOrEqual(900 + 1e-6);
        }
      }
    }
  });

  it('renders one lane at (near) full size', () => {
    // The belt-bisecting slots stretched the lane, so "full size" is a
    // little smaller than it was when machines sat beside the belt.
    const { s } = sceneTransform(BASE_FLOOR_W, floorDepth(1));
    expect(s).toBeGreaterThan(0.8);
  });

  it('reserves a lane band for the ghost project lane inside the room', () => {
    for (const n of [0, 1, 3, 9]) {
      // The ghost occupies the band right after the last real lane…
      expect(ghostLaneY(n)).toBe(laneY(n));
      // …and the workshop floor is deep enough to contain it.
      expect(workshopFloorDepth(n)).toBe(floorDepth(n + 1));
      expect(ghostLaneY(n) + LANE_D).toBeLessThanOrEqual(workshopFloorDepth(n) - BACK_MARGIN + 1e-9);
      // The back-wall console band stays clear of the ghost lane.
      expect(consoleY(workshopFloorDepth(n))).toBeGreaterThanOrEqual(ghostLaneY(n) + LANE_D - 1e-9);
    }
  });

  it('scale-to-fit still holds with the ghost band included', () => {
    for (const n of [0, 1, 3, 9]) {
      const { s } = sceneTransform(BASE_FLOOR_W, workshopFloorDepth(n));
      expect(s).toBeGreaterThan(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });

  it('default pipeline mirrors the server default (blank line: no machines)', () => {
    const config = defaultPipeline('p1');
    expect(config.machines).toEqual([]);
  });
});
