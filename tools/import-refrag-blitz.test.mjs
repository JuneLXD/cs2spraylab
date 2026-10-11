import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {compileRefragArenas, parseRefragArenas, sourcePoint, sourceAngles} from './import-refrag-blitz.mjs';
const capture = readFileSync(new URL('../docs/evidence/refrag-ancient-blitz-v120.txt', import.meta.url), 'utf8');

test('all 38 native arenas and 190 authored bots survive import in original order', () => {
  const data = compileRefragArenas(capture), raw = parseRefragArenas(capture);
  assert.equal(data.source.setId, 4530); assert.equal(data.source.version, 120);
  assert.equal(data.arenas.length, 38); assert.equal(data.arenas.reduce((n, a) => n + a.swingers.length, 0), 190);
  assert.deepEqual(data.arenas.map(a => a.name), raw.map(a => a.name));
  assert.deepEqual(['jump','jiggle','duck'].map(key=>data.arenas.flatMap(a=>a.swingers).filter(b=>b.permissions[key]).length),[20,159,129]);
  assert.equal(data.arenas[0].name, 'A Site'); assert.equal(data.arenas[37].name, 'B Site #13');
  assert.deepEqual(data.arenas[0].player, {...sourcePoint([-959.784485,1054.403931,65.659019]), ...sourceAngles([.666491,-153.115051,0])});
  assert.deepEqual(data.arenas[0].swingers[0].hold, sourcePoint([-2040.980225,397.516113,75.03125]));
  const artifact = JSON.parse(readFileSync(new URL('../src/range/duel/maps/de_ancient.blitz.json', import.meta.url), 'utf8'));
  assert.deepEqual(data, artifact);
});

test('Source coordinates and angles convert without an eye-height offset or mirroring', () => {
  assert.deepEqual(sourcePoint([100,200,300]), {x:5.08,y:7.62,z:2.54});
  assert.deepEqual(sourceAngles([45,0,0]), {yaw:Math.PI,pitch:-Math.PI/4});
  const raw = parseRefragArenas(capture), data = compileRefragArenas(capture);
  const directions = new Set();
  raw.forEach((arena, i) => arena.groups[0].bots.forEach((bot, j) => {
    directions.add(bot.direction);
    const swing = data.arenas[i].swingers[j].swing, yaw = bot.angles[1] * Math.PI / 180;
    assert.ok(Math.abs(Math.hypot(swing.x,swing.z)-1) < 1e-12);
    const forwardDot = swing.x*Math.sin(yaw)+swing.z*Math.cos(yaw);
    assert.ok(Math.abs(forwardDot-(bot.direction==='Forward'?1:0)) < 1e-12);
    if(bot.direction!=='Forward') assert.ok(Math.abs((swing.x*Math.cos(yaw)-swing.z*Math.sin(yaw))-(bot.direction==='Left'?1:-1)) < 1e-12);
  }));
  assert.deepEqual([...directions].sort(),['Forward','Left','Right']);
});

test('incomplete captures and unsupported groups/directions fail instead of making up positions', () => {
  assert.throws(() => compileRefragArenas(capture.slice(0,capture.lastIndexOf('Arena Index: 37'))), /Incomplete arena roster/);
  assert.throws(() => compileRefragArenas(capture.replace('Min Swing Delay      0.000','Min Swing Delay      1.000')), /unsupported bot/);
  assert.throws(() => compileRefragArenas(capture.replace('Always Ducked        No','Always Ducked        Yes')), /unsupported bot/);
  assert.throws(() => compileRefragArenas(capture.replace('Bot Group Count: 1','Bot Group Count: 2')), /additional groups/);
  assert.throws(() => compileRefragArenas(capture.replace('Swing Direction      Left [1]','Swing Direction      Recording [6]')), /unsupported bot/);
  assert.throws(() => compileRefragArenas(capture.replace(/---> 4 \[BOT\][\s\S]*?(?=Arena Index: 1)/,'')), /incomplete bots/);
});
