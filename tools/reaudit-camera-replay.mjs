// Run serially under the memory cap; no browser or game is launched.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'vite';
const output = path.resolve('../native-audit/reports');
const clockReport = JSON.parse(fs.readFileSync(path.join(output, 'reaudit-camera-anchor-clocks.json')));
const vite = await createServer({server: {middlewareMode: true}, appType: 'custom', logLevel: 'error'});
const f = Math.fround;
try {
  const {ViewPunch, viewPunchImpulse} = await vite.ssrLoadModule('/src/range/view-punch.ts');
  const {PunchRecovery} = await vite.ssrLoadModule('/src/range/punch-recovery.ts');
  const native = JSON.parse(fs.readFileSync(path.join(output, 'reaudit-camera-native.json')));
  const oracle = {samples: 0, impulses: 0, maxSampleError: 0, maxImpulseError: 0};
  for (const profile of native.results) {
    for (const row of profile.samples) {
      const p = new ViewPunch();
      // This is a controlled conversion of the two native float clocks, not a
      // claim that an arbitrary browser event supplies the native command pair.
      const anchor = f(f(row.tick) + f(row.fraction)) / 64;
      p.add({pitch: -row.angle[0], yaw: -row.angle[1]}, 0);
      const actual = p.sample(f(row.now - anchor));
      oracle.samples++;
      oracle.maxSampleError = Math.max(oracle.maxSampleError, Math.abs(actual.pitch + row.result[0]), Math.abs(actual.yaw + row.result[1]));
    }
    for (const row of profile.impulses) {
      const p = new ViewPunch(); p.add({pitch: -row.previous[0], yaw: -row.previous[1]}, 0);
      p.add(viewPunchImpulse(row.angle, row.magnitude), 0);
      const actual = p.sample(0); oracle.impulses++;
      oracle.maxImpulseError = Math.max(oracle.maxImpulseError, Math.abs(actual.pitch + row.result[0]), Math.abs(actual.yaw + row.result[1]));
    }
  }
  if (oracle.maxSampleError > 1e-7 || oracle.maxImpulseError > 1e-7) throw new Error('Current native arithmetic mismatch');
  const recordings = clockReport.recordings.map(recording => {
    const before = new ViewPunch(), scheduled = new ViewPunch();
    let carried = {pitch: 0, yaw: 0}, anchor = 0;
    const shots = recording.shots.map(row => {
      const impulse = {pitch: -row.impulse[0], yaw: -row.impulse[1]};
      before.add(impulse, row.gameTime); scheduled.add(impulse, row.schedule);
      const factor = f(Math.exp(-f(Math.max(0, f(f(row.schedule) - f(anchor))) * 18)));
      carried = {pitch: f(f(carried.pitch * factor) + impulse.pitch), yaw: f(f(carried.yaw * factor) + impulse.yaw)};
      anchor = row.cameraTime;
      const nativeAt = time => {
        const factor = f(Math.exp(-f(Math.max(0, f(f(time) - f(row.cameraTime))) * 18)));
        return {pitch: f(-row.camera[0] * factor), yaw: f(-row.camera[1] * factor)};
      };
      const candidateAt = time => {
        const factor = f(Math.exp(-f(Math.max(0, f(f(time) - f(anchor))) * 18)));
        return {pitch: f(carried.pitch * factor), yaw: f(carried.yaw * factor)};
      };
      const expected = nativeAt(row.gameTime), actual = before.sample(row.gameTime), scheduleOnly = scheduled.sample(row.gameTime);
      const candidate = candidateAt(row.gameTime);
      const error = a => Math.hypot(a.pitch - expected.pitch, a.yaw - expected.yaw);
      return {tick: row.tick, sampleTime: row.gameTime, schedule: row.schedule, commandAnchor: row.cameraTime,
        native: expected, before: actual, scheduleOnly, recordedClockCandidate: candidate,
        beforeError: error(actual), scheduleOnlyError: error(scheduleOnly), candidateError: error(candidate)};
    });
    return {demo: recording.demo, sha256: recording.demoSha256, shots,
      maxBeforeError: Math.max(...shots.map(r => r.beforeError)), maxScheduleOnlyError: Math.max(...shots.map(r => r.scheduleOnlyError)),
      maxRecordedClockCandidateError: Math.max(...shots.map(r => r.candidateError))};
  });
  const stem = 'native_reaudit_recovery_002';
  const rows = JSON.parse(fs.readFileSync(path.join(output, stem, 'ticks.json')));
  const fireTicks = new Set(JSON.parse(fs.readFileSync(path.join(output, stem, 'weapon_fire.json'))).map(r => r.tick));
  const cam = 'CCSPlayerPawn.CCSPlayer_CameraServices.', aim = 'CCSPlayerPawn.CCSPlayer_AimPunchServices.';
  const vec = ([pitch, yaw, roll]) => ({pitch, yaw, roll});
  const anchors = rows.filter(r => fireTicks.has(r.tick)).map(row => ({
    shotTime: row.last_shot_time,
    punch: new PunchRecovery(vec(row[aim + 'm_predictableBaseAngle']), vec(row[aim + 'm_predictableBaseAngleVel'])),
    aimAt: row[aim + 'm_predictableBaseTick'] / 128 + row[aim + 'm_predictableBaseTickInterpAmount'] / 64,
    cameraAt: row[cam + 'm_nCsViewPunchAngleTick'] / 128 + row[cam + 'm_flCsViewPunchAngleTickRatio'] / 64,
    camera: row[cam + 'm_vecCsViewPunchAngle'],
  }));
  const first = anchors[0].shotTime, samples = [];
  for (let i = -2000; i <= 8000; i++) {
    const time = first + i / 1000, a = anchors.findLast(a => a.shotTime <= time);
    const punch = a ? a.punch.sample(Math.max(0, time - a.aimAt)) : {pitch: 0, yaw: 0};
    const decay = a ? f(Math.exp(-f(Math.max(0, f(f(time) - f(a.cameraAt))) * 18))) : 0;
    const kickPitch = a ? -a.camera[0] * decay : 0, kickYaw = a ? a.camera[1] * decay : 0;
    samples.push({time, pitch: -punch.pitch * .9 + kickPitch, yaw: punch.yaw * .9 + kickYaw,
      aimPitch: -punch.pitch * .9, aimYaw: punch.yaw * .9, kickPitch, kickYaw});
  }
  const report = {baseline: execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim(), oracle, recordings,
    limitations: ['Class replay uses recorded shot events and states as exogenous inputs; it is not a reconstruction of browser or native button input.',
      'gameTime is a chosen reference sample clock, not an observed display time.',
      'Recorded-clock candidate needs the native command-history anchor, which current trainer input does not supply; it is not a shipped feel fix.']};
  fs.writeFileSync(path.join(output, 'reaudit-camera-production-before.json'), JSON.stringify(report, null, 2) + '\n');
  fs.writeFileSync(path.join(output, 'reaudit-camera-native-prediction.json'), JSON.stringify({stem, firstShot: first, samples}) + '\n');
  console.log(JSON.stringify({oracle, recordings: recordings.map(({shots, ...r}) => ({...r, shots: shots.length}))}, null, 2));
} finally {await vite.close();}
