import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
const sources={concrete:'concrete/bullethole_concrete_1_color_psd_5d8baebd',metal:'metal/bullethole_metal_1_color_psd_dd6383dc',
 wood:'wood/shot1_color_tga_cca04ada',glass:'glass/shot1_color_psd_797d0fe2'};
const textures={};
for(const [id,name] of Object.entries(sources)) {
 const input=fs.readFileSync(path.join(process.argv[2],'materials/decals',name+'.png'));
 const bytes=await sharp(input).webp({lossless:true}).toBuffer();
 const url=`/textures/impact-${id}.webp`;fs.writeFileSync('public/revamp'+url,bytes);
 textures[id]={url,source:`materials/decals/${name}.vtex_c`,decodedSha256:crypto.createHash('sha256').update(input).digest('hex'),
   sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
}
fs.writeFileSync('src/range/impact-textures.json',JSON.stringify({build:'2000927',textures},null,2)+'\n');
