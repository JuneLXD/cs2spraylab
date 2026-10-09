import {BufferAttribute, BufferGeometry, DoubleSide, Matrix4, Mesh, MeshBasicMaterial, Raycaster, Vector3} from 'three';

/** Exported horizontal overlay meshes may sit above their receiving floor.
 * Project them during import, retaining their authored lighting charts. No per-frame projection. */
export function projectFloorDecals(doc) {
  const receivers = [], targets = [], material = new MeshBasicMaterial({side: DoubleSide});
  for (const node of doc.getRoot().listNodes()) for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
    const surface = primitive.getMaterial(), positions = primitive.getAttribute('POSITION');
    if (!surface || !positions) continue;
    if (surface.getExtras().vmat?.IntParams?.F_OVERLAY && !primitive.getExtras().nativeFloorProjected) {
      targets.push({node, primitive});
    } else if (/concrete_floor|concretefloor|metal_floor|floor_plate/.test(surface.getName()) && surface.getAlphaMode() === 'OPAQUE') {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(positions.getArray(), 3, positions.getNormalized()));
      if (primitive.getIndices()) geometry.setIndex(new BufferAttribute(primitive.getIndices().getArray(), 1));
      // applyMatrix4 changes positions, so keep the original glTF accessor untouched.
      const receiver = new Mesh(geometry.clone().applyMatrix4(new Matrix4().fromArray(node.getWorldMatrix())), material);
      geometry.dispose(); receivers.push(receiver);
    }
  }
  const ray = new Raycaster(), down = new Vector3(0, -1, 0), point = new Vector3(), origin = new Vector3();
  ray.near = 0; ray.far = .52;
  let projectedFloorDecals = 0, projectedVertices = 0;
  const unprojectedFloorDecals = [];
  try {
    for (const {node, primitive} of targets) {
      const world = new Matrix4().fromArray(node.getWorldMatrix()), inverse = world.clone().invert();
      const source = primitive.getAttribute('POSITION'), points = [];
      for (let i = 0; i < source.getCount(); i++) points.push(new Vector3().fromArray(source.getElement(i, [])).applyMatrix4(world));
      let minY = Infinity, maxY = -Infinity;
      for (const vertex of points) {minY = Math.min(minY, vertex.y); maxY = Math.max(maxY, vertex.y);}
      if (!points.length || maxY - minY > .002) continue; // Wall/container overlays keep their placement.
      const hits = points.map(vertex => {
        // Compiler clipping can extend a decal less than a millimetre past a floor edge.
        for (const [dx, dz] of [[0, 0], [.001, 0], [-.001, 0], [0, .001], [0, -.001],
          [.001, .001], [.001, -.001], [-.001, .001], [-.001, -.001]]) {
          origin.copy(vertex).add(new Vector3(dx, .01, dz)); ray.set(origin, down);
          const hit = ray.intersectObjects(receivers, false)[0];
          if (hit) return hit;
        }
        return null;
      });
      if (hits.some(hit => !hit)) {
        unprojectedFloorDecals.push({node: node.getName(), missingVertices: hits.filter(hit => !hit).length});
        continue; // Never partly deform an overlay without a complete receiver.
      }
      const positions = source.clone();
      hits.forEach((hit, index) => {
        point.copy(points[index]); point.y = hit.point.y + .001;
        point.applyMatrix4(inverse); positions.setElement(index, point.toArray());
      });
      primitive.setAttribute('POSITION', positions);
      // The decal's chart layout differs from the floor's at some edges. Borrowing
      // per-vertex receiver UVs would interpolate across unrelated atlas charts.
      primitive.setExtras({...primitive.getExtras(), nativeFloorProjected: true});
      projectedFloorDecals++; projectedVertices += points.length;
    }
  } finally {
    for (const receiver of receivers) receiver.geometry.dispose(); material.dispose();
  }
  return {projectedFloorDecals, projectedVertices, unprojectedFloorDecals};
}
