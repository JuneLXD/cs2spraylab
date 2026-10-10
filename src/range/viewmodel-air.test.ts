import {describe, expect, it} from 'vitest';
import {Euler, Group, Quaternion, Vector3} from 'three';
import {DEG, UNIT} from './actor-physics';
import {ViewmodelAir} from './viewmodel-air';
import {recoilView} from './view-recoil';
import native from '../../docs/evidence/reaudit-viewmodel-air-native.json';
import runtime from '../../docs/evidence/reaudit-viewmodel-air-runtime.json';

const sourceQuaternion = ([x, y, z, w]: number[]) => new Quaternion(-y, z, -x, w).normalize();

describe('native weapon airborne motion', () => {
  for (const sequence of native.sequences) it(`replays every native frame: ${sequence.name}`, () => {
    const motion = new ViewmodelAir(), model = new Group();
    const view = {...recoilView(0, 0, {pitch: -sequence.punch[0], yaw: -sequence.punch[1], roll: -sequence.punch[2]}),
      pitch: -sequence.camera[0] * DEG, yaw: sequence.camera[1] * DEG, roll: -sequence.camera[2] * DEG};
    const original = {...view}, inverse = sourceQuaternion(sequence.cameraQuaternion).invert();
    for (const row of sequence.rows) {
      model.position.set(0, 0, 0);
      motion.apply(model, view, row.grounded);
      expect(motion.amount).toBe(row.air);
      const position = new Vector3(row.origin[1], row.origin[2], row.origin[0]).multiplyScalar(UNIT).applyQuaternion(inverse);
      expect(model.position.distanceTo(position)).toBeLessThan(2e-8);
      expect(model.quaternion.angleTo(inverse.clone().multiply(sourceQuaternion(row.modelQuaternion))) / DEG).toBeLessThan(.00005);
      expect(view).toEqual(original);
    }
  });

  it('matches every observed transition from the approved native recording', () => {
    const motion = new ViewmodelAir(), model = new Group(), view = recoilView(0, 0, {pitch: 0, yaw: 0});
    for (const [previous, grounded, next] of runtime.pairs) {
      motion.amount = previous as number; model.position.set(0, 0, 0);
      motion.apply(model, view, grounded as boolean);
      expect(motion.amount).toBe(next);
    }
  });

  it('keeps world vertical independent of camera pitch, yaw and roll', () => {
    const motion = new ViewmodelAir(), model = new Group();
    const view = {...recoilView(2, 1, {pitch: 0, yaw: 0}), roll: .4};
    const camera = new Quaternion().setFromEuler(new Euler(view.pitch, view.yaw, view.roll, 'YXZ'));
    for (let i = 0; i < 20; i++) { model.position.set(0, 0, 0); motion.apply(model, view, false); }
    const world = model.position.clone().applyQuaternion(camera);
    expect(world.x).toBeCloseTo(0, 12); expect(world.z).toBeCloseTo(0, 12);
    expect(world.y).toBeCloseTo(-.8 * UNIT, 8);
    motion.reset(); expect(motion.amount).toBe(0);
    model.position.set(0, 0, 0); motion.apply(model, view, true);
    expect(model.position.length()).toBe(0);
  });
});
