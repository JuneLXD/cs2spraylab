import {describe, expect, it} from 'vitest';
import {defaults, sanitizeSettings, type Settings} from '../config';
import {applyConsoleCommand} from '../console-settings';
import {cvarAssignment} from './console';
import {importCs2Config} from './cs2-import';
import {applyCrosshairCommand, bround, crosshairFromCvars, cvarsFromCrosshair, sanitizeCs2Crosshair, videoHeight} from './crosshair-cvars';
import {defaultKeyboard} from './profile';
import {BindRuntime, type BindEvent} from './runtime';

const at1080 = {screenHeight: 1080, cssHeight: 1080};
const view = (cvars: Record<string, string>, screenHeight = 1080, cssHeight = 1080) => crosshairFromCvars({cvars, screenHeight}, cssHeight);

describe('CS2 crosshair convars', () => {
  it('rounds scaled sizes half to even, as CS did', () => {
    expect([2.5, 3.5, -2.5, 6.75, .225].map(bround)).toEqual([2, 4, -2, 7, 0]);
  });

  it('converts pre-update units: 1/480ths of the screen height, gap 4 + raw pixels', () => {
    // A small outlined dot: size -1 hides the bars, thickness 1.5 is 3 px at 1080p.
    expect(view({cl_crosshairsize: '-1', cl_crosshairgap: '-3', cl_crosshairthickness: '1.5', cl_crosshairdot: 'true',
      cl_crosshairstyle: '4', cl_crosshaircolor: '5', cl_crosshaircolor_r: '255', cl_crosshaircolor_g: '0', cl_crosshaircolor_b: '0',
      cl_crosshairalpha: '255', cl_crosshairusealpha: 'true', cl_crosshair_drawoutline: 'true', cl_crosshair_outlinethickness: '0.1'}).crosshair)
      .toEqual({color: '#ff0000', size: 0, gap: 1, thickness: 3, outline: 1, alpha: 1, dot: true, t: false, dynamic: false});
    expect(view({cl_crosshairsize: '3', cl_crosshairgap: '0.7', cl_crosshairthickness: '0.1'}).crosshair)
      .toMatchObject({size: 7, gap: 4, thickness: 1});
    // The gap is not resolution-scaled; size and thickness are.
    expect(view({cl_crosshairsize: '3', cl_crosshairgap: '0', cl_crosshairthickness: '1'}, 1440, 1440).crosshair)
      .toMatchObject({size: 9, gap: 4, thickness: 3});
  });

  it('keeps the on-screen size for a lower or stretched CS2 resolution', () => {
    // CS2 at 1280x960 stretched to a 1080-pixel monitor.
    expect(view({cl_crosshairsize: '3', cl_crosshairgap: '0', cl_crosshairthickness: '1'}, 960, 1080).crosshair)
      .toMatchObject({size: 6.75, gap: 4.5, thickness: 2.25});
  });

  it('reads the pixel-based names, scaled from the height they were authored at', () => {
    const pixels = {cl_crosshair_length: '8', cl_crosshair_thickness: '1', cl_crosshair_gap: '4', cl_crosshair_screen_height: '1080'};
    // The gap is the centre-to-bar distance whatever the thickness (client, build 2000930).
    expect(view(pixels).crosshair).toMatchObject({size: 8, thickness: 1, gap: 4});
    expect(view({...pixels, cl_crosshair_thickness: '2'}).crosshair).toMatchObject({thickness: 2, gap: 4});
    // Rescaled to 1440: 8 * 4/3 = 10.67 -> 11, 4 * 4/3 = 5.33 -> 5, thickness 1.33 -> 1.
    expect(view(pixels, 1440, 1440).crosshair).toMatchObject({size: 11, thickness: 1, gap: 5});
    // Tiny values survive a downscale as one pixel; a zero gap stays zero.
    expect(view({...pixels, cl_crosshair_gap: '1', cl_crosshair_thickness: '1'}, 540, 540).crosshair).toMatchObject({thickness: 1, gap: 1});
    expect(view({...pixels, cl_crosshair_gap: '0'}, 540, 540).crosshair).toMatchObject({gap: 0});
  });

  it('uses whichever naming scheme set a size last', () => {
    expect(view({cl_crosshair_length: '8', cl_crosshairsize: '3'}).crosshair.size).toBe(7);
    expect(view({cl_crosshairsize: '3', cl_crosshair_length: '8'}).crosshair.size).toBe(8);
    expect(view({cl_crosshairalpha: '100', cl_crosshaircolor_a: '255'}).crosshair.alpha).toBe(1);
    expect(view({cl_crosshaircolor_a: '255', cl_crosshairalpha: '100'}).crosshair.alpha).toBe(.39);
  });

  it('maps colours, opacity and styles', () => {
    expect(view({cl_crosshaircolor: '1', cl_crosshaircolor_r: '255'}).crosshair.color).toBe('#32fa32');
    const additive = view({cl_crosshairusealpha: '0', cl_crosshairalpha: '50'});
    expect(additive.crosshair.alpha).toBe(.78);
    expect(additive.notes).toContain('additive blending is shown as 78% opacity');
    expect(view({cl_crosshairstyle: '0'}).crosshair.dynamic).toBe(true);
    expect(view({cl_crosshairstyle: '1'}).crosshair.dynamic).toBe(false);
    expect(view({cl_crosshairstyle: '6', cl_crosshair_length: '10'}).crosshair).toMatchObject({size: 0, dot: true});
    const quadrant = view({cl_crosshairstyle: '7', cl_crosshair_length: '6'});
    expect(quadrant.crosshair.dynamic).toBe(true);
    expect(quadrant.notes).toEqual(['quadrant styles are drawn as a cross']);
    expect(view({cl_crosshair_drawoutline: '2'}).crosshair.outline).toBe(.5);
    expect(view({cl_crosshair_drawoutline: 'false'}).crosshair.outline).toBe(0);
    expect(view({cl_crosshair_recoil: 'true'}).follow).toBe(true);
  });

  it('round-trips a trainer crosshair through the pixel names', () => {
    const crosshair = {...defaults.crosshair, size: 6, gap: 3, thickness: 1, color: '#12abef', alpha: .5, dot: true, t: true, dynamic: true};
    const source = cvarsFromCrosshair(crosshair, 1080, 1080);
    expect(source.cvars).toMatchObject({cl_crosshair_length: '6', cl_crosshair_gap: '3', cl_crosshair_thickness: '1', cl_crosshairstyle: '0',
      cl_crosshaircolor_r: '18', cl_crosshaircolor_g: '171', cl_crosshaircolor_b: '239', cl_crosshaircolor_a: '128'});
    expect(crosshairFromCvars(source, 1080).crosshair).toEqual({...crosshair, alpha: .5});
  });

  it('applies console assignments, toggles and incrementvar, newest last', () => {
    const start = {cvars: {cl_crosshairsize: '3', cl_crosshairdot: '0'}, screenHeight: 1080};
    const dot = applyCrosshairCommand(start, ['cl_crosshairdot', '1'])!;
    expect(Object.keys(dot.cvars)).toEqual(['cl_crosshairsize', 'cl_crosshairdot']);
    expect(applyCrosshairCommand(dot, ['toggle', 'cl_crosshairdot'])!.cvars.cl_crosshairdot).toBe('0');
    expect(applyCrosshairCommand(start, ['toggle', 'cl_crosshairsize', '1', '3', '5'])!.cvars.cl_crosshairsize).toBe('5');
    expect(applyCrosshairCommand(start, ['incrementvar', 'cl_crosshairsize', '0', '4', '1'])!.cvars.cl_crosshairsize).toBe('4');
    expect(applyCrosshairCommand(start, ['incrementvar', 'cl_crosshairsize', '0', '3', '1'])!.cvars.cl_crosshairsize).toBe('0');
    expect(applyCrosshairCommand(start, ['cl_crosshairoutlinethickness', '1'])).toBeUndefined();
    expect(applyCrosshairCommand(start, ['cl_crosshairsize', 'big'])).toBeUndefined();
    expect(applyCrosshairCommand(start, ['fps_max', '0'])).toBeUndefined();
  });

  it('cycles toggle values like the Source console', () => {
    const value = (args: string[], now?: string) => cvarAssignment(args, () => now)?.value;
    expect(value(['toggle', 'cl_radar_scale', '0.3', '1'], '0.300000')).toBe('1');
    expect(value(['toggle', 'cl_radar_scale', '0.3', '1'], '1')).toBe('0.3');
    expect(value(['toggle', 'cl_radar_scale', '0.3', '1'], '0.7')).toBe('0.3');
    expect(value(['toggle', 'crosshair'], 'true')).toBe('0');
    expect(value(['toggle', 'crosshair'], '0')).toBe('1');
    expect(value(['incrementvar', 'volume', '0', '1', '-0.25'], '0')).toBe('1');
    expect(value(['buymenu'])).toBeUndefined();
  });

  it('sanitizes stored convars and reads the CS2 resolution', () => {
    expect(sanitizeCs2Crosshair({screenHeight: 99999, cvars: {CL_CROSSHAIRSIZE: '3', cl_crosshairgap: 'x', fps_max: '0', cl_crosshairdot: true}}))
      .toEqual({screenHeight: 4320, cvars: {cl_crosshairsize: '3'}});
    expect(sanitizeCs2Crosshair({screenHeight: 1080, cvars: {fps_max: '0'}})).toBeUndefined();
    expect(videoHeight('"video.cfg"\n{\n\t"setting.defaultres"\t\t"1280"\n\t"setting.defaultresheight"\t\t"960"\n}')).toBe(960);
    expect(videoHeight('"video.cfg" { "setting.defaultresheight" "12" }')).toBeUndefined();
  });
});

describe('crosshair and setting commands from binds', () => {
  const keyboard = importCs2Config([{name: 'autoexec.cfg', text: [
    'alias "xhair_cross" "cl_crosshairsize 3; cl_crosshairgap 0; cl_crosshairthickness 0.5; cl_crosshairdot 0; bind KP_5 xhair_dot"',
    'alias "xhair_dot" "cl_crosshairsize -1; cl_crosshairdot 1; cl_crosshairthickness 1.5; bind KP_5 xhair_cross"',
    'alias "tint_green" "cl_crosshaircolor_r 0; cl_crosshaircolor_g 255; cl_crosshaircolor_b 0; bind KP_6 tint_white"',
    'alias "tint_white" "cl_crosshaircolor_r 255; cl_crosshaircolor_g 255; cl_crosshaircolor_b 255; bind KP_6 tint_green"',
    'bind KP_5 xhair_cross', 'bind KP_6 tint_green', 'bind KP_7 "toggle cl_crosshair_t"', 'bind y "toggle volume 0.08 1"',
    'bind KP_8 "sensitivity 2; zoom_sensitivity_ratio 0.8"',
  ].join('\n')}, {name: 'cs2_user_convars_0_slot0.vcfg', text: '"config" { "convars" { "cl_crosshaircolor" "5" "cl_crosshaircolor_r" "255" "cl_crosshaircolor_g" "0" "cl_crosshaircolor_b" "0" "cl_crosshairsize" "2" } }'}], defaultKeyboard).profile;

  it('runs toggle aliases bound to keys against live settings', () => {
    let settings: Settings = sanitizeSettings({...defaults, keyboard});
    const runtime = new BindRuntime(keyboard, (event: BindEvent) => {
      if (event.kind === 'console') settings = applyConsoleCommand(settings, event.args, at1080) ?? settings;
    });
    const press = (key: string) => {runtime.keyDown(key); runtime.keyUp(key);};
    press('KP_5');
    expect(settings.crosshair).toMatchObject({size: 7, gap: 4, thickness: 1, dot: false});
    press('KP_5');
    expect(settings.crosshair).toMatchObject({size: 0, thickness: 3, dot: true});
    press('KP_6');
    expect(settings.crosshair.color).toBe('#00ff00');
    press('KP_6');
    expect(settings.crosshair.color).toBe('#ffffff');
    press('KP_7');
    expect(settings.crosshair.t).toBe(true);
    press('y');
    expect(settings.volume).toBe(.08);
    press('y');
    expect(settings.volume).toBe(1);
    const binds = settings.keyboard.binds;
    press('KP_8');
    expect(settings.sensitivity).toBe(2);
    expect(settings.keyboard.zoomSensitivity).toBe(.8);
    expect(settings.keyboard.binds).toBe(binds);
    expect(settings.cs2Crosshair?.screenHeight).toBe(1080);
  });

  it('starts from a hand-made crosshair when no CS2 convars are stored', () => {
    const settings = sanitizeSettings({...defaults, crosshair: {...defaults.crosshair, size: 5, gap: 2, thickness: 2, color: '#ffffff'}});
    const next = applyConsoleCommand(settings, ['cl_crosshaircolor_g', '0'], at1080)!;
    expect(next.crosshair).toMatchObject({size: 5, gap: 2, thickness: 2, color: '#ff00ff'});
    expect(applyConsoleCommand(settings, ['cl_crosshair_recoil', '1'], at1080)!.follow).toBe(true);
    expect(applyConsoleCommand(settings, ['viewmodel_fov', '60'], at1080)!.viewmodel.fov).toBe(60);
    expect(applyConsoleCommand(settings, ['m_pitch', '-0.022'], at1080)!.invertY).toBe(true);
    expect(applyConsoleCommand(settings, ['buymenu'], at1080)).toBeUndefined();
    expect(applyConsoleCommand(settings, ['sensitivity', '0'], at1080)).toBeUndefined();
  });

  it('imports the crosshair with the CS2 resolution from cs2_video.txt', () => {
    const result = importCs2Config([
      {name: 'cs2_user_convars_0_slot0.vcfg', text: '"config" { "convars" { "cl_crosshairsize" "3" "cl_crosshairthickness" "1" "fps_max" "0" } }'},
      {name: 'cs2_video.txt', text: '"video.cfg" { "setting.defaultres" "1280" "setting.defaultresheight" "960" }'},
    ], defaultKeyboard);
    expect(result.crosshair).toEqual({cvars: {cl_crosshairsize: '3', cl_crosshairthickness: '1'}, screenHeight: 960});
    expect(result.report.files.map(file => file.kind)).toEqual(['convars', 'video']);
    expect(result.report.settings).toContain('crosshair (960p)');
  });
});
