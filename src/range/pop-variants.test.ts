import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';
import {Mesh, MeshBasicMaterial, Raycaster, Vector3} from 'three';
import {popFrameGeometry} from './pop-geometry';
import {defaults, sanitizeSettings} from './config';
import {POP_SPAWN, PopField, popConfig, type PopVariant} from './pop';
import {capturePopPreset, matchesPopPreset, popBuiltInPresets, popPresetPatch, popVariantPatch, sanitizeSavedPopPresets} from './pop-presets';
import {Simulation} from './simulation';
import {rangeDrillDefaults} from './ui/drill-setup';
import {TrainingSettings} from './ui/screens/TrainingSettings';

const random = (seed: number) => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const setup = (variant: PopVariant) => sanitizeSettings({...defaults, mode: 'pop', ...popVariantPatch(variant)});
const aim = (to: {x: number; y: number; z: number}) => {
  const x = to.x - POP_SPAWN.x, y = to.y - POP_SPAWN.y, z = to.z - POP_SPAWN.z, length = Math.hypot(x, y, z);
  return {x: x / length, y: y / length, z: z / length};
};

describe('Pop specific modes', () => {
  it('renders all four sides of the square outline with an open centre', () => {
    const geometry = popFrameGeometry(1, 1, .3), material = new MeshBasicMaterial(), mesh = new Mesh(geometry, material);
    for (const [x, y] of [[0, -.85], [.85, 0], [0, .85], [-.85, 0]]) {
      expect(new Raycaster(new Vector3(x, y, 1), new Vector3(0, 0, -1)).intersectObject(mesh).length).toBeGreaterThan(0);
    }
    expect(new Raycaster(new Vector3(0, 0, 1), new Vector3(0, 0, -1)).intersectObject(mesh)).toHaveLength(0);
    geometry.dispose(); material.dispose();
  });

  it('keeps far Wide Flicks targets inside the physical range walls', () => {
    const field = new PopField(popConfig({...setup('wide'), popDistance: 40}), POP_SPAWN, random(7));
    expect(field.region.halfW).toBe(11);
    for (let i = 0; i < 100; i++) {
      const ball = field.balls[0];
      expect(Math.abs(ball.x) + ball.radius).toBeLessThan(11.75);
      field.hit(POP_SPAWN, aim(ball));
    }
  });
  it.each(['wide', 'microshot'] as const)('%s keeps one target fully inside its panel across 200 replacements', variant => {
    const field = new PopField(popConfig(setup(variant)), POP_SPAWN, random(7));
    let previous = field.balls[0];
    for (let i = 0; i < 200; i++) {
      expect(field.balls).toHaveLength(1);
      const ball = field.balls[0];
      expect(Math.abs(ball.x - field.region.x) + ball.radius).toBeLessThanOrEqual(field.region.halfW + 1e-9);
      expect(Math.abs(ball.y - field.region.y) + ball.radius).toBeLessThanOrEqual(field.region.halfH + 1e-9);
      if (i) {
        expect(Math.hypot(ball.x - previous.x, ball.y - previous.y)).toBeGreaterThanOrEqual(field.config.size * 1.5 - 1e-9);
        if (variant === 'wide') expect((ball.x - field.region.x) * (previous.x - field.region.x)).toBeLessThan(0);
      }
      expect(field.hit(POP_SPAWN, aim(ball))?.popped).toBe(true);
      previous = ball;
    }
    expect(field.pops).toBe(200);
  });

  it.each(['wide', 'microshot'] as const)('%s stays bounded with extreme size/distance and a constant random source', variant => {
    const field = new PopField(popConfig({...setup(variant), popSize: 80, popDistance: 3}), POP_SPAWN, () => .5);
    for (let i = 0; i < 20; i++) {
      const ball = field.balls[0];
      expect(Math.abs(ball.x) + ball.radius).toBeLessThanOrEqual(field.region.halfW + 1e-9);
      expect(Math.abs(ball.y - field.region.y) + ball.radius).toBeLessThanOrEqual(field.region.halfH + 1e-9);
      field.hit(POP_SPAWN, aim(ball));
      expect(Math.hypot(field.balls[0].x - ball.x, field.balls[0].y - ball.y)).toBeGreaterThan(0);
    }
  });

  it('uses a rectangular hit area for Microshot, including corners and the hollow centre', () => {
    const field = new PopField(popConfig({...setup('microshot'), popHits: 3}), POP_SPAWN, random(4));
    const ball = field.balls[0];
    expect(field.hit(POP_SPAWN, aim({...ball, x: ball.x + ball.radius * 1.01}))).toBeUndefined();
    expect(field.hit(POP_SPAWN, {x: 1, y: 0, z: 0})).toBeUndefined();
    expect(field.hit(POP_SPAWN, {x: 0, y: 0, z: 1})).toBeUndefined();
    expect(field.hit(POP_SPAWN, aim(ball), 1)).toBeUndefined();
    expect(field.hit(POP_SPAWN, aim({...ball, x: ball.x + ball.radius * .95, y: ball.y + ball.radius * .95}))?.popped).toBe(false);
    expect(field.hit(POP_SPAWN, aim(ball))?.popped).toBe(false);
    expect(field.hit(POP_SPAWN, aim({...ball, x: ball.x - ball.radius}))?.popped).toBe(true);
    expect(field.hits).toBe(3); expect(field.pops).toBe(1);
  });

  it('retains the previous side through delayed respawn and resets the session cleanly', () => {
    const field = new PopField(popConfig({...setup('wide'), popRespawn: .5}), POP_SPAWN, random(4));
    const ball = field.balls[0];
    field.hit(POP_SPAWN, aim(ball), Infinity, 2);
    expect(field.balls).toHaveLength(0);
    field.advance(2.49); expect(field.balls).toHaveLength(0);
    field.advance(2.5); expect(field.balls).toHaveLength(1);
    expect(field.balls[0].x * ball.x).toBeLessThan(0);
    field.hit(POP_SPAWN, aim(field.balls[0])); field.reset(); field.advance(10);
    expect(field.balls).toHaveLength(1); expect(field.pending).toEqual([]); expect(field.pops).toBe(0);
  });

  it('isolates single-target rules from hidden classic settings and repositions on a mode change', () => {
    const settings = {...setup('classic'), popWall: 'both' as const, popRespawnMode: 'pad' as const, popMoveX: 4};
    const sim = new Simulation(settings, random(1));
    sim.position.x = 5; sim.yaw = 1;
    sim.configure({...settings, popVariant: 'microshot'});
    expect(sim.position).toEqual(POP_SPAWN); expect(sim.yaw).toBe(0);
    expect(sim.pop!.balls).toHaveLength(1); expect(sim.pop!.moving).toBe(false); expect(sim.pop!.wall).toBeUndefined();
    expect(sim.pop!.config.respawnMode).toBe('timer');
    sim.configure(settings);
    expect(sim.pop!.balls).toHaveLength(5); expect(sim.pop!.wall).toBeDefined(); expect(sim.pop!.moving).toBe(true);
  });

  it('saves the variant, migrates old presets to Classic, and restores Classic defaults', () => {
    const micro = setup('microshot'), captured = capturePopPreset(micro, false);
    const [saved] = sanitizeSavedPopPresets([{id: 'user-micro', name: 'Micro', ...captured}]);
    expect(popPresetPatch(saved).popVariant).toBe('microshot');
    expect(matchesPopPreset(saved, micro)).toBe(true);
    const old = {settings: {popSize: 18}};
    expect(popPresetPatch(old).popVariant).toBe('classic');
    expect(matchesPopPreset(old, micro)).toBe(false);
    expect(sanitizeSettings({popVariant: 'invalid'}).popVariant).toBe('classic');
    expect(sanitizeSettings({}).popVariant).toBe('classic');
    expect(rangeDrillDefaults('pop').popVariant).toBe('classic');
    for (const preset of popBuiltInPresets) expect(popPresetPatch(preset).popVariant).toBe('classic');
    const changed = {...micro, ...popVariantPatch('wide')};
    expect(changed.popColor).toBe(micro.popColor); expect(changed.weapon).toBe(micro.weapon); expect(changed.popSound).toBe(micro.popSound);
  });

  it('shows the mode selector and only applicable controls for specific modes', () => {
    const html = renderToStaticMarkup(createElement(TrainingSettings, {settings: setup('microshot'), update: () => {}}));
    expect(html).toContain('aria-label="Pop mode"'); expect(html).toContain('Microshot');
    expect(html).toContain('Target size'); expect(html).toContain('Distance to the target');
    expect(html).not.toContain('Balls at once'); expect(html).not.toContain('Peek wall'); expect(html).not.toContain('Left-right speed');
  });
});
