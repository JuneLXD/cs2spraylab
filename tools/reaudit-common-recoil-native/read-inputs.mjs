// Retained native KV3 parameters only; no trainer defaults or game/exporter.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseKv3} from '../kv3.mjs';
const here = new URL('.', import.meta.url);
const repo = path.resolve(fileURLToPath(here),'../..');
const defaultRoot = path.basename(path.dirname(repo))==='native-audit' ? path.resolve(repo,'../..') : path.dirname(repo);
const option = (name,fallback) => {const index=process.argv.indexOf(name);if(index<0){assert(fallback,`${name} required`);return fallback;}
  assert(process.argv[index+1]&&!process.argv[index+1].startsWith('--'),`${name} requires a path`);return path.resolve(process.argv[index+1]);};
const root=option('--root',defaultRoot), output=option('--output');
const target=path.join(output,'native-inputs.json');
assert(!fs.existsSync(target),'Refuse to overwrite retained native inputs');
const hash = value => createHash('sha256').update(value).digest('hex');
const raw = fs.readFileSync(path.join(root,'native-audit/reports/common-burst-next/native-data/scripts/weapons.vdata'));
const identityRaw = fs.readFileSync(path.join(root,'native-audit/reports/awp-clocks-next/current-awp-data.json'));
const identity = JSON.parse(identityRaw);
assert.equal(hash(raw), '46e7a84b46c620e8daf11c403ee9152a5faa1a033407748b527862aa3147236b');
assert.equal(hash(raw), identity.decoded.sha256);
assert.equal(hash(identityRaw),'473089f681a3296ec69de31b84dfd137ad3df42e110bd8833f18fbf282c27bfe');
assert.equal(identity.compiled.sha256,'5ca094238e180376646a5cd69250c091ae5a9d937a3446c188ee5117fb6da28b');
const parser = fs.readFileSync(new URL('../kv3.mjs', here));
assert.equal(hash(parser), identity.parserSha256);
const native = parseKv3(raw.toString());
const names = {ak47:'weapon_ak47',m4a4:'weapon_m4a1',m4a1s:'weapon_m4a1_silencer',
  awp:'weapon_awp',glock:'weapon_glock',usp:'weapon_usp_silencer',deagle:'weapon_deagle'};
const fields = {angle:'m_flRecoilAngle',variance:'m_flRecoilAngleVariance',
  magnitude:'m_flRecoilMagnitude',magnitudeVariance:'m_flRecoilMagnitudeVariance'};
const weapons = {}, scalarFields = [];
for (const [id, name] of Object.entries(names)) {
  const data = native[name]; assert(data, name);
  const values = {seed:data.m_nRecoilSeed,fullAuto:data.m_bIsFullAuto};
  assert(Number.isInteger(values.seed)); assert.equal(typeof values.fullAuto, 'boolean');
  for (const [key, field] of Object.entries(fields)) {
    const value=data[field];
    if (Array.isArray(value)) {
      assert(value.length===2&&value.every(Number.isFinite),`${id} ${field}`);
      values[key]=value;
    } else {
      // Current common-weapon exception is an authored zero angle. Keep it
      // explicit rather than substituting absent fields or trainer defaults.
      assert.equal(value,0,`${id} ${field}: unexpected scalar`);
      scalarFields.push({weapon:id,field,value,modeValues:[0,0]});
      values[key]=[0,0];
    }
  }
  weapons[id]=values;
}
const result = {method:'Parse seven weapon parameter pairs directly from the retained native KV3 export; no trainer defaults.',
  decodedSha256:hash(raw),compiledSha256:identity.compiled.sha256,identityReportSha256:hash(identityRaw),
  parserSha256:hash(parser),readerSha256:hash(fs.readFileSync(new URL(import.meta.url))),fields,
  weapons,scalarFields,limits:['Retained compiled-resource binding from pass39; no new export or live resource-memory read.',
    'Authored scalar zero angle is supplied as zero to both native mode fields; no absent input has a trainer-derived fallback.']};
fs.mkdirSync(output,{recursive:true});
fs.writeFileSync(target,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({weapons:Object.keys(weapons),decodedSha256:result.decodedSha256,values:7*10}));
