#!/usr/bin/env python3
"""Compose VFX timelines/rulers and true-dimension prop bounding boxes from unlabelled LOOK art."""
from pathlib import Path
import json,math,hashlib
import numpy as np
from PIL import Image,ImageDraw,ImageOps,ImageFilter,ImageEnhance
from scene_composition import *
R=Path(__file__).resolve().parents[1]
def read(p):return json.loads(Path(p).read_text())
def write(p,d):Path(p).write_text(json.dumps(d,indent=2)+'\n')
def text(d,xy,t,px=18,col=SILVER):d.text(xy,str(t),font=font(px),fill=col)
def parsehex(v):return np.array([int(v[i:i+2],16) for i in [1,3,5]],float)
def calibrated_ladder(size,view,target):
 """Render binding rung geometry in code; source timber swatch supplies the material look."""
 W,H=size;im=Image.new('RGB',size,(23,27,32));d=ImageDraw.Draw(im)
 texture=Image.open(R/'materials/old_wood.jpg').convert('RGB')
 rail=max(1,round(W*.075));left=round(W*.13);right=round(W*.82)
 for x in [left,right]:
  im.paste(fit(texture,(rail,H)),(x,0));d.line((x,0,x,H),fill=(156,127,86),width=1)
 count=target['rung_count'];spacing=target['rung_spacing_m'];height=22
 thickness=max(1,round(H*target['rung_diameter_m']/height))
 for i in range(count):
  y=round(H-(.3+i*spacing)/height*H)
  if y<2:continue
  skew=round(W*.15) if view else 0
  d.line((left,y+skew,right+rail,y-skew),fill=(80,60,39),width=thickness+1)
  d.line((left,y+skew-1,right+rail,y-skew-1),fill=(164,133,88),width=thickness)
 return im
def screen_effect(im,name,strength):
 im=im.convert('RGB');a=np.asarray(im).astype(float);h,w=a.shape[:2];yy,xx=np.mgrid[:h,:w];radius=np.sqrt(((xx-w/2)/(w/2))**2+((yy-h/2)/(h/2))**2)
 if name=='focus_screen':
  lum=a@np.array([.2126,.7152,.0722]);a=a*(1-.65*strength)+lum[:,:,None]*(.65*strength);a=a*(1-.2*strength)+np.array([115,155,159])*.2*strength
  norm=np.maximum(1,np.sqrt((xx-w/2)**2+(yy-h/2)**2));acc=np.zeros_like(a)
  for t in np.linspace(-3,3,7):
   sx=np.clip((xx+(xx-w/2)/norm*t*strength).round().astype(int),0,w-1);sy=np.clip((yy+(yy-h/2)/norm*t*strength).round().astype(int),0,h-1);acc+=a[sy,sx]/7
  mask=np.clip((radius-.35)/.55,0,1)[:,:,None];a=a*(1-mask)+acc*mask
 elif name=='damage_vignette':
  mask=np.clip((radius-.6)/.5,0,1)[:,:,None]*.32*strength;a=a*(1-mask)+np.array([143,37,31])*mask
 elif name=='cinematic_letterbox':
  n=round(h*.12*strength);a[:n]=0
  if n:a[-n:]=0
 return Image.fromarray(np.clip(a,0,255).astype(np.uint8))

def particle_frame(name,j,t,size=(238,160)):
 """A calibrated orthographic simulation study; not a claim of measured runtime particles."""
 W,H=size;im=Image.new('RGB',size,(23,27,32));d=ImageDraw.Draw(im);seed=int(hashlib.sha256(name.encode()).hexdigest()[:8],16);rng=np.random.default_rng(seed)
 domain=24 if name=='culvert_explosion' else 30 if name=='smoke_column' else 12 if name=='burning_house' else 3 if name in ['torch','brazier','barrel_splash','rapids_foam'] else 12 if name in ['rain','storm_lightning'] else 8 if name=='snow' else 6 if name in ['ash','dust_motes','mirkwood_spores'] else 2
 ppm=(H-32)/domain;origin=np.array([W/2,H-20]);drawn=0;cap=j['particle_count'];rate=j['emission_rate_per_s'];g=np.array(j['gravity_m_s2']);vmin=np.array(j['velocity_range_m_s']['min']);vmax=np.array(j['velocity_range_m_s']['max']);life=rng.uniform(*j['lifetime_s'],size=max(1,cap));vel=rng.uniform(vmin,vmax,size=(max(1,cap),3))
 active_cap=min(cap,round(rate*sum(j['lifetime_s'])/2)) if rate else cap
 for i in range(active_cap):
  birth=0;age=(t-i/max(rate,1))%life[i] if rate else t
  if age<0 or age>life[i]:continue
  pos=vel[i]*age+.5*g*age*age
  if not rate:pos[1]+=domain*.52
  if rate:pos+=rng.uniform([-domain*.4,domain*.5,-.5],[domain*.4,domain,.5])
  if name in ['normal_arrow','focus_volley']:pos[2]=0;pos[0]=(age/max(life[i],.01)-.5)*1.4;pos[1]=.7 if name=='normal_arrow' else .45+(i%3)*.38
  x=origin[0]+pos[0]*ppm;y=origin[1]-pos[1]*ppm
  if not 0<=x<W or not 0<=y<H:continue
  fraction=age/life[i];keys=j['colours_over_life'];segment=next(((a,b) for a,b in zip(keys,keys[1:]) if a['t']<=fraction<=b['t']),(keys[-2],keys[-1]));a,b=segment;u=np.clip((fraction-a['t'])/max(.001,b['t']-a['t']),0,1);colour=parsehex(a['hex'])*(1-u)+parsehex(b['hex'])*u;alpha=a.get('alpha',1)*(1-u)+b.get('alpha',0)*u;colour=np.clip(colour*alpha+np.array([23,27,32])*(1-alpha),0,255).astype(int);col=tuple(int(v) for v in colour);radius=max(.65,(j['size_m']['start']*(1-fraction)+j['size_m']['end']*fraction)*ppm/2)
  if name in ['rain','storm_lightning']:d.line((x,y,x-2,y+12),fill=col,width=1)
  elif name in ['normal_arrow','focus_volley']:d.line((x-16,y,x+16,y),fill=col,width=2)
  elif name=='impact_wood':d.line((x,y,x+radius*3,y-radius*2),fill=col,width=1)
  else:d.ellipse((x-radius,y-radius,x+radius,y+radius),fill=col)
  drawn+=1
 d.line((8,H-20,W-8,H-20),fill=(65,76,72));return im,{'source':'design_target','time_s':t,'drawn_particles':drawn,'world_view_height_m':domain,'projection_pixels_per_metre':ppm,'simulation':'Seeded velocity/lifetime/colour integration from targets; illustrative code study, not measured runtime output.'}

def vfx(partial=True):
 p=R/'vfx/vfx.json';root=read(p)
 for name,j in root['effects'].items():
  screen=j['particle_count']==0;src=R/'scenes/mirkwood/gameplay_look.jpg' if screen else R/'vfx/looks'/(name+'.jpg')
  if not src.exists():
   if not partial:raise FileNotFoundError(src)
   continue
  photo=Image.open(src).convert('RGB');im=Image.new('RGB',(1536,1024),BG);d=ImageDraw.Draw(im);text(d,(36,20),name.replace('_',' ').upper()+' · LOOK + SCRIPTED SEQUENCE',28,GOLD)
  if screen:photo=screen_effect(photo,name,1)
  im.paste(pad(photo,(1464,608)),(36,64));scale_bar(d,56,683,1,60)
  text(d,(150,693),'Design scale cue; hero is LOOK art. Timeline below is generated from the numeric target.',14)
  states=[]
  for i,t in enumerate(j['sequence_times_s']):
   x=30+i*250
   if screen:
    strength=min(1,t/.12,max(0,(1-t)/.18));frame=screen_effect(fit(Image.open(src),(238,160)),name,strength);state={'source':'design_target','time_s':t,'strength':strength,'method':'CPU reference filter using the target screen parameters'}
   else:frame,state=particle_frame(name,j,t)
   im.paste(frame,(x,756));d.rectangle((x,756,x+238,916),outline=(90,101,94));text(d,(x+8,924),f'{t:.2f} s',16,GOLD);states.append(state)
  text(d,(36,980),'Six code-composed frames · metres / seconds · source: design_target · actual renderer remains the implementation authority',14)
  save(im,R/'vfx'/(name+'.jpg'));j.update(image=name+'.jpg',source='design_target',sequence_composition=states,scale_legend={'source':'design_target','metres':1,'pixels':60,'applies_to':'Separate dimensional cue, not surveyed hero photometry'},hero_look_source=str(src.relative_to(R)))
 write(p,root)

def props(partial=True):
 p=R/'props/props.json';root=read(p);groups={}
 for name,j in root['props'].items():groups.setdefault(j['sheet'].replace('.png','.jpg'),[]).append((name,j))
 for sheet,items in groups.items():
  if not all((R/'props/looks'/(n+'.jpg')).exists() for n,j in items):
   if not partial:raise FileNotFoundError(sheet)
   continue
  count=len(items);cols=3 if count>4 else 2;rows=math.ceil(count/cols);cellW=1536//cols;cellH=944//rows
  im=Image.new('RGB',(1536,1024),BG);d=ImageDraw.Draw(im);text(d,(28,18),sheet[:-4].replace('_',' ').upper()+' · DESIGN DIMENSIONS',28,GOLD)
  for i,(name,j) in enumerate(items):
   xx=(i%cols)*cellW;yy=64+(i//cols)*cellH;src=R/'props/looks'/(name+'.jpg');look=Image.open(src).convert('RGB');width,height=look.size
   alpha=Path('/tmp/greenleaf-ref-tools/prop-alpha')/(name+'.png');bounds=j.get('observed_view_bounds_px')
   if not bounds:
    if alpha.exists():mask=ImageOps.pad(Image.open(alpha).convert('RGBA'),look.size,color=(0,0,0,0),method=Image.Resampling.LANCZOS).getchannel('A');mask=mask.point(lambda a:255 if a>160 else 0)
    else:
     arr=np.asarray(look).astype(float);mask=Image.fromarray((np.max(np.abs(arr-np.array([23,27,32])),axis=2)>20).astype(np.uint8)*255)
    bounds=[]
    for view in range(2):
     part=mask.crop((view*width//2,0,(view+1)*width//2,height));b=part.getbbox() or (0,0,width//2,height);bounds.append([b[0]+view*width//2,b[1],b[2]+view*width//2,b[3]])
    j['observed_view_bounds_px']=bounds;j['bounds_provenance']={'source':'measured_script','method':'Opaque-alpha bounding box, or background-difference threshold if alpha unavailable. Bounds include look geometry, not physical dimensions.','look_image':str(src.relative_to(R))}
   target=j['dimensions_m'];H=target['height'];W=target['width'];D=target['depth_length'];ppm=min((cellH-116)/max(H,1.85),(cellW/2-32)/(max(W,(W+D)/math.sqrt(2))+.32*1.85+.15));feet=yy+cellH-56
   text(d,(xx+16,yy+4),name.replace('_',' '),18,GOLD);text(d,(xx+16,yy+31),f'{W:g} × {H:g} × {D:g} m · W/H/D',14)
   calibration=[]
   for view in range(2):
    box=bounds[view];cut=look.crop(box);display_w=W if view==0 else (W+D)/math.sqrt(2);pw=max(2,round(display_w*ppm));ph=max(2,round(H*ppm));center=xx+view*cellW/2+16+pw/2;cut=cut.resize((pw,ph),Image.Resampling.LANCZOS)
    if name=='ladder':cut=calibrated_ladder((pw,ph),view,j['construction_target'])
    im.paste(cut,(round(center-pw/2),round(feet-ph)));silhouette(d,center+pw/2+10+.16*1.85*ppm,feet,1.85*ppm)
    text(d,(center-28,feet+8),'FRONT' if view==0 else '3/4',13);calibration.append({'source':'design_target','pixels_per_metre':ppm,'prop_bbox_px':[pw,ph],'scale_figure_height_px':1.85*ppm,'world_height_m':H,'projection':'Front target W/H; illustrative 45° three-quarter bounding width (W+D)/sqrt(2). Not a measured 3D reconstruction.'})
   j.update(sheet=sheet,source='design_target',composition=calibration)
  text(d,(28,1008),'Each panel has its own metre scale; compare the script-drawn 1.85 m figure. Generated images supply surface appearance only.',12)
  save(im,R/'props'/sheet)
 write(p,root)
if __name__=='__main__':vfx();props();print('Composed available VFX and prop references')
