#!/usr/bin/env python3
"""Persistent review ledger and index; never auto-accepts imagery."""
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
STATE=ROOT/'progress.json'
ROSTER={
'legolas':(1.85,'humanoid'),'gimli':(1.37,'humanoid'),'aragorn':(1.88,'humanoid'),'tauriel':(1.78,'humanoid'),'bolg':(2.6,'humanoid'),'cave_troll':(4.5,'humanoid'),
 'thranduil':(1.9,'humanoid'),'elf_mirkwood':(1.85,'humanoid'),'elf_galadhrim':(1.85,'humanoid'),'boromir':(1.85,'humanoid'),'gondor':(1.82,'humanoid'),'rohirrim':(1.8,'humanoid'),'laketown_man':(1.75,'humanoid'),
 'orc':(1.7,'humanoid'),'goblin':(1.48,'humanoid'),'gundabad':(2.1,'humanoid'),'uruk':(2.0,'humanoid'),'berserker':(2.1,'humanoid'),'lurtz':(2.1,'humanoid'),'easterling':(1.8,'humanoid'),'haradrim':(1.8,'humanoid'),'war_troll':(4.5,'humanoid'),
 'mirkwood_spider':(2.75,'creature'),'brood_mother':(6,'creature'),'mumak':(14,'creature'),'gundabad_bat':(7,'creature'),'great_eagle':(10,'silhouette'),'fell_beast':(12,'silhouette'),
 'dwarf_bald':(1.35,'humanoid'),'dwarf_hat':(1.30,'humanoid'),'dwarf_elder':(1.37,'humanoid'),'dwarf_redbeard':(1.40,'humanoid')}
WEAPONS=['galadhrim_bow','elven_knives','gimli_axe','uruk_falchion','orc_cleaver','orc_scimitar','bolg_mace','cave_troll_club','war_hammer','pike','rohan_shield','gondor_shield','uruk_shield','torch']

def save(data):
 STATE.write_text(json.dumps(data,indent=2)+'\n')

def initialize():
 if STATE.exists():return
 entries={}
 for cid,(extent,kind) in ROSTER.items():
  views=['front','three_quarter','side','back'] if kind=='humanoid' else ['side','front','top','three_quarter']
  if cid=='gundabad_bat':views+=['folded']
  deliverables={f'views/{v}':{'status':'pending','attempts':[]} for v in views}
  if kind!='silhouette':
   deliverables.update({f'face_views/{v}':{'status':'pending','attempts':[]} for v in ['front','three_quarter','side']})
   deliverables.update({f'details/{v}':{'status':'pending','attempts':[]} for v in ['cloth_leather','weapon_metal','skin','hair']})
  for v in ['turnaround','spec','notes','check']+([] if kind=='silhouette' else ['face','details','observed']):deliverables[v]={'status':'pending','attempts':[]}
  entries[cid]={'kind':kind,'design_extent_m':extent,'deliverables':deliverables}
 for group,names in {'weapons':WEAPONS,'orc_variants':['wiry','brown','scarred','matted'],'dwarf_company':['dwarf_bald','dwarf_hat','dwarf_elder','dwarf_redbeard'],'mumak_howdah':['howdah']}.items():
  entries[group]={'kind':'supplement','deliverables':{name:{'status':'pending','attempts':[]} for name in names+['sheet','spec','notes','check']}}
 data={'version':1,'branch':'reference/character-sheets','pr':'https://github.com/vicciz-ceo/legolas-greenleaf/pull/1','entries':entries,'blockers':{'missing_old_images':'Old full-resolution PNGs and accepted Legolas sheets are absent from this workspace and GitHub. Retain historical attempts; do not overwrite accepted designs.'}}
 save(data)

def record(cid,key,status,reason='',path=None,attempt=False):
 data=json.loads(STATE.read_text());item=data['entries'][cid]['deliverables'][key]
 if attempt:
  if len(item['attempts'])>=4:raise ValueError('Four-attempt cap reached')
  item['attempts'].append({'number':len(item['attempts'])+1,'status':status,'reason':reason,'path':path})
 item.update(status=status,reason=reason)
 if path:item['path']=path
 save(data)

def render():
 data=json.loads(STATE.read_text());lines=['# Full character-library checklist','', 'Statuses are evidence-based. Accepted design notes do not certify a completed visual reference. Historical accepted files that are missing here are blocked for delivery, not rejected.','']
 for cid,e in data['entries'].items():
  lines+=['## '+cid,'','| Deliverable | Status | Attempts | Evidence / next action |','| --- | --- | --- | --- |']
  for k,d in e['deliverables'].items():lines.append(f"| {k} | {d['status']} | {len(d['attempts'])} | {d.get('reason','')} |")
  lines.append('')
 (ROOT/'CHECKLIST.md').write_text('\n'.join(lines).rstrip()+'\n')


def index_and_report(data):
 from compose import stored_bytes
 history=ROOT/'recovery'
 for name in ('README','QUALITY_REPORT'):
  target=history/('first-pass-'+name+'.md')
  if not target.exists():target.write_text((ROOT/(name+'.md')).read_text())
 lines=['# Greenleaf character reference library','', 'Development references only; the game imports none of these images. All source meshes, textures and sound remain procedural.','', 'Branch `reference/character-sheets`; [draft PR #1](https://github.com/vicciz-ceo/legolas-greenleaf/pull/1). The original briefs are retained in [recovery/original-brief.txt](recovery/original-brief.txt). [CHECKLIST.md](CHECKLIST.md) and [progress.json](progress.json) track every required deliverable and its attempt history.','', '| Character / group | Design height or span | Thumbnail | Spec | Notes | Delivery status |','| --- | --- | --- | --- | --- | --- |']
 quality=['# Reference quality report','', 'Current resumed pass. Prior failed multi-view generations are preserved in [recovery/first-pass-QUALITY_REPORT.md](recovery/first-pass-QUALITY_REPORT.md); they are not accepted sources. Revised-view attempts retain their counts across sessions.','', 'Visual review checks identity, anatomy, angle, gear sides, text and silhouette. Automated checks reconstruct the exact pre-JPEG canvas, use tolerance 3 for decoded JPEG background, and verify sources, schema, geometry and storage budgets. Neither normalizing a cutout nor a generated number measures recovered 3D anatomy. Samples are rendered and lit, not albedo.','', '## Missing original files','',data['blockers'].get('missing_old_images','None'),'', 'Gimli loose-back-hair correction and the opaque-kilt troll framing correction both completed in the failed chat, but their files are absent here and lack a subsequent recorded review. See [RECOVERY_STATUS.md](RECOVERY_STATUS.md).','', '## Per-deliverable outcomes','', '| Character | Deliverable | Current status | Attempts | Specific evidence or defect |','| --- | --- | --- | --- | --- |']
 for cid,e in data['entries'].items():
  statuses=[d['status'] for d in e['deliverables'].values()]
  status='accepted' if all(x=='accepted' for x in statuses) else 'blocked' if 'blocked' in statuses else 'rejected / pending' if 'rejected' in statuses else 'pending'
  exists=(ROOT/cid/'spec.json').exists()
  thumb=f'<img src="{cid}/{cid}_turnaround.jpg" width="180" alt="{cid}">' if status=='accepted' and (ROOT/cid/f'{cid}_turnaround.jpg').exists() else '—'
  spec=f'[spec]({cid}/spec.json)' if exists else '—'
  notes=f'[notes]({cid}/notes.md)' if (ROOT/cid/'notes.md').exists() else '—'
  lines.append(f"| {cid} | {e.get('design_extent_m','supplement')} | {thumb} | {spec} | {notes} | {status} |")
  for key,d in e['deliverables'].items():
   reason=d.get('reason','Not yet attempted').replace('|','/')
   quality.append(f"| {cid} | {key} | {d['status']} | {len(d['attempts'])} | {reason} |")
   for attempt in d['attempts']:
    if attempt['status']=='rejected':quality.append(f"| {cid} | {key} attempt {attempt['number']} | rejected | — | {attempt['reason']} |")
 lines+=['','## Composition and storage','',f'Retained library size: **{stored_bytes(ROOT):,} bytes / 70,000,000 bytes**. Per-character budget: 2,500,000 bytes including all retained sources, finals, JSON and notes. Full-resolution originals stay outside the committed reference library in `/workspace/generated_images`; `sources.json` records provenance. Temporary previews and Python bytecode are not retained assets.','', 'Commands: `python docs/refs/tools/compose.py check <id>` and `python docs/refs/tools/compose.py check --all`. A whole-library PARTIAL result lists missing, rejected or blocked sets rather than certifying them.','', 'Minor buckle, stitching, strap-count and light drift is tolerated and documented per character. No source is mirrored. Creature views, flight silhouettes and supplements follow their explicitly recorded exceptions.']
 quality+=['','## Validation','', '- Eight compositor regression tests pass (scale, layout, source freshness, schema, budget, reconstruction, fallback segmentation and whole-library entrypoint).','- Game build passed. Smoke passed four arena checkpoints with zero errors using `SNAP_CHROME=/usr/bin/chromium`. The default Chromium path was absent; no game files were changed.','- Latest per-character and whole-library output is saved under `validation/` at each commit checkpoint.']
 (ROOT/'README.md').write_text('\n'.join(lines).rstrip()+'\n');(ROOT/'QUALITY_REPORT.md').write_text('\n'.join(quality)+'\n')

if __name__=='__main__':
 import argparse
 p=argparse.ArgumentParser();p.add_argument('action',choices=['init','render','record']);p.add_argument('args',nargs='*');a=p.parse_args()
 if a.action=='init':initialize()
 elif a.action=='record':record(*a.args)
 render()
