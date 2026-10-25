import {describe, expect, it, vi} from 'vitest';
import {defaults, sanitizeSettings} from './config';
import {POP_CENTER_HOLD, POP_SPAWN, PopField, popConfig} from './pop';
import {capturePopPreset, popPresetPatch, popVariantPatch} from './pop-presets';
import {DEG, Simulation} from './simulation';
import {rangeDrillDefaults} from './ui/drill-setup';

const settings = {...defaults, mode: 'pop' as const, ...popVariantPatch('precision')};
const ray = (point: {x: number; y: number; z: number}) => {
  const x = point.x - POP_SPAWN.x, y = point.y - POP_SPAWN.y, z = point.z - POP_SPAWN.z, d = Math.hypot(x, y, z);
  return {x: x / d, y: y / d, z: z / d};
};
const away = {x: 0, y: 1, z: 0};
const arm = (field: PopField, time = 0) => {
  field.advance(time, POP_SPAWN, ray(field.center!));
  field.advance(time + POP_CENTER_HOLD + 1e-6, POP_SPAWN, ray(field.center!));
};
const seeded = (seed: number) => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;

describe('Center Return', () => {
  it('waits for a continuous center fixation, without counting or requiring a shot', () => {
    const field = new PopField(popConfig(settings), POP_SPAWN, seeded(1)), center = {...field.center!};
    expect(field.balls).toEqual([]); expect(field.precisionPhase).toBe('center');
    expect(field.hit(POP_SPAWN, ray(center))).toBeUndefined();
    field.advance(1, POP_SPAWN, away); expect(field.balls).toEqual([]);
    field.advance(2, POP_SPAWN, ray(center)); field.advance(2.06, POP_SPAWN, ray(center));
    expect(field.balls).toEqual([]); expect(field.centerProgress).toBeCloseTo(.5);
    field.advance(2.07, POP_SPAWN, away); expect(field.centerProgress).toBe(0);
    field.advance(2.08, POP_SPAWN, ray(center)); field.advance(2.15, POP_SPAWN, ray(center));
    expect(field.balls).toEqual([]);
    field.advance(2.21, POP_SPAWN, ray(center));
    expect(field.precisionPhase).toBe('target'); expect(field.balls).toHaveLength(1);
    expect([field.pops, field.hits, field.shots]).toEqual([0, 0, 0]); expect(field.center).toEqual(center);
    expect(field.aimedAtCenter({x: 0, y: center.y, z: center.z - 1}, {x: 0, y: 0, z: 1})).toBe(false);
  });

  it('enters from either edge and moves horizontally across a varying-height lane', () => {
    const field = new PopField(popConfig(settings), POP_SPAWN, seeded(7)), sides = new Set<number>(), heights = new Set<number>();
    for (let i = 0; i < 50; i++) {
      const at = i * 3; arm(field, at);
      const ball = field.balls[0], x = ball.x, y = ball.y;
      expect(Math.abs(x)).toBeCloseTo(field.region.halfW - ball.radius);
      expect(x * ball.vx).toBeLessThan(0); expect(Math.abs(ball.vx)).toBe(.8);
      sides.add(Math.sign(x)); heights.add(y);
      field.advance(at + POP_CENTER_HOLD + .2 + 1e-6, POP_SPAWN, away);
      expect(ball.x).toBeCloseTo(x + ball.vx * .2); expect(ball.y).toBe(y);
      expect(field.hit(POP_SPAWN, ray(field.center!))).toBeUndefined();
      expect(field.hit(POP_SPAWN, ray(ball), Infinity, at + .4)?.popped).toBe(true);
      expect(field.balls).toEqual([]); expect(field.precisionPhase).toBe('center');
    }
    expect(sides.size).toBe(2); expect(heights.size).toBeGreaterThan(10);
    expect(field.pops).toBe(50);
  });

  it('requires a fresh return to center after a hit and honours the between-rep delay', () => {
    const field = new PopField(popConfig({...settings, popRespawn: 1}), POP_SPAWN, seeded(2));
    arm(field); field.hit(POP_SPAWN, ray(field.balls[0]), Infinity, .2);
    field.advance(.3, POP_SPAWN, away); field.advance(1.1, POP_SPAWN, away);
    expect(field.balls).toEqual([]); expect(field.pending).toEqual([]);
    arm(field, 1.11);
    expect(field.balls).toHaveLength(1);
    field.hit(POP_SPAWN, ray(field.balls[0]), Infinity, 1.3);
    arm(field, 1.4); expect(field.balls).toEqual([]);
    field.advance(2.29, POP_SPAWN, ray(field.center!)); expect(field.balls).toEqual([]);
    field.advance(2.3, POP_SPAWN, ray(field.center!)); expect(field.balls).toHaveLength(1);
  });

  it('removes an escaped target and requires centering again, without awarding a pop', () => {
    const field = new PopField(popConfig(settings), POP_SPAWN, seeded(3));
    arm(field); field.advance(10, POP_SPAWN, away);
    expect(field.balls).toEqual([]); expect(field.precisionPhase).toBe('center'); expect(field.pops).toBe(0);
    field.advance(20, POP_SPAWN, away); expect(field.balls).toEqual([]);
    arm(field, 21); expect(field.balls).toHaveLength(1);
  });

  it('keeps multi-hit targets moving until popped and resets to the center phase', () => {
    const field = new PopField(popConfig({...settings, popHits: 2}), POP_SPAWN, seeded(4));
    arm(field); const ball = field.balls[0];
    expect(field.hit(POP_SPAWN, ray(ball))?.popped).toBe(false);
    field.advance(.3, POP_SPAWN, away); expect(field.balls[0]).toBe(ball); expect(ball.hits).toBe(1);
    expect(field.hit(POP_SPAWN, ray(ball))?.popped).toBe(true);
    field.reset(); expect(field.balls).toEqual([]); expect(field.precisionPhase).toBe('center');
    expect([field.hits, field.pops, field.shots, field.centerProgress]).toEqual([0, 0, 0, 0]);
    arm(field, 1); expect(field.balls).toHaveLength(1);
  });

  it('keeps even maximum-size targets clear of the center and bounded on a close panel', () => {
    const field = new PopField(popConfig({...settings, popSize: 80, popDistance: 3}), POP_SPAWN, () => .5);
    arm(field);
    const ball = field.balls[0];
    field.advance(POP_CENTER_HOLD + 1e-6 + Math.abs(ball.x) / field.config.precisionSpeed, POP_SPAWN, away);
    expect(ball.x).toBeCloseTo(0); expect(field.hit(POP_SPAWN, ray(field.center!))).toBeUndefined();
    expect(Math.abs(ball.y - field.region.y) + ball.radius).toBeLessThanOrEqual(field.region.halfH + 1e-9);
  });

  it('does not arm behind the menu and uses the live simulation aim when entered', () => {
    const sim = new Simulation(settings, seeded(3));
    sim.advance(.25); expect(sim.pop!.balls).toEqual([]);
    sim.active = true; sim.yaw = .5; sim.advance(.25); expect(sim.pop!.balls).toEqual([]);
    sim.yaw = 0; sim.advance(.2); expect(sim.pop!.balls).toHaveLength(1);
    const x = sim.pop!.balls[0].x;
    sim.active = false; sim.advance(.25); expect(sim.pop!.balls[0].x).toBe(x);
  });

  it.each([false, true])('arms using the displayed crosshair under recoil (follow %s)', follow => {
    const sim = new Simulation({...settings, follow, weapon: 'ak47', primaryEnabled: true}, seeded(5));
    vi.spyOn(sim.recovery, 'recoil', 'get').mockReturnValue({yaw: 0, pitch: 8});
    sim.active = true; sim.advance(.2); expect(sim.pop!.balls).toEqual([]);
    sim.pitch = -8 * DEG * (follow ? 1 : .45);
    sim.advance(.2); expect(sim.pop!.balls).toHaveLength(1);
  });

  it('bounds, persists and resets the dedicated speed setting', () => {
    expect(sanitizeSettings({}).popPrecisionSpeed).toBe(.8);
    expect(sanitizeSettings({popPrecisionSpeed: 0}).popPrecisionSpeed).toBe(.1);
    expect(sanitizeSettings({popPrecisionSpeed: 100}).popPrecisionSpeed).toBe(3);
    const captured = capturePopPreset({...settings, popPrecisionSpeed: 1.7}, false);
    expect(popPresetPatch(captured).popPrecisionSpeed).toBe(1.7);
    expect(rangeDrillDefaults('pop').popPrecisionSpeed).toBe(.8);
  });
});
