import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';
import {defaults, sanitizeSettings, type Settings} from './config';
import {DEG, UNIT} from './actor-physics';
import {RANGE_WALLS} from './drills';
import {sanitizeBotzConfig} from './duel/botz';
import {sanitizeDuelConfig} from './duel/config';
import {POP_EYE, POP_SPAWN, PopField, popConfig, popFeet, popOrigin, popSpawn, popVariants, popWall} from './pop';
import {POP_RAMP_CLEARANCE, popRampFacings, popRampFloorAt, popRampKeys, popRampLayout, popRampLimits, popRampSurfaceAt, rayRampDistance,
  type PopRampConfig, type PopRampFacing} from './pop-ramp';
import {popRampGeometry} from './pop-ramp-geometry';
import {capturePopPreset, matchesPopPreset, popBuiltInPresets, popPresetKeys, popPresetPatch, popVariantPatch} from './pop-presets';
import {Simulation, STEP} from './simulation';
import {surfaceHeight, TERRAIN_RULES} from './terrain';
import {drillSetupSummary, rangeDrillDefaults} from './ui/drill-setup';
import {TrainingSettings} from './ui/screens/TrainingSettings';

const R = TERRAIN_RULES.hullRadius;
const tan = (degrees: number) => Math.tan(degrees * DEG);
const ramp = (patch: Partial<PopRampConfig> = {}): PopRampConfig => ({angle: 20, length: 6, width: 6, facing: 'wall', start: .5, ...patch});
/** Deterministic stand-in for Math.random. */
const lcg = (seed: number) => () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const unit = (from: {x: number; y: number; z: number}, to: {x: number; y: number; z: number}) => {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z, length = Math.hypot(dx, dy, dz);
  return {x: dx / length, y: dy / length, z: dz / length};
};
const facings = popRampFacings.map(([id]) => id);

describe('the ramp layout', () => {
  it('is a wedge against the near wall, centred on the middle of the range, in the shape the movement code already walks', () => {
    const wall = popRampLayout(ramp({length: 8, width: 4}));
    expect(wall.rise).toBeCloseTo(8 * tan(20));
    expect(wall.solid).toMatchObject({id: 'pop-ramp', center: {x: 0, z: 1}, size: {x: 4, z: 8}, traversal: {kind: 'ramp', axis: 'z', direction: -1}});
    expect(wall.solid.center.y).toBeCloseTo(wall.rise / 2); expect(wall.solid.size.y).toBeCloseTo(wall.rise);
    expect(popRampLayout(ramp({length: 8, width: 4, facing: 'away'})).solid).toMatchObject({center: {x: 0, z: 1}, size: {x: 4, z: 8}, traversal: {axis: 'z', direction: 1}});
    expect(popRampLayout(ramp({length: 8, width: 4, facing: 'right'})).solid).toMatchObject({center: {x: 0, z: 3}, size: {x: 8, z: 4}, traversal: {axis: 'x', direction: 1}});
    expect(popRampLayout(ramp({length: 8, width: 4, facing: 'left'})).solid).toMatchObject({center: {x: 0, z: 3}, size: {x: 8, z: 4}, traversal: {axis: 'x', direction: -1}});
    // Every edge stays inside what you can walk on: 5 m back at most, 10 m across at most.
    for (const facing of facings) for (const [length, width] of [[10, 16], [2, 1]]) {
      const {solid} = popRampLayout(ramp({length, width, facing}));
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
      expect(layout.start.feet).toBeCloseTo(surfaceHeight(layout.solid, layout.start.x, layout.start.z));
    }
    // A hull rests on the slope under its uphill edge, so the default start (3 m up a 20 degree slope) is a little above 3 * tan.
    const middle = popRampLayout(ramp());
    expect(middle.start).toMatchObject({x: 0, z: 2}); expect(middle.start.feet).toBeCloseTo((3 + R) * tan(20));
    // `ahead` is how far the ramp reaches from you towards the balls.
    expect([at('wall', 0).ahead, at('wall', 1).ahead, at('away', 0).ahead, at('away', 1).ahead, at('left', .3).ahead, at('right', .9).ahead])
      .toEqual([8, .5, 0, 7.5, 2, 2]);
  });

  it('knows the floor under a hull: the slope over it, else the floor', () => {
    const {solid, start} = popRampLayout(ramp());
    expect(popRampFloorAt(solid, start.x, start.z)).toBeCloseTo(start.feet);
    expect(popRampFloorAt(solid, 10, start.z)).toBe(0); expect(popRampFloorAt(solid, 0, -3)).toBe(0);
    // The visible slope is the plain plane, without the hull's allowance.
    expect(popRampSurfaceAt(solid, 0, 2)).toBeCloseTo(3 * tan(20)); expect(popRampSurfaceAt(solid, 0, -1)).toBeCloseTo(solid.size.y);
  });

  it('builds one mesh from the solid the movement uses, with the slope and its markings', () => {
    for (const facing of facings) {
      const {solid} = popRampLayout(ramp({facing, length: 5}));
      const geometry = popRampGeometry(solid), positions = geometry.getAttribute('position');
      expect(positions.count % 3).toBe(0); expect(geometry.getAttribute('color').count).toBe(positions.count);
      const box = geometry.boundingBox!;
      expect(box.min.y).toBeCloseTo(0); expect(box.max.y).toBeCloseTo(solid.size.y + .008);
      expect(box.min.x).toBeCloseTo(solid.center.x - solid.size.x / 2); expect(box.max.z).toBeCloseTo(solid.center.z + solid.size.z / 2);
      for (let i = 0; i < positions.count; i++) expect(Number.isFinite(positions.getX(i) + positions.getY(i) + positions.getZ(i))).toBe(true);
    }
  });
});

describe('ray against the ramp', () => {
  const {solid} = popRampLayout(ramp());   // rises towards -z, 2.18 m at z = -1, 1.09 m at z = 2
  it('meets the slope from above, the top end from the front, and misses what passes over or beside it', () => {
    expect(rayRampDistance({x: 0, y: 6, z: 2}, {x: 0, y: -1, z: 0}, solid)).toBeCloseTo(6 - 3 * tan(20), 9);
    expect(rayRampDistance({x: 0, y: 1, z: -5}, {x: 0, y: 0, z: 1}, solid)).toBeCloseTo(4, 9);
    expect(rayRampDistance({x: 0, y: 4, z: -5}, {x: 0, y: 0, z: 1}, solid)).toBeUndefined();
    expect(rayRampDistance({x: 5, y: 1, z: -5}, {x: 0, y: 0, z: 1}, solid)).toBeUndefined();
    expect(rayRampDistance({x: 0, y: 1, z: 2}, {x: 0, y: 0, z: -1}, solid)).toBe(0);   // from inside it
    expect(rayRampDistance({x: 0, y: 1.5, z: 8}, {x: 0, y: 1, z: 0}, solid)).toBeUndefined();   // pointing away
  });

  it('agrees with where a bullet from your eye lands when you look down at it', () => {
    const {start} = popRampLayout(ramp()), eye = {x: start.x + 1, y: start.feet + POP_EYE, z: start.z};
    const dir = unit(eye, {x: start.x + 1, y: 0, z: start.z - 2});
    const distance = rayRampDistance(eye, dir, solid)!, point = {x: eye.x + dir.x * distance, y: eye.y + dir.y * distance, z: eye.z + dir.z * distance};
    expect(distance).toBeGreaterThan(0); expect(point.y).toBeCloseTo(popRampSurfaceAt(solid, point.x, point.z), 9);
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

  it('builds the ramp from the settings in every Pop mode, and starts the field from where you stand on it', () => {
    const config = popConfig({...defaults, popRamp: true, popRampAngle: 25, popRampLength: 7, popRampWidth: 5, popRampFacing: 'away', popRampStart: .25});
    expect(config.ramp).toEqual({angle: 25, length: 7, width: 5, facing: 'away', start: .25});
    const {start} = popRampLayout(config.ramp!), origin = popOrigin(config);
    expect(origin).toEqual({x: start.x, y: start.feet + POP_EYE, z: start.z});
    const field = new PopField(config, origin, lcg(5));
    expect(field.ramp?.start).toEqual(start); expect(field.region.y).toBeCloseTo(origin.y);
    for (const ball of field.balls) expect(ball.z).toBeCloseTo(origin.z - config.distance);
    expect(field.solids.map(solid => solid.id)).toEqual(['pop-ramp']);
    for (const variant of popVariants.map(entry => entry.id)) {
      const other = popConfig({...defaults, popVariant: variant, popRamp: true});
      expect(other.ramp, variant).toBeDefined();
      if (variant !== 'classic') expect(other.wall, variant).toBe('off');
    }
  });

  it('keeps the balls clear of the end of the ramp that faces them', () => {
    // Downhill towards the balls from the top: 5.5 m of ramp lie in front of you.
    const near = {...defaults, popRamp: true, popRampFacing: 'away' as const, popRampStart: 1};
    expect(popConfig({...near, popDistance: 3}).distance).toBeCloseTo(5.5 + POP_RAMP_CLEARANCE);
    expect(popConfig({...near, popDistance: 12}).distance).toBe(12);
    const sim = new Simulation({...near, mode: 'pop', weapon: 'ak47', popDistance: 3});
    expect(sim.pop!.balls[0].z).toBeCloseTo(sim.pop!.ramp!.solid.center.z - sim.pop!.ramp!.solid.size.z / 2 - POP_RAMP_CLEARANCE);
  });

  it('lifts the peek wall so it still covers you when you start high up, and it stands on the floor', () => {
    const config = popConfig({...defaults, popRamp: true, popWall: 'both', popWallWidth: 3}), origin = popOrigin(config);
    const wall = popWall(config, origin)!;
    expect(wall.size.y).toBeCloseTo(2.8 + origin.y - POP_EYE); expect(wall.center.y - wall.size.y / 2).toBeCloseTo(0);
    expect(new PopField(config, origin, lcg(2)).solids.map(solid => solid.id)).toEqual(['pop-wall', 'pop-ramp']);
    // Off the ramp the wall is the one it always was.
    expect(popWall({wall: 'both', wallWidth: 3}, POP_SPAWN)!.size.y).toBe(2.8);
  });

  it('stops bullets: balls behind the top edge cannot be hit from the bottom, nor can you shoot into the slope', () => {
    const low = popConfig({...defaults, popRamp: true, popRampStart: 0, popCount: 1}), lowEye = popOrigin(low);
    const field = new PopField(low, lowEye, lcg(9));
    field.balls.splice(0, field.balls.length, {id: 900, x: 0, y: 1.7, z: -6, radius: .15, hits: 0, vx: 0, vy: 0});
    const toBall = unit(lowEye, field.balls[0]);
    expect(field.hit(lowEye, toBall)).toBeUndefined(); expect(field.pops).toBe(0);
    const blocked = field.rampHit(lowEye, toBall)!;
    expect(blocked.point.y).toBeCloseTo(popRampSurfaceAt(field.ramp!.solid, blocked.point.x, blocked.point.z), 6);
    expect(field.rampHit(lowEye, toBall, blocked.distance - .01)).toBeUndefined();
    // From the middle of the ramp the same field is in plain view above its top edge.
    const high = popConfig({...defaults, popRamp: true, popCount: 1}), highEye = popOrigin(high), seen = new PopField(high, highEye, lcg(9));
    seen.balls.splice(0, seen.balls.length, {id: 901, x: 0, y: highEye.y, z: highEye.z - 12, radius: .15, hits: 0, vx: 0, vy: 0});
    expect(seen.rampHit(highEye, unit(highEye, seen.balls[0]))).toBeUndefined();
    expect(seen.hit(highEye, unit(highEye, seen.balls[0]))?.ball.id).toBe(901);
    // Aiming straight down marks the slope under you, and the ramp is no target.
    const down = seen.rampHit(highEye, {x: 0, y: -1, z: 0})!;
    expect(down.point.y).toBeCloseTo(popRampSurfaceAt(seen.ramp!.solid, highEye.x, highEye.z), 9); expect(down.distance).toBeLessThan(POP_EYE + .5);
  });
});

describe('standing and moving on the ramp', () => {
  const sim = (patch: Partial<Settings> = {}) => {
    const next = new Simulation({...defaults, mode: 'pop', weapon: 'ak47', primaryEnabled: true, spread: false, popRamp: true, ...patch});
    next.active = true; return next;
  };
  const run = (s: Simulation, seconds: number, each?: () => void) => {for (let t = 0; t < seconds - 1e-9; t += STEP) {s.advance(STEP); each?.();}};
  const press = (s: Simulation, forward: number, side: number) => {s.input = {...s.input, forward, side};};

  it('starts you grounded on the slope, level with the balls, and keeps you still on it', () => {
    for (const angle of [3, 20, 40]) for (const facing of facings) for (const start of [0, .5, 1]) {
      const s = sim({popRampAngle: angle, popRampFacing: facing, popRampStart: start}), before = {...s.position};
      expect(s.position.y).toBeCloseTo(s.feet + POP_EYE); expect(s.pop!.region.y).toBeCloseTo(s.position.y);
      expect(s.feet).toBeCloseTo(surfaceHeight(s.pop!.ramp!.solid, s.position.x, s.position.z));
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
      const s = sim({popRampFacing: facing, popRampLength: 10, popRampWidth: 16}), began = s.feet; let airborne = 0, off = 0;
      press(s, forward, side);
      run(s, .4, () => {
        if (!s.grounded) airborne++;
        off = Math.max(off, Math.abs(s.feet - surfaceHeight(s.pop!.ramp!.solid, s.position.x, s.position.z)));
      });
      expect([facing, forward, side, Math.sign(s.feet - began), airborne]).toEqual([facing, forward, side, climb, 0]);
      expect(off).toBeLessThan(1e-6);
    }
  });

  it('covers the same ground per second as on the flat, uphill and downhill', () => {
    const walked = (patch: Partial<Settings>) => {const s = sim({popRampLength: 10, ...patch}); const began = s.position.z; press(s, 1, 0); run(s, .8); return s.position.z - began;};
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
      const flat = trace({popRamp: false}, forward, side), onRamp = trace({popRampAngle: angle, popRampFacing: facing}, forward, side);
      const label = `${angle} ${facing} ${forward},${side}`;
      expect(onRamp.airborne, label).toBe(0); expect(onRamp.stop, label).toBe(flat.stop); expect(onRamp.stop, label).toBeLessThan(10);
      expect(onRamp.speeds.length, label).toBe(flat.speeds.length);
      onRamp.speeds.forEach((speed, i) => expect(Math.abs(speed - flat.speeds[i]), `${label} tick ${i}`).toBeLessThan(1e-9));
    }
  });

  it('drops you to the floor when you walk off an edge, and you land standing', () => {
    const top = sim(), side = sim({popRampWidth: 1});
    press(top, 1, 0); press(side, 0, 1);
    for (const s of [top, side]) {
      let fell = 0; const began = s.feet; run(s, 2, () => {if (!s.grounded) fell++;});
      expect(began).toBeGreaterThan(.5); expect(fell).toBeGreaterThan(10); expect(s.feet).toBe(0); expect(s.grounded).toBe(true);
    }
  });

  it('puts you back at the start when the ramp changes, and on the floor when it goes, but not for other changes', () => {
    const s = sim(); press(s, 1, 0); run(s, .5); press(s, 0, 0); run(s, .3);
    const moved = {...s.position}; expect(moved.z).toBeLessThan(2);
    s.configure({...s.settings, popDistance: 20}); expect(s.position).toEqual(moved);
    s.configure({...s.settings, popRampAngle: 25});
    const layout = popRampLayout(ramp({angle: 25, width: 6}));
    expect(s.position.z).toBeCloseTo(layout.start.z); expect(s.feet).toBeCloseTo(layout.start.feet); expect(s.position.y).toBeCloseTo(layout.start.feet + POP_EYE);
    expect(s.velocity).toEqual({x: 0, z: 0}); expect(s.grounded).toBe(true);
    s.configure({...s.settings, popRampFacing: 'right', popRampStart: 0});
    expect(s.position.x).toBeCloseTo(-3); expect(s.feet).toBeCloseTo(popRampLayout(ramp({angle: 25, facing: 'right', start: 0})).start.feet);
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
    const s = sim({popWall: 'left', popRespawnMode: 'pad'});
    expect(s.pop!.solids.map(solid => solid.id)).toEqual(['pop-wall', 'pop-ramp']);
    expect(s.pop!.onPadAt(s.position)).toBe(true);
    expect(s.pop!.pad.x).toBeCloseTo(s.position.x); expect(s.pop!.pad.z).toBeCloseTo(s.position.z);
    expect(s.position.y).toBeCloseTo(s.feet + POP_EYE);
  });
});

describe('the ramp settings', () => {
  it('are bounded like the sliders, rounded to their steps, and fall back to a ramp that rises towards the balls', () => {
    expect(sanitizeSettings({})).toMatchObject({popRamp: false, popRampAngle: 20, popRampLength: 6, popRampWidth: 6, popRampFacing: 'wall', popRampStart: .5});
    expect(sanitizeSettings({popRamp: 'yes', popRampAngle: -1e9, popRampLength: 0, popRampWidth: -3, popRampFacing: 'sideways', popRampStart: -1}))
      .toMatchObject({popRamp: false, popRampAngle: popRampLimits.angle[0], popRampLength: popRampLimits.length[0], popRampWidth: popRampLimits.width[0], popRampFacing: 'wall', popRampStart: 0});
    expect(sanitizeSettings({popRamp: true, popRampAngle: 80, popRampLength: 99, popRampWidth: 99, popRampFacing: 'away', popRampStart: 3}))
      .toMatchObject({popRamp: true, popRampAngle: popRampLimits.angle[1], popRampLength: popRampLimits.length[1], popRampWidth: popRampLimits.width[1], popRampFacing: 'away', popRampStart: 1});
    expect(sanitizeSettings({popRampLength: 6.3, popRampWidth: 4.8, popRampAngle: 17.6, popRampStart: .33}))
      .toMatchObject({popRampLength: 6.5, popRampWidth: 5, popRampAngle: 18, popRampStart: .35});
    for (const facing of facings) expect(sanitizeSettings({popRampFacing: facing}).popRampFacing).toBe(facing);
    expect(popRampLimits).toEqual({angle: [3, 40], length: [2, 10], width: [1, 16]});
    // Even the steepest ramp is ground you can stand on (CS2: surface normal 0.7 and up).
    expect(Math.cos(popRampLimits.angle[1] * DEG)).toBeGreaterThanOrEqual(TERRAIN_RULES.standableNormal);
  });

  it('are saved with a preset, but picking a Pop mode or a built-in preset leaves your ramp alone', () => {
    const settings: Settings = {...defaults, mode: 'pop', popRamp: true, popRampAngle: 28, popRampFacing: 'right', popRampStart: .8};
    const captured = capturePopPreset(settings, false);
    for (const key of popRampKeys) {expect(captured.settings).toHaveProperty(key); expect(popPresetKeys).toContain(key);}
    expect(captured.settings).toMatchObject({popRamp: true, popRampAngle: 28, popRampFacing: 'right', popRampStart: .8});
    for (const preset of popBuiltInPresets) for (const key of popRampKeys) expect(preset.settings, `${preset.id} ${key}`).not.toHaveProperty(key);
    for (const variant of popVariants.map(entry => entry.id)) for (const key of popRampKeys) expect(popVariantPatch(variant), `${variant} ${key}`).not.toHaveProperty(key);
    expect(popPresetPatch({settings: captured.settings})).toMatchObject({popRamp: true, popRampAngle: 28, popRampFacing: 'right'});
    expect(matchesPopPreset({settings: captured.settings}, settings)).toBe(true);
    expect(matchesPopPreset({settings: captured.settings}, {...settings, popRampAngle: 30})).toBe(false);
    // A built-in preset still matches whatever ramp you have, since it never set one.
    expect(matchesPopPreset(popBuiltInPresets[0], {...settings, ...popPresetPatch(popBuiltInPresets[0])})).toBe(true);
  });

  it('come back with Restore drill defaults and show in the setup summary of every Pop mode', () => {
    expect(rangeDrillDefaults('pop')).toMatchObject({popRamp: false, popRampAngle: 20, popRampLength: 6, popRampWidth: 6, popRampFacing: 'wall', popRampStart: .5});
    const botz = sanitizeBotzConfig({}), duel = sanitizeDuelConfig({});
    expect(drillSetupSummary(sanitizeSettings({mode: 'pop', popRamp: true}), botz, duel)).toContain(' · 20° ramp (6 x 6 m), uphill toward the balls');
    expect(drillSetupSummary(sanitizeSettings({mode: 'pop', popRamp: true, popVariant: 'microshot', popRampFacing: 'left', popRampAngle: 12}), botz, duel))
      .toMatch(/^Microshot .* · 12° ramp \(6 x 6 m\), uphill to your left$/);
    expect(drillSetupSummary(sanitizeSettings({mode: 'pop'}), botz, duel)).not.toContain('ramp');
    expect(drillSetupSummary(sanitizeSettings({mode: 'guided', popRamp: true}), botz, duel)).not.toContain('ramp');
  });
});

describe('the ramp controls in the Pop settings', () => {
  const render = (settings: Settings) => renderToStaticMarkup(createElement(TrainingSettings, {settings, update: () => undefined}));
  it('show a switch in every Pop mode and the sliders only while the ramp is up', () => {
    for (const variant of popVariants.map(entry => entry.id)) {
      const html = render({...defaults, mode: 'pop', popVariant: variant});
      expect(html, variant).toContain('>Ramp</label>'); expect(html, variant).not.toContain('Ramp angle'); expect(html, variant).not.toContain('Ramp direction');
      const up = render({...defaults, mode: 'pop', popVariant: variant, popRamp: true, popRampAngle: 27, popRampLength: 7.5});
      for (const label of ['Ramp angle', 'Ramp length', 'Ramp width', 'Ramp direction', 'Start on the ramp']) expect(up, `${variant} ${label}`).toContain(`aria-label="${label}"`);
      // The sliders show the saved values and the limits the sanitizer enforces.
      expect(up).toMatch(/aria-label="Ramp angle" type="range" min="3" max="40" step="1" style="[^"]*" value="27"/);
      expect(up).toMatch(/aria-label="Ramp length" type="range" min="2" max="10" step="0.5" style="[^"]*" value="7.5"/);
      expect(up).toMatch(/aria-label="Ramp width" type="range" min="1" max="16" step="0.5" style="[^"]*" value="6"/);
      expect(up).toMatch(/aria-label="Start on the ramp" type="range" min="0" max="100" step="5" style="[^"]*" value="50"/);
      expect(up).toMatch(/<option value="wall" selected="">Uphill toward the balls<\/option>/);
      for (const [, name] of popRampFacings) expect(up).toContain(`>${name}</option>`);
    }
    expect(render({...defaults, mode: 'guided'})).not.toContain('>Ramp</label>');
  });
});
