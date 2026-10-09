import {describe, expect, it} from 'vitest';
import {STEP, UNIT, advanceActor, idleInput} from '../actor-physics';
import {WeaponRecovery} from '../ballistics';
import {gameData} from '../config';
import {shotDirection} from '../shot-model';
import {sanitizeDuelConfig, duelDefaults, botConfig} from './config';
import {resolveDamage} from './damage';
import {testArena, traceActor, traceSolid} from './geometry';
import {randomStream} from './rng';
import {DuelSimulation} from './simulation';
import {DuelWeaponState} from './weapon-state';

describe('duel contracts and shared kernels', () => {
  it('starts new visitors at level 3 without replacing a saved difficulty', () => {
    expect(duelDefaults.skill).toBe(3);
    expect(sanitizeDuelConfig({}).skill).toBe(3);
    expect(sanitizeDuelConfig({skill: 7}).skill).toBe(7);
  });
  it('validates count, weapon pool, health, armor, rank and per-bot overrides', () => {
    const config = sanitizeDuelConfig({botCount: 999, skill: 20, weapons: ['__proto__', 'mp9', 'mp9'],
      health: -5, armor: false, accuracy: Infinity,
      overrides: [{weapon: 'negev', health: 1000, accuracy: .01}, {weapon: 'forged'}]});
    expect(config.botCount).toBe(5);
    expect(config.skill).toBe(3);
    expect(config.weapons).toEqual(['mp9']);
    expect(config.health).toBe(1);
    expect(botConfig(config, 0)).toMatchObject({weapon: 'negev', health: 500, armor: false, accuracy: .5});
    expect(botConfig(config, 1).weapon).toBe('mp9');
    expect(sanitizeDuelConfig({weapons: [], botCount: NaN})).toMatchObject({weapons: ['ak47'], botCount: 1});
    expect(sanitizeDuelConfig({skill: '10+'}).skill).toBe('10+');
    expect(duelDefaults.armor).toBe(true);
  });

  it('separates seeded actor streams and exactly reproduces them', () => {
    const a = randomStream(42, 'shot:1'), b = randomStream(42, 'shot:1'), c = randomStream(42, 'shot:2');
    const first = Array.from({length: 10}, () => a());
    expect(first).toEqual(Array.from({length: 10}, () => b()));
    expect(first).not.toEqual(Array.from({length: 10}, () => c()));
    expect(first.every(value => value >= 0 && value < 1)).toBe(true);
  });

  it('keeps the original kinematics and shot distribution available to every actor', () => {
    const moving = advanceActor({position: {x: 0, y: 64 * UNIT, z: 0}, velocity: {x: 0, z: 0}, yaw: 0,
      feet: 0, verticalVelocity: 0, eyeHeight: 64 * UNIT, jumpHeld: false},
      {...idleInput(), forward: 1}, gameData.weapons.ak47.speed * UNIT, STEP);
    expect(moving.position.z).toBeLessThan(0);
    const recovery = new WeaponRecovery(gameData.weapons.ak47);
    const base = {yaw: 0, pitch: 0, recoil: recovery.recoil, weapon: gameData.weapons.ak47,
      recovery, walking: false, airborne: false, verticalSpeedUnits: 0, spread: true};
    const idle = shotDirection({...base, speedRatio: 0}, () => .25);
    const running = shotDirection({...base, speedRatio: 1}, () => .25);
    expect(Math.abs(running.y)).toBeGreaterThan(Math.abs(idle.y) * 15);
    expect(shotDirection({...base, speedRatio: 1, spread: false})).toEqual({x: -0, y: 0, z: -1});
  });

  it('drops a tap released before the weapon is ready, like the range and Source', () => {
    const weapon = new DuelWeaponState('ak47', () => 0);
    const actor = {position: {x: 0, y: 64 * UNIT, z: 0}, yaw: 0, pitch: 0,
      velocity: {x: 0, z: 0}, feet: 0, verticalVelocity: 0};
    const command = { ...idleInput(), yawDelta: 0, pitchDelta: 0, fireHeld: false, firePressed: true,
      reloadPressed: false };
    expect(weapon.advance(STEP, STEP, command, actor)).toBeDefined();
    command.firePressed = false;
    weapon.advance(STEP * 2, STEP, command, actor);
    // A press whose release arrives before the cycle ends is not buffered.
    command.firePressed = true;
    expect(weapon.advance(STEP * 3, STEP, command, actor)).toBeUndefined();
    expect(weapon.pendingPress).toBe(false);
    command.firePressed = false;
    let second;
    for (let tick = 4; tick < 16; tick++) second = weapon.advance(tick * STEP, STEP, command, actor) ?? second;
    expect(second).toBeUndefined();
    expect(weapon.ammo).toBe(29);
    expect(weapon.nextAttackTime(command)).toBe(Infinity);
  });

  it('fires at readiness when the trigger is held through the cycle, keeping recoil and cadence', () => {
    const weapon = new DuelWeaponState('ak47', () => 0);
    const actor = {position: {x: 0, y: 64 * UNIT, z: 0}, yaw: 0, pitch: 0,
      velocity: {x: 0, z: 0}, feet: 0, verticalVelocity: 0};
    const command = { ...idleInput(), yawDelta: 0, pitchDelta: 0, fireHeld: false, firePressed: true,
      reloadPressed: false };
    expect(weapon.advance(STEP, STEP, command, actor)).toBeDefined();
    command.firePressed = false;
    weapon.advance(STEP * 2, STEP, command, actor);
    // Pressed early and held: the shot lands at the cycle deadline, not at release.
    command.firePressed = true; command.fireHeld = true;
    expect(weapon.advance(STEP * 3, STEP, command, actor)).toBeUndefined();
    expect(weapon.pendingPress).toBe(true);
    expect(weapon.nextAttackTime(command)).toBeCloseTo(STEP + gameData.weapons.ak47.cycle, 9);
    command.firePressed = false;
    let second;
    for (let tick = 4; tick < 16; tick++) second = weapon.advance(tick * STEP, STEP, command, actor) ?? second;
    expect(second?.ordinal).toBe(1);
    expect(weapon.ammo).toBe(28);
    expect(weapon.recovery.index).toBeGreaterThan(1);
    expect(weapon.recovery.penalty).toBeGreaterThan(gameData.weapons.ak47.stand);
    // Holding a full-auto trigger keeps firing; releasing stops it without a queued shot.
    command.fireHeld = false;
    for (let tick = 16; tick < 40; tick++) expect(weapon.advance(tick * STEP, STEP, command, actor)).toBeUndefined();
    expect(weapon.ammo).toBe(28);
  });
});

describe('headless combat fixtures', () => {
  it.each([2, 20, 60, 100])('applies damage and death on the firing tick at %sm without waiting for a tracer', distance => {
    const arena = {...testArena(), minZ: -150, maxZ: 150};
    const sim = new DuelSimulation(sanitizeDuelConfig({health: 1}), 42, arena);
    sim.actors[0].position = {x: 0, y: 64 * UNIT, z: distance};
    sim.actors[1].position = {x: 0, y: 64 * UNIT, z: 0};
    sim.actors[0].weapon = new DuelWeaponState('ak47', () => 0);
    sim.command(1, {}); sim.start(); sim.command(0, {firePressed: true});
    sim.step();
    const events = sim.drainEvents(), fire = events.find(event => event.kind === 'fire'), hit = events.find(event => event.kind === 'hit');
    expect(fire).toBeDefined();
    expect(hit).toMatchObject({tick: fire!.tick, shooter: 0, victim: 1, lethal: true});
    expect(sim.snapshot()[1]).toMatchObject({health: 0, alive: false});
    expect(sim.phase).toBe('result');
  });

  it('resolves nearer cover before a hittable actor', () => {
    const arena = testArena();
    arena.solids.push({center: {x: 0, y: 1.5, z: 0}, size: {x: 2, y: 3, z: .4}});
    const origin = {x: 0, y: 64 * UNIT, z: 8}, ray = {x: 0, y: 0, z: -1};
    expect(traceSolid(origin, ray, arena).distance).toBeCloseTo(7.8);
    expect(traceActor(origin, ray, {x: 0, y: 0, z: -8}, false).distance).toBeGreaterThan(15);
    const sim = new DuelSimulation(sanitizeDuelConfig({}), 42, arena);
    sim.start(); sim.command(0, {firePressed: true}); sim.step();
    expect(sim.drainEvents().map(event => event.kind)).toEqual(['fire', 'surface']);
    expect(sim.snapshot()[1].health).toBe(100);
  });

  it('computes damage from distance, hitgroup, armor and helmet with explicit approximation', () => {
    const bare = resolveDamage('ak47', 'head', 0, 0, false);
    const helmet = resolveDamage('ak47', 'head', 0, 100, true);
    expect(bare.healthDamage).toBe(144);
    expect(helmet.healthDamage).toBe(111); // 144 * 0.775 = 111.6, truncated like the game
    expect(helmet.armorDamage).toBeGreaterThan(0);
    expect(resolveDamage('ak47', 'leg', 0, 100, true).armorDamage).toBe(0);
    expect(resolveDamage('ak47', 'chest', 30, 0, false).healthDamage).toBeLessThan(36);
  });

  it('allows same-tick mutual kills independent of actor order', () => {
    const sim = new DuelSimulation();
    sim.start();
    sim.command(0, {firePressed: true}); sim.command(1, {firePressed: true}); sim.step();
    const events = sim.drainEvents();
    expect(events.filter(event => event.kind === 'fire')).toHaveLength(2);
    expect(events.filter(event => event.kind === 'hit')).toHaveLength(2);
    expect(sim.snapshot().every(actor => !actor.alive)).toBe(true);
    expect(sim.outcome).toBe('draw');
  });

  it('reloads the player\'s empty magazine by itself once the last shot\'s cycle ends', () => {
    const sim = new DuelSimulation(sanitizeDuelConfig({playerHealth: 500}), 42, testArena(), 'deagle');
    const player = sim.actors[0];
    sim.start(); player.yaw += Math.PI; player.weapon.ammo = 1;
    sim.command(0, {firePressed: true}); sim.step();
    expect(player.weapon.ammo).toBe(0); expect(player.weapon.reload.active).toBe(false);
    const ready = player.weapon.nextShotAt;
    while (sim.time + STEP < ready - 1e-9) sim.step();
    expect(player.weapon.reload.active).toBe(false);
    sim.step(); sim.step();
    expect(player.weapon.reload.active).toBe(true); expect(player.weapon.reloadEmpty).toBe(true);
    expect(sim.drainEvents().some(event => event.kind === 'action' && event.actorId === 0 && event.action === 'reload-start')).toBe(true);
  });

  it('simulates a click at elapsed input time without borrowing a future tick', () => {
    const sim = new DuelSimulation(sanitizeDuelConfig({playerHealth: 500}), 42, testArena());
    sim.start(); sim.actors[0].yaw += Math.PI;
    sim.advance(STEP + .001); sim.drainEvents();
    const tick = sim.tick;
    sim.advance(.002);
    expect(sim.tick).toBe(tick);
    sim.flushInput();
    sim.command(0, {firePressed: true, fireHeld: true});
    expect(sim.stepEarly()).toBe(true);
    expect(sim.tick).toBe(tick);
    expect(sim.time).toBeCloseTo(STEP + .003);
    expect(sim.accumulator).toBe(0);
    expect(sim.drainEvents().some(event => event.kind === 'fire' && event.actorId === 0)).toBe(true);
    sim.stepEarly(); expect(sim.drainEvents().filter(event => event.kind === 'fire')).toEqual([]);
    sim.advance(STEP - .003); expect(sim.tick).toBe(tick + 1);
  });

  it('keeps the predicted local view continuous when input flushes a partial tick', () => {
    const sim = new DuelSimulation(sanitizeDuelConfig({playerHealth: 500}), 42, testArena());
    sim.start(); sim.command(0, {forward: 1});
    for (let i = 0; i < 20; i++) sim.advance(.007);
    const before = sim.renderSnapshot()[0].position;
    sim.flushInput(); sim.command(0, {firePressed: true}); sim.processInput();
    const after = sim.renderSnapshot()[0].position;
    expect(Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z)).toBeLessThan(1e-9);
    sim.advance(.004);
    const later = sim.renderSnapshot()[0].position;
    expect(Math.hypot(later.x - after.x, later.z - after.z)).toBeGreaterThan(0);
  });

  it('freezes combat and clears held inputs on resume', () => {
    const sim = new DuelSimulation(); sim.start(); sim.pause();
    sim.command(0, {fireHeld: true}); sim.advance(5);
    expect(sim.tick).toBe(0);
    sim.resume(); sim.advance(STEP);
    expect(sim.drainEvents()).toEqual([]);
    expect(sim.snapshot()[0].ammo).toBe(30);
  });

  it('replays identical combat and preserves independent actors', () => {
    const run = () => {
      const sim = new DuelSimulation(sanitizeDuelConfig({botCount: 3}), 1234);
      sim.start();
      sim.command(0, {side: 1, fireHeld: true});
      sim.command(1, {side: -1, fireHeld: true});
      sim.command(2, {forward: 1});
      for (let tick = 0; tick < 64; tick++) sim.step();
      return {actors: sim.snapshot(), events: sim.drainEvents()};
    };
    expect(run()).toEqual(run());
    const result = run();
    expect(result.actors[0].position.x).toBeGreaterThan(0);
    expect(result.actors[1].position.x).not.toBe(result.actors[2].position.x);
  });
});
