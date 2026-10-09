"""Contact sheet of a screenshot strip: python3 tools/contact-sheet.py <strip dir> <out.png> [--crop x,y,w,h] [--cols 6] [--width 360]"""
import json, sys, pathlib
from PIL import Image, ImageDraw

args = sys.argv[1:]
src, dest = pathlib.Path(args[0]), pathlib.Path(args[1])
opt = lambda name, fallback: args[args.index(f'--{name}') + 1] if f'--{name}' in args else fallback
crop = tuple(int(v) for v in opt('crop', '').split(',')) if opt('crop', '') else None
cols, width = int(opt('cols', '6')), int(opt('width', '360'))
frames = json.loads((src / 'frames.json').read_text())['frames']
tiles = []
for frame in frames:
    image = Image.open(src / frame['file']).convert('RGB')
    if crop: image = image.crop((crop[0], crop[1], crop[0] + crop[2], crop[1] + crop[3]))
    scale = width / image.width
    image = image.resize((width, round(image.height * scale)))
    draw = ImageDraw.Draw(image)
    label = f"{frame['age']:.2f}s" + (f" hp{frame['health']}" if 'health' in frame else '')
    draw.rectangle((0, 0, 8 + 7 * len(label), 14), fill=(0, 0, 0))
    draw.text((3, 2), label, fill=(255, 255, 0))
    tiles.append(image)
rows = (len(tiles) + cols - 1) // cols
h = tiles[0].height
sheet = Image.new('RGB', (cols * width, rows * h), (20, 20, 20))
for i, tile in enumerate(tiles): sheet.paste(tile, ((i % cols) * width, (i // cols) * h))
sheet.save(dest)
print(f'{len(tiles)} tiles -> {dest} {sheet.size}')
