import {describe, expect, it} from 'vitest';
import {Quaternion} from 'three';
import {DEG, STEP} from './actor-physics';
import {defaults} from './config';
import {Simulation} from './simulation';
import {AIM_PUNCH_CAMERA_SCALE, applyViewmodelRecoil, recoilView} from './view-recoil';
import nativeModel from '../../docs/evidence/reaudit-viewmodel-native.json';
import native from './native-view-punch-fixture.json';
import {direction, shotDirection} from './shot-model';
import {WeaponRecovery} from './ballistics';
import {gameData} from './config';

describe('shared camera presentation', () => {
  it('matches current native world-angle recoil in the separate model scene at steep aim and with roll', () => {
    const source = ([x, y, z, w]: number[]) => new Quaternion(-y, z, -x, w).normalize();
    for (const row of nativeModel.rows) {
      const view = recoilView(row.base[1] * DEG, -row.base[0] * DEG,
        {pitch: -row.physical[0], yaw: -row.physical[1], roll: -row.physical[2]},
        {pitch: -row.kick[0], yaw: -row.kick[1]});
      view.roll += (-row.base[2] - row.kick[2]) * DEG;
      const actual = new Quaternion(); applyViewmodelRecoil(actual, view);
      const expected = source(row.cameraQuaternion).invert().multiply(source(row.modelQuaternion));
      // Native trigonometry and angles round to float32; Three uses doubles.
      expect(actual.angleTo(expected) / DEG).toBeLessThan(.00005);
    }
  });

  it('carries camera-only kick in the model base without applying it twice', () => {
    const model = new Quaternion();
    applyViewmodelRecoil(model, recoilView(1, -.7, {pitch: 0, yaw: 0}, {pitch: 2, yaw: -1}));
    expect(model.angleTo(new Quaternion())).toBeLessThan(1e-7);
  });

  it('matches 12 native camera compositions, including full aim punch from damage', () => {
    for (const row of native.composition) {
      const view = recoilView(0, 0, {pitch: -row.physical[0], yaw: -row.physical[1]},
        {pitch: -row.previous[0], yaw: -row.previous[1]});
      expect(Math.abs(-view.pitch / DEG - row.result[0])).toBeLessThan(.000002);
      expect(Math.abs(view.yaw / DEG - row.result[1])).toBeLessThan(.000002);
      expect(Math.abs(row.previous[2] + row.physical[2] * AIM_PUNCH_CAMERA_SCALE - row.result[2])).toBeLessThan(.000002);
    }
  });

  it('renders recoil without feeding it back into physical aim or mouse sensitivity', () => {
    const recoil = {yaw: 2, pitch: 7};
    const shot = direction(.3 - recoil.yaw * DEG, .1 + recoil.pitch * DEG);
    const view = recoilView(.3, .1, recoil);
    expect(view.pitch).toBeGreaterThan(.1); expect(view.pitch).toBeLessThan(.1 + 7 * DEG);
    expect(view.yaw).toBeLessThan(.3);
    expect(recoil).toEqual({yaw: 2, pitch: 7});
    expect(direction(.3 - recoil.yaw * DEG, .1 + recoil.pitch * DEG)).toEqual(shot);
    expect(recoilView(.4, .2, recoil).yaw - view.yaw).toBeCloseTo(.1);
  });
  it('applies full physical recoil and punch once while the view remains presentation only', () => {
    const weapon = gameData.weapons.ak47, recovery = new WeaponRecovery(weapon), recoil = {yaw: 2, pitch: 7};
    const punch = {yaw: -.3, pitch: 1, roll: 2}, yaw = .3, pitch = .1;
    const aim = {yaw, pitch, recoil, punch, weapon, recovery, speedRatio: 0, walking: false,
      airborne: false, verticalSpeedUnits: 0, spread: false};
    const before = JSON.stringify(aim);
    const view = recoilView(yaw, pitch, recoil), shot = shotDirection(aim);
    expect(shot).toEqual(direction(yaw - (recoil.yaw + punch.yaw) * DEG, pitch + (recoil.pitch + punch.pitch) * DEG));
    expect(shot).not.toEqual(direction(view.yaw, view.pitch));
    expect(shotDirection(aim)).toEqual(shot); expect(JSON.stringify(aim)).toBe(before);
  });

  it('interpolates range movement at 240 Hz without moving the authoritative shot origin', () => {
    const sim = new Simulation({...defaults, mode: 'guided'});
    sim.position.z = -60; sim.active = true; sim.input.forward = 1;
    for (let tick = 0; tick < 128; tick++) sim.step(STEP);
    const positions: number[] = [];
    for (let frame = 0; frame < 30; frame++) {
      sim.advance(1 / 240);
      const before = {...sim.position};
      positions.push(sim.renderPosition().z);
      expect(sim.position).toEqual(before);
    }
    const steps = positions.slice(1).map((z, i) => Math.abs(z - positions[i]));
    expect(Math.min(...steps)).toBeGreaterThan(.02);
    expect(Math.max(...steps) - Math.min(...steps)).toBeLessThan(.00001);
    sim.cancel(); expect(sim.renderPosition()).toEqual(sim.position);
  });
});
