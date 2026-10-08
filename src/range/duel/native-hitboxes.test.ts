import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Bone, Group, Matrix4, Object3D, Quaternion, Vector3} from 'three';
import {describe, expect, it} from 'vitest';
import {NativeHitboxPose} from './native-hitboxes';
import native from './native-hitboxes.json';
import fixture from './native-hitbox-space-fixture.json';
import source from '../../../docs/native-hitbox-evidence.json';
import hitgroups from '../../../docs/native-hitgroup-evidence.json';
import {resolveDamage} from './damage';

function skeleton(name: string) {
  const bytes = readFileSync(`public/revamp/models/${name}.glb`);
  const doc = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  const joints = new Set<number>(doc.skins.flatMap((skin: {joints: number[]}) => skin.joints));
  const nodes: Object3D[] = doc.nodes.map((node: any, i: number) => {
    const object = joints.has(i) ? new Bone() : new Object3D(); object.name = node.name ?? '';
    if (node.matrix) new Matrix4().fromArray(node.matrix).decompose(object.position, object.quaternion, object.scale);
    else {
      object.position.fromArray(node.translation ?? [0, 0, 0]); object.quaternion.fromArray(node.rotation ?? [0, 0, 0, 1]);
      object.scale.fromArray(node.scale ?? [1, 1, 1]);
    }
    return object;
  });
  doc.nodes.forEach((node: any, i: number) => node.children?.forEach((child: number) => nodes[i].add(nodes[child])));
  const root = new Group(); doc.scenes[doc.scene ?? 0].nodes.forEach((i: number) => root.add(nodes[i]));
  root.updateMatrixWorld(true);
  return {root, hash: createHash('sha256').update(bytes).digest('hex')};
}

describe('native bone-bound hitboxes', () => {
  it('matches native armor coverage, including the neck sharing the chest damage branch', () => {
    expect(hitgroups.damageBranches[8]).toBe(hitgroups.damageBranches[2]);
    for (const row of hitgroups.armorCases) {
      const capsule = native.hitboxes.find(h => h.nativeGroup === row.group);
      if (!capsule) continue;
      const result = resolveDamage('ak47', capsule.group as 'head' | 'chest' | 'stomach' | 'arm' | 'leg', 0, row.armor, row.helmet);
      expect(result.armorDamage > 0).toBe(row.protected);
    }
  });
  it('retains all nineteen native capsule definitions and their anatomical groups', () => {
    const boxes = source.distinctSets[0].hitboxes;
    expect(native.hitboxes).toHaveLength(19); expect(native.sourceSha256).toBe(source.sourceSha256);
    const groups = {1: 'head', 2: 'chest', 3: 'stomach', 4: 'arm', 5: 'arm', 6: 'leg', 7: 'leg', 8: 'chest'};
    for (const [i, box] of boxes.entries()) {
      expect(box.m_nShapeType).toBe(2); expect(box.m_bTranslationOnly).toBe(false);
      expect(native.hitboxes[i]).toEqual({bone: box.m_sBoneName, start: box.m_vMinBounds, end: box.m_vMaxBounds,
        radius: box.m_flShapeRadius, nativeGroup: box.m_nGroupId, index: box.m_nHitBoxIndex,
        group: groups[box.m_nGroupId as keyof typeof groups]});
    }
  });
  it.each(fixture.results)('$model matches native inverse-bind endpoints in the exported skeleton', model => {
    const {root, hash} = skeleton(model.model), pose = NativeHitboxPose.bind(root);
    expect(hash).toBe(model.sha256); expect(pose).toBeDefined();
    const capsules = pose!.capture();
    for (let i = 0; i < capsules.length; i++) {
      for (const end of ['start', 'end'] as const) {
        const actual = capsules[i][end], expected = fixture.capsules[i][end];
        expect(Math.hypot(actual.x - expected[0], actual.y - expected[1], actual.z - expected[2])).toBeLessThan(.00005);
      }
      expect(capsules[i].radius).toBeCloseTo(fixture.capsules[i].radius, 6);
    }
  });
  it('follows rotated head/limb bones and world transforms while preserving the previous frame', () => {
    const {root} = skeleton('target'), pose = NativeHitboxPose.bind(root)!;
    const first = pose.capture(), before = structuredClone(first), head = root.getObjectByName('head_0')!;
    head.quaternion.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 3));
    root.position.set(3, .4, -8); root.rotation.y = Math.PI / 2; root.updateMatrixWorld(true);
    const second = pose.capture(); expect(first).toEqual(before);
    const local = native.hitboxes[0].start.map(n => n * native.unitScale), expected = new Vector3(...local).applyMatrix4(head.matrixWorld);
    expect(second[0].start.x).toBeCloseTo(expected.x, 12); expect(second[0].start.y).toBeCloseTo(expected.y, 12);
    expect(second[0].start.z).toBeCloseTo(expected.z, 12); expect(second[0].start).not.toEqual(first[0].start);
    const secondBefore = structuredClone(second); root.position.x++; root.updateMatrixWorld(true);
    expect(pose.capture()).toBe(first); expect(second).toEqual(secondBefore);
  });
  it('falls back as a complete pose when a required bone is missing', () => {
    const {root} = skeleton('target'); root.getObjectByName('head_0')!.name = 'missing_head';
    expect(NativeHitboxPose.bind(root)).toBeUndefined();
  });
});
