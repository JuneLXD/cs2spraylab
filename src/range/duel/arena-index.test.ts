import {describe, expect, it} from 'vitest';
import {advanceActor, STEP, UNIT, type ActorKinematics, type MoveInput} from '../actor-physics';
import {canFitInArena, traceSolid, traceSolidUnindexed, type Arena, type Solid} from './geometry';
import {arenaMovementEnvironment, arenaTerrain, arenaTerrainNear} from './traversal';
import {randomStream} from './rng';

/** A map-sized arena: thousands of boxes of all sizes, a few ramps and some boxes bullets pass through. */
function bigArena(seed: number, count = 2000): Arena {
  const random = randomStream(seed, 'arena-index');
  const solids: Solid[] = Array.from({length: count}, (_, i) => {
    const size = {x: .1 + random() * (random() < .1 ? 12 : 2), y: .1 + random() * 3, z: .1 + random() * (random() < .1 ? 12 : 2)};
    return {center: {x: -30 + random() * 60, y: size.y / 2 + (random() < .3 ? random() * 4 : 0), z: -30 + random() * 60}, size,
      ...(i % 97 === 0 ? {shape: {kind: 'ramp' as const, axis: random() < .5 ? 'x' as const : 'z' as const, highSide: random() < .5 ? -1 as const : 1 as const}} : {}),
      ...(i % 13 === 0 ? {shotBlocking: false} : {})};
  });
  return {minX: -32, maxX: 32, minZ: -32, maxZ: 32, solids};
}

describe('large arena indexes', () => {
  it('a traced ray hits exactly what a full scan hits', () => {
    const arena = bigArena(3), random = randomStream(9, 'rays');
    let hits = 0;
    for (let n = 0; n < 3000; n++) {
      const origin = {x: -45 + random() * 90, y: random() * 5, z: -45 + random() * 90};
      // Include axis-aligned and vertical rays, and unnormalised directions.
      const pick = random(), scale = .5 + random() * 2;
      const raw = pick < .1 ? {x: random() < .5 ? -1 : 1, y: 0, z: 0} : pick < .2 ? {x: 0, y: 0, z: random() < .5 ? -1 : 1}
        : pick < .25 ? {x: 0, y: -1, z: 0} : {x: random() * 2 - 1, y: random() * .6 - .3, z: random() * 2 - 1};
      const direction = {x: raw.x * scale, y: raw.y * scale, z: raw.z * scale};
      const max = random() < .3 ? Infinity : random() * 60;
      const indexed = traceSolid(origin, direction, arena, max), full = traceSolidUnindexed(origin, direction, arena, max);
      expect([indexed.distance, indexed.exitDistance, indexed.surfaceId], `ray ${n}`).toEqual([full.distance, full.exitDistance, full.surfaceId]);
      if (Number.isFinite(full.distance)) hits++;
    }
    expect(hits).toBeGreaterThan(1000);
  });

  it('small arenas keep every box for movement; large ones hand over the same moves with only the nearby boxes', () => {
    const small: Arena = {minX: -10, maxX: 10, minZ: -10, maxZ: 10, solids: bigArena(1, 50).solids};
    expect(arenaTerrainNear(small, {x: 0, y: 0, z: 0})).toBe(arenaTerrain(small));
    const arena = bigArena(5), random = randomStream(4, 'walk');
    expect(arenaTerrainNear(arena, {x: 0, y: 0, z: 0}).length).toBeLessThan(arenaTerrain(arena).length / 10);
    // Start somewhere with room to stand.
    let start = {x: 0, y: 64 * UNIT, z: 0};
    for (let tries = 0; !canFitInArena(start, 0, 72 * UNIT, arena); tries++) start = {x: -20 + random() * 40, y: 64 * UNIT, z: -20 + random() * 40};
    let full: ActorKinematics = {position: start, velocity: {x: 0, z: 0}, yaw: 0, feet: 0, verticalVelocity: 0,
      eyeHeight: 64 * UNIT, duckAmount: 0, jumpHeld: false};
    let local = {...full};
    let input: MoveInput = {forward: 1, side: 0, walk: false, crouch: false, jump: false};
    for (let tick = 0; tick < 1500; tick++) {
      if (tick % 40 === 0) input = {forward: random() < .8 ? 1 : -1, side: Math.round(random() * 2 - 1), walk: false, crouch: random() < .2, jump: random() < .15};
      full = advanceActor({...full, yaw: full.yaw + .01}, input, 250 * UNIT, STEP, undefined, undefined, undefined, arenaMovementEnvironment(arena, [], 0, tick * STEP, 0));
      local = advanceActor({...local, yaw: local.yaw + .01}, input, 250 * UNIT, STEP, undefined, undefined, undefined,
        arenaMovementEnvironment(arena, [], 0, tick * STEP, 0, local.position));
      expect(local.position, `tick ${tick}`).toEqual(full.position);
      expect(local.feet).toBe(full.feet);
    }
    expect(Math.hypot(full.position.x - start.x, full.position.z - start.z)).toBeGreaterThan(1);
  });
});
