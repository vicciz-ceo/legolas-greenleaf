#!/usr/bin/env python3
"""Shared reference composition primitives. Pillow/NumPy; no game/runtime imports."""
from pathlib import Path
import math,json
import numpy as np
from PIL import Image,ImageDraw,ImageFont,ImageOps,ImageFilter
BG=(17,25,27); GOLD=(201,181,123); SILVER=(197,208,207)
FONT_PATH='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
def font(px=18):return ImageFont.truetype(FONT_PATH,px)
def save(im,path):
 path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
 if path.suffix.lower() in ['.jpg','.jpeg']:im.convert('RGB').save(path,quality=88,subsampling=2,optimize=True)
 else:im.save(path,optimize=True)
def fit(im,size):return ImageOps.fit(im.convert('RGB'),size,method=Image.Resampling.LANCZOS)
def pad(im,size):return ImageOps.pad(im.convert('RGB'),size,color=BG,method=Image.Resampling.LANCZOS)
def wrap(draw,text,width,px=18):
 lines=[];line=''
 for word in text.split():
  if draw.textlength((line+' '+word).strip(),font=font(px))>width and line:lines.append(line);line=word
  else:line=(line+' '+word).strip()
 if line:lines.append(line)
 return lines

def silhouette(draw,x,feet,height,colour=SILVER,bow=False):
 """Neutral one-head/two-arms/two-legs silhouette, calibrated to a code-given height."""
 h=height;y=feet-h;r=h*.052
 draw.ellipse((x-r,y,x+r,y+2*r),fill=colour)
 pts=[(x-h*.055,y+h*.115),(x-h*.115,y+h*.17),(x-h*.16,y+h*.46),(x-h*.13,y+h*.49),(x-h*.075,y+h*.31),(x-h*.073,y+h*.54),(x-h*.075,y+h*.75),(x-h*.075,feet),(x-h*.017,feet),(x,y+h*.63),(x+h*.017,feet),(x+h*.075,feet),(x+h*.075,y+h*.75),(x+h*.073,y+h*.54),(x+h*.075,y+h*.31),(x+h*.13,y+h*.49),(x+h*.16,y+h*.46),(x+h*.115,y+h*.17),(x+h*.055,y+h*.115)]
 draw.polygon(pts,fill=colour)
 if bow:draw.arc((x-h*.21,y+h*.22,x+h*.12,y+h*.82),90,270,fill=GOLD,width=max(1,int(h*.008)))
def scale_panel(im,ppm=50):
 """Separate calibration legend. Does not claim photogrammetric calibration of the artwork."""
 d=ImageDraw.Draw(im);x=im.width-190;feet=im.height-45;h=1.85*ppm
 d.rectangle((x-75,feet-h-35,x+150,im.height),fill=BG)
 silhouette(d,x,feet,h);d.line((x+45,feet-h,x+45,feet),fill=GOLD,width=2)
 for yy in [feet-h,feet]:d.line((x+39,yy,x+51,yy),fill=GOLD,width=2)
 d.text((x+60,feet-h*.6),'1.85 m',font=font(17),fill=GOLD)
 return {'source':'design_target','height_m':1.85,'pixels_per_metre':ppm,'height_px':h,'meaning':'Separate script-drawn dimensional legend; generated people are uncalibrated narrative figures.'}
def scale_bar(draw,x,y,metres,ppm):
 length=metres*ppm;draw.line((x,y,x+length,y),fill=GOLD,width=3)
 for a in [x,x+length]:draw.line((a,y-7,a,y+7),fill=GOLD,width=2)
 draw.text((x,y+12),f'{metres:g} m',font=font(17),fill=GOLD)
def median_roi(im,box):
 a=np.asarray(im.convert('RGB'));x0,y0,x1,y1=box;v=a[y0:y1,x0:x1].reshape(-1,3)
 col=np.median(v,axis=0).round().astype(int)
 return {'source':'measured_script','method':'per-channel median in encoded sRGB','hex':'#'+''.join(f'{c:02x}' for c in col),'region_px':list(box),'pixel_count':len(v)}
def seamless(im,size=1024):
 """Half-tile offset plus raised-cosine crossfade on X/Y, then matched boundary samples."""
 a=np.asarray(fit(im,(size,size)),dtype=np.float32)
 for axis in [1,0]:
  shifted=np.roll(a,size//2,axis=axis)
  t=np.arange(size)/(size-1);weight=np.sin(np.pi*t)**2
  shape=[1,1,1];shape[axis]=size;weight=weight.reshape(shape)
  a=a*weight+shifted*(1-weight)
 for axis in [1,0]:
  if axis==1:
   shared=(a[:,0]+a[:,-1])/2;a[:,0]=shared;a[:,-1]=shared
  else:
   shared=(a[0]+a[-1])/2;a[0]=shared;a[-1]=shared
 return Image.fromarray(np.clip(a,0,255).round().astype(np.uint8))
def project(point,camera):
 """Pinhole projection: +Y up, +Z forward, camera pitch in degrees, vertical FOV."""
 x,y,z=point;x-=camera['shoulder_offset_m'];y-=camera['height_m'];z+=camera['behind_player_m']
 p=math.radians(camera['pitch_deg']);yy=y*math.cos(p)-z*math.sin(p);zz=y*math.sin(p)+z*math.cos(p)
 f=camera['size_px'][1]/(2*math.tan(math.radians(camera['vertical_fov_deg']/2)))
 return camera['size_px'][0]/2+x*f/zz,camera['size_px'][1]/2-yy*f/zz

def player_overlay(im,camera):
 """Original schematic Legolas back silhouette with exact 1.85 m projection. No likeness claim."""
 d=ImageDraw.Draw(im);head=project((0,1.85,0),camera);foot=project((0,0,0),camera);h=foot[1]-head[1];x=(head[0]+foot[0])/2
 silhouette(d,x,foot[1],h,(38,57,44),True)
 # Pale half-tied hair / cloak / quiver, entirely drawn. A readable schematic stand-in, not character look art.
 d.ellipse((x-h*.05,head[1],x+h*.05,head[1]+h*.1),fill=(163,152,108))
 d.polygon([(x-h*.055,head[1]+h*.065),(x+h*.055,head[1]+h*.065),(x+h*.072,head[1]+h*.27),(x-h*.067,head[1]+h*.25)],fill=(157,145,102))
 d.polygon([(x-h*.09,head[1]+h*.19),(x+h*.06,head[1]+h*.19),(x+h*.11,head[1]+h*.68),(x-h*.13,head[1]+h*.72)],fill=(47,64,47))
 d.line((x-h*.065,head[1]+h*.16,x+h*.09,head[1]+h*.47),fill=(106,79,47),width=max(3,int(h*.025)))
 for a in [-.065,-.035,0]:d.line((x+h*a,head[1]+h*.16,x+h*(a-.02),head[1]+h*.05),fill=(144,127,89),width=2)
 return {'source':'measured_script','method':'pinhole projection of a 1.85 m vertical subject; background remains an uncalibrated look reference','head_px':list(head),'foot_px':list(foot),'projected_height_px':h,'camera':camera}
