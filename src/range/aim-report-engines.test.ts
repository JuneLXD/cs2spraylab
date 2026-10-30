import {describe, expect, it} from 'vitest';
import {DEG, STEP} from './actor-physics';
import {aimReport, AimRecorder} from './aim-report';
import {defaults, sanitizeSettings, type Settings} from './config';
import {botzArena, botzDuelConfig, sanitizeBotzConfig} from './duel/botz';
import {DuelSimulation} from './duel/simulation';
import {DuelWeaponState} from './duel/weapon-state';
import {popVariantPatch} from './pop-presets';
import {Simulation} from './simulation';

const seeded = (seed: number) => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;

describe('aim report in AI Duel and Aim Botz', () => {
  const botz = (patch = {}) => {
    const config = sanitizeBotzConfig({botCount: 1, ...patch});
    const sim = new DuelSimulation(botzDuelConfig(config), 7, botzArena(), 'ak47', 'usp', true, config);
    sim.actors[0].weapon = new DuelWeaponState('ak47', () => 0);
    sim.aimLog = new AimRecorder(); sim.start();
    return sim;
  };
  const aimAtHead = (sim: DuelSimulation) => {
    const eye = sim.actors[0].position, bot = sim.actors[1];
    const dx = bot.position.x - eye.x, dy = bot.feet + 1.62 - eye.y, dz = bot.position.z - eye.z;
    sim.actors[0].yaw = Math.atan2(-dx, -dz); sim.actors[0].pitch = Math.asin(dy / Math.hypot(dx, dy, dz));
  };
  const fire = (sim: DuelSimulation) => {sim.command(0, {firePressed: true, fireHeld: true}); sim.step(); sim.command(0, {fireHeld: false}); sim.step();};

  it('records a standing headshot kill on a bot you can see', () => {
    const sim = botz();
    for (let i = 0; i < 16; i++) sim.step();
    aimAtHead(sim); sim.step();
    fire(sim);
    const report = aimReport(sim.aimLog!, {mode: 'botz', label: 'Aim Botz', weapon: 'ak47'})!;
    expect(report).toMatchObject({shots: 1, hits: 1, heads: 1, targets: 1, cleared: 1, firstShot: 1});
    expect(report.movement.standing).toEqual({shots: 1, hits: 1});
    expect(report.click).toMatchObject({n: 1});
  });

  it('times a real counter-strafe: hold D, tap A, shoot', () => {
    const sim = botz();
    sim.command(0, {side: 1});
    for (let t = 0; t < .6; t += STEP) sim.step();
    sim.command(0, {side: -1});
    let steps = 0;
    while (Math.hypot(sim.actors[0].velocity.x, sim.actors[0].velocity.z) / (215 * .0254) > .2 && steps < 64) {sim.step(); steps++;}
    sim.command(0, {side: 0});
    sim.step(); sim.step();
    fire(sim);
    const shot = sim.aimLog!.shots[0];
    expect(shot).toMatchObject({state: 'stopped', first: true, stop: {kind: 'counter'}});
    // CS2's counter-strafe reaches an accurate speed in about 80 ms; the shot came after it.
    expect(shot.stop!.since).toBeGreaterThan(.05); expect(shot.stop!.since).toBeLessThan(.2);
    expect(shot.stop!.accurate).toBeGreaterThanOrEqual(0);
  });

  it('starts a fresh clock in a new round but keeps the session', () => {
    const log = new AimRecorder(), first = botz();
    first.aimLog = log;
    for (let i = 0; i < 16; i++) first.step();
    aimAtHead(first); first.step(); fire(first);
    log.segment();
    const second = botz(); second.aimLog = log;
    for (let i = 0; i < 16; i++) second.step();
    aimAtHead(second); second.step(); fire(second);
    const report = aimReport(log, {mode: 'duel', label: 'AI Duel', weapon: 'ak47'})!;
    expect(report).toMatchObject({shots: 2, hits: 2, cleared: 2});
    expect(report.seconds).toBeGreaterThan(30 * STEP); expect(report.seconds).toBeLessThan(.5);
  });
});

describe('aim report on the range', () => {
  const pop = (patch: Partial<Settings>) => {
    const sim = new Simulation(sanitizeSettings({...defaults, mode: 'pop', weapon: 'ak47', popAmmo: 'magazine', spread: false, ...patch}), seeded(3));
    sim.aimLog = new AimRecorder(); sim.active = true;
    sim.onShot = shot => {
      const hit = sim.pop!.hit(shot.origin, shot.direction, shot.maxDistance, shot.at);
      if (hit) sim.aimLog!.hit(shot.aim, sim.popAimKey(hit.ball.id, hit.life), false, hit.popped);
    };
    return sim;
  };
  const lookAt = (sim: Simulation, index = 0) => {
    const ball = sim.pop!.balls[index], dx = ball.x - sim.position.x, dy = ball.y - sim.position.y, dz = ball.z - sim.position.z;
    // Through mouse look, as a player would, so the report sees the movement.
    const yaw = Math.atan2(-dx, -dz), pitch = Math.atan2(dy, Math.hypot(dx, dz));
    sim.yaw = yaw; sim.pitch = pitch;
  };

  it('scores a popped ball as a cleared target, with you standing', () => {
    const sim = pop({popCount: 1, popHits: 1});
    sim.advance(.2);
    lookAt(sim); sim.advance(.05);
    sim.pressTrigger(); sim.release('mouse'); sim.advance(.05);
    const report = aimReport(sim.aimLog!, {mode: 'pop', label: 'Pop', weapon: 'ak47'})!;
    expect(report).toMatchObject({shots: 1, hits: 1, cleared: 1, targets: 1});
    expect(report.movement.standing.shots).toBe(1);
  });

  it('gives Micro Flicks a new target at every hop', () => {
    const sim = pop({...popVariantPatch('wide'), popHits: 1});
    sim.advance(.2);
    for (let i = 0; i < 3; i++) {
      lookAt(sim); sim.advance(.02);
      // advance() takes at most 0.25 s at a time; the hop finishes well within a second.
      sim.pressTrigger(); sim.release('mouse'); for (let k = 0; k < 4; k++) sim.advance(.25);
    }
    const report = aimReport(sim.aimLog!, {mode: 'pop', label: 'Pop · Micro Flicks', weapon: 'ak47'})!;
    expect(report).toMatchObject({shots: 3, hits: 3, cleared: 3, targets: 3});
  });

  it('counts held-fire clears in Pokeball, which fire no shots', () => {
    const sim = pop({...popVariantPatch('pokeball')});
    sim.advance(.2);
    lookAt(sim); sim.advance(.02);
    sim.pressTrigger(); sim.advance(.3); sim.release('mouse');
    const report = aimReport(sim.aimLog!, {mode: 'pop', label: 'Pop · Pokeball', weapon: 'ak47'})!;
    expect(report.shots).toBe(0);
    expect(report.cleared).toBeGreaterThanOrEqual(1);
  });

  it('records the mouse movement that turns the view, right and down', () => {
    const sim = pop({popCount: 1});
    const log = sim.aimLog!, before = {yaw: sim.yaw, pitch: sim.pitch};
    sim.aim(40, 30);
    const turned = {x: -(sim.yaw - before.yaw) / DEG, y: -(sim.pitch - before.pitch) / DEG};
    expect(turned.x).toBeGreaterThan(0); expect(turned.y).toBeGreaterThan(0);
    sim.advance(.1);
    const report = aimReport(log, {mode: 'pop', label: 'Pop', weapon: 'ak47'});
    // No shot or hit yet: nothing to report, but the movement was recorded for the next flick.
    expect(report).toBeUndefined();
    expect((log as unknown as {events: {ox: number; oy: number}[]}).events[0]).toMatchObject({ox: turned.x, oy: turned.y});
  });
});
