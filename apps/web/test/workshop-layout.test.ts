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
  FLOOR_W,
  HEAD_X,
  HEAD_W,
  LANE_BELT_X0,
  LANE_BELT_X1,
  LANE_D,
  SLOT_D,
  SLOT_LOCAL_Y,
  SLOT_W,
  TOOLBOX_D,
  TOOLBOX_W,
  TOOLBOX_X,
  TUNNEL_H,
  consoleY,
  defaultPipeline,
  floorDepth,
  gateX,
  ghostLaneY,
  ghostSlotIndex,
  itemSlot,
  laneY,
  sceneTransform,
  slotX,
  toolboxY,
  workshopFloorDepth,
} from '../src/scenes/workshop/layout.js';
import { PIPELINE_STAGE_ORDER } from '../src/types.js';

describe('workshop lane layout', () => {
  it('places all six stage slots inside the floor with clearance between them', () => {
    for (let i = 0; i < PIPELINE_STAGE_ORDER.length; i++) {
      expect(slotX(i)).toBeGreaterThan(LANE_BELT_X0);
      expect(slotX(i) + SLOT_W).toBeLessThan(FLOOR_W);
      if (i > 0) {
        expect(slotX(i)).toBeGreaterThan(slotX(i - 1) + SLOT_W);
      }
    }
  });

  it('keeps the head machine left of the belt', () => {
    expect(HEAD_X + HEAD_W).toBeLessThanOrEqual(LANE_BELT_X0);
  });

  it('bisects each stage machine with the belt', () => {
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
    for (let i = 1; i < PIPELINE_STAGE_ORDER.length; i++) {
      const stage = PIPELINE_STAGE_ORDER[i]!;
      const prevExit = slotX(i - 1) + SLOT_W;
      expect(gateX(i)).toBeGreaterThan(prevExit);
      expect(gateX(i)).toBeLessThan(slotX(i));
      expect(itemSlot({ currentStage: stage, status: 'queued' }).x).toBeGreaterThan(prevExit + 0.72);
      expect(itemSlot({ currentStage: stage, status: 'waiting-approval' }).x).toBeGreaterThan(prevExit + 0.72);
    }
  });

  it('puts running items inside the machine and failed items back at its mouth', () => {
    for (let i = 0; i < PIPELINE_STAGE_ORDER.length; i++) {
      const stage = PIPELINE_STAGE_ORDER[i]!;
      const running = itemSlot({ currentStage: stage, status: 'running' });
      expect(running.x).toBeGreaterThan(slotX(i));
      expect(running.x).toBeLessThan(slotX(i) + SLOT_W);
      const failed = itemSlot({ currentStage: stage, status: 'failed' });
      expect(failed.x).toBeLessThan(slotX(i));
    }
  });

  it('keeps lane content inside its band so lanes sort independently', () => {
    // Stations reach the deepest into the band; they must not cross into
    // the next lane's band or per-lane depth sorting would be wrong.
    expect(SLOT_LOCAL_Y + SLOT_D).toBeLessThan(LANE_D);
    expect(laneY(1) - laneY(0)).toBe(LANE_D);
    expect(laneY(0)).toBe(APRON_D);
  });

  it('keeps every item slot on the belt', () => {
    const statuses = ['queued', 'running', 'waiting-approval', 'failed', 'monitoring'] as const;
    for (const currentStage of PIPELINE_STAGE_ORDER) {
      for (const status of statuses) {
        const slot = itemSlot({ currentStage, status });
        expect(slot.x).toBeGreaterThanOrEqual(LANE_BELT_X0);
        expect(slot.x).toBeLessThanOrEqual(LANE_BELT_X1);
      }
    }
  });

  it('parks held items before the gate that guards their stage', () => {
    for (let i = 1; i < PIPELINE_STAGE_ORDER.length; i++) {
      const stage = PIPELINE_STAGE_ORDER[i]!;
      const slot = itemSlot({ currentStage: stage, status: 'waiting-approval' });
      expect(slot.x).toBeLessThan(gateX(i));
      expect(gateX(i)).toBeLessThan(slotX(i));
    }
  });

  it('runs the belt flush into the right wall, where the SHIPPED chute sits', () => {
    expect(LANE_BELT_X1).toBe(FLOOR_W);
  });

  it('parks monitoring items past the last machine, by the exit', () => {
    const slot = itemSlot({ currentStage: 'monitor', status: 'monitoring' });
    expect(slot.x).toBeGreaterThan(slotX(5) + SLOT_W);
    expect(slot.x).toBeLessThanOrEqual(LANE_BELT_X1);
  });

  it('puts the ghost slot at the first not-installed stage', () => {
    const config = defaultPipeline('p1');
    expect(ghostSlotIndex(config.stages)).toBe(0); // blank line
    config.stages.intake.enabled = true;
    config.stages.code.enabled = true;
    expect(ghostSlotIndex(config.stages)).toBe(1); // spec is next gap
    for (const stage of PIPELINE_STAGE_ORDER) config.stages[stage].enabled = true;
    expect(ghostSlotIndex(config.stages)).toBeNull(); // fully built line
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
    expect(TOOLBOX_X + TOOLBOX_W).toBeLessThan(FLOOR_W);
  });

  it('grows the floor depth linearly with lane count, with a one-band minimum', () => {
    expect(floorDepth(0)).toBe(floorDepth(1));
    expect(floorDepth(1)).toBe(APRON_D + LANE_D + BACK_MARGIN);
    expect(floorDepth(5) - floorDepth(4)).toBe(LANE_D);
  });

  it('scale-to-fit keeps the projected scene inside the stage for 1..9 lanes', () => {
    for (const n of [1, 3, 9]) {
      const floorD = floorDepth(n);
      const { s, tx, ty } = sceneTransform(FLOOR_W, floorD);
      expect(s).toBeGreaterThan(0);
      expect(s).toBeLessThanOrEqual(1);
      // Recompute the world bbox and verify its transformed corners fit
      // (horizontally: right of the reserved panel strip).
      const cornersX = [800 - floorD * 50.229, 800 + FLOOR_W * 50.229];
      const cornersY = [800 - (FLOOR_W + floorD) * 29 - 3.8 * 58, 800 + 0.2 * 58];
      for (const x of cornersX) {
        expect(s * x + tx).toBeGreaterThanOrEqual(280);
        expect(s * x + tx).toBeLessThanOrEqual(1600);
      }
      for (const y of cornersY) {
        expect(s * y + ty).toBeGreaterThanOrEqual(0);
        expect(s * y + ty).toBeLessThanOrEqual(900);
      }
    }
  });

  it('renders one lane at (near) full size', () => {
    // The belt-bisecting slots stretched the lane, so "full size" is a
    // little smaller than it was when machines sat beside the belt.
    const { s } = sceneTransform(FLOOR_W, floorDepth(1));
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
      const { s } = sceneTransform(FLOOR_W, workshopFloorDepth(n));
      expect(s).toBeGreaterThan(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });

  it('default pipeline mirrors the server defaults (blank line: all disabled)', () => {
    const config = defaultPipeline('p1');
    for (const stage of PIPELINE_STAGE_ORDER) {
      expect(config.stages[stage].enabled).toBe(false);
    }
    expect(config.stages.spec.gate).toBe('auto');
    expect(config.stages.deploy.gate).toBe('approval');
    expect(config.stages.monitor.intervalMinutes).toBe(30);
    expect(config.stages.monitor.maxChecks).toBe(3);
  });
});
