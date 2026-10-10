import {describe, expect, it} from 'vitest';
import {defaults, parseResolution, sanitizeSettings, viewAspect} from './config';
import {applyConsoleCommand} from './console-settings';
import {importCs2Config, exportCfg} from './keybinds/cs2-import';
import {mouseLook} from './mouse-look';
import {Simulation} from './simulation';
import {mouseCompensation} from './spray-demonstration';

const metrics = {screenHeight: 1440, cssHeight: 1080};
const video = (width: string, height: string) => ({name: 'cs2_video.txt', text: `"video.cfg" { "setting.defaultres" "${width}" "setting.defaultresheight" "${height}" }`});
const config = (text: string) => ({name: 'autoexec.cfg', text});
const degrees = (radians: number) => radians * 180 / Math.PI;

describe('CS2 aiming settings', () => {
  it.each([['1920', '1080', 16/9], ['1920', '1440', 4/3], ['1600', '1200', 4/3]])('imports %sx%s and preserves it through saved settings', (width, height, aspect) => {
    const result = importCs2Config([video(width, height)], defaults.keyboard);
    expect(result.resolution).toBe(`${width}x${height}`);
    const saved = sanitizeSettings(JSON.parse(JSON.stringify({...defaults, resolution: result.resolution})));
    expect(saved.resolution).toBe(result.resolution);
    expect(viewAspect(saved.resolution, 1920, 1080)).toBe(aspect);
  });

  it.each([['0', '1080'], ['1920', ''], ['NaN', '1080'], ['1920.5', '1080'], ['99999', '1080']])('does not apply invalid video dimensions %sx%s', (width, height) => {
    expect(importCs2Config([video(width, height)], defaults.keyboard).resolution).toBeUndefined();
  });

  it('retains signed coefficients independently of analog inversion, including an export round trip', () => {
    const imported = importCs2Config([config('sensitivity 1; m_yaw -0.0165; m_pitch -0.044; sensitivity_y_scale 0.5; bind mouse_x !yaw; bind mouse_y !pitch')], defaults.keyboard);
    const settings = sanitizeSettings({...defaults, ...imported.mouse});
    expect(settings).toMatchObject({mouseYaw: -.0165, mousePitch: -.044, sensitivityYScale: .5, invertX: true, invertY: true});
    const look = mouseLook(100, 100, settings);
    expect(degrees(look.yaw)).toBeCloseTo(-1.65, 12);
    expect(degrees(look.pitch)).toBeCloseTo(-2.2, 12);
    const again = importCs2Config([config(exportCfg(imported.profile, {...settings, crosshair: undefined}))], defaults.keyboard);
    expect(again.mouse).toEqual(imported.mouse);
  });

  it('applies imported horizontal and vertical values to actual Range aim, including AWP scope scaling', () => {
    const imported = importCs2Config([config('m_yaw 0.0165; m_pitch 0.044; sensitivity_y_scale 0.5')], defaults.keyboard);
    for (const scoped of [false, true]) {
      const sim = new Simulation({...defaults, ...imported.mouse, mode: 'guided', weapon: scoped ? 'awp' : 'ak47'});
      sim.yaw = sim.pitch = 0;
      if (scoped) {sim.actions.secondary(0); sim.time = .1;}
      sim.aim(100, 100);
      const scale = scoped ? 40/90 : 1;
      expect(degrees(sim.yaw)).toBeCloseTo(-1.65 * scale, 12);
      expect(degrees(sim.pitch)).toBeCloseTo(-2.2 * scale, 12);
    }
  });

  it('keeps existing profiles and touchscreen movement unchanged', () => {
    const old = sanitizeSettings({sensitivity: 1, invertY: true});
    expect(old).toMatchObject({mouseYaw: .022, mousePitch: .022, sensitivityYScale: 1, invertX: false, invertY: true});
    expect(degrees(mouseLook(100, 100, old).pitch)).toBeCloseTo(2.2);
    expect(mouseLook(2, 3, {...old, mouseYaw: .5, mousePitch: 0, sensitivityYScale: 0}, true)).toEqual({yaw: -.005, pitch: .0075});
  });

  it('adapts the compensation preview to the imported axis ratio and directions', () => {
    const settings = {...defaults, mouseYaw: -.0165, mousePitch: -.044, sensitivityYScale: .5, invertY: true};
    const point = {yaw: 3, pitch: 7};
    const correction = mouseCompensation(point, settings.invertY, settings);
    const look = mouseLook(correction.x / .022, correction.y / .022, settings);
    expect(degrees(look.yaw)).toBeCloseTo(point.yaw, 12);
    expect(degrees(look.pitch)).toBeCloseTo(-point.pitch, 12);
  });

  it('preserves zero coefficients and ignores non-finite settings', () => {
    const zero = importCs2Config([config('m_yaw 0; m_pitch 0; sensitivity_y_scale 0')], defaults.keyboard);
    expect(sanitizeSettings({...defaults, ...zero.mouse})).toMatchObject({mouseYaw: 0, mousePitch: 0, sensitivityYScale: 0});
    expect(importCs2Config([config('m_yaw NaN; m_pitch Infinity; sensitivity_y_scale 1e100')], defaults.keyboard).mouse).toEqual({});
    expect(parseResolution('native')).toBe('native');
  });

  it('console toggles and increments use the preserved axis values without changing inversion', () => {
    let settings = {...defaults, invertY: true};
    settings = applyConsoleCommand(settings, ['m_pitch', '-0.044'], metrics)!;
    settings = applyConsoleCommand(settings, ['m_yaw', '0'], metrics)!;
    settings = applyConsoleCommand(settings, ['incrementvar', 'sensitivity_y_scale', '0', '3', '0.5'], metrics)!;
    expect(settings).toMatchObject({mousePitch: -.044, mouseYaw: 0, sensitivityYScale: 1.5, invertY: true});
    settings = applyConsoleCommand(settings, ['toggle', 'm_yaw', '0', '0.0165'], metrics)!;
    expect(settings.mouseYaw).toBe(.0165);
  });
});
