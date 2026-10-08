#!/usr/bin/env python3
"""Save an already reviewed source cutout and its original-path provenance."""
import argparse,json
from pathlib import Path
from PIL import Image
import compose,progress

_LAST_DETAIL_RGBA = None

def intake(cid,key,path,crop=None,remove_detail_bg=False):
 global _LAST_DETAIL_RGBA
 folder=compose.ROOT/cid
 relative=key+'.png'
 original=Path(path)
 image=Image.open(original)
 if remove_detail_bg:
  from rembg import remove,new_session
  import os
  if compose._REMBG_SESSION is None:
   compose._REMBG_SESSION=new_session(os.environ.get('GREENLEAF_REMBG_MODEL','u2net'))
  fingerprint=compose.digest(original)
  if _LAST_DETAIL_RGBA is not None and _LAST_DETAIL_RGBA[0]==fingerprint:
   image=_LAST_DETAIL_RGBA[1].copy()
  else:
   image=remove(image,session=compose._REMBG_SESSION)
   # Keep only the latest full-resolution mask, for distinct detail crops of
   # one accepted original. Never retain this temporary cache in the library.
   _LAST_DETAIL_RGBA=(fingerprint,image.copy())
 if crop:
  image=image.crop(crop)
  temp=Path('/tmp/greenleaf-intake-crop.png');image.save(temp);inp=temp
 else:inp=original
 detail_trim=None
 if key.startswith(('views/','face_views/')):
  config=json.loads((folder/'spec.json').read_text()).get('composition',{}).get('source_heights',{})
  height=config.get('body',560) if key.startswith('views/') else config.get('face',320)
  result=compose.segment(inp,folder/relative,max_height=height,backend='rembg')
 else:
  if remove_detail_bg:
   detail_trim=compose.bbox(image.convert('RGBA'),require_transparency=False)
   image=image.crop(detail_trim)
  image=image.convert('RGBA' if remove_detail_bg else 'RGB');image.thumbnail((256,256),Image.Resampling.LANCZOS)
  (folder/relative).parent.mkdir(parents=True,exist_ok=True);image.save(folder/relative,optimize=True)
  result={'output':relative,'size_px':list(image.size)}
 p=folder/'sources.json';data=json.loads(p.read_text()) if p.exists() else {}
 data[key]={'original_full_resolution_path':str(original),'original_sha256':compose.digest(original),'original_size_px':list(Image.open(original).size),'crop_px':list(crop) if crop else None,'detail_background_removed':remove_detail_bg,'detail_trim_box_in_cropped_source_px':list(detail_trim) if detail_trim else None,'saved_cutout':relative,'cutout_sha256':compose.digest(folder/relative)}
 p.write_text(json.dumps(data,indent=2)+'\n')
 return result
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('cid');p.add_argument('key');p.add_argument('path');p.add_argument('--crop',nargs=4,type=int);p.add_argument('--remove-background',action='store_true');a=p.parse_args()
 print(json.dumps(intake(a.cid,a.key,a.path,a.crop,a.remove_background)))
