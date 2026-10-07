import {resolutionSize, sanitizeViewmodel, type Resolution, type Settings, type Viewmodel} from './config';
import {cvarAssignment} from './keybinds/console';
import {applyCrosshairCommand, crosshairFromCvars, cvarsFromCrosshair, isCrosshairCvar, type Cs2Crosshair} from './keybinds/crosshair-cvars';

/** The height CS2 renders at, and the same screen in CSS pixels. */
export type ScreenMetrics = {screenHeight: number; cssHeight: number};

/** Without cs2_video.txt, assume CS2 runs at the trainer's resolution, or the monitor's native one. */
export function screenMetrics(resolution?: Resolution): ScreenMetrics {
  const cssHeight = typeof screen !== 'undefined' && screen.height > 0 ? screen.height : 1080;
  const ratio = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return {cssHeight, screenHeight: (resolution && resolutionSize(resolution)?.height) || Math.round(cssHeight * ratio)};
}

const viewmodelCvars: Readonly<Record<string, keyof Viewmodel>> = {viewmodel_fov: 'fov', viewmodel_offset_x: 'x', viewmodel_offset_y: 'y', viewmodel_offset_z: 'z'};

/** The crosshair convars a command starts from: the stored ones, or the trainer crosshair in CS2's pixel names. */
function crosshairSource(settings: Settings, metrics: ScreenMetrics): Cs2Crosshair {
  const source = settings.cs2Crosshair ?? cvarsFromCrosshair(settings.crosshair, metrics.screenHeight, metrics.cssHeight);
  return 'cl_crosshair_recoil' in source.cvars ? source : {...source, cvars: {cl_crosshair_recoil: settings.follow ? '1' : '0', ...source.cvars}};
}

/**
 * Applies a console command that a bind or alias ran, as CS2 would: crosshair
 * convars (both naming schemes, `toggle` and `incrementvar`), cl_crosshair_recoil,
 * sensitivity, m_pitch, volume, zoom_sensitivity_ratio and viewmodel_*.
 * Returns undefined for commands the trainer does not simulate.
 */
export function applyConsoleCommand(settings: Settings, args: readonly string[], metrics: ScreenMetrics = screenMetrics(settings.resolution)): Settings | undefined {
  const current = (name: string) => {
    if (isCrosshairCvar(name)) return crosshairSource(settings, metrics).cvars[name];
    if (name in viewmodelCvars) return String(settings.viewmodel[viewmodelCvars[name]]);
    return ({sensitivity: String(settings.sensitivity), volume: String(settings.volume), m_pitch: settings.invertY ? '-0.022' : '0.022',
      zoom_sensitivity_ratio: String(settings.keyboard.zoomSensitivity)} as Record<string, string>)[name];
  };
  const assignment = cvarAssignment(args, current);
  if (!assignment) return;
  const {name, value} = assignment;
  if (isCrosshairCvar(name)) {
    const next = applyCrosshairCommand(crosshairSource(settings, metrics), args);
    if (!next) return;
    const view = crosshairFromCvars(next, metrics.cssHeight);
    return {...settings, crosshair: view.crosshair, cs2Crosshair: next, ...(name === 'cl_crosshair_recoil' ? {follow: view.follow === true} : {})};
  }
  const number = Number(value);
  if (!value.trim() || !Number.isFinite(number)) return;
  if (name in viewmodelCvars) return {...settings, viewmodel: sanitizeViewmodel({...settings.viewmodel, [viewmodelCvars[name]]: number})};
  switch (name) {
    case 'sensitivity': return number > 0 ? {...settings, sensitivity: Math.min(10, Math.max(.05, number))} : undefined;
    case 'm_pitch': return number ? {...settings, invertY: number < 0} : undefined;
    case 'volume': return {...settings, volume: Math.min(1, Math.max(0, number))};
    // Keep the bind and alias tables untouched so toggle scripts keep their session rebinds.
    case 'zoom_sensitivity_ratio': return {...settings, keyboard: {...settings.keyboard, zoomSensitivity: Math.min(3, Math.max(.01, number))}};
  }
}
