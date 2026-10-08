const linear = s => s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4;
const srgb = x => x <= .0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - .055;
/** Preserve additive RGB after GPU sRGB decoding and straight-alpha blending. */
export function additiveLinearAlpha(pixels) {
  const output=Buffer.from(pixels);
  for(let i=0;i<output.length;i+=4) {
    const r=linear(pixels[i]/255),g=linear(pixels[i+1]/255),b=linear(pixels[i+2]/255),a=Math.max(r,g,b);
    output[i]=a?Math.round(srgb(r/a)*255):0;
    output[i+1]=a?Math.round(srgb(g/a)*255):0;
    output[i+2]=a?Math.round(srgb(b/a)*255):0;
    output[i+3]=Math.round(a*255);
  }
  return output;
}
