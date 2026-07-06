import { describe, expect, it } from 'vitest';
import {
  BELT_X0,
  BELT_X1,
  EXIT_X,
  HALL_W,
  STATION_W,
  defaultPipeline,
  gateX,
  itemSlot,
  stationX,
} from '../src/scenes/line/layout.js';
import { PIPELINE_STAGE_ORDER } from '../src/types.js';

describe('assembly line layout', () => {
  it('places all six stations inside the hall with clearance between them', () => {
    for (let i = 0; i < PIPELINE_STAGE_ORDER.length; i++) {
      expect(stationX(i)).toBeGreaterThan(0);
      expect(stationX(i) + STATION_W).toBeLessThan(HALL_W);
      if (i > 0) {
        expect(stationX(i)).toBeGreaterThan(stationX(i - 1) + STATION_W);
      }
    }
  });

  it('keeps every item slot on the belt', () => {
    const statuses = ['queued', 'running', 'waiting-approval', 'failed', 'monitoring'] as const;
    for (const currentStage of PIPELINE_STAGE_ORDER) {
      for (const status of statuses) {
        const slot = itemSlot({ currentStage, status });
        expect(slot.x).toBeGreaterThanOrEqual(BELT_X0);
        expect(slot.x).toBeLessThanOrEqual(BELT_X1);
      }
    }
  });

  it('parks held items before the gate that guards their stage', () => {
    for (let i = 1; i < PIPELINE_STAGE_ORDER.length; i++) {
      const stage = PIPELINE_STAGE_ORDER[i]!;
      const slot = itemSlot({ currentStage: stage, status: 'waiting-approval' });
      expect(slot.x).toBeLessThan(gateX(i));
      expect(gateX(i)).toBeLessThan(stationX(i));
    }
  });

  it('parks monitoring items by the exit chute', () => {
    const slot = itemSlot({ currentStage: 'monitor', status: 'monitoring' });
    expect(slot.x).toBeGreaterThan(stationX(5));
    expect(slot.x).toBeLessThanOrEqual(EXIT_X);
  });

  it('default pipeline mirrors the server defaults', () => {
    const config = defaultPipeline('p1');
    expect(config.stages.intake.enabled).toBe(false);
    expect(config.stages.spec.gate).toBe('auto');
    expect(config.stages.deploy.gate).toBe('approval');
    expect(config.stages.monitor.intervalMinutes).toBe(30);
    expect(config.stages.monitor.maxChecks).toBe(3);
  });
});
