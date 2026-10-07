// Source-style viewmodel FOV is horizontal at 4:3; Three expects vertical FOV.
export const viewmodelFov = (fov: number) => 2 * Math.atan(Math.tan(fov * Math.PI / 360) / (4 / 3)) * 180 / Math.PI;
export const VIEWMODEL_FOV = viewmodelFov(68);
export const VIEWMODEL_OFFSET = { x: 2.5 * .0254, y: -1.5 * .0254, z: 0 };
/** CS2 viewmodel_offset_x/y/z (inches: right, forward, up) as view-camera metres. */
export const viewmodelOffset = ({x, y, z}: {x: number; y: number; z: number}) => ({x: x * .0254, y: z * .0254, z: -y * .0254});

export function viewmodelViewport(width: number, height: number) {
  // Keep portrait arms below the aim area and ultrawide arms at the right edge.
  // The world can be stretched, but this viewport always has square pixels.
  const w = Math.min(width, height * 16 / 9);
  const h = Math.min(height, width * 3 / 4);
  return { x: width - w, y: 0, width: w, height: h, aspect: w / h };
}
