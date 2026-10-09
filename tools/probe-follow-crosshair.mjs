import fs from 'node:fs';
import * as THREE from 'three';
import {createServer} from 'vite';

const vite = await createServer({root: new URL('..', import.meta.url).pathname,
  server: {middlewareMode: true}, appType: 'custom', logLevel: 'error'});
try {
  const {Simulation, VERTICAL_FOV} = await vite.ssrLoadModule('/src/range/simulation.ts');
  const {defaults} = await vite.ssrLoadModule('/src/range/config.ts');
  const {recoilView} = await vite.ssrLoadModule('/src/range/view-recoil.ts');
  const {followCrosshairOffset, followCrosshairDirection} = await vite.ssrLoadModule('/src/range/crosshair-follow.ts');
  const width = 1920, height = 1080;
  const camera = new THREE.PerspectiveCamera(VERTICAL_FOV, width / height, .01, 1000);
  const sim = new Simulation({...defaults, mode: 'guided', weapon: 'ak47', burst: 0, spread: false});
  sim.start();
  const rows = [];
  for (let frame = 0; frame < 960; frame++) {
    sim.advance(1 / 240);
    const predicted = sim.recovery.predict(sim.accumulator);
    const view = recoilView(sim.yaw, sim.pitch, predicted, sim.viewPunch.sample(sim.time + sim.accumulator));
    camera.rotation.set(view.pitch, view.yaw, 0, 'YXZ'); camera.updateMatrixWorld();
    const project = recoil => {
      const direction = followCrosshairDirection(sim.yaw, sim.pitch, recoil);
      return new THREE.Vector3(direction.x, direction.y, direction.z).multiplyScalar(10).project(camera);
    };
    const old = project(sim.recoil), current = project(predicted);
    const before = {x: old.x * width / 2, y: -old.y * height / 2};
    const after = followCrosshairOffset(current, width, height);
    rows.push({time: sim.time + sim.accumulator, shotCount: sim.shots,
      renderPredictionDegrees: Math.hypot(predicted.yaw - sim.recoil.yaw, predicted.pitch - sim.recoil.pitch),
      predictionPixels: Math.hypot((old.x - current.x) * width / 2, (old.y - current.y) * height / 2),
      before, after, correctedDistancePixels: Math.hypot(before.x - after.x, before.y - after.y)});
  }
  const max = key => Math.max(...rows.map(row => row[key]));
  const result = {boundary: 'Deterministic trainer AK magazine at 240 Hz, 1920x1080; no hardware latency measurement.',
    frames: rows.length, viewport: [width, height], frameRate: 240,
    maxPredictionDegrees: max('renderPredictionDegrees'), maxPredictionPixels: max('predictionPixels'),
    maxCorrectionPixels: max('correctedDistancePixels'), rows};
  // An optional path retains all samples; otherwise print only the summary.
  if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(result, null, 2) + '\n');
  const {rows: _, ...summary} = result;
  console.log(JSON.stringify(summary));
} finally { await vite.close(); }
