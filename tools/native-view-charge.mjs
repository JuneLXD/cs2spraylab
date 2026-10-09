import {Quaternion} from 'three';

/** Revolver graph: fixed shoot1 frame zero, with prepare_shoot as an additive layer.
 * VRF --gltf_compose_additive composes onto bind pose, which is not this graph base.
 * Rebase its first-frame-relative deltas before Blender bakes the weapon mount.
 */
export function composeRevolverCharge(document) {
  const root = document.getRoot();
  const charge = root.listAnimations().find(a => a.getName().endsWith('/prepare_shoot_revolver'));
  const base = root.listAnimations().find(a => a.getName().endsWith('/shoot1_revolver'));
  if (!charge || !base || !charge.getExtras().additive_composed) throw new Error('Expected composed native revolver charge and shoot1 clips.');
  const original = charge.listSamplers();
  const inverse = new Quaternion(), delta = new Quaternion(), q = new Quaternion();
  for (const channel of charge.listChannels()) {
    const node = channel.getTargetNode(), target = channel.getTargetPath(), sampler = channel.getSampler();
    const size = sampler.getOutput().getElementSize(), values = sampler.getOutput().getArray();
    const reference = base.listChannels().find(c => c.getTargetNode() === node && c.getTargetPath() === target);
    const authored = reference?.getSampler().getOutput().getArray().slice(0, size)
      ?? (target === 'rotation' ? node.getRotation() : target === 'translation' ? node.getTranslation() : node.getScale());
    const first = values.slice(0, size), output = new Float32Array(values.length);
    for (let i = 0; i < values.length; i += size) {
      if (target === 'rotation') {
        inverse.fromArray(first).normalize().invert();
        delta.fromArray(values, i).normalize();
        q.fromArray(authored).normalize().multiply(inverse).multiply(delta).normalize().toArray(output, i);
      } else for (let j = 0; j < size; j++) output[i + j] = target === 'scale'
        ? authored[j] * values[i + j] / (first[j] || 1) : authored[j] + values[i + j] - first[j];
    }
    const accessor = document.createAccessor().setType(sampler.getOutput().getType()).setArray(output).setBuffer(root.listBuffers()[0]);
    const replacement = document.createAnimationSampler().setInput(sampler.getInput()).setOutput(accessor).setInterpolation(sampler.getInterpolation());
    charge.addSampler(replacement); channel.setSampler(replacement);
  }
  for (const sampler of original) charge.removeSampler(sampler);
  charge.setExtras({...charge.getExtras(), additive: false, additive_composed: true,
    additive_base: base.getName(), additive_base_time: 0, composition: 'native-revolver-primary-fire-charge-layer'});
  return {source: charge.getName(), base: base.getName(), baseTime: 0, graph: 'animation/graphs/viewmodel/viewmodel_gun_revolver.vnmgraph'};
}
