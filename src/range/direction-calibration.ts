import {isNeutralProfile, profileNumbers, scaleProfile, type DirectionProfile, type FlickCondition} from './aim-vector';
import type {Settings} from './config';

/** Direction Calibration in every mode: the settings side. While `directionCalibrate` is on, each engine's aim recorder keeps
 * every flick that measures your aim cleanly as a calibration flick (see `AimRecorder.calibration`), and the engines apply your
 * direction profile, or the blind A/B test's hidden choice, to mouse counts before the sensitivity. aim-vector.ts fits the
 * profile; the Aim tab's Direction calibration view shows it. */

type CalibrationSettings = Pick<Settings, 'directionCalibrate' | 'directionProfile' | 'directionProfileOn' | 'directionStrength' | 'directionTest' |
  'mouseYaw' | 'invertX' | 'mousePitch' | 'sensitivityYScale' | 'invertY'>;

/** What the aim recorder needs to keep calibration flicks: the axes your settings invert (1 x, 2 y: moving the mouse right or
 * toward you turns the view left or up) and the numbers of the profile you have set, at its strength. */
export type AimCalibration = {flip: number; profile?: readonly number[]};

/** The blind A/B test runs while calibration flicks are recorded, the test is switched on and there is a profile to test. */
export const blindTesting = (s: CalibrationSettings) => s.directionCalibrate && s.directionTest && !isNeutralProfile(s.directionProfile);

/** The profile mouse input runs with now: yours when it is switched on, or during the blind test the hidden choice for the
 * current block (`testOn`, from the aim recorder); undefined when none applies. */
export function activeDirectionProfile(s: CalibrationSettings, testOn: boolean): DirectionProfile | undefined {
  if (isNeutralProfile(s.directionProfile)) return undefined;
  return (blindTesting(s) ? testOn : s.directionProfileOn) ? s.directionProfile : undefined;
}

/** How a flick made now is filed: during the blind test by its hidden block, otherwise by whether your profile is on. */
export function flickCondition(s: CalibrationSettings, testOn: boolean): FlickCondition {
  return blindTesting(s) ? testOn ? 'test-on' : 'test-off' : activeDirectionProfile(s, testOn) ? 'on' : 'off';
}

/** The inverted axes as a calibration flick marks them (1 x, 2 y). */
export const invertedAxes = (s: CalibrationSettings) =>
  (Math.sign(s.mouseYaw || 1) * (s.invertX ? -1 : 1) < 0 ? 1 : 0) | (Math.sign(s.mousePitch * s.sensitivityYScale || 1) * (s.invertY ? -1 : 1) < 0 ? 2 : 0);

/** The recorder's calibration setting for these settings: undefined while recording calibration flicks is off. */
export function directionCalibration(s: CalibrationSettings): AimCalibration | undefined {
  if (!s.directionCalibrate) return undefined;
  return {flip: invertedAxes(s), ...(isNeutralProfile(s.directionProfile) ? {} : {profile: profileNumbers(scaleProfile(s.directionProfile, s.directionStrength))})};
}
