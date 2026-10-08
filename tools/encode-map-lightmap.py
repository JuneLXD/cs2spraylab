"""Encode Source 2 float irradiance without clipping it to an 8-bit SDR image.

Usage: python encode-map-lightmap.py irradiance.exr shadows.png output/map_name
Requires OpenEXR, numpy and Pillow. Run under the repository's memory cap.
"""
import argparse
import json
from pathlib import Path

import Imath
import OpenEXR
import numpy as np
from PIL import Image

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('irradiance', type=Path)
parser.add_argument('shadows', type=Path)
parser.add_argument('output', type=Path)
args = parser.parse_args()
source = OpenEXR.InputFile(str(args.irradiance))
box = source.header()['dataWindow']
width, height = box.max.x - box.min.x + 1, box.max.y - box.min.y + 1
factor = max(1, max(width, height) // 4096)
if width % factor or height % factor:
    raise ValueError('Lightmap dimensions must divide evenly into the output size')
planes = []
for channel in ('R', 'G', 'B'):
    plane = np.frombuffer(source.channel(channel, Imath.PixelType(Imath.PixelType.FLOAT)), dtype=np.float32).reshape(height, width)
    planes.append(plane.reshape(height // factor, factor, width // factor, factor).mean(axis=(1, 3)))
source.close()
rgb = np.maximum(0, np.nan_to_num(np.stack(planes, axis=-1), nan=0, posinf=16, neginf=0))
rgbm_range = 16
multiplier = np.clip(np.ceil(rgb.max(axis=-1) / rgbm_range * 255) / 255, 1 / 255, 1)
packed = np.empty((*multiplier.shape, 4), dtype=np.uint8)
packed[:, :, :3] = np.clip(np.round(rgb / (multiplier[:, :, None] * rgbm_range) * 255), 0, 255)
packed[:, :, 3] = np.round(multiplier * 255)
args.output.parent.mkdir(parents=True, exist_ok=True)
Image.fromarray(packed, 'RGBA').save(f'{args.output}-lightmap.webp', lossless=True, method=4)
with Image.open(args.shadows) as image:
    # R is baked shadow index 0, the light_environment in aim_redline.
    image.convert('RGB').resize((width // factor, height // factor), getattr(Image, 'Resampling', Image).BOX).save(
        f'{args.output}-sun-shadow.webp', lossless=True, method=4)
report = {'width': width // factor, 'height': height // factor, 'encoding': 'linear RGBM',
          'range': rgbm_range, 'maximum': float(rgb.max()),
          'clippedFraction': float(np.mean(rgb.max(axis=-1) > rgbm_range))}
Path(f'{args.output}-lighting.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report))
