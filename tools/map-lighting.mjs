/** Source 2 light_environment, matching VRF WorldLightingInfo.StoreSunLight.
 * Source (x,y,z) maps to glTF (y,z,x); the surface-to-sun vector is -forward. */
export function readMapLighting(entities) {
  const block = entities.split(/^====\d+====$/m).find(value => /^classname\s+"light_environment"\s*$/m.test(value));
  if (!block) return null;
  const get = key => block.match(new RegExp(`^${key}\\s+(.+)$`, 'm'))?.[1]?.trim().replaceAll('"', '');
  const vector = (key, fallback) => get(key)?.replace(/[[\],]/g, ' ').trim().split(/\s+/).map(Number) ?? fallback;
  const [pitch, yaw] = vector('angles', [0, 0, 0]).map(value => value * Math.PI / 180);
  const brightness = Number(get('brightness') ?? 1) * Number(get('brightnessscale') ?? 1);
  const linear = value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  const index = Number(get('bakedshadowindex') ?? get('bakelightindex') ?? -1);
  const enabled = !['0', 'false'].includes(get('enabled'));
  return {
    version: 1,
    sunDirection: [-Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), -Math.cos(pitch) * Math.cos(yaw)],
    sunColor: vector('color', [255, 255, 255]).map(value => enabled ? linear(value / 255) * brightness : 0),
    sunShadowChannel: index,
    // The encoder extracts the chosen channel into an opaque, single-channel image.
    sunShadowMask: index >= 0 && index <= 3 ? [1, 0, 0, 0] : [0, 0, 0, 0],
  };
}
