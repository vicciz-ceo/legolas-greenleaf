#!/usr/bin/env python3
"""Validate reference coverage, contracts, dimensions, observed medians and byte budget."""
import json,re,sys,math
from pathlib import Path
import numpy as np
from PIL import Image
R=Path(__file__).resolve().parents[1]
ids=['mirkwood','barrels','laketown','ravenhill','moria','amon_hen','helms_deep','pelennor','black_gate','menu']
errors=[];checks=0
def check(condition,message):
 global checks
 checks+=1
 if not condition:errors.append(message)
def load(p):return json.loads(p.read_text())
def image(p,size):
 check(p.exists(),f'Missing {p.relative_to(R)}')
 if p.exists():
  with Image.open(p) as im:check(im.size==size,f'Wrong dimensions {p.relative_to(R)}: {im.size}')
def hx(v):return isinstance(v,str) and re.fullmatch('#[0-9a-fA-F]{6}',v)
names=['mirkwood','forest_river','laketown_night','ravenhill_winter','moria','amon_hen','helms_deep_storm','pelennor','black_gate','menu']
required=['sky','sunColor','sunIntensity','hemiSky','hemiGround','hemiIntensity','envIntensity','fog','exposure','bloom','grade','weather','weatherIntensity']
current=load(R/'tools/current-presets-scenes.json')['presets']
def field(j,path):
 for part in path.split('.'):j=j[part]
 return j
def comparable(actual,reference):
 if hx(reference) and isinstance(actual,int):return f'#{actual:06x}'
 return actual
for chapter,name in zip(ids,names):
 folder=R/'scenes'/chapter;j=load(folder/'lighting.json');layout=load(folder/'layout.json')
 check(j['source']=='design_target',chapter+' lighting provenance')
 check(all(k in j for k in required),chapter+' missing EnvironmentPreset fields')
 check(j['environment_name']==name,chapter+' EnvironmentName mismatch')
 for change in j['changes_vs_current']:
  check(comparable(field(current['menu' if chapter=='menu' else name],change['field']),change['current'])==change['current'],chapter+' current comparison '+change['field'])
  check(field(j,change['field'])==change['recommended'],chapter+' recommended comparison '+change['field'])
 check(j['sky']['kind'] in ['physical','gradient','cave'],chapter+' sky discriminant')
 for key in ['sunColor','hemiSky','hemiGround']:check(hx(j[key]),chapter+' '+key+' hex')
 check(hx(j['fog']['color']),chapter+' fog hex')
 for key in ['lift','gamma','gain']:check(len(j['grade'][key])==3 and all(isinstance(v,(int,float)) for v in j['grade'][key]),chapter+' grade '+key)
 check(j['weather'] in ['none','rain','storm','snow','embers','ash','spores','dust'],chapter+' weather')
 check(8<=len(j['palette'])<=12,chapter+' palette count')
 check(layout['source']=='design_target',chapter+' layout provenance')
 check([v['index'] for v in layout['checkpoints']]==list(range(len(layout['checkpoints']))),chapter+' checkpoint order')
 check(layout['plan_render']['source']=='measured_script',chapter+' rendered plan provenance')
 for stem in ['layout','beats','palette']:image(folder/(stem+'.png'),(1536,1024))
 for stem in ['establishing','gameplay_view']+list(layout['extra_set_pieces']):image(folder/(stem+'.jpg'),(1536,1024))
 for i in range(6):image(folder/'frames'/f'beat_{i:02d}_look.jpg',(768,512))
 for key,v in j['observed_palette'].items():
  if v['hex'] is not None:
   with Image.open(folder/v['image']) as im:
    rgb=np.asarray(im.convert('RGB').crop(tuple(v['region_px'])))
   got='#'+''.join(f'{int(x):02x}' for x in np.median(rgb.reshape(-1,3),axis=0).round())
   check(got.lower()==v['hex'].lower(),chapter+' median mismatch '+key)
image(R/'scenes/color_script.png',(1536,1024))
barrels=load(R/'scenes/barrels/layout.json')
route=barrels['ride_route_m'];length=sum(np.linalg.norm(np.array(b)-a) for a,b in zip(route,route[1:]))
check(7<=length/90<=11,'Barrel ride speed/duration consistency')
check(barrels['structures'][0]['position_m'][2]==barrels['checkpoints'][0]['position_m'][2],'Gate/start alignment')
helms=load(R/'scenes/helms_deep/layout.json');stairs=helms['extra_set_pieces']['shield_stair']
check(abs(stairs['riser_m']*stairs['risers']-stairs['rise_m'])<.001,'Shield stair total rise')
check(abs(stairs['tread_m']*stairs['risers']-stairs['run_m'])<.001,'Shield stair total run')
check(len(helms['ladder_sockets_m'])==6,'Six ladder sockets')
materials=load(R/'materials/materials.json');check(materials['source']=='design_target','materials provenance');check(len(materials['materials'])==37,'material generator coverage')
for name,j in materials['materials'].items():
 image(R/'materials'/(name+'.jpg'),(1024,1024));check(j['observed_statistics']['source']=='measured_script',name+' material median provenance')
 check(j['observed_statistics']['boundary_mean_abs_error_rgb']<8,name+' excessive JPEG edge error')
vfx=load(R/'vfx/vfx.json');check(vfx['source']=='design_target','VFX provenance');check(len(vfx['effects'])==28,'VFX coverage')
for name,j in vfx['effects'].items():image(R/'vfx'/(name+'.jpg'),(1536,1024));check(6<=len(j['sequence_composition'])<=8,name+' sequence count')
props=load(R/'props/props.json');check(props['source']=='design_target','prop provenance');check(len(props['props'])==26,'prop coverage')
for name,j in props['props'].items():check(len(j.get('composition',[]))==2,name+' front/three-quarter coverage')
for sheet in {j['sheet'] for j in props['props'].values()}:image(R/'props'/sheet,(1536,1024))
ui=load(R/'ui/mockup-measurements.json');check(len(ui['screens'])==13,'native mockup count')
ui_target=load(R/'ui/ui-spec.json')['elements']
for screen in ui['screens']:
 check(not screen['errors'],screen['screen']+' browser errors')
 for e in screen['elements']:
  if e['element'] in ui_target:
   target=ui_target[e['element']];rect=target['rect_px']
   if target.get('rotation_deg'):
    x,y,w,h=rect;a=math.radians(target['rotation_deg']);ww=abs(w*math.cos(a))+abs(h*math.sin(a));hh=abs(w*math.sin(a))+abs(h*math.cos(a));rect=[x+w/2-ww/2,y+h/2-hh/2,ww,hh]
   check(np.max(np.abs(np.array(e['rect_px'])-rect))<.01,e['element']+' CSS/JSON target mismatch')
 if screen['screen']=='hud_touch':
  buttons=[e for e in screen['elements'] if e['element'].removeprefix('touch_') in ['DRAW','AIM','KNIVES','JUMP','DASH','FOCUS','INTERACT','ARROW','PAUSE']]
  check(len(buttons)==9,'Nine touch actions')
  for i,a in enumerate(buttons):
   for b in buttons[i+1:]:
    x,y,w,h=a['rect_px'];xx,yy,ww,hh=b['rect_px']
    check(min(x+w,xx+ww)<=max(x,xx) or min(y+h,yy+hh)<=max(y,yy),a['element']+' overlaps '+b['element'])
  for e in screen['elements']:
   if e['element'].removeprefix('touch_') in ['DRAW','AIM','KNIVES','JUMP','DASH','FOCUS','INTERACT','ARROW','PAUSE']:
    x,y,w,h=e['rect_px'];check(min(w,h)>=56,e['element']+' touch size');check(x>=26 and y>=14 and x+w<=818 and y+h<=376,e['element']+' safe-area bounds')
for name in ['hud_desktop','title','chapter_select','upgrades','settings','pause','chapter_complete','defeat','loading','credits']:image(R/'ui'/(name+'.jpg'),(1920,1080))
image(R/'ui/hud_touch.jpg',(844,390))
for chapter in ids[:-1]:image(R/'ui/chapter_cards'/(chapter+'.jpg'),(1024,512))
for p in (R/'ui/icons').glob('*.svg'):
 s=p.read_text();check('viewBox="0 0 24 24"' in s and 'currentColor' in s,p.name+' SVG contract')
image(R/'key-art/poster.jpg',(1024,1536));image(R/'key-art/readme_banner.jpg',(1536,512))
for manifest,count in [('current-capture-results.json',10),('current-vignette-results.json',9)]:
 captures=load(R/'scenes'/manifest);check(len(captures)==count,manifest+' capture count')
 for capture in captures:
  check(capture['result']['ok'] and not capture['result']['errors'],capture['id']+' capture browser errors')
  check((R/capture['published_image']).exists(),capture['id']+' capture delivery')
files=[p for p in R.rglob('*') if p.is_file()];total=sum(p.stat().st_size for p in files)
check(total<=120_000_000,f'Library exceeds 120 MB: {total} bytes')
result={'source':'measured_script','script':'tools/validate_refs.py','checks':checks,'errors':errors,'file_count':len(files),'library_bytes_before_this_report':total,'limit_bytes':120_000_000}
(R/'tools/validation-scenes.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result));sys.exit(bool(errors))
