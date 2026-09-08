"""Generate reproducible synthetic images; never touches user projects. Requires Pillow."""
from pathlib import Path
from PIL import Image, ImageDraw
import json, random

root = Path(__file__).resolve().parents[1]
fixtures = root / 'tests' / 'fixtures'
fixtures.mkdir(parents=True, exist_ok=True)
small = Image.new('RGBA', (64, 32), (220, 40, 80, 100))
for ext in ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'avif']:
    image = small.convert('RGB') if ext in ['jpg', 'jpeg', 'bmp'] else small
    image.save(fixtures / f'sample.{ext}')
first = Image.new('RGB', (64, 32), 'red')
first.save(fixtures / 'sample.gif', save_all=True, append_images=[Image.new('RGB', (64,32), 'blue')], duration=100, loop=0)
(fixtures / 'corrupt.png').write_bytes(b'not an image')
Image.new('RGB', (9000, 1), 'red').save(fixtures / 'oversized.avif')

project_root = root / '.perf' / 'project'
tracks = []
random.seed(42)
# Deterministic textured 4K source rather than uniform, unrealistically tiny PNGs.
texture = Image.frombytes('RGB', (960, 540), random.randbytes(960 * 540 * 3)).resize((3840,2160))
for t in range(10):
    folder = project_root / f'track_{t}'
    folder.mkdir(parents=True, exist_ok=True)
    images = []
    for i in range(20):
        name = f'{t}_{i}.jpg'
        output = folder / name
        if not output.exists():
            im = texture.copy() if i % 2 else texture.resize((2560,1440))
            ImageDraw.Draw(im).rectangle((100,100,700,500), fill=(t*23, i*11, 160))
            im.save(output, quality=85)
        images.append(dict(id=f'image_{t}_{i}',fileName=name,relativePath=f'track_{t}/{name}',version=str(i+1),note='',status='pending',createdAt='1'))
    tracks.append(dict(id=f'track_{t}',name=f'Track {t}',folderName=f'track_{t}',prefix=str(t),letter=chr(65+t),images=images))
project = dict(projectId='performance',projectDataFile='project_performance.json',projectName='Performance 200',projectFolderPath=str(project_root),imagesFolderName='',tracks=tracks)
(root / '.perf' / 'project.json').write_text(json.dumps(project),encoding='utf-8')
print(f'Generated {len(tracks)*20} 2K/4K images and 8 format/error fixtures in {root}')
