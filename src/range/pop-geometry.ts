import {Path, Shape, ShapeGeometry, Vector2} from 'three';

/** Flat frame whose outside dimensions match the target or panel bounds exactly. */
export function popFrameGeometry(halfW: number, halfH: number, border: number): ShapeGeometry {
  const corners = (w: number, h: number) => [new Vector2(-w, -h), new Vector2(w, -h), new Vector2(w, h), new Vector2(-w, h)];
  const shape = new Shape(corners(halfW, halfH));
  shape.holes.push(new Path(corners(halfW - border, halfH - border)));
  return new ShapeGeometry(shape);
}
