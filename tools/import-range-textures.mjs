// Exports the concrete wall/floor textures used by the range and the AI Duel shell
// (public/revamp/textures/{wall,wall-normal,floor,floor-normal}.webp). Source2Viewer 20
// cannot decompile current CS2 materials (VCS v72 shaders), so the texture references
// are read from the compiled .vmat_c bytes and only the textures are decompiled.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {execFileSync} from 'node:child_process';

const game = process.env.CS2_PATH || 'C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive';
const cli = path.resolve(process.env.SOURCE2VIEWER || '.local-tools/vrf/Source2Viewer-CLI.exe');
const vpk = `${game}/game/csgo/pak01_dir.vpk`;
const work = 'research/range-textures', out = 'public/revamp/textures';
fs.mkdirSync(work, {recursive: true}); fs.mkdirSync(out, {recursive: true});

for (const surface of ['wall', 'floor']) {
  const material = `materials/concrete/hr_c/hr_concrete_${surface}_001.vmat_c`, compiled = `${work}/${surface}.vmat_c`;
  execFileSync(cli, ['-i', vpk, '-f', material, '-o', compiled], {stdio: 'pipe'});
  const references = [...fs.readFileSync(compiled).toString('latin1').matchAll(/materials\/[\w/]+?\.vtex/g)].map(match => match[0]);
  const pick = (role) => references.find(reference => reference.includes(`/hr_concrete_${surface}_001_`) && role.test(reference));
  for (const [name, source] of [[surface, pick(/_color_/)], [`${surface}-normal`, pick(/_normals?_/)]]) {
    if (!source) throw new Error(`${material} has no ${name} texture reference`);
    const png = `${work}/${name}.png`;
    execFileSync(cli, ['-i', vpk, '-f', `${source}_c`, '-d', '-o', png], {stdio: 'pipe'});
    await sharp(png).resize({width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true})
      .webp({quality: name.endsWith('normal') ? 85 : 82}).toFile(`${out}/${name}.webp`);
    const {width, height} = await sharp(`${out}/${name}.webp`).metadata();
    console.log(`${name}: ${source} -> ${out}/${name}.webp ${width}x${height}`);
  }
}
