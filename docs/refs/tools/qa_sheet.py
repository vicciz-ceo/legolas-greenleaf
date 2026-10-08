#!/usr/bin/env python3
"""Compose labelled review contact sheets without changing any input image."""
from pathlib import Path
import argparse,json
from PIL import Image,ImageDraw
from compose import *
R=Path(__file__).resolve().parents[1]
a=argparse.ArgumentParser();a.add_argument('--mode',choices=['baseline','final','materials','ui','looks'],default='final');a.add_argument('--out',default='/tmp/greenleaf-ref-qa');args=a.parse_args();out=Path(args.out);out.mkdir(parents=True,exist_ok=True)
files=sorted([p for p in R.rglob('*') if p.suffix.lower() in ['.jpg','.png']])
if args.mode=='baseline':files=[p for p in files if p.stem.startswith('current_')]
elif args.mode=='materials':files=[p for p in files if p.parent==R/'materials' and p.stem!='materials_overview']
elif args.mode=='ui':files=[p for p in files if 'ui' in p.relative_to(R).parts]
elif args.mode=='looks':files=[p for p in files if 'looks' in p.parts or p.stem.endswith('_look')]
else:files=[p for p in files if not ('looks' in p.parts or 'frames' in p.parts or p.stem.endswith('_look') or p.stem.startswith('current_') or p.stem=='palette_regions')]
pages=[]
for start in range(0,len(files),6):
 chunk=files[start:start+6];im=Image.new('RGB',(1536,1024),BG);d=ImageDraw.Draw(im)
 for i,p in enumerate(chunk):
  x=i%3*512;y=i//3*512;im.paste(pad(Image.open(p),(504,463)),(x+4,y+4));d.text((x+8,y+473),str(p.relative_to(R)),font=font(13),fill=GOLD)
 dest=out/f'{args.mode}_{start//6:02d}.jpg';save(im,dest);pages.append({'page':str(dest),'images':[str(p.relative_to(R)) for p in chunk]})
(out/(args.mode+'_pages.json')).write_text(json.dumps(pages,indent=2));print(json.dumps({'pages':len(pages),'images':len(files),'out':str(out)}))
