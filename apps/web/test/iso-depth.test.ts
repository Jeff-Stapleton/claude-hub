import { describe, expect, it } from 'vitest';
import { depthSort, type SceneEntity } from '../src/scenes/iso.js';

function entity(key: string, x: number, y: number, extra?: Partial<SceneEntity>): SceneEntity {
  return { key, anchor: { x, y }, node: null, ...extra };
}

describe('depthSort', () => {
  it('paints descending x+y so the entity at world (0,0) is last (front-most)', () => {
    const sorted = depthSort([
      entity('origin', 0, 0),
      entity('back', 6, 6),
      entity('mid', 2, 3),
    ]);
    expect(sorted.map((e) => e.key)).toEqual(['back', 'mid', 'origin']);
  });

  it('gives layer precedence over depth', () => {
    // The belt (layer 0) is nearer the viewer than the gate (layer 1) but
    // must still paint first.
    const sorted = depthSort([
      entity('gate', 5, 5, { layer: 1 }),
      entity('belt', 1, 1, { layer: 0 }),
    ]);
    expect(sorted.map((e) => e.key)).toEqual(['belt', 'gate']);
  });

  it('breaks x+y ties with z ascending (raised objects paint on top)', () => {
    const sorted = depthSort([
      { key: 'raised', anchor: { x: 2, y: 2, z: 1 }, node: null },
      { key: 'ground', anchor: { x: 2, y: 2, z: 0 }, node: null },
    ]);
    expect(sorted.map((e) => e.key)).toEqual(['ground', 'raised']);
  });

  it('is deterministic for fully tied entities (key order)', () => {
    const sorted = depthSort([entity('b', 1, 1), entity('a', 1, 1)]);
    expect(sorted.map((e) => e.key)).toEqual(['a', 'b']);
  });

  it('paints a belt item in front of a station behind the belt (lane regression)', () => {
    // Station at lane-local y 1.35 vs item on the belt at y 0.55, slightly
    // higher x: the item has the smaller x+y and must paint after.
    const sorted = depthSort([
      entity('item', 3.1, 0.55),
      entity('station', 3.0, 1.35),
    ]);
    expect(sorted.map((e) => e.key)).toEqual(['station', 'item']);
  });

  it('does not mutate its input', () => {
    const input = [entity('origin', 0, 0), entity('back', 6, 6)];
    depthSort(input);
    expect(input.map((e) => e.key)).toEqual(['origin', 'back']);
  });
});
