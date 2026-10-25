import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';
import {Mesh, MeshBasicMaterial, Raycaster, Vector3} from 'three';
import {popFrameGeometry} from './pop-geometry';
import {defaults, sanitizeSettings} from './config';
import {POP_SPAWN, type PopVariant} from './pop';
import {capturePopPreset, matchesPopPreset, popBuiltInPresets, popPresetPatch, popVariantPatch, sanitizeSavedPopPresets} from './pop-presets';
import {Simulation} from './simulation';
import {rangeDrillDefaults} from './ui/drill-setup';
import {TrainingSettings} from './ui/screens/TrainingSettings';

const random = (seed: number) => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const setup = (variant: PopVariant) => sanitizeSettings({...defaults, mode: 'pop', ...popVariantPatch(variant)});
describe('Pop specific modes', () => {
  it('renders all four sides of the square outline with an open centre', () => {
    const geometry = popFrameGeometry(1, 1, .3), material = new MeshBasicMaterial(), mesh = new Mesh(geometry, material);
    for (const [x, y] of [[0, -.85], [.85, 0], [0, .85], [-.85, 0]]) {
      expect(new Raycaster(new Vector3(x, y, 1), new Vector3(0, 0, -1)).intersectObject(mesh).length).toBeGreaterThan(0);
    }
    expect(new Raycaster(new Vector3(0, 0, 1), new Vector3(0, 0, -1)).intersectObject(mesh)).toHaveLength(0);
    geometry.dispose(); material.dispose();
  });

  it('isolates specific-mode rules from hidden classic settings and repositions on a mode change', () => {
    const settings = {...setup('classic'), popWall: 'both' as const, popRespawnMode: 'pad' as const, popMoveX: 4};
    const sim = new Simulation(settings, random(1));
    sim.position.x = 5; sim.yaw = 1;
    sim.configure({...settings, popVariant: 'microshot'});
    expect(sim.position).toEqual(POP_SPAWN); expect(sim.yaw).toBe(0);
    expect(sim.pop!.balls).toHaveLength(3); expect(sim.pop!.moving).toBe(false); expect(sim.pop!.wall).toBeUndefined();
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
