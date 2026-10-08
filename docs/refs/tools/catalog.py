#!/usr/bin/env python3
"""Original roster descriptions and explicitly authored design targets."""
import copy,json
from pathlib import Path
from progress import ROOT,ROSTER
DESCRIPTIONS={
 'thranduil':'Elvenking: long platinum-silver hair; dark twig crown with autumn leaves and berries; silver brocade robe under a floor-length wine-red embroidered coat; regal cold original elf face.',
 'elf_mirkwood':'Mirkwood male elf guard: original face, pointed ears, dark brown long hair; gold-bronze leaf-pattern cuirass, green cloak, leaf-crested helmet, green tunic, brown boots; elegant glaive held low in own RIGHT hand, own left hand empty.',
 'elf_galadhrim':'Galadhrim male elf of Lothlorien: original face, pointed ears, long warm blond hair; ornate fluted golden armour, deep red cloak, dark leggings and boots; longbow held low in own LEFT hand, back quiver, right hand empty.',
 'boromir':'Gondor captain: original rugged face, shoulder-length brown hair and beard, NO helmet; fur-collared dark cloak over blue-grey tunic, leather belt and boots; carved pale Horn of Gondor at own RIGHT hip; sheathed sword own LEFT hip; both hands empty.',
 'gondor':'Gondor soldier: original human face; black surcoat bearing a decorative white tree emblem, mail, polished steel plates, tall winged Minas Tirith helmet; sword in own RIGHT hand, kite shield on own LEFT arm; leather boots.',
 'rohirrim':'Rohirrim human soldier: original weathered bearded face; mail shirt, green tunic, round steel helm with horsehair crest, brown boots; sword in own RIGHT hand, round painted wood shield with horse motif on own LEFT arm.',
 'laketown_man':'Lake-town human town guard and fisher: original middle-aged bearded face, brown wool cap, padded dull blue jacket over simple beige tunic, belt pouch, dark trousers, brown worn boots; both hands empty; no armour.',
 'orc':'Wiry hunched orc: mottled grey-green skin, old scars, uneven fangs, matted black hair; rag armour and crude rusty plates over opaque ragged brown tunic and kilt, wrapped feet; rusty cleaver in own RIGHT hand, left empty.',
 'goblin':'Moria goblin: pale grey skin, large glinting amber eyes, bat-like pointed ears, lean long limbs, deep crouch; sparse dark hair, coarse brown wrap covers torso and lower body, rusty plates; crude blade in own RIGHT hand, left empty.',
 'gundabad':'Huge Gundabad orc: pale bluish-grey skin, huge broad shoulders, original fanged scarred face, sparse dark hair; heavy scrap iron plates, spiked pauldrons, coarse opaque brown kilt, foot wraps; brutal mace own RIGHT hand, left empty.',
 'uruk':'Muscular Uruk-hai: dark brown-black skin, long black hair, original fanged broad face; black armour and helmet, white hand emblems on helmet and shield, opaque black kilt, boots; falchion own RIGHT hand, shield own LEFT arm.',
 'berserker':'Uruk berserker: muscular dark brown-black skin, original creature anatomy; bare upper torso painted with white handprints, spiked iron helmet covers face, opaque knee-length black cloth kilt, thick belt, foot wraps; huge two-handed sword held low in own RIGHT hand for reference pose, left empty.',
 'lurtz':'Original Uruk captain Lurtz: huge muscular dark brown-black skin, long black hair, uneven fangs, old scars, white hand painted across face; no upper armour, leather bracers and belt, substantial opaque dark knee-length kilt and boots; bow own LEFT hand, sword own RIGHT hand, shield on BACK.',
 'easterling':'Easterling human warrior: original face under golden masked faceplate helmet; gold bronze and black scale armour, red-black cloth, boots; spear own RIGHT hand held LOW horizontal or diagonal entirely below helmet, shield on own LEFT arm.',
 'haradrim':'Haradrim human warrior: original warm brown face with red-black paint, black wrapped hair; red and black robes and wraps, gold jewellery, brown leather sandals; scimitar own RIGHT hand, left empty.',
 'war_troll':'Armoured War Troll: soot-dark warty hide, small tusked heavy-brow head, massive organic shoulders and arms, ONE barrel chest and belly; pointed iron helmet, heavy plate harness, spiked pauldrons, opaque knee-length leather kilt; warhammer own RIGHT hand, left empty; five fingers on each hand.',
 'mirkwood_spider':'Giant Mirkwood spider: exactly EIGHT jointed legs, black-brown chitin with coarse hair, patterned bulbous abdomen, eight glossy clustered eyes, paired mandibles; body about 1.2 m tall, leg span 2.75 m; no armour or gear.',
 'brood_mother':'Brood Mother giant spider: exactly EIGHT jointed legs, massive bulbous black-brown patterned abdomen, coarse hair, old scars and pale markings, eight glossy clustered eyes, paired mandibles; 6 m leg span; no gear.',
 'mumak':'War oliphaunt: original massive grey-brown wrinkled elephant creature, FOUR huge tusks in two pairs, long trunk, large ears, war paint; wooden war howdah strapped to back with ropes and girths, red and gold banners, rope ladder on own LEFT flank; 14 m shoulder height; FOUR natural legs, no human figures.',
 'gundabad_bat':'Gundabad giant bat: original rat-like head, furred dark grey torso, TWO leathery membranous translucent wings with natural finger struts, TWO clawed rear feet; wings SPREAD with 7 m span, no armour or gear.',
 'great_eagle':'Great eagle in FLIGHT: original golden-brown raptor, two feathered spread wings, single head with curved beak, feathered tail, two tucked taloned feet; far-distance readable natural silhouette, 10 m wingspan, no rider or gear.',
 'fell_beast':'Fell beast in FLIGHT: original dark reptilian winged creature, single serpentine neck and narrow toothy head, long tail, TWO bat-like membrane wings, TWO tucked hind legs; far-distance readable silhouette, 12 m wingspan, no rider or gear.',
 'dwarf_bald':'Original stocky dwarf warrior: bald tattooed scalp, wide face, braided short dark beard; worn brown leather and mail, crossed straps, belt axes, thick boots; axe own RIGHT hand, left empty; upper-body tattoos clearly readable.',
 'dwarf_hat':'Original stocky dwarf: soft floppy wool hat, broad face and curly chestnut beard; coarse ochre tunic, dark brown padded vest, belt, thick boots; both hands empty; distinctive floppy hat readable above barrel rim.',
 'dwarf_elder':'Original elderly stocky dwarf: long white beard, bushy white brows, thinning white hair, wrinkled broad face; dark blue wool tunic and brown leather vest, belt and thick boots; both hands empty; flowing white beard clearly readable.',
 'dwarf_redbeard':'Original huge stocky dwarf: enormous wild red beard and red-brown hair, broad full face; russet tunic, heavy brown leather vest, thick belt and boots; both hands empty; very broad shoulders and huge beard silhouette.'}
PALETTES={
 'thranduil':('#e7c7b7','#d5d4ce','#6c192e','#c2beb4','#665447'),
 'elf_mirkwood':('#e0baa0','#493728','#4c6137','#a07e39','#62462e'),
 'elf_galadhrim':('#e2c3a9','#c7b18a','#74242c','#ae8c4b','#584231'),
 'boromir':('#bf9379','#53392c','#474f64','#8c8c81','#614d37'),
 'gondor':('#c39b82','#4d382a','#292929','#969c9d','#574735'),
 'rohirrim':('#b98f73','#614b31','#4d593c','#8a8980','#67503b'),
 'laketown_man':('#b98f73','#61452f','#566473','#6b665c','#5c4431'),
 'orc':('#6b7156','#302f25','#554333','#71614b','#55412c'),
 'goblin':('#9a9e92','#393a30','#554b3a','#665d4c','#594a34'),
 'gundabad':('#aeb8b5','#3a3934','#4b4237','#726452','#52402e'),
 'uruk':('#4d4033','#24211d','#302d27','#454742','#493828'),
 'berserker':('#50412e','#29241d','#333029','#54554e','#4d3929'),
 'lurtz':('#55432f','#24211b','#3f3426','#6b6657','#5a3f2a'),
 'easterling':('#b98f72','#312920','#342d27','#b0904b','#583c2b'),
 'haradrim':('#a17253','#2a231b','#86292c','#b39145','#5b3c27'),
 'war_troll':('#45473c','#34352b','#3b362a','#57594e','#4b392b')}

def initialize():
 template=json.loads((ROOT/'legolas/spec.json').read_text())['design']
 for cid,(extent,kind) in ROSTER.items():
  folder=ROOT/cid;folder.mkdir(exist_ok=True);path=folder/'spec.json'
  if path.exists():continue
  d=copy.deepcopy(template);pal=PALETTES.get(cid,('#777064','#5a4c38','#5b4b37','#80735e','#594232'))
  d.update(id=cid,display_name=cid.replace('_',' ').title(),height_m=extent,overall_height_m=extent,description=DESCRIPTIONS[cid],source='design_target')
  if cid=='thranduil':d['overall_height_m']=2.08
  if cid=='gondor':d['overall_height_m']=2.04
  if cid in ('rohirrim','elf_mirkwood'):d['overall_height_m']=extent+.12
  d['proportions']={k:round(extent*f,3) for k,f in [('head_height_m',.124),('shoulder_width_m',.24),('hip_width_m',.185),('arm_length_m',.42),('leg_length_m',.52),('hand_length_m',.103),('neck_length_m',.06)]}
  d['proportions'].update(bulk_0to1=.85 if cid.startswith('dwarf') or cid in ('gundabad','war_troll') else .5,hunch_0to1=.15 if cid in ('orc','goblin') else 0)
  d['face'].update(shape=DESCRIPTIONS[cid],skin_base_hex=pal[0],ears='pointed elf ears' if cid.startswith('elf') or cid=='thranduil' else 'as described; original natural anatomy')
  d['hair'].update(root_hex=pal[1],tip_hex=pal[1],length_m=.65 if cid=='thranduil' else .35,style=DESCRIPTIONS[cid],braids='as described, no additional ornamental braids')
  d['outfit_layers']=[dict(name='cloth',material='woven cloth or brocade as described',color_hex=pal[2],roughness=.85,sheen=.3,notes=DESCRIPTIONS[cid]),dict(name='leather',material='worn stitched leather',color_hex=pal[4],roughness=.72,sheen=.08,notes='Only where required by description')]
  d['armor']=[dict(name='metal',material='metal fittings or armour as described',color_hex=pal[3],roughness=.5,metalness=1)]
  d['weapons']=[];d['attachments']={};d['silhouette_keywords']=DESCRIPTIONS[cid].split(';');d['avoid']=['actor likeness','incorrect limbs or digits','gear side swaps','generated text','cropped extremities']
  d['design_sources']=['recovery/original-brief.txt: original roster entry','ARCHITECTURE.md section 4: applicable scale list']
  d['proportion_note']='Unspecified proportions, crown allowance and palette/PBR values are authored modelling intent, not prescribed requirements or measured anatomy.'
  if kind!='humanoid':
   d['proportion_note']='Original creature scale target; humanoid-schema proportions are not applicable and are zero. Projected extents and palettes are authored design targets, not recovered 3D measurements.'
   d['proportions']={k:0 for k in d['proportions']};d['outfit_layers']=[];d['armor']=[];d['hair']['length_m']=.04
  composition={'fit_policy':'fit','detail_tiles':[{'name':n,'label':l,'source':f'details/{n}.png'} for n,l in [('cloth_leather','CLOTH / LEATHER'),('weapon_metal','GEAR / METAL'),('skin','SKIN / FACE'),('hair','HAIR / STRANDS')]]}
  if kind!='humanoid':
   composition.update(creature=True,silhouette_only=kind=='silhouette',views=['front','side','top','three_quarter'],reference_view='side',scale_axis='height' if cid=='mumak' else 'width',scale_extent_m=extent,projected_extents_m={v:extent for v in ['front','side','top','three_quarter']})
   if cid=='mumak':composition['measurement_note']='Shoulder height endpoint must be selected below the howdah; never normalize by the tower top.'
   else:composition['measurement_note']='Span endpoint pair selected on accepted reference; perpendicular projections require authored projected extent before composing.'
  path.write_text(json.dumps({'id':cid,'design':d,'composition':composition},indent=2)+'\n')
  (folder/'notes.md').write_text('# '+d['display_name']+' modelling notes\n\n'+'\n'.join('- '+s for s in [DESCRIPTIONS[cid],'Preserve the original face; no actor likeness.','Keep gear on its own anatomical side under rotation.','Build surface weave, skin and hair as procedural detail.','Do not infer 3D dimensions from the image normalization.','Design palette and roughness are targets; observed pixels are rendered and lit, not albedo.','Minor seams, buckle shapes, strap count and mild light differences may vary.','Maintain natural joints and all required limb and digit counts.'])+'\n')
if __name__=='__main__':initialize()
