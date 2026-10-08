#!/usr/bin/env python3
"""Compose the scenes/graphics library from JSON targets and unlabelled look images.
Usage: python docs/refs/tools/compose_scenes.py [--partial]
All textual/measurable marks are drawn here. No model-generated diagram is used.
"""
import argparse,math,json,hashlib,shutil
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw,ImageOps,ImageFilter,ImageEnhance
from scene_composition import *
R=Path(__file__).resolve().parents[1]
def read(p):return json.loads(Path(p).read_text())
def write(p,d):Path(p).write_text(json.dumps(d,indent=2,ensure_ascii=False)+'\n')
def text(d,xy,t,px=18,col=SILVER):d.text(xy,str(t),font=font(px),fill=col)
def source_image(p):return Image.open(p).convert('RGB')
def migrate():
 # Originals generated before the amendment remain unlabelled LOOK inputs. Narrative people are uncalibrated.
 for folder in (R/'scenes').iterdir():
  if not folder.is_dir() or not (folder/'layout.json').exists():continue
  extra=list(read(folder/'layout.json')['extra_set_pieces'])
  for name in ['establishing']+extra:
   p=folder/(name+'.png');dest=folder/'looks'/(name+'.jpg')
   if p.exists() and not dest.exists():save(fit(source_image(p),(1536,1024)),dest);p.unlink()
  # Old generated player views were oversized; code projects the replacement figure onto fresh backgrounds.
  p=folder/'gameplay_view.png'
  if p.exists():p.unlink()
  for p in folder.glob('current*.png'):save(source_image(p),p.with_suffix('.jpg'));p.unlink()
  for p in [folder/'layout.svg',folder/'palette.svg']:
   if p.exists():p.unlink()
 for p in (R/'ui/chapter_cards').glob('*.png'):save(fit(source_image(p),(1024,512)),p.with_suffix('.jpg'));p.unlink()
 for p in (R/'materials').glob('*.png'):
  if p.stem=='materials_overview':continue
  out=R/'materials/looks'/p.with_suffix('.jpg').name
  if not out.exists():save(fit(source_image(p),(1024,1024)),out)
  p.unlink()
 for p in (R/'ui').rglob('*.png'):
  save(source_image(p),p.with_suffix('.jpg'));p.unlink()

def layout(folder):
 j=read(folder/'layout.json');im=Image.new('RGB',(1536,1024),BG);d=ImageDraw.Draw(im)
 text(d,(42,25),j['chapter'].replace('_',' ').upper()+' · DESIGN TARGET PLAN',30,GOLD)
 text(d,(42,70),'Metres · +Z north · +Y elevation · zero-based checkpoints · layout.json is the numeric authority',17)
 w,z=j['extent_m'];ppm=min(990/w,735/z);ox,oy=615,478
 def pt(v):return ox+v[0]*ppm,oy-v[2]*ppm
 left,top=ox-w*ppm/2,oy-z*ppm/2;right,bottom=left+w*ppm,top+z*ppm
 d.rectangle((left,top,right,bottom),fill=(34,50,43),outline=(99,117,106),width=1)
 step=100 if z>500 else 20
 for x in range(-int(w/2),int(w/2)+1,step):xx,_=pt([x,0,0]);d.line((xx,top,xx,bottom),fill=(53,71,60))
 for zz in range(-int(z/2),int(z/2)+1,step):_,yy=pt([0,0,zz]);d.line((left,yy,right,yy),fill=(53,71,60))
 route=[pt(v) for v in j['set_piece_route']['points_m']]
 if len(route)>1:d.line(route,fill=(93,156,173),width=max(3,int(j['set_piece_route']['width_m']*ppm)))
 for s in j['structures']:
  x,y=pt(s['position_m']);a,_,b=s['size_m']
  if j['chapter']=='helms_deep' and s['id'] in ['S1','S2']:
   d.line([pt(v) for v in j['wall_path_m']],fill=(137,149,139),width=max(3,round(6*ppm)));continue
  if not left<=x<=right or not top<=y<=bottom:continue
  angle=math.radians(s.get('yaw_deg',0));cx,cy,cz=s['position_m'];corners=[pt([cx+dx*math.cos(angle)+dz*math.sin(angle),cy,cz-dx*math.sin(angle)+dz*math.cos(angle)]) for dx,dz in [(-a/2,-b/2),(a/2,-b/2),(a/2,b/2),(-a/2,b/2)]]
  d.polygon(corners,fill=(102,114,109),outline=(200,201,183));text(d,(x+3,y-16),s['id'],14)
 for key,col,label in [('ride_route_m',(111,199,219),'90 s ride'),('bat_flight_route_m',(204,172,224),'bat flight'),('falling_block_route_m',(231,176,121),'falling climb'),('stairs_route_m',(157,208,156),'stairs'),('bank_route_m',(157,208,156),'bank run'),('rooftop_chase_route_m',(204,172,224),'roof chase'),('mumak_climb_route_m',(231,176,121),'climb / neck'),('trunk_slide_route_m',(157,208,156),'trunk slide'),('eagles_flight_route_m',(204,172,224),'late eagles')]:
  points=j.get(key,[])
  if points:
   d.line([pt(v) for v in points],fill=col,width=4);text(d,pt(points[-1]),label,13,col)
 for v in j.get('falling_block_route_m',[]):
  x,y=pt(v);d.rectangle((x-1.2*ppm,y-ppm,x+1.2*ppm,y+ppm),outline=(231,176,121),width=2)
 for key in ['rescue_cocoons_m','canopy_anchors_m','girth_cut_points_m','encirclement_sectors_m']:
  for i,v in enumerate(j.get(key,[])):
   x,y=pt(v);d.ellipse((x-3,y-3,x+3,y+3),fill=GOLD);text(d,(x+4,y+4),key.split('_')[0]+str(i+1),11,GOLD)
 for v in j.get('pillar_grid_m',[]):
  x,y=pt(v);d.rectangle((x-1.5*ppm,y-1.5*ppm,x+1.5*ppm,y+1.5*ppm),fill=(116,125,121))
 for e in j['enemy_entry_zones']:
  x,y=pt(e['center_m']);a,b=e['half_size_m'];d.rectangle((x-a*ppm,y-b*ppm,x+a*ppm,y+b*ppm),fill=(143,67,58));text(d,(x+3,y),e['id'],11,(244,194,176))
 for c in j['cover']:
  x,y=pt(c['position_m']);a,_,b=c['size_m'];d.rectangle((x-a*ppm/2,y-b*ppm/2,x+max(3,a*ppm/2),y+max(3,b*ppm/2)),fill=(192,170,121))
 for h in j['high_ground']:
  x,y=pt(h['position_m']);d.polygon([(x,y-8),(x-7,y+6),(x+7,y+6)],fill=(165,154,202));text(d,(x+8,y-4),h['id'],11)
 for a in j['ally_positions']:
  x,y=pt(a['position_m']);d.ellipse((x-4,y-4,x+4,y+4),fill=(139,196,154))
 for c in j['checkpoints']:
  x,y=pt(c['position_m']);d.ellipse((x-14,y-14,x+14,y+14),fill=BG,outline=GOLD,width=3);text(d,(x-6,y-10),c['index'],17,GOLD)
 for v in j.get('ladder_sockets_m',[]):
  x,y=pt(v);d.line((x-3,y-8,x-3,y+8),fill=GOLD,width=2);d.line((x+3,y-8,x+3,y+8),fill=GOLD,width=2);d.line((x-3,y,x+3,y),fill=GOLD,width=2)
 if j['player_start_m']:
  x,y=pt(j['player_start_m']);d.line((x-32,y+34,x-14,y+15),fill=SILVER,width=3);text(d,(x-90,y+35),'START',14)
 d.line((1055,155,1055,108),fill=GOLD,width=2);d.polygon([(1055,103),(1048,116),(1062,116)],fill=GOLD);text(d,(1039,79),'+Z',16,GOLD)
 sx,sy=1140,132
 for label,col in [('Checkpoint 0…n',GOLD),('Enemy entry zone',(143,67,58)),('Ally',(139,196,154)),('Cover',(192,170,121)),('High ground',(165,154,202)),('Set-piece route',(93,156,173))]:
  d.rectangle((sx,sy+4,sx+12,sy+16),fill=col);text(d,(sx+24,sy),label,16);sy+=30
 sy+=20;text(d,(sx,sy),'CHECKPOINTS',18,GOLD);sy+=30
 for c in j['checkpoints']:
  for line in wrap(d,f"{c['index']} · {c['label']}",350,14):text(d,(sx,sy),line,14);sy+=20
  text(d,(sx,sy),str(c['position_m'])+' m',12,(153,173,163));sy+=32
 if not j['checkpoints']:text(d,(sx,sy),'Menu: no gameplay checkpoints',14);sy+=40
 sy+=10;text(d,(sx,sy),'STRUCTURES · W × H × D',16,GOLD);sy+=29
 for s in j['structures']:
  text(d,(sx,sy),s['id']+' · '+s['name'],14);sy+=22;text(d,(sx,sy),' × '.join(map(str,s['size_m']))+' m',13,(159,181,170));sy+=29
 scale_bar(d,58,915,100 if z>500 else 20,ppm)
 text(d,(270,912),'Same scale on X and Z; elevations are explicit in JSON.',16)
 text(d,(42,985),'Structures outside playable bounds are listed in JSON. Perspective art is a look reference, not a survey.',15)
 save(im,folder/'layout.png')
 j['plan_render']={'source':'measured_script','pixels_per_metre':ppm,'origin_px':[ox,oy],'image_size_px':[1536,1024],'script':'tools/compose_scenes.py:layout'};write(folder/'layout.json',j)

def scenes(folder,partial):
 spec=read(folder/'image-spec.json');layoutj=read(folder/'layout.json');measure={}
 for n in ['establishing']+list(layoutj['extra_set_pieces']):
  p=folder/'looks'/(n+'.jpg')
  if not p.exists():continue
  im=fit(source_image(p),(1536,1024));measure[n]={'scale_legend':scale_panel(im)};save(im,folder/(n+'.jpg'))
 bg=folder/'gameplay_look.jpg'
 if bg.exists():
  camera={'height_m':1.6,'behind_player_m':3.2,'shoulder_offset_m':1.2,'vertical_fov_deg':70,'pitch_deg':3,'size_px':[1536,1024]}
  im=fit(source_image(bg),(1536,1024));measure['gameplay_view']=player_overlay(im,camera);save(im,folder/'gameplay_view.jpg');spec['gameplay_view'].update(camera);spec['gameplay_view']['expected_player_height_percent']=round(measure['gameplay_view']['projected_height_px']/1024*100,2);spec['gameplay_view']['note']='Background is uncalibrated look art. Code projects the schematic 1.85 m player through the exact camera; character look is owned by the parallel sheets.'
 frames=[folder/'frames'/f'beat_{i:02d}_look.jpg' for i in range(6)]
 if all(p.exists() for p in frames):
  im=Image.new('RGB',(1536,1024),BG);d=ImageDraw.Draw(im)
  for i,p in enumerate(frames):
   x=8+(i%2)*768;y=8+(i//2)*341
   im.paste(pad(source_image(p),(752,282)),(x,y));d.rectangle((x,y,x+752,y+325),outline=(87,101,93))
   lines=wrap(d,f'{i+1:02d} · '+spec['beats']['captions'][i],734,17)
   for k,line in enumerate(lines[:2]):text(d,(x+10,y+287+k*20),line,17,GOLD)
  save(im,folder/'beats.png');measure['beats']={'source':'measured_script','columns':2,'rows':3,'frame_rect_px':[752,282],'caption_font':'DejaVu Sans 17 px','inputs':[str(p.relative_to(R)) for p in frames]}
 elif not partial:raise FileNotFoundError('Missing individual storyboard frames for '+folder.name)
 spec['observed_composition']=measure;write(folder/'image-spec.json',spec)

def palettes(folder):
 src=folder/'looks/establishing.jpg'
 if not src.exists():return
 im=source_image(src);j=read(folder/'lighting.json');pal=j['palette'];w,h=im.size
 # Labelled ROIs are selected appearance regions, not radiometry or canonical material albedos.
 base={'sky_top':[.6,.02,.75,.10],'horizon':[.62,.20,.76,.28],'fog':[.48,.32,.58,.43],'sun':None,'shadow_fill':[.09,.45,.16,.52],'dominant_ground':[.45,.83,.58,.93],'dominant_structure':[.19,.29,.29,.41],'accent':[.38,.57,.45,.63],'fire_emissive':None}
 if folder.name=='mirkwood':base.update(sky_top=None,horizon=None,fog=[.56,.30,.62,.41],dominant_structure=[.07,.25,.13,.39],accent=[.31,.63,.37,.69])
 if folder.name=='moria':base.update(sky_top=None,horizon=None,fog=[.73,.3,.78,.4],sun=[.29,.1,.32,.17],dominant_structure=[.28,.54,.34,.57],accent=[.28,.54,.34,.57],fire_emissive=[.707,.544,.723,.585])
 if folder.name=='laketown':base.update(fire_emissive=[.374,.738,.384,.774],dominant_structure=[.475,.28,.565,.4],accent=[.51,.37,.555,.425],fog=[.763,.61,.79,.645],dominant_ground=[.08,.86,.18,.94])
 if folder.name=='helms_deep':base.update(fire_emissive=[.348,.225,.369,.263],dominant_structure=[.30,.40,.36,.51],accent=[.48,.33,.53,.40])
 if folder.name=='pelennor':base.update(dominant_structure=[.39,.1,.455,.17],accent=[.042,.01,.09,.085])
 if folder.name=='amon_hen':base.update(sky_top=[.45,.02,.52,.08],horizon=None,sun=[.164,.345,.181,.367],fog=[.82,.4,.86,.46],dominant_structure=[.52,.17,.57,.23])
 if folder.name=='barrels':base.update(sky_top=[.67,.025,.74,.08],horizon=[.78,.27,.83,.32],fog=None,dominant_structure=[.42,.16,.46,.22],dominant_ground=[.05,.55,.10,.63],accent=[.42,.77,.48,.82])
 if folder.name=='helms_deep':base.update(horizon=[.07,.32,.12,.38],fog=[.06,.45,.10,.53],fire_emissive=None,dominant_structure=[.42,.47,.48,.55])
 if folder.name=='moria':base.update(sun=[.283,.04,.294,.08],fire_emissive=[.918,.39,.927,.415],dominant_ground=[.49,.76,.57,.82])
 if folder.name=='menu':base.update(sky_top=[.43,.025,.51,.08],horizon=[.47,.28,.53,.34],fog=[.47,.37,.56,.43],dominant_structure=[.05,.15,.12,.35],accent=[.68,.17,.72,.23])
 if folder.name=='pelennor':base.update(dominant_structure=[.78,.30,.84,.37],accent=[.28,.16,.30,.20])
 if folder.name=='black_gate':base.update(fog=[.47,.51,.54,.56])
 if folder.name=='ravenhill':base.update(dominant_structure=[.34,.24,.37,.32],accent=[.45,.61,.50,.68],fog=[.72,.42,.80,.49])
 observed={};annotated=im.copy();ad=ImageDraw.Draw(annotated)
 for n,box in base.items():
  if box is None:observed[n]={'source':'measured_script','hex':None,'reason':'No unambiguous visible region; do not infer a value from unrelated pixels.'};continue
  rect=[round(box[0]*w),round(box[1]*h),round(box[2]*w),round(box[3]*h)];observed[n]=median_roi(im,rect);observed[n]['image']='looks/establishing.jpg';observed[n]['label']=n
  ad.rectangle(rect,outline=GOLD,width=2);text(ad,(rect[0],max(0,rect[1]-19)),n,14,GOLD)
 j['observed_palette']=observed;write(folder/'lighting.json',j);save(annotated,folder/'palette_regions.jpg')
 panel=Image.new('RGB',(1536,1024),BG);d=ImageDraw.Draw(panel);text(d,(42,26),folder.name.upper()+' · PALETTE: INTENT / OBSERVED MEDIAN',28,GOLD)
 for i,(n,col) in enumerate(pal.items()):
  x=42+i%3*496;y=98+i//3*287
  text(d,(x,y),n.replace('_',' '),21)
  d.rectangle((x,y+36,x+210,y+188),fill=col);actual=observed[n]['hex']
  d.rectangle((x+218,y+36,x+428,y+188),fill=actual or BG,outline=(95,108,99))
  text(d,(x,y+201),'INTENT '+col.upper(),17,GOLD);text(d,(x+218,y+201),'OBS '+(actual.upper() if actual else 'NOT VISIBLE'),16)
 text(d,(42,984),'Observed: per-channel sRGB median of labelled pixel regions. Lighting intensities and geometry remain design targets.',15)
 save(panel,folder/'palette.png')

def materials():
 p=R/'materials/materials.json';j=read(p);names=list(j['materials'])
 for n,v in j['materials'].items():
  src=R/'materials/looks'/(n+'.jpg')
  if not src.exists():continue
  tile=seamless(source_image(src));out=R/'materials'/(n+'.jpg');save(tile,out);encoded=source_image(out);a=np.asarray(encoded);stats=median_roi(encoded,[0,0,1024,1024]);stats.update(image=n+'.jpg',range_p05_p95=['#'+''.join(f'{int(c):02x}' for c in np.percentile(a.reshape(-1,3),q,axis=0)) for q in [5,95]])
  stats['boundary_mean_abs_error_rgb']=float((np.abs(a[:,0].astype(float)-a[:,-1]).mean()+np.abs(a[0].astype(float)-a[-1]).mean())/2)
  v.update(image=n+'.jpg',source='design_target',observed_statistics=stats,seamless_method='Half-tile offset plus raised-cosine crossfade on X/Y; matched boundary pixels before JPEG quality 88.')
 write(p,j);im=Image.new('RGB',(1536,1024),BG);d=ImageDraw.Draw(im);text(d,(30,18),'MATERIAL APPEARANCE TARGETS · 1024² · METRE-SCALE TILES',24,GOLD)
 for i,n in enumerate(names):
  x=28+i%6*253;y=65+i//6*135;f=R/'materials'/(n+'.jpg')
  if f.exists():im.paste(fit(source_image(f),(232,99)),(x,y))
  text(d,(x,y+104),n,14);text(d,(x+155,y+104),str(j['materials'][n]['tile_size_m'])+' m',14,GOLD)
 save(im,R/'materials/materials_overview.png')

def colour_script():
 ids=['menu','mirkwood','barrels','laketown','ravenhill','moria','amon_hen','helms_deep','pelennor','black_gate'];im=Image.new('RGB',(1536,1024),BG);d=ImageDraw.Draw(im);text(d,(32,28),'GREENLEAF · COLOUR SCRIPT',32,GOLD);text(d,(32,85),'Calm → danger → relief → pursuit → cold → dread → grief → endurance → triumph → last hope',17)
 records=[]
 for i,n in enumerate(ids):
  p=R/'scenes'/n;src=p/'establishing.jpg';x=int(i*153.6);width=int((i+1)*153.6)-x
  if src.exists():im.paste(fit(source_image(src),(width-4,102)),(x+2,155))
  text(d,(x+8,272),f'{i:02d} '+n.replace('_',' '),12,GOLD)
  j=read(p/'lighting.json');palette=j.get('observed_palette',{})
  for k,key in enumerate(['sky_top','horizon','fog','dominant_structure','dominant_ground','accent']):
   col=palette.get(key,{}).get('hex') or j['palette'][key];d.rectangle((x+4,315+k*83,x+width-4,383+k*83),fill=col);text(d,(x+8,386+k*83),key.replace('dominant_',''),10)
  records.append({'chapter':n,'thumbnail_rect_px':[x+2,155,width-4,102],'source_image':str(src.relative_to(R)),'colours_from':'observed_palette; design-intent fallback only when visible sample is unavailable'})
 text(d,(32,924),'One strip of ten thumbnails, menu + chapters in story order. Swatches below are sampled medians or explicitly documented intent fallback.',15)
 save(im,R/'scenes/color_script.png');write(R/'scenes/color-script-spec.json',{'source':'measured_script','size_px':[1536,1024],'order':ids,'entries':records,'script':'tools/compose_scenes.py:colour_script'})

if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('--partial',action='store_true');args=ap.parse_args();migrate()
 for folder in (R/'scenes').iterdir():
  if folder.is_dir() and (folder/'layout.json').exists():layout(folder);scenes(folder,args.partial);palettes(folder)
 materials();colour_script();print('Composed plans, scenes, palettes, material tiles and colour script')
