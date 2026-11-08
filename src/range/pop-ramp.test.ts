import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';
import {defaults, sanitizeSettings, type Settings} from './config';
import {DEG, UNIT} from './actor-physics';
import {RANGE_WALLS} from './drills';
import {sanitizeBotzConfig} from './duel/botz';
import {sanitizeDuelConfig} from './duel/config';
import {POP_EYE, POP_SPAWN, PopField, popConfig, popFeet, popOrigin, popSpawn, popVariants, popWall} from './pop';
import {POP_RAMP_CLEARANCE, popRampFacings, popRampFloorAt, popRampGroundAt, popRampKeys, popRampLayout, popRampLimits, popRampShapes, popRampSurfaceAt,
  rayRampDistance, rayRampsDistance, type PopRampConfig, type PopRampFacing, type PopRampLayout} from './pop-ramp';
import {popRampGeometry} from './pop-ramp-geometry';
import {capturePopPreset, matchesPopPreset, popBuiltInPresets, popPresetKeys, popPresetPatch, popVariantPatch} from './pop-presets';
import {Simulation, STEP} from './simulation';
import {horizontalOverlap, surfaceHeight, TERRAIN_RULES, type TerrainSolid} from './terrain';
import {drillSetupSummary, rangeDrillDefaults} from './ui/drill-setup';
import {TrainingSettings} from './ui/screens/TrainingSettings';

const R = TERRAIN_RULES.hullRadius;
const tan = (degrees: number) => Math.tan(degrees * DEG);
/** One ramp, the layout these older cases are about. */
const ramp = (patch: Partial<PopRampConfig> = {}): PopRampConfig => ({shape: 'ramp', angle: 20, length: 4, width: 6, facing: 'wall', start: .5, platform: 3, ...patch});
/** A platform with four ramps. */
const platform = (patch: Partial<PopRampConfig> = {}): PopRampConfig => ramp({shape: 'platform', ...patch});
/** Settings that ask for one ramp. */
const one = {popRampShape: 'ramp'} as const;
/** Deterministic stand-in for Math.random. */
const lcg = (seed: number) => () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const unit = (from: {x: number; y: number; z: number}, to: {x: number; y: number; z: number}) => {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z, length = Math.hypot(dx, dy, dz);
  return {x: dx / length, y: dy / length, z: dz / length};
};
const facings = popRampFacings.map(([id]) => id);
const first = (layout: PopRampLayout) => layout.solids[0];
const part = (layout: PopRampLayout, id: string) => layout.solids.find(solid => solid.id === id)!;
/** What the hull rests on at (x, z): the highest surface it overlaps, which is what the movement code snaps to. */
const supportAt = (solids: readonly TerrainSolid[], x: number, z: number) => {
  let top = 0;
  for (const solid of solids) if (horizontalOverlap({x, y: 0, z}, solid)) top = Math.max(top, surfaceHeight(solid, x, z));
  return top;
};
/** Counts the quads of a mesh by what they are: a light marking, a plain top, or a dark side. */
const quadKinds = (geometry: ReturnType<typeof popRampGeometry>) => {
  const color = geometry.getAttribute('color'), kinds = {mark: 0, top: 0, side: 0};
  for (let v = 0; v < color.count; v += 6) {const r = color.getX(v); if (r > .5) kinds.mark++; else if (r > .12) kinds.top++; else kinds.side++;}
  return kinds;
};

describe('one ramp: the layout', () => {
  it('is a wedge against the near wall, centred on the middle of the range, in the shape the movement code already walks', () => {
    const wall = popRampLayout(ramp({length: 8, width: 4}));
    expect(wall.solids).toHaveLength(1); expect(wall.rise).toBeCloseTo(8 * tan(20));
    expect(first(wall)).toMatchObject({id: 'pop-ramp', center: {x: 0, z: 1}, size: {x: 4, z: 8}, traversal: {kind: 'ramp', axis: 'z', direction: -1}});
    expect(first(wall).center.y).toBeCloseTo(wall.rise / 2); expect(first(wall).size.y).toBeCloseTo(wall.rise);
    expect(first(popRampLayout(ramp({length: 8, width: 4, facing: 'away'})))).toMatchObject({center: {x: 0, z: 1}, size: {x: 4, z: 8}, traversal: {axis: 'z', direction: 1}});
    expect(first(popRampLayout(ramp({length: 8, width: 4, facing: 'right'})))).toMatchObject({center: {x: 0, z: 3}, size: {x: 8, z: 4}, traversal: {axis: 'x', direction: 1}});
    expect(first(popRampLayout(ramp({length: 8, width: 4, facing: 'left'})))).toMatchObject({center: {x: 0, z: 3}, size: {x: 8, z: 4}, traversal: {axis: 'x', direction: -1}});
    // Every edge stays inside what you can walk on: 5 m back at most, 10 m across at most.
    for (const facing of facings) for (const [length, width] of [[10, 16], [2, 1]]) {
      const solid = first(popRampLayout(ramp({length, width, facing})));
      expect(solid.center.z + solid.size.z / 2).toBeCloseTo(5); expect(Math.abs(solid.center.x) + solid.size.x / 2).toBeLessThanOrEqual(10);
    }
  });

  it('starts you the chosen way up, never closer than half a metre to the top edge, standing on the surface', () => {
    const at = (facing: PopRampFacing, start: number) => popRampLayout(ramp({length: 8, width: 4, facing, start}));
    expect(at('wall', 0).start).toMatchObject({x: 0, z: 5}); expect(at('wall', 1).start).toMatchObject({x: 0, z: -2.5});
    expect(at('away', 0).start).toMatchObject({x: 0, z: -3}); expect(at('away', 1).start).toMatchObject({x: 0, z: 4.5});
    expect(at('right', 0).start).toMatchObject({x: -4, z: 3}); expect(at('right', 1).start).toMatchObject({x: 3.5, z: 3});
    expect(at('left', 0).start).toMatchObject({x: 4, z: 3}); expect(at('left', 1).start).toMatchObject({x: -3.5, z: 3});
    for (const facing of facings) for (const start of [0, .25, .5, 1]) {
      const layout = at(facing, start);
      expect(layout.start.feet).toBeCloseTo(surfaceHeight(first(layout), layout.start.x, layout.start.z));
    }
    // A hull rests on the slope under its uphill edge, so the middle of a 6 m, 20 degree slope is a little above 3 * tan.
    const middle = popRampLayout(ramp({length: 6}));
    expect(middle.start).toMatchObject({x: 0, z: 2}); expect(middle.start.feet).toBeCloseTo((3 + R) * tan(20));
    // `ahead` is how far the ramp reaches from you towards the balls.
    expect([at('wall', 0).ahead, at('wall', 1).ahead, at('away', 0).ahead, at('away', 1).ahead, at('left', .3).ahead, at('right', .9).ahead])
      .toEqual([8, .5, 0, 7.5, 2, 2]);
  });

  it('knows the floor under a hull: the slope over it, else the floor', () => {
    const layout = popRampLayout(ramp({length: 6})), {start} = layout, solid = first(layout);
    expect(popRampFloorAt(layout.solids, start.x, start.z)).toBeCloseTo(start.feet);
    expect(popRampFloorAt(layout.solids, 10, start.z)).toBe(0); expect(popRampFloorAt(layout.solids, 0, -3)).toBe(0);
    // The visible slope is the plain plane, without the hull's allowance.
    expect(popRampSurfaceAt(solid, 0, 2)).toBeCloseTo(3 * tan(20)); expect(popRampSurfaceAt(solid, 0, -1)).toBeCloseTo(solid.size.y);
  });

  it('builds one mesh from the solid the movement uses, with its slope and markings as parts of the surface', () => {
    for (const facing of facings) {
      const layout = popRampLayout(ramp({facing, length: 5})), solid = first(layout);
      const geometry = popRampGeometry(layout.solids), positions = geometry.getAttribute('position');
      expect(positions.count % 3).toBe(0); expect(geometry.getAttribute('color').count).toBe(positions.count);
      const box = geometry.boundingBox!;
      expect(box.min.y).toBeCloseTo(0); expect(box.max.y).toBeCloseTo(solid.size.y);
      expect(box.min.x).toBeCloseTo(solid.center.x - solid.size.x / 2); expect(box.max.z).toBeCloseTo(solid.center.z + solid.size.z / 2);
      // Nothing floats over the surface: every vertex is on the floor or exactly on the slope.
      for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
        expect(Number.isFinite(x + y + z)).toBe(true);
        expect(Math.min(Math.abs(y), Math.abs(y - popRampSurfaceAt(solid, x, z))), `${facing} vertex ${i}`).toBeLessThan(1e-6);
      }
      // A cross line every metre of the five (four lines) and a border all round: 28 light cells, 5 plain ones, 3 dark faces.
      expect(quadKinds(geometry), facing).toEqual({mark: 28, top: 5, side: 3});
    }
  });
});

describe('the platform with four ramps: the layout', () => {
  it('is a square platform with a wedge down each side, as high as the platform and as wide as it, rising towards it', () => {
    const layout = popRampLayout(platform()), rise = 4 * tan(20);
    expect(layout.solids.map(solid => solid.id)).toEqual(['pop-platform', 'pop-ramp-front', 'pop-ramp-back', 'pop-ramp-left', 'pop-ramp-right']);
    expect(layout.rise).toBeCloseTo(rise);
    // The back ramp's foot stands against the near wall (z = 5): 1.5 m of platform and 4 m of ramp in front of it.
    expect(part(layout, 'pop-platform')).toMatchObject({center: {x: 0, z: -.5}, size: {x: 3, z: 3}});
    expect(part(layout, 'pop-platform').traversal).toBeUndefined();
    expect(part(layout, 'pop-ramp-front')).toMatchObject({center: {x: 0, z: -4}, size: {x: 3, z: 4}, traversal: {kind: 'ramp', axis: 'z', direction: 1}});
    expect(part(layout, 'pop-ramp-back')).toMatchObject({center: {x: 0, z: 3}, size: {x: 3, z: 4}, traversal: {kind: 'ramp', axis: 'z', direction: -1}});
    expect(part(layout, 'pop-ramp-left')).toMatchObject({center: {x: -3.5, z: -.5}, size: {x: 4, z: 3}, traversal: {kind: 'ramp', axis: 'x', direction: 1}});
    expect(part(layout, 'pop-ramp-right')).toMatchObject({center: {x: 3.5, z: -.5}, size: {x: 4, z: 3}, traversal: {kind: 'ramp', axis: 'x', direction: -1}});
    for (const solid of layout.solids) {expect(solid.center.y).toBeCloseTo(rise / 2); expect(solid.size.y).toBeCloseTo(rise);}
    // You start in the middle of the platform, standing on its top, and the front ramp reaches 5.5 m from you (1.5 m of platform, 4 m of ramp).
    expect(layout.start).toMatchObject({x: 0, z: -.5}); expect(layout.start.feet).toBeCloseTo(rise); expect(layout.ahead).toBe(5.5);
  });

  it('meets every ramp to the platform edge at the platform height, and lets it down to the floor at its far end', () => {
    for (const [angle, length, side] of [[3, 2, 1.5], [20, 4, 3], [40, 10, 6]]) {
      const layout = popRampLayout(platform({angle, length, platform: side})), top = part(layout, 'pop-platform'), edge = side / 2;
      const rise = top.size.y, l = Math.min(length, 11 - side / 2);
      expect(rise).toBeCloseTo(l * tan(angle));
      const at = (id: string, x: number, z: number) => popRampSurfaceAt(part(layout, id), x, z);
      const cz = top.center.z;
      expect(at('pop-ramp-front', 0, cz - edge)).toBeCloseTo(rise); expect(at('pop-ramp-front', 0, cz - edge - l)).toBeCloseTo(0);
      expect(at('pop-ramp-back', 0, cz + edge)).toBeCloseTo(rise); expect(at('pop-ramp-back', 0, cz + edge + l)).toBeCloseTo(0);
      expect(at('pop-ramp-left', -edge, cz)).toBeCloseTo(rise); expect(at('pop-ramp-left', -edge - l, cz)).toBeCloseTo(0);
      expect(at('pop-ramp-right', edge, cz)).toBeCloseTo(rise); expect(at('pop-ramp-right', edge + l, cz)).toBeCloseTo(0);
    }
  });

  it('stays inside what you can walk on, and its parts never overlap', () => {
    for (const angle of [3, 40]) for (const length of [2, 6, 10]) for (const side of [1.5, 3, 6]) {
      const layout = popRampLayout(platform({angle, length, platform: side})), label = `${angle} ${length} ${side}`;
      let back = -Infinity, across = 0;
      for (const solid of layout.solids) {
        back = Math.max(back, solid.center.z + solid.size.z / 2); across = Math.max(across, Math.abs(solid.center.x) + solid.size.x / 2);
        expect(solid.center.y - solid.size.y / 2, label).toBeCloseTo(0);
      }
      expect(back, label).toBeCloseTo(5); expect(across, label).toBeLessThanOrEqual(11 + 1e-9);
      layout.solids.forEach((a, i) => layout.solids.slice(i + 1).forEach(b => {
        const x = Math.min(a.center.x + a.size.x / 2, b.center.x + b.size.x / 2) - Math.max(a.center.x - a.size.x / 2, b.center.x - b.size.x / 2);
        const z = Math.min(a.center.z + a.size.z / 2, b.center.z + b.size.z / 2) - Math.max(a.center.z - a.size.z / 2, b.center.z - b.size.z / 2);
        expect(x > 1e-9 && z > 1e-9, `${label} ${a.id} / ${b.id}`).toBe(false);
      }));
    }
    // A long ramp round a big platform is shortened so its foot stays inside the range: 11 m from the middle.
    const long = popRampLayout(platform({length: 10, platform: 6}));
    expect(part(long, 'pop-ramp-left').size.x).toBe(8); expect(part(long, 'pop-ramp-left').center.x - 4).toBeCloseTo(-11);
  });

  it('knows the floor and the visible ground under a hull: the platform, a slope, or the open corner at the floor', () => {
    const layout = popRampLayout(platform()), rise = layout.rise, {solids} = layout;
    expect(popRampFloorAt(solids, 0, -.5)).toBeCloseTo(rise);
    expect(popRampFloorAt(solids, 0, -4)).toBeCloseTo(surfaceHeight(part(layout, 'pop-ramp-front'), 0, -4));
    expect(popRampFloorAt(solids, 3.5, -3.5)).toBe(0); expect(popRampFloorAt(solids, 20, 0)).toBe(0);
    expect(popRampGroundAt(solids, 0, -.5)).toEqual({height: rise, normal: {x: 0, y: 1, z: 0}});
    expect(popRampGroundAt(solids, 5, 5)).toEqual({height: 0, normal: {x: 0, y: 1, z: 0}});
    // On a slope the ground tilts towards the way down: away from the platform.
    expect(popRampGroundAt(solids, 0, -4).normal.z).toBeLessThan(-.2); expect(popRampGroundAt(solids, 0, 3).normal.z).toBeGreaterThan(.2);
    expect(popRampGroundAt(solids, -3.5, -.5).normal.x).toBeLessThan(-.2); expect(popRampGroundAt(solids, 3.5, -.5).normal.x).toBeGreaterThan(.2);
    expect(popRampGroundAt(solids, 0, -4).height).toBeCloseTo(rise / 2);
  });

  it('builds one mesh: the platform and its four ramps as non-overlapping cells, nothing floating over anything', () => {
    const layout = popRampLayout(platform()), geometry = popRampGeometry(layout.solids), positions = geometry.getAttribute('position');
    // Each ramp: 4 cross lines and a border all round (23 light cells, 4 plain ones, 3 dark faces); the platform: a border round
    // one plain cell (8 light, 1 plain) and 4 dark faces.
    expect(quadKinds(geometry)).toEqual({mark: 4 * 23 + 8, top: 4 * 4 + 1, side: 4 * 3 + 4});
    const box = geometry.boundingBox!;
    expect(box.min.y).toBeCloseTo(0); expect(box.max.y).toBeCloseTo(layout.rise);
    expect(box.min.x).toBeCloseTo(-5.5); expect(box.max.x).toBeCloseTo(5.5); expect(box.max.z).toBeCloseTo(5); expect(box.min.z).toBeCloseTo(-6);
    // Nothing floats: every vertex is on the floor or exactly on the visible ground there.
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
      expect(Math.min(Math.abs(y), Math.abs(y - popRampGroundAt(layout.solids, x, z).height)), `vertex ${i}`).toBeLessThan(1e-6);
    }
  });
});

describe('ray against the ramps', () => {
  const solid = first(popRampLayout(ramp({length: 6})));   // rises towards -z, 2.18 m at z = -1, 1.09 m at z = 2
  it('meets the slope from above, the top end from the front, and misses what passes over or beside it', () => {
    expect(rayRampDistance({x: 0, y: 6, z: 2}, {x: 0, y: -1, z: 0}, solid)).toBeCloseTo(6 - 3 * tan(20), 9);
    expect(rayRampDistance({x: 0, y: 1, z: -5}, {x: 0, y: 0, z: 1}, solid)).toBeCloseTo(4, 9);
    expect(rayRampDistance({x: 0, y: 4, z: -5}, {x: 0, y: 0, z: 1}, solid)).toBeUndefined();
    expect(rayRampDistance({x: 5, y: 1, z: -5}, {x: 0, y: 0, z: 1}, solid)).toBeUndefined();
    expect(rayRampDistance({x: 0, y: 1, z: 2}, {x: 0, y: 0, z: -1}, solid)).toBe(0);   // from inside it
    expect(rayRampDistance({x: 0, y: 1.5, z: 8}, {x: 0, y: 1, z: 0}, solid)).toBeUndefined();   // pointing away
  });

  it('agrees with where a bullet from your eye lands when you look down at it', () => {
    const layout = popRampLayout(ramp({length: 6})), {start} = layout, eye = {x: start.x + 1, y: start.feet + POP_EYE, z: start.z};
    const dir = unit(eye, {x: start.x + 1, y: 0, z: start.z - 2});
    const distance = rayRampDistance(eye, dir, solid)!, point = {x: eye.x + dir.x * distance, y: eye.y + dir.y * distance, z: eye.z + dir.z * distance};
    expect(distance).toBeGreaterThan(0); expect(point.y).toBeCloseTo(popRampSurfaceAt(solid, point.x, point.z), 9);
  });

  it('on the platform, stops at the nearest of the platform and its ramps', () => {
    const layout = popRampLayout(platform()), {solids, rise} = layout;
    // From high above the middle straight down: the platform top.
    expect(rayRampsDistance({x: 0, y: 6, z: -.5}, {x: 0, y: -1, z: 0}, solids)).toBeCloseTo(6 - rise, 9);
    // Level with your eyes on the platform towards the balls: over the front ramp, nothing in the way.
    expect(rayRampsDistance({x: 0, y: rise + POP_EYE, z: -.5}, {x: 0, y: 0, z: -1}, solids)).toBeUndefined();
    // Low and level from the front, the slope of the front ramp is met first, where its height reaches the ray.
    const low = rayRampsDistance({x: 0, y: .5, z: -10}, {x: 0, y: 0, z: 1}, solids)!;
    expect(popRampSurfaceAt(part(layout, 'pop-ramp-front'), 0, -10 + low)).toBeCloseTo(.5, 9);
    // The same from the left reaches the left ramp's slope, from the back the back ramp's.
    const left = rayRampsDistance({x: -12, y: .5, z: -.5}, {x: 1, y: 0, z: 0}, solids)!;
    expect(popRampSurfaceAt(part(layout, 'pop-ramp-left'), -12 + left, -.5)).toBeCloseTo(.5, 9);
    const back = rayRampsDistance({x: 0, y: .5, z: 8}, {x: 0, y: 0, z: -1}, solids)!;
    expect(popRampSurfaceAt(part(layout, 'pop-ramp-back'), 0, 8 - back)).toBeCloseTo(.5, 9);
    // In the open corner at the floor, between two ramps, nothing is in the way outwards; inwards is the front ramp's side, 2 m off.
    expect(rayRampsDistance({x: 3.5, y: .3, z: -4}, {x: 1, y: 0, z: 0}, solids)).toBeUndefined();
    expect(rayRampsDistance({x: 3.5, y: .3, z: -4}, {x: -1, y: 0, z: 0}, solids)).toBeCloseTo(2, 9);
    expect(rayRampsDistance({x: 0, y: 6, z: -.5}, {x: 0, y: 1, z: 0}, solids)).toBeUndefined();
  });
});

describe('Pop with a ramp', () => {
  it('changes nothing while the ramp is off', () => {
    const config = popConfig({...defaults});
    expect(config.ramp).toBeUndefined(); expect(popOrigin(config)).toBe(POP_SPAWN); expect(config.distance).toBe(12);
    expect(popFeet(config, POP_SPAWN)).toBe(0); expect(popSpawn(config, POP_SPAWN)).toEqual({...POP_SPAWN});
    expect(new PopField(config, POP_SPAWN, lcg(3)).solids).toEqual([]);
    const sim = new Simulation({...defaults, mode: 'pop', weapon: 'ak47'});
    expect(sim.environment.solids).toBe(RANGE_WALLS); expect(sim.feet).toBe(0);
    expect(popWall({wall: 'left', wallWidth: 3}, POP_SPAWN)!.size.y).toBe(2.8);
  });

  it('builds one ramp from the settings in every Pop mode, and starts the field from where you stand on it', () => {
    const config = popConfig({...defaults, ...one, popRamp: true, popRampAngle: 25, popRampLength: 7, popRampWidth: 5, popRampFacing: 'away', popRampStart: .25});
    expect(config.ramp).toEqual({shape: 'ramp', angle: 25, length: 7, width: 5, facing: 'away', start: .25, platform: 3});
    const {start} = popRampLayout(config.ramp!), origin = popOrigin(config);
    expect(origin).toEqual({x: start.x, y: start.feet + POP_EYE, z: start.z});
    const field = new PopField(config, origin, lcg(5));
    expect(field.ramp?.start).toEqual(start); expect(field.region.y).toBeCloseTo(origin.y);
    for (const ball of field.balls) expect(ball.z).toBeCloseTo(origin.z - config.distance);
    expect(field.solids.map(solid => solid.id)).toEqual(['pop-ramp']);
    for (const variant of popVariants.map(entry => entry.id)) {
      for (const shape of ['ramp', 'platform'] as const) {
        const other = popConfig({...defaults, popVariant: variant, popRamp: true, popRampShape: shape});
        expect(other.ramp, `${variant} ${shape}`).toBeDefined();
        if (variant !== 'classic') expect(other.wall, variant).toBe('off');
      }
    }
  });

  it('keeps the balls clear of the end of the ramp that faces them', () => {
    // Downhill towards the balls from the top: 5.5 m of ramp lie in front of you.
    const near = {...defaults, ...one, popRamp: true, popRampLength: 6, popRampFacing: 'away' as const, popRampStart: 1};
    expect(popConfig({...near, popDistance: 3}).distance).toBeCloseTo(5.5 + POP_RAMP_CLEARANCE);
    expect(popConfig({...near, popDistance: 12}).distance).toBe(12);
    const sim = new Simulation({...near, mode: 'pop', weapon: 'ak47', popDistance: 3});
    const solid = first(sim.pop!.ramp!);
    expect(sim.pop!.balls[0].z).toBeCloseTo(solid.center.z - solid.size.z / 2 - POP_RAMP_CLEARANCE);
  });

  it('lifts the peek wall so it still covers you when you start high up, and it stands on the floor', () => {
    const config = popConfig({...defaults, ...one, popRamp: true, popRampLength: 6, popWall: 'both', popWallWidth: 3}), origin = popOrigin(config);
    const wall = popWall(config, origin)!;
    expect(wall.size.y).toBeCloseTo(2.8 + origin.y - POP_EYE); expect(wall.center.y - wall.size.y / 2).toBeCloseTo(0);
    expect(new PopField(config, origin, lcg(2)).solids.map(solid => solid.id)).toEqual(['pop-wall', 'pop-ramp']);
    // Off the ramp the wall is the one it always was.
    expect(popWall({wall: 'both', wallWidth: 3}, POP_SPAWN)!.size.y).toBe(2.8);
  });

  it('stops bullets: balls behind the top edge cannot be hit from the bottom, nor can you shoot into the slope', () => {
    const low = popConfig({...defaults, ...one, popRamp: true, popRampLength: 6, popRampStart: 0, popCount: 1}), lowEye = popOrigin(low);
    const field = new PopField(low, lowEye, lcg(9));
    field.balls.splice(0, field.balls.length, {id: 900, x: 0, y: 1.7, z: -6, radius: .15, hits: 0, vx: 0, vy: 0});
    const toBall = unit(lowEye, field.balls[0]);
    expect(field.hit(lowEye, toBall)).toBeUndefined(); expect(field.pops).toBe(0);
    const blocked = field.rampHit(lowEye, toBall)!;
    expect(blocked.point.y).toBeCloseTo(popRampSurfaceAt(first(field.ramp!), blocked.point.x, blocked.point.z), 6);
    expect(field.rampHit(lowEye, toBall, blocked.distance - .01)).toBeUndefined();
    // From the middle of the ramp the same field is in plain view above its top edge.
    const high = popConfig({...defaults, ...one, popRamp: true, popRampLength: 6, popCount: 1}), highEye = popOrigin(high), seen = new PopField(high, highEye, lcg(9));
    seen.balls.splice(0, seen.balls.length, {id: 901, x: 0, y: highEye.y, z: highEye.z - 12, radius: .15, hits: 0, vx: 0, vy: 0});
    expect(seen.rampHit(highEye, unit(highEye, seen.balls[0]))).toBeUndefined();
    expect(seen.hit(highEye, unit(highEye, seen.balls[0]))?.ball.id).toBe(901);
    // Aiming straight down marks the slope under you, and the ramp is no target.
    const down = seen.rampHit(highEye, {x: 0, y: -1, z: 0})!;
    expect(down.point.y).toBeCloseTo(popRampSurfaceAt(first(seen.ramp!), highEye.x, highEye.z), 9); expect(down.distance).toBeLessThan(POP_EYE + .5);
  });
});

describe('Pop with the platform', () => {
  it('starts the field from the middle of the platform, level with your eyes up there, and keeps the balls clear of the front ramp', () => {
    const config = popConfig({...defaults, popRamp: true}), layout = popRampLayout(config.ramp!), origin = popOrigin(config);
    expect(config.ramp).toEqual({shape: 'platform', angle: 20, length: 4, width: 6, facing: 'wall', start: .5, platform: 3});
    expect(origin).toEqual({x: 0, y: layout.rise + POP_EYE, z: -.5});
    const field = new PopField(config, origin, lcg(5));
    expect(field.region.y).toBeCloseTo(origin.y); expect(field.solids.map(solid => solid.id)).toEqual(layout.solids.map(solid => solid.id));
    for (const ball of field.balls) expect(ball.z).toBeCloseTo(origin.z - config.distance);
    // The front ramp reaches 5.5 m from you: the balls never come closer than 1.5 m past it.
    expect(popConfig({...defaults, popRamp: true, popDistance: 3}).distance).toBeCloseTo(5.5 + POP_RAMP_CLEARANCE);
    expect(popConfig({...defaults, popRamp: true, popDistance: 12}).distance).toBe(12);
    expect(popFeet(config, {x: 0, z: -.5})).toBeCloseTo(layout.rise); expect(popFeet(config, {x: 0, z: 3})).toBeGreaterThan(0);
  });

  it('lifts the peek wall to cover you up there and puts the respawn pad on the platform', () => {
    const config = popConfig({...defaults, popRamp: true, popWall: 'both', popWallWidth: 3, popRespawnMode: 'pad'}), origin = popOrigin(config);
    const wall = popWall(config, origin)!;
    expect(wall.size.y).toBeCloseTo(2.8 + origin.y - POP_EYE); expect(wall.center.y - wall.size.y / 2).toBeCloseTo(0);
    const field = new PopField(config, origin, lcg(2));
    expect(field.solids.map(solid => solid.id)).toEqual(['pop-wall', 'pop-platform', 'pop-ramp-front', 'pop-ramp-back', 'pop-ramp-left', 'pop-ramp-right']);
    expect(field.pad).toMatchObject({x: origin.x, z: origin.z});
    expect(popRampGroundAt(field.ramp!.solids, field.pad.x, field.pad.z)).toEqual({height: field.ramp!.rise, normal: {x: 0, y: 1, z: 0}});
  });

  it('stops bullets: from up on the platform the balls are in plain view over the front ramp, and the ramps hide what is behind them', () => {
    const config = popConfig({...defaults, popRamp: true, popCount: 1, popRampAngle: 30, popRampLength: 6}), origin = popOrigin(config);
    const field = new PopField(config, origin, lcg(9)), layout = field.ramp!;
    field.balls.splice(0, field.balls.length, {id: 910, x: 0, y: origin.y, z: origin.z - 14, radius: .15, hits: 0, vx: 0, vy: 0});
    expect(field.rampHit(origin, unit(origin, field.balls[0]))).toBeUndefined();   // from the platform, over the front ramp
    expect(field.hit(origin, unit(origin, field.balls[0]))?.ball.id).toBe(910);
    // From the floor beyond the front ramp's foot, the ramp and the platform stand between you and a low ball behind them.
    const floor = {x: 0, y: POP_EYE, z: origin.z - 3 - 6 - 2}, behind = {x: 0, y: 1, z: origin.z + 4};
    const blocked = rayRampsDistance(floor, unit(floor, behind), layout.solids);
    expect(blocked).toBeDefined(); expect(blocked!).toBeLessThan(Math.hypot(behind.y - floor.y, behind.z - floor.z));
    // Aiming straight down from the platform marks the platform under you.
    const down = field.rampHit(origin, {x: 0, y: -1, z: 0})!;
    expect(down.point.y).toBeCloseTo(layout.rise, 9); expect(down.distance).toBeCloseTo(POP_EYE, 9);
  });
});

const sim = (patch: Partial<Settings> = {}) => {
  const next = new Simulation({...defaults, mode: 'pop', weapon: 'ak47', primaryEnabled: true, spread: false, popRamp: true, ...patch});
  next.active = true; return next;
};
const run = (s: Simulation, seconds: number, each?: () => void) => {for (let t = 0; t < seconds - 1e-9; t += STEP) {s.advance(STEP); each?.();}};
const press = (s: Simulation, forward: number, side: number) => {s.input = {...s.input, forward, side};};
/** Stands you, still, on the ground at (x, z) the way a hull rests there. */
const place = (s: Simulation, x: number, z: number) => {
  const feet = popRampFloorAt(s.pop!.ramp!.solids, x, z);
  s.position = {x, y: feet + POP_EYE, z}; s.feet = feet; s.velocity = {x: 0, z: 0}; s.verticalVelocity = 0; s.grounded = true;
};

describe('standing and moving on one ramp', () => {
  it('starts you grounded on the slope, level with the balls, and keeps you still on it', () => {
    for (const angle of [3, 20, 40]) for (const facing of facings) for (const start of [0, .5, 1]) {
      const s = sim({...one, popRampAngle: angle, popRampFacing: facing, popRampStart: start}), before = {...s.position};
      expect(s.position.y).toBeCloseTo(s.feet + POP_EYE); expect(s.pop!.region.y).toBeCloseTo(s.position.y);
      expect(s.feet).toBeCloseTo(surfaceHeight(first(s.pop!.ramp!), s.position.x, s.position.z));
      expect(s.environment.solids.map(solid => solid.id)).toContain('pop-ramp');
      let airborne = 0; run(s, 1, () => {if (!s.grounded) airborne++;});
      expect([angle, facing, start, airborne]).toEqual([angle, facing, start, 0]);
      for (const axis of ['x', 'y', 'z'] as const) expect(s.position[axis]).toBeCloseTo(before[axis], 6);
    }
  });

  it('takes you up and down it, and stays on the surface the whole way', () => {
    const cases: [PopRampFacing, number, number, 1 | -1][] = [['wall', 1, 0, 1], ['wall', -1, 0, -1], ['away', 1, 0, -1], ['away', -1, 0, 1],
      ['left', 0, -1, 1], ['left', 0, 1, -1], ['right', 0, 1, 1], ['right', 0, -1, -1]];
    for (const [facing, forward, side, climb] of cases) {
      const s = sim({...one, popRampFacing: facing, popRampLength: 10, popRampWidth: 16}), began = s.feet; let airborne = 0, off = 0;
      press(s, forward, side);
      run(s, .4, () => {
        if (!s.grounded) airborne++;
        off = Math.max(off, Math.abs(s.feet - surfaceHeight(first(s.pop!.ramp!), s.position.x, s.position.z)));
      });
      expect([facing, forward, side, Math.sign(s.feet - began), airborne]).toEqual([facing, forward, side, climb, 0]);
      expect(off).toBeLessThan(1e-6);
    }
  });

  it('covers the same ground per second as on the flat, uphill and downhill', () => {
    const walked = (patch: Partial<Settings>) => {const s = sim({...one, popRampLength: 10, ...patch}); const began = s.position.z; press(s, 1, 0); run(s, .8); return s.position.z - began;};
    const flat = walked({popRamp: false});
    expect(flat).toBeLessThan(-3);
    for (const facing of ['wall', 'away'] as const) expect(walked({popRampFacing: facing}), facing).toBeCloseTo(flat, 9);
  });

  it('counter-strafes exactly as on the flat on every diagonal of every ramp, never leaving the ground', () => {
    const keys: [number, number][] = [[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [0, 1]];
    const trace = (patch: Partial<Settings>, forward: number, side: number) => {
      const s = sim({...patch, popRampLength: 10, popRampWidth: 16}); const speeds: number[] = []; let airborne = 0;
      const tick = () => {s.advance(STEP); if (!s.grounded) airborne++; speeds.push(Math.hypot(s.velocity.x, s.velocity.z) / UNIT);};
      press(s, forward, side); for (let t = 0; t < .15; t += STEP) tick();
      press(s, -forward, -side); let stop = 0;
      while (Math.hypot(s.velocity.x, s.velocity.z) / UNIT >= 34 && stop < 200) {tick(); stop++;}
      return {speeds, airborne, stop};
    };
    for (const angle of [20, 40]) for (const facing of facings) for (const [forward, side] of keys) {
      const flat = trace({popRamp: false}, forward, side), onRamp = trace({...one, popRampAngle: angle, popRampFacing: facing}, forward, side);
      const label = `${angle} ${facing} ${forward},${side}`;
      expect(onRamp.airborne, label).toBe(0); expect(onRamp.stop, label).toBe(flat.stop); expect(onRamp.stop, label).toBeLessThan(10);
      expect(onRamp.speeds.length, label).toBe(flat.speeds.length);
      onRamp.speeds.forEach((speed, i) => expect(Math.abs(speed - flat.speeds[i]), `${label} tick ${i}`).toBeLessThan(1e-9));
    }
  });

  it('drops you to the floor when you walk off an edge, and you land standing', () => {
    const top = sim(one), side = sim({...one, popRampWidth: 1});
    press(top, 1, 0); press(side, 0, 1);
    for (const s of [top, side]) {
      let fell = 0; const began = s.feet; run(s, 2, () => {if (!s.grounded) fell++;});
      expect(began).toBeGreaterThan(.5); expect(fell).toBeGreaterThan(10); expect(s.feet).toBe(0); expect(s.grounded).toBe(true);
    }
  });

  it('puts you back at the start when the ramp changes, and on the floor when it goes, but not for other changes', () => {
    const s = sim(one); press(s, 1, 0); run(s, .5); press(s, 0, 0); run(s, .3);
    const moved = {...s.position}; expect(moved.z).toBeLessThan(2);
    s.configure({...s.settings, popDistance: 20}); expect(s.position).toEqual(moved);
    s.configure({...s.settings, popRampAngle: 25});
    const layout = popRampLayout(ramp({angle: 25, width: 6}));
    expect(s.position.z).toBeCloseTo(layout.start.z); expect(s.feet).toBeCloseTo(layout.start.feet); expect(s.position.y).toBeCloseTo(layout.start.feet + POP_EYE);
    expect(s.velocity).toEqual({x: 0, z: 0}); expect(s.grounded).toBe(true);
    s.configure({...s.settings, popRampFacing: 'right', popRampStart: 0});
    expect(s.position.x).toBeCloseTo(-2); expect(s.feet).toBeCloseTo(popRampLayout(ramp({angle: 25, facing: 'right', start: 0})).start.feet);
    s.configure({...s.settings, popRamp: false});
    expect(s.position).toEqual({...POP_SPAWN}); expect(s.feet).toBe(0); expect(s.pop!.ramp).toBeUndefined();
    expect(s.environment.solids.map(solid => solid.id)).not.toContain('pop-ramp');
    s.configure({...s.settings, popRamp: true, popRampStart: 1});
    expect(s.feet).toBeGreaterThan(1.5);
  });

  it('is part of Pop only: other modes ignore the settings', () => {
    const range = new Simulation({...defaults, mode: 'guided', weapon: 'ak47', popRamp: true});
    expect(range.pop).toBeUndefined(); expect(range.feet).toBe(0); expect(range.environment.solids).toBe(RANGE_WALLS);
  });

  it('works together with the peek wall and the respawn pad, which start where you stand on it', () => {
    const s = sim({...one, popWall: 'left', popRespawnMode: 'pad'});
    expect(s.pop!.solids.map(solid => solid.id)).toEqual(['pop-wall', 'pop-ramp']);
    expect(s.pop!.onPadAt(s.position)).toBe(true);
    expect(s.pop!.pad.x).toBeCloseTo(s.position.x); expect(s.pop!.pad.z).toBeCloseTo(s.position.z);
    expect(s.position.y).toBeCloseTo(s.feet + POP_EYE);
  });
});

describe('standing and moving on the platform', () => {
  /** Where each ramp's middle is, and the keys that walk up it (forward is towards the balls, -z). */
  const sides = [['front', 'pop-ramp-front', 0, -4, -1, 0], ['back', 'pop-ramp-back', 0, 3, 1, 0], ['left', 'pop-ramp-left', -3.5, -.5, 0, 1], ['right', 'pop-ramp-right', 3.5, -.5, 0, -1]] as const;

  it('starts you on the platform: grounded, still, level with the balls, and standing on its top', () => {
    for (const angle of [3, 20, 40]) for (const length of [2, 4, 10]) for (const size of [1.5, 3, 6]) {
      const s = sim({popRampAngle: angle, popRampLength: length, popRampPlatform: size}), layout = s.pop!.ramp!, before = {...s.position};
      expect(layout.start.x).toBe(0); expect(s.position).toMatchObject({x: 0, z: layout.start.z});
      expect(s.feet).toBeCloseTo(layout.rise); expect(s.position.y).toBeCloseTo(layout.rise + POP_EYE); expect(s.pop!.region.y).toBeCloseTo(s.position.y);
      expect(s.environment.solids.map(solid => solid.id)).toEqual(expect.arrayContaining(layout.solids.map(solid => solid.id)));
      let airborne = 0; run(s, 1, () => {if (!s.grounded) airborne++;});
      expect([angle, length, size, airborne]).toEqual([angle, length, size, 0]);
      for (const axis of ['x', 'y', 'z'] as const) expect(s.position[axis]).toBeCloseTo(before[axis], 6);
    }
  });

  it('takes you down each ramp from the platform, staying on the surface the whole way and landing on the floor', () => {
    for (const [name, forward, side] of [['front', 1, 0], ['back', -1, 0], ['left', 0, -1], ['right', 0, 1]] as const) {
      const s = sim(), solids = s.pop!.ramp!.solids, rise = s.pop!.ramp!.rise; let airborne = 0, off = 0, last = s.feet, rose = 0, onSlope = 0;
      press(s, forward, side);
      run(s, 2, () => {
        if (!s.grounded) airborne++;
        off = Math.max(off, Math.abs(s.feet - supportAt(solids, s.position.x, s.position.z)));
        rose = Math.max(rose, s.feet - last); last = s.feet; if (s.feet > .05 && s.feet < rise - .05) onSlope++;
      });
      expect(airborne, name).toBe(0); expect(off, name).toBeLessThan(1e-6); expect(rose, name).toBeLessThan(1e-9);
      // Down the slope, then on the floor (or, at the back, against the near wall, standing on the foot of the ramp).
      expect(onSlope, name).toBeGreaterThan(10); expect(s.feet, name).toBeLessThan(.2); expect(s.grounded, name).toBe(true);
    }
  });

  it('takes you up each ramp onto the platform and over it, never leaving the surface at the junctions', () => {
    for (const [name, , x, z, forward, side] of sides) {
      const s = sim(), solids = s.pop!.ramp!.solids, rise = s.pop!.ramp!.rise;
      // Half a metre short of the foot of the ramp (the near wall stops the back one at its foot): on the floor, or as low as it goes.
      const foot = {x: x - 2.5 * side, z: Math.min(5, z + 2.5 * forward)};
      place(s, foot.x, foot.z); expect(s.feet, name).toBeLessThan(.2);
      let airborne = 0, off = 0, top = 0; press(s, forward, side);
      run(s, 1.2, () => {
        if (!s.grounded) airborne++;
        off = Math.max(off, Math.abs(s.feet - supportAt(solids, s.position.x, s.position.z))); top = Math.max(top, s.feet);
      });
      expect(airborne, name).toBe(0); expect(off, name).toBeLessThan(1e-6); expect(top, name).toBeCloseTo(rise, 6);
    }
  });

  it('lets you cross the platform and go down the ramp on the other side in one run', () => {
    const s = sim(), solids = s.pop!.ramp!.solids, rise = s.pop!.ramp!.rise;
    place(s, 0, -4.2); press(s, -1, 0);
    let airborne = 0, off = 0, top = 0; run(s, 2, () => {
      if (!s.grounded) airborne++; off = Math.max(off, Math.abs(s.feet - supportAt(solids, s.position.x, s.position.z))); top = Math.max(top, s.feet);
    });
    expect(airborne).toBe(0); expect(off).toBeLessThan(1e-6); expect(top).toBeCloseTo(rise, 6); expect(s.position.z).toBeGreaterThan(3); expect(s.feet).toBeLessThan(rise / 2);
  });

  it('crosses every edge of the platform at an angle, up or down, without leaving the surface', () => {
    // Forward is (-sin yaw, -cos yaw): yaw 0 walks towards the balls (-z), PI back, -PI/2 to the right (+x), PI/2 to the left.
    const down = [0, Math.PI, Math.PI / 2, -Math.PI / 2], up = [['front', 0, -4, Math.PI], ['back', 0, 3, 0], ['left', -3.5, -.5, -Math.PI / 2], ['right', 3.5, -.5, Math.PI / 2]] as const;
    for (const slant of [-.4, -.2, .2, .4]) {
      for (const yaw of down) {
        const s = sim(), solids = s.pop!.ramp!.solids, rise = s.pop!.ramp!.rise; let airborne = 0, off = 0;
        s.yaw = yaw + slant; press(s, 1, 0);
        run(s, .6, () => {if (!s.grounded) airborne++; off = Math.max(off, Math.abs(s.feet - supportAt(solids, s.position.x, s.position.z)));});
        expect([`down ${yaw} ${slant}`, airborne]).toEqual([`down ${yaw} ${slant}`, 0]); expect(off, `down ${yaw} ${slant}`).toBeLessThan(1e-6);
        expect(s.feet, `down ${yaw} ${slant}`).toBeLessThan(rise - .05);   // it did go over the edge and start down
      }
      for (const [name, x, z, yaw] of up) {
        const s = sim(), solids = s.pop!.ramp!.solids, rise = s.pop!.ramp!.rise; let airborne = 0, off = 0, top = 0;
        place(s, x, z); s.yaw = yaw + slant; press(s, 1, 0);
        run(s, .9, () => {if (!s.grounded) airborne++; off = Math.max(off, Math.abs(s.feet - supportAt(solids, s.position.x, s.position.z))); top = Math.max(top, s.feet);});
        expect([`up ${name} ${slant}`, airborne]).toEqual([`up ${name} ${slant}`, 0]); expect(off, `up ${name} ${slant}`).toBeLessThan(1e-6);
        expect(top, `up ${name} ${slant}`).toBeCloseTo(rise, 6);
      }
    }
  });

  it('starts you on a ramp, standing still, when a wide peek wall puts the start beside the platform', () => {
    const s = sim({popWall: 'left', popWallWidth: 8, popRespawnMode: 'pad'}), solids = s.pop!.ramp!.solids;
    expect(s.position.x).toBeGreaterThan(1.9); expect(s.feet).toBeGreaterThan(0); expect(s.feet).toBeLessThan(s.pop!.ramp!.rise);
    expect(s.feet).toBeCloseTo(supportAt(solids, s.position.x, s.position.z)); expect(s.position.y).toBeCloseTo(s.feet + POP_EYE);
    const began = {...s.position}; let airborne = 0; run(s, 1, () => {if (!s.grounded) airborne++;});
    expect(airborne).toBe(0); for (const axis of ['x', 'y', 'z'] as const) expect(s.position[axis]).toBeCloseTo(began[axis], 6);
    expect(s.pop!.onPadAt(s.position)).toBe(true);
  });

  it('drops you to the floor off a corner of the platform or the side of a ramp, and you land standing', () => {
    const corner = sim(), edge = sim();
    press(corner, 1, 1);
    place(edge, 0, -4); press(edge, 0, 1);
    for (const [name, s] of [['corner', corner], ['side of a ramp', edge]] as const) {
      let fell = 0; const began = s.feet; run(s, 2, () => {if (!s.grounded) fell++;});
      expect(began, name).toBeGreaterThan(.3); expect(fell, name).toBeGreaterThan(5); expect(s.feet, name).toBe(0); expect(s.grounded, name).toBe(true);
    }
    // Off the corner you land in the open between two ramps, past the platform's corner.
    expect(Math.abs(corner.position.x)).toBeGreaterThan(1.5);
  });

  it('counter-strafes exactly as on the flat on every diagonal, on the platform and on each of its ramps', () => {
    const keys: [number, number][] = [[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [0, 1]];
    const trace = (patch: Partial<Settings>, spot: [number, number] | undefined, forward: number, side: number) => {
      const s = sim(patch), speeds: number[] = []; let airborne = 0;
      if (spot) place(s, spot[0], spot[1]);
      const tick = () => {s.advance(STEP); if (!s.grounded) airborne++; speeds.push(Math.hypot(s.velocity.x, s.velocity.z) / UNIT);};
      press(s, forward, side); for (let t = 0; t < .15; t += STEP) tick();
      press(s, -forward, -side); let stop = 0;
      while (Math.hypot(s.velocity.x, s.velocity.z) / UNIT >= 34 && stop < 200) {tick(); stop++;}
      return {speeds, airborne, stop};
    };
    const spots: ([number, number] | undefined)[] = [undefined, ...sides.map(([, , x, z]) => [x, z] as [number, number])];
    for (const angle of [20, 40]) for (const spot of spots) for (const [forward, side] of keys) {
      const flat = trace({popRamp: false}, undefined, forward, side), onRamp = trace({popRampAngle: angle}, spot, forward, side);
      const label = `${angle} ${spot ?? 'platform'} ${forward},${side}`;
      expect(onRamp.airborne, label).toBe(0); expect(onRamp.stop, label).toBe(flat.stop); expect(onRamp.stop, label).toBeLessThan(10);
      expect(onRamp.speeds.length, label).toBe(flat.speeds.length);
      onRamp.speeds.forEach((speed, i) => expect(Math.abs(speed - flat.speeds[i]), `${label} tick ${i}`).toBeLessThan(1e-9));
    }
  });

  it('puts you back in the middle of the platform when its layout changes, not for other changes, and on the floor when it goes', () => {
    const s = sim(); press(s, 1, 0); run(s, .5); press(s, 0, 0); run(s, .3);
    const moved = {...s.position}; expect(moved.z).toBeLessThan(-.5);
    s.configure({...s.settings, popDistance: 20}); expect(s.position).toEqual(moved);
    s.configure({...s.settings, popRampPlatform: 4});
    let layout = popRampLayout(platform({platform: 4}));
    expect(s.position).toMatchObject({x: 0, z: layout.start.z}); expect(s.feet).toBeCloseTo(layout.rise); expect(s.grounded).toBe(true);
    s.configure({...s.settings, popRampAngle: 30, popRampLength: 3});
    layout = popRampLayout(platform({platform: 4, angle: 30, length: 3}));
    expect(s.position.z).toBeCloseTo(layout.start.z); expect(s.feet).toBeCloseTo(layout.rise); expect(s.position.y).toBeCloseTo(layout.rise + POP_EYE);
    s.configure({...s.settings, popRampShape: 'ramp'});
    expect(s.pop!.ramp!.solids.map(solid => solid.id)).toEqual(['pop-ramp']);
    expect(s.feet).toBeCloseTo(popRampLayout(ramp({angle: 30, length: 3})).start.feet);
    s.configure({...s.settings, popRampShape: 'platform'});
    expect(s.pop!.ramp!.solids).toHaveLength(5);
    s.configure({...s.settings, popRamp: false});
    expect(s.position).toEqual({...POP_SPAWN}); expect(s.feet).toBe(0); expect(s.pop!.ramp).toBeUndefined();
  });

  it('works together with the peek wall and the respawn pad, which start where you stand on it', () => {
    const s = sim({popWall: 'left', popRespawnMode: 'pad'});
    expect(s.pop!.solids.map(solid => solid.id).slice(0, 2)).toEqual(['pop-wall', 'pop-platform']);
    expect(s.pop!.onPadAt(s.position)).toBe(true);
    expect(s.pop!.pad.z).toBeCloseTo(s.position.z); expect(s.position.y).toBeCloseTo(s.feet + POP_EYE);
    expect(s.feet).toBeCloseTo(s.pop!.ramp!.rise);
  });
});

describe('the ramp settings', () => {
  it('are bounded like the sliders, rounded to their steps, and fall back to a platform with four ramps', () => {
    expect(sanitizeSettings({})).toMatchObject({popRamp: false, popRampShape: 'platform', popRampAngle: 20, popRampLength: 4, popRampWidth: 6, popRampFacing: 'wall', popRampStart: .5, popRampPlatform: 3});
    expect(sanitizeSettings({popRamp: 'yes', popRampShape: 'cube', popRampAngle: -1e9, popRampLength: 0, popRampWidth: -3, popRampFacing: 'sideways', popRampStart: -1, popRampPlatform: -2}))
      .toMatchObject({popRamp: false, popRampShape: 'platform', popRampAngle: popRampLimits.angle[0], popRampLength: popRampLimits.length[0], popRampWidth: popRampLimits.width[0], popRampFacing: 'wall', popRampStart: 0,
        popRampPlatform: popRampLimits.platform[0]});
    expect(sanitizeSettings({popRamp: true, popRampShape: 'ramp', popRampAngle: 80, popRampLength: 99, popRampWidth: 99, popRampFacing: 'away', popRampStart: 3, popRampPlatform: 99}))
      .toMatchObject({popRamp: true, popRampShape: 'ramp', popRampAngle: popRampLimits.angle[1], popRampLength: popRampLimits.length[1], popRampWidth: popRampLimits.width[1], popRampFacing: 'away', popRampStart: 1,
        popRampPlatform: popRampLimits.platform[1]});
    expect(sanitizeSettings({popRampLength: 6.3, popRampWidth: 4.8, popRampAngle: 17.6, popRampStart: .33, popRampPlatform: 3.8}))
      .toMatchObject({popRampLength: 6.5, popRampWidth: 5, popRampAngle: 18, popRampStart: .35, popRampPlatform: 4});
    for (const facing of facings) expect(sanitizeSettings({popRampFacing: facing}).popRampFacing).toBe(facing);
    for (const [shape] of popRampShapes) expect(sanitizeSettings({popRampShape: shape}).popRampShape).toBe(shape);
    expect(popRampLimits).toEqual({angle: [3, 40], length: [2, 10], width: [1, 16], platform: [1.5, 6]});
    // Even the steepest ramp is ground you can stand on (CS2: surface normal 0.7 and up).
    expect(Math.cos(popRampLimits.angle[1] * DEG)).toBeGreaterThanOrEqual(TERRAIN_RULES.standableNormal);
  });

  it('are saved with a preset, but picking a Pop mode or a built-in preset leaves your ramps alone', () => {
    const settings: Settings = {...defaults, mode: 'pop', popRamp: true, popRampShape: 'ramp', popRampAngle: 28, popRampFacing: 'right', popRampStart: .8, popRampPlatform: 4.5};
    const captured = capturePopPreset(settings, false);
    for (const key of popRampKeys) {expect(captured.settings).toHaveProperty(key); expect(popPresetKeys).toContain(key);}
    expect(captured.settings).toMatchObject({popRamp: true, popRampShape: 'ramp', popRampAngle: 28, popRampFacing: 'right', popRampStart: .8, popRampPlatform: 4.5});
    for (const preset of popBuiltInPresets) for (const key of popRampKeys) expect(preset.settings, `${preset.id} ${key}`).not.toHaveProperty(key);
    for (const variant of popVariants.map(entry => entry.id)) for (const key of popRampKeys) expect(popVariantPatch(variant), `${variant} ${key}`).not.toHaveProperty(key);
    expect(popPresetPatch({settings: captured.settings})).toMatchObject({popRamp: true, popRampShape: 'ramp', popRampAngle: 28, popRampFacing: 'right', popRampPlatform: 4.5});
    expect(matchesPopPreset({settings: captured.settings}, settings)).toBe(true);
    expect(matchesPopPreset({settings: captured.settings}, {...settings, popRampAngle: 30})).toBe(false);
    expect(matchesPopPreset({settings: captured.settings}, {...settings, popRampPlatform: 3})).toBe(false);
    // A built-in preset still matches whatever ramp you have, since it never set one.
    expect(matchesPopPreset(popBuiltInPresets[0], {...settings, ...popPresetPatch(popBuiltInPresets[0])})).toBe(true);
  });

  it('come back with Restore drill defaults and show in the setup summary of every Pop mode', () => {
    expect(rangeDrillDefaults('pop')).toMatchObject({popRamp: false, popRampShape: 'platform', popRampAngle: 20, popRampLength: 4, popRampWidth: 6, popRampFacing: 'wall', popRampStart: .5, popRampPlatform: 3});
    const botz = sanitizeBotzConfig({}), duel = sanitizeDuelConfig({});
    expect(drillSetupSummary(sanitizeSettings({mode: 'pop', popRamp: true}), botz, duel)).toContain(' · 20° ramps (4 m) to a 3 m platform');
    expect(drillSetupSummary(sanitizeSettings({mode: 'pop', popRamp: true, popRampAngle: 12, popRampLength: 3.5, popRampPlatform: 4.5, popVariant: 'microshot'}), botz, duel))
      .toMatch(/^Microshot .* · 12° ramps \(3\.5 m\) to a 4\.5 m platform$/);
    expect(drillSetupSummary(sanitizeSettings({mode: 'pop', popRamp: true, popRampShape: 'ramp'}), botz, duel)).toContain(' · 20° ramp (4 x 6 m), uphill toward the balls');
    expect(drillSetupSummary(sanitizeSettings({mode: 'pop', popRamp: true, popRampShape: 'ramp', popVariant: 'microshot', popRampFacing: 'left', popRampAngle: 12}), botz, duel))
      .toMatch(/^Microshot .* · 12° ramp \(4 x 6 m\), uphill to your left$/);
    expect(drillSetupSummary(sanitizeSettings({mode: 'pop'}), botz, duel)).not.toContain('ramp');
    expect(drillSetupSummary(sanitizeSettings({mode: 'guided', popRamp: true}), botz, duel)).not.toContain('ramp');
  });
});

describe('the ramp controls in the Pop settings', () => {
  const render = (settings: Settings) => renderToStaticMarkup(createElement(TrainingSettings, {settings, update: () => undefined}));
  it('show a switch in every Pop mode, and the controls of the chosen layout only while the ramps are up', () => {
    for (const variant of popVariants.map(entry => entry.id)) {
      const html = render({...defaults, mode: 'pop', popVariant: variant});
      expect(html, variant).toContain('>Ramp</label>'); expect(html, variant).not.toContain('Ramp angle'); expect(html, variant).not.toContain('Ramp layout');
      // The platform is the default layout: its sliders show the saved values and the limits the sanitizer enforces.
      const up = render({...defaults, mode: 'pop', popVariant: variant, popRamp: true, popRampAngle: 27, popRampLength: 7.5, popRampPlatform: 4.5});
      for (const label of ['Ramp layout', 'Ramp angle', 'Ramp length', 'Platform size']) expect(up, `${variant} ${label}`).toContain(`aria-label="${label}"`);
      for (const label of ['Ramp width', 'Ramp direction', 'Start on the ramp']) expect(up, `${variant} ${label}`).not.toContain(`aria-label="${label}"`);
      expect(up).toMatch(/aria-label="Ramp angle" type="range" min="3" max="40" step="1" style="[^"]*" value="27"/);
      expect(up).toMatch(/aria-label="Ramp length" type="range" min="2" max="10" step="0.5" style="[^"]*" value="7.5"/);
      expect(up).toMatch(/aria-label="Platform size" type="range" min="1.5" max="6" step="0.5" style="[^"]*" value="4.5"/);
      expect(up).toMatch(/<option value="platform" selected="">Platform with four ramps<\/option>/);
      for (const [, name] of popRampShapes) expect(up).toContain(`>${name}</option>`);
      // One ramp has its own controls instead.
      const single = render({...defaults, mode: 'pop', popVariant: variant, popRamp: true, popRampShape: 'ramp', popRampAngle: 27, popRampLength: 7.5});
      for (const label of ['Ramp layout', 'Ramp angle', 'Ramp length', 'Ramp width', 'Ramp direction', 'Start on the ramp']) expect(single, `${variant} ${label}`).toContain(`aria-label="${label}"`);
      expect(single, variant).not.toContain('aria-label="Platform size"');
      expect(single).toMatch(/aria-label="Ramp width" type="range" min="1" max="16" step="0.5" style="[^"]*" value="6"/);
      expect(single).toMatch(/aria-label="Start on the ramp" type="range" min="0" max="100" step="5" style="[^"]*" value="50"/);
      expect(single).toMatch(/<option value="ramp" selected="">One ramp<\/option>/);
      expect(single).toMatch(/<option value="wall" selected="">Uphill toward the balls<\/option>/);
      for (const [, name] of popRampFacings) expect(single).toContain(`>${name}</option>`);
    }
    expect(render({...defaults, mode: 'guided'})).not.toContain('>Ramp</label>');
  });
});
