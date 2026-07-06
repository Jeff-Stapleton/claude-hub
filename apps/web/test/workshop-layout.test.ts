import { describe, expect, it } from 'vitest';
import {
  APRON_D,
  BACK_MARGIN,
  FLOOR_W,
  HEAD_X,
  HEAD_W,
  LANE_BELT_X0,
  LANE_BELT_X1,
  LANE_D,
  SLOT_D,
  SLOT_LOCAL_Y,
  SLOT_W,
  defaultPipeline,
  floorDepth,
  gateX,
  ghostSlotIndex,
  itemSlot,
  laneY,
  sceneTransform,
  slotX,
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

  it('parks monitoring items past the last slot, by the exit', () => {
    const slot = itemSlot({ currentStage: 'monitor', status: 'monitoring' });
    expect(slot.x).toBeGreaterThan(slotX(5));
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
    const { s } = sceneTransform(FLOOR_W, floorDepth(1));
    expect(s).toBeGreaterThan(0.9);
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
