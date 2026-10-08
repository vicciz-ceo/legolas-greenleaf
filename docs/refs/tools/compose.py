#!/usr/bin/env python3
"""Deterministic Greenleaf reference composition; Python 3, Pillow, numpy.

Run from anywhere. Sources, manifests and outputs live under docs/refs/<id>.
No image is mirrored. Measured describes image construction, never body anatomy.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys
import tempfile
import os
from contextlib import contextmanager
from collections import deque

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
BG = (127, 127, 127)
TURN_SIZE = FACE_SIZE = (1536, 1024)
GRID_SIZE = (1024, 1024)
QUALITY = 88
CHAR_BUDGET = 2_500_000
LIB_BUDGET = 70_000_000
_REMBG_SESSION = None
VIEWS = ('front', 'three_quarter', 'side', 'back')
LABELS = {'front': 'FRONT', 'three_quarter': '3/4 FRONT', 'side': 'RIGHT PROFILE',
          'back': 'BACK', 'top': 'TOP DOWN', 'spread': 'WINGS SPREAD', 'folded': 'WINGS FOLDED'}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def load(cid):
    require(cid not in ('', '.', '..') and '/' not in cid and '\\' not in cid, 'Invalid character ID')
    folder = ROOT / cid
    path = folder / 'spec.json'
    data = json.loads(path.read_text())
    require(data.get('id') == cid, 'Top-level spec id must match folder')
    require(data['design'].get('source') == 'design_target', 'Design must be marked design_target')
    return folder, path, data


def write_spec(path, data):
    # Atomic replacement; preserve design and other author-owned fields verbatim.
    stage = path.with_suffix('.json.tmp')
    stage.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n')
    stage.replace(path)


def font(size=22):
    for name in ('DejaVuSans.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            pass
    return ImageFont.load_default(size=size)


def text(draw, xy, label, size=22, anchor='mm'):
    draw.text(xy, label, fill=(238, 238, 238), font=font(size), anchor=anchor)


def bbox(im):
    require(im.mode == 'RGBA', 'Source must be RGBA, not an opaque studio render')
    alpha = np.asarray(im.getchannel('A'))
    mask = alpha > 127
    require(mask.any() and (~mask).any(), 'Source needs a nonempty cutout and transparent background')
    yy, xx = np.where(mask)
    return (int(xx.min()), int(yy.min()), int(xx.max()) + 1, int(yy.max()) + 1)


def tight(im):
    # Ignore only near-transparent background. Do not rotate, warp or mirror.
    b = bbox(im)
    return im.crop(b), b


def source(folder, relative):
    path = (folder / relative).resolve()
    require(path.is_relative_to(folder.resolve()), 'Source escapes character directory')
    require(path.is_file(), f'Missing source: {relative}')
    im = Image.open(path).convert('RGBA')
    return path, im


def save_sheet(im, path):
    require(im.mode == 'RGB', 'Sheets must be RGB')
    im.save(path, 'JPEG', quality=QUALITY, subsampling=0, optimize=True)
    require(np.all(np.asarray(im)[:16, :16] == np.array(BG)), 'Pre-JPEG background patch changed')
    pre_jpeg_sha256 = hashlib.sha256(im.tobytes()).hexdigest()
    decoded = Image.open(path).convert('RGB')
    # A constant safe 8x8 JPEG block remains exact; edges of cutouts can ring.
    require(np.max(np.abs(np.asarray(decoded).astype(int)[:16, :16] - np.array(BG))) <= 3, 'JPEG safe background patch changed')
    return {'path': path.name, 'canvas_px': list(im.size), 'jpeg_quality': QUALITY,
            'jpeg_subsampling': 0, 'sha256': digest(path), 'size_bytes': path.stat().st_size,
            'background_rgb': list(BG), 'background_probe': [0, 0, 16, 16],
            'pre_jpeg_sha256': pre_jpeg_sha256, 'decoded_background_tolerance': 3}


def component_cleanup(candidate, max_small=12):
    """Remove speckle and fill one-pixel gaps using Pillow morphology."""
    m = Image.fromarray((candidate.astype(np.uint8) * 255), 'L')
    m = m.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(3))
    return np.asarray(m) > 127


def segment(inp, out, threshold=38.0, max_height=768, backend='auto'):
    global _REMBG_SESSION
    im = Image.open(inp).convert('RGBA')
    input_size = im.size
    alpha = np.asarray(im.getchannel('A'))
    if np.any(alpha < 255):
        method = 'existing_alpha'
    else:
        removed = None
        if backend != 'threshold':
            try:
                from rembg import remove, new_session
                if _REMBG_SESSION is None:
                    _REMBG_SESSION = new_session(os.environ.get("GREENLEAF_REMBG_MODEL", "u2net"))
                removed = remove(im, session=_REMBG_SESSION)
            except ImportError:
                require(backend != 'rembg', 'rembg requested but not installed')
        if removed is not None:
            im = removed.convert('RGBA')
            method = 'rembg'
        else:
            arr = np.asarray(im.convert('RGB')).astype(np.float32)
            h, w = arr.shape[:2]
            corner = max(3, min(h, w) // 25)
            samples = np.concatenate([arr[:corner, :corner].reshape(-1, 3),
                arr[:corner, -corner:].reshape(-1, 3), arr[-corner:, :corner].reshape(-1, 3),
                arr[-corner:, -corner:].reshape(-1, 3)])
            median = np.median(samples, axis=0)
            distance = np.linalg.norm(arr - median, axis=2)
            candidate = distance > threshold
            # Morphology is intentionally conservative; by-eye cutout review is still required.
            mask = component_cleanup(candidate)
            require(mask.any(), 'Threshold removed entire subject; lower --threshold or use rembg')
            # Remove tiny detached residuals, keeping legitimate detached gear larger than 20 px.
            try:
                from scipy.ndimage import label
                labels, n = label(mask)
                counts = np.bincount(labels.ravel())
                keep = counts >= 20
                keep[0] = False
                mask = keep[labels]
            except ImportError:
                pass
            rgba = np.asarray(im).copy()
            rgba[:, :, 3] = np.where(mask, 255, 0).astype(np.uint8)
            im = Image.fromarray(rgba, 'RGBA')
            method = 'corner_median_colour_distance_morphology'
    im, original_box = tight(im)
    require(method != 'corner_median_colour_distance_morphology' or tuple(original_box) != (0, 0, *input_size), 'Threshold cutout covers entire input; review backdrop or threshold')
    if im.height > max_height:
        im = im.resize((max(1, round(im.width * max_height / im.height)), max_height), Image.Resampling.LANCZOS)
    # Clean RGB of fully transparent pixels so PNG compression does not store the backdrop.
    arr = np.asarray(im).copy()
    arr[arr[:, :, 3] == 0, :3] = 0
    im = Image.fromarray(arr, 'RGBA')
    padded = Image.new('RGBA', (im.width + 8, im.height + 8), (0, 0, 0, 0))
    padded.alpha_composite(im, (4, 4))
    require(padded.height <= 1024, 'Cutout is taller than 1024 px')
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    padded.save(out, optimize=True, compress_level=9)
    return {'output': str(out), 'method': method, 'size_px': list(padded.size),
            'threshold': threshold if method.startswith('corner') else None,
            'original_bbox_px': list(original_box), 'size_bytes': out.stat().st_size}


def ruler(draw, ppm, baseline, height, x=105):
    ytop = baseline - round(height * ppm)
    draw.line((x, ytop, x, baseline), fill=(225, 225, 225), width=1)
    ticks = []
    for i in range(math.floor(height / .25 + 1e-8) + 1):
        value = i * .25
        y = baseline - round(value * ppm)
        draw.line((x - 8, y, x + 8, y), fill=(225, 225, 225), width=1)
        text(draw, (x - 12, y), f'{value:.2f}', 16, 'rm')
        ticks.append({'value_m': value, 'y_px': y})
    # Put endpoint label on the right to avoid overlap with a near-quarter tick.
    draw.line((x - 8, ytop, x + 8, ytop), fill=(225, 225, 225), width=1)
    text(draw, (x + 12, ytop - 12), f'{height:.2f} m', 18, 'lm')
    return {'axis': 'vertical', 'x_px': x, 'baseline_y_px': baseline, 'top_y_px': ytop,
            'endpoint_m': height, 'step_m': .25, 'ticks': ticks}


def human(draw, x, baseline, ppm):
    # A deterministic, original 1.85 m scale icon, not generated imagery.
    h = round(1.85 * ppm)
    y = baseline - h
    r = max(2, round(.10 * ppm))
    head = y + r
    draw.ellipse((x-r, y, x+r, y+2*r), fill=(30, 30, 30))
    shoulder = y + round(.30 * ppm)
    hip = y + round(.93 * ppm)
    half = max(3, round(.21 * ppm))
    draw.polygon([(x-half, shoulder), (x+half, shoulder), (x+round(.14*ppm), hip),
                  (x-round(.14*ppm), hip)], fill=(30, 30, 30))
    width = max(2, round(.09*ppm))
    for sign in (-1, 1):
        draw.line((x+sign*half, shoulder, x+sign*round(.30*ppm), y+round(1.02*ppm)),
                  fill=(30, 30, 30), width=width)
        draw.line((x+sign*round(.08*ppm), hip, x+sign*round(.13*ppm), baseline-1),
                  fill=(30, 30, 30), width=width)
    text(draw, (x, baseline+18), '1.85 m', 14)
    return {'height_m': 1.85, 'height_px': h, 'top_y_px': y, 'baseline_y_px': baseline,
            'center_x_px': x}


def turnaround(cid):
    folder, specpath, data = load(cid)
    config = data.get('composition', {})
    if config.get('creature'):
        return creature(cid)
    height = float(data['design']['overall_height_m'])
    require(height > 0, 'overall_height_m must be positive')
    canvas = Image.new('RGB', TURN_SIZE, BG)
    draw = ImageDraw.Draw(canvas)
    baseline = 940
    boxes = []
    images = []
    left, right, gap = 155, 1512, 16
    panel_width = (right - left - gap * 3) // 4
    for view in VIEWS:
        path, im = source(folder, f'views/{view}.png')
        require(im.height <= 1024, f'{view}: source taller than 1024 px')
        crop, srcbox = tight(im)
        images.append((view, path, crop, srcbox))
    ppm_height = math.floor(1024 * .85) / height
    ppm_width = min((panel_width - 8) * crop.height / (crop.width * height)
                    for _, _, crop, _ in images)
    fit_policy = config.get('fit_policy', 'strict_85_percent')
    if fit_policy == 'fit':
        ppm = min(ppm_height, ppm_width)
    else:
        require(ppm_width >= ppm_height, 'Four views do not fit at 85% height; use composition.fit_policy="fit" if authorised')
        ppm = ppm_height
    target_height = round(height * ppm)
    require(target_height > 0, 'Invalid projected height')
    # Set ppm from the actual integer silhouette height, not an unrounded target.
    ppm = target_height / height
    for i, (view, path, crop, srcbox) in enumerate(images):
        width = max(1, round(crop.width * target_height / crop.height))
        require(width <= panel_width, f'{view}: panel overflow')
        resized = crop.resize((width, target_height), Image.Resampling.LANCZOS)
        x = left + i*(panel_width + gap) + (panel_width-width)//2
        y = baseline-target_height
        canvas.paste(resized, (x, y), resized)
        text(draw, (left+i*(panel_width+gap)+panel_width//2, 980), LABELS[view], 18)
        boxes.append({'view': view, 'source': str(path.relative_to(folder)), 'source_sha256': digest(path),
                      'source_bbox_px': list(srcbox), 'sheet_bbox_px': [x, y, x+width, baseline],
                      'silhouette_height_px': target_height, 'baseline_y_px': baseline,
                      'resize_uniform_scale': target_height/crop.height, 'mirrored': False})
    scale = ruler(draw, ppm, baseline, height)
    output = folder / f'{cid}_turnaround.jpg'
    result = save_sheet(canvas, output)
    result.update({'px_per_m': ppm, 'baseline_y_px': baseline, 'overall_height_m': height,
                   'height_fill_fraction': target_height/1024, 'fit_policy': fit_policy, 'scale_reduction_reason': 'Horizontal panel fit' if ppm_width < ppm_height else '85 percent height target',
                   'views': boxes, 'ruler': scale, 'interpretation': 'Uniform image normalization to design overall height; not recovered 3D anatomy.'})
    data.setdefault('measured', {})['turnaround'] = result
    write_spec(specpath, data)
    return result


def creature(cid):
    folder, specpath, data = load(cid)
    cfg = data['composition']
    axis = cfg.get('scale_axis', 'width')
    reference_view = cfg.get('reference_view', 'side')
    extent = float(cfg['scale_extent_m'])
    views = cfg.get('views', ['front', 'side', 'top', 'three_quarter'])
    require(len(views) == 4 and axis in ('width', 'height'), 'Creature requires four views and a width/height axis')
    images = []
    for view in views:
        path, im = source(folder, f'views/{view}.png')
        require(im.height <= 1024, 'Creature source exceeds 1024 px')
        crop, srcbox = tight(im)
        images.append((view, path, crop, srcbox))
    ref = next(item for item in images if item[0] == reference_view)
    ref_pixels = ref[2].width if axis == 'width' else ref[2].height
    # All creature views are generated at independent crops. Their explicit target
    # projected extents must be supplied; a side length is not a top wingspan.
    extents = cfg.get('projected_extents_m', {})
    require(all(view in extents for view in views), 'Supply projected_extents_m for each creature view')
    available_w, available_h = 610, 360
    max_ppm = []
    for view, path, crop, srcbox in images:
        e = float(extents[view])
        base = crop.width if axis == 'width' else crop.height
        max_ppm += [available_w * base / (crop.width * e), available_h * base / (crop.height * e)]
    ppm = min(max_ppm)
    canvas = Image.new('RGB', TURN_SIZE, BG)
    draw = ImageDraw.Draw(canvas)
    boxes = []
    for i, (view, path, crop, srcbox) in enumerate(images):
        e = float(extents[view])
        base = crop.width if axis == 'width' else crop.height
        factor = e * ppm / base
        w, h = round(crop.width*factor), round(crop.height*factor)
        panel_x = (i%2)*768
        baseline = 430 + (i//2)*512
        x = panel_x+120+(610-w)//2
        y = baseline-h
        image = crop.resize((w, h), Image.Resampling.LANCZOS)
        canvas.paste(image, (x, y), image)
        text(draw, (panel_x+420, baseline+50), LABELS.get(view, view.upper()), 18)
        marker = human(draw, panel_x+55, baseline, ppm)
        boxes.append({'view': view, 'source': str(path.relative_to(folder)), 'source_sha256': digest(path),
                      'source_bbox_px': list(srcbox), 'sheet_bbox_px': [x,y,x+w,baseline],
                      'projected_extent_m': e, 'scale_axis': axis, 'mirrored': False,
                      'human': marker})
    # Calibrated quarter-metre ticks on the reference view's own extent.
    refbox = next(b for b in boxes if b['view'] == reference_view)
    x0,y0,x1,y1 = refbox['sheet_bbox_px']
    ticks = []
    if axis == 'width':
        ruler_y = y1+12
        draw.line((x0, ruler_y, x1-1, ruler_y), fill=(225,225,225))
        effective_ppm = (x1-x0)/float(extents[reference_view])
        for i in range(math.floor(extent/.25)+1):
            value = i*.25
            x = x0 + round(value*effective_ppm)
            draw.line((x,ruler_y-4,x,ruler_y+4),fill=(225,225,225))
            if i % 4 == 0:
                text(draw,(x,ruler_y+17),f'{value:g}',12)
            ticks.append({'value_m':value,'x_px':x})
        calibration = {'axis':'horizontal','start_x_px':x0,'end_x_px':x1,'y_px':ruler_y,
                       'endpoint_m':extent,'px_per_m':effective_ppm,'step_m':.25,'ticks':ticks}
    else:
        calibration = ruler(draw, (y1-y0)/extent, y1, extent, max(100,x0-25))
    result = save_sheet(canvas, folder/f'{cid}_turnaround.jpg')
    result.update({'creature':True,'px_per_m':ppm,'views':boxes,'ruler':calibration,
                   'scale_axis':axis,'reference_view':reference_view,'scale_extent_m':extent,
                   'interpretation':'Projected extents are design targets; no 3D measurement inferred from generated views.'})
    data.setdefault('measured',{})['turnaround'] = result
    write_spec(specpath,data)
    return result


def face(cid):
    folder, specpath, data = load(cid)
    canvas = Image.new('RGB', FACE_SIZE, BG)
    draw = ImageDraw.Draw(canvas)
    boxes = []
    for i, view in enumerate(('front','three_quarter','side')):
        path, im = source(folder, f'face_views/{view}.png')
        require(im.height <= 1024, 'Face source taller than 1024 px')
        crop, srcbox = tight(im)
        scale = min(460/crop.width, 870/crop.height)
        w,h = round(crop.width*scale), round(crop.height*scale)
        x,y = 26+i*504+(460-w)//2, 920-h
        resized = crop.resize((w,h), Image.Resampling.LANCZOS)
        canvas.paste(resized,(x,y),resized)
        text(draw,(256+i*504,980),LABELS[view],20)
        boxes.append({'view':view,'source':str(path.relative_to(folder)), 'source_sha256':digest(path),
                      'source_bbox_px':list(srcbox),'sheet_bbox_px':[x,y,x+w,y+h],'mirrored':False})
    result = save_sheet(canvas,folder/f'{cid}_face.jpg')
    result['views'] = boxes
    result['scale_requirement'] = 'none; portraits fitted without mirroring or warping'
    data.setdefault('measured',{})['face'] = result
    write_spec(specpath,data)
    return result


def grid(cid):
    folder,specpath,data = load(cid)
    tiles = data['composition']['detail_tiles']
    require(len(tiles) in (4,9), 'detail_tiles must contain four or nine individually generated tiles')
    n = math.isqrt(len(tiles))
    cell = 1024//n
    canvas = Image.new('RGB',GRID_SIZE,BG)
    draw = ImageDraw.Draw(canvas)
    boxes = []
    for i,tile in enumerate(tiles):
        path,im = source(folder,tile['source'])
        x,y = (i%n)*cell+12,(i//n)*cell+12
        w,h = cell-24,cell-68
        # Preserve the whole individual image; letterbox rather than crop away a weapon.
        tile_background = Image.new('RGBA', im.size, (*BG, 255))
        tile_background.alpha_composite(im)
        im = tile_background.convert('RGB')
        factor = min(w/im.width,h/im.height)
        iw,ih = round(im.width*factor),round(im.height*factor)
        px,py = x+(w-iw)//2,y+(h-ih)//2
        canvas.paste(im.resize((iw,ih),Image.Resampling.LANCZOS),(px,py))
        text(draw,(x+w//2,y+h+26),tile['label'],18 if n==3 else 22)
        boxes.append({'name':tile['name'],'label':tile['label'],'source':str(path.relative_to(folder)),
                      'source_sha256':digest(path),'sheet_bbox_px':[px,py,px+iw,py+ih]})
    result = save_sheet(canvas,folder/f'{cid}_details.jpg')
    result['tiles'] = boxes
    data.setdefault('measured',{})['details'] = result
    write_spec(specpath,data)
    return result


def sample(cid):
    folder,specpath,data = load(cid)
    rectangles = data.get('sampling',[])
    require(rectangles, 'Supply author-reviewed sampling rectangles in top-level sampling')
    samples = {}
    for item in rectangles:
        sheet = item['sheet']
        require(sheet in ('turnaround','face','details'), 'Unknown sampling sheet')
        filename = f'{cid}_{sheet}.jpg'
        im = Image.open(folder/filename).convert('RGB')
        rect = item['rect_px']
        x0,y0,x1,y1 = map(int,rect)
        require(0<=x0<x1<=im.width and 0<=y0<y1<=im.height, 'Invalid sampling rectangle')
        values = np.asarray(im)[y0:y1,x0:x1].reshape(-1,3)
        require(np.mean(np.any(np.abs(values.astype(int)-np.array(BG))>2,axis=1)) > .60, f"{item['name']}: sample contains mostly background")
        rgb = np.floor(np.median(values,axis=0)+.5).astype(int).tolist()
        samples[item['name']] = {'sheet':filename,'sheet_sha256':digest(folder/filename),
            'rect_px':[x0,y0,x1,y1],'coordinate_space':'final JPEG pixels, top-left origin, half-open rectangle','rgb':rgb,'srgb_hex':'#%02x%02x%02x'%tuple(rgb),
            'statistic':'per-channel median sRGB','interpretation':'rendered and lit, not albedo'}
    data['observed'] = {'source':'compose.py sample','interpretation':'rendered and lit, not albedo','samples':samples}
    write_spec(specpath,data)
    return data['observed']


def preview64(cid):
    folder,_,data = load(cid)
    outdir = Path(tempfile.gettempdir())/'greenleaf-reference-previews'/cid
    outdir.mkdir(parents=True,exist_ok=True)
    paths=[]
    for view in data['measured']['turnaround']['views']:
        _,im = source(folder,view['source'])
        im,_ = tight(im)
        target=(max(1,round(im.width*64/im.height)),64)
        alpha=im.getchannel('A').resize(target,Image.Resampling.LANCZOS)
        preview=Image.new('RGB',target,BG)
        preview.paste((25,25,25),(0,0,*target),alpha)
        path=outdir/f"{view['view']}.png"
        preview.save(path)
        paths.append(str(path))
    return {'temporary_directory':str(outdir),'previews':paths}


def check(cid):
    folder,_,data = load(cid)
    validate_schema(data)
    require((folder/'notes.md').is_file(), 'Missing notes.md')
    measured=data.get('measured',{})
    if measured.get('turnaround') and not measured['turnaround'].get('creature'):
        require(data['design']['overall_height_m']==measured['turnaround']['overall_height_m'], 'Design overall height changed; recompose')
    expected={'turnaround':TURN_SIZE,'face':FACE_SIZE,'details':GRID_SIZE}
    if data.get('composition',{}).get('silhouette_only'):
        expected={'turnaround':TURN_SIZE}
    for sheet,size in expected.items():
        rec=measured[sheet]
        path=folder/rec['path']
        require(digest(path)==rec['sha256'],f'{sheet}: sheet changed after construction')
        im=Image.open(path)
        require(im.format=='JPEG' and im.size==size,f'{sheet}: wrong format or canvas dimensions')
        require(rec['jpeg_quality']==88 and rec['jpeg_subsampling']==0,'Wrong JPEG settings')
        require(rec['background_rgb']==list(BG),'Wrong constructed background')
        x0,y0,x1,y1=rec['background_probe']
        require(np.max(np.abs(np.asarray(im.convert('RGB')).astype(int)[y0:y1,x0:x1]-np.array(BG))) <= rec['decoded_background_tolerance'],f'{sheet}: safe background patch changed')
        objects=rec.get('views',rec.get('tiles',[]))
        for index, left in enumerate(objects):
            for right in objects[index+1:]:
                a,b=left['sheet_bbox_px'],right['sheet_bbox_px']
                require(min(a[2],b[2])<=max(a[0],b[0]) or min(a[3],b[3])<=max(a[1],b[1]), f'{sheet}: overlapping objects')
        for item in objects:
            path=folder/item['source']
            require(digest(path)==item['source_sha256'],f"{sheet}: stale source {path.name}")
            with Image.open(path) as source_image:
                require(source_image.height<=1024,'Source exceeds 1024 px')
                if sheet != 'details':
                    require(list(bbox(source_image.convert('RGBA'))) == item['source_bbox_px'], 'Source silhouette bounds changed')
            b=item['sheet_bbox_px']
            require(0<=b[0]<b[2]<=size[0] and 0<=b[1]<b[3]<=size[1],f'{sheet}: object outside canvas')
            require(not item.get('mirrored',False),'Mirrored view forbidden')
        rebuilt = reconstruct(cid, sheet)
        require(hashlib.sha256(rebuilt.tobytes()).hexdigest() == rec['pre_jpeg_sha256'], f'{sheet}: pre-JPEG canvas or geometry changed')
        require(np.all(np.asarray(rebuilt)[y0:y1,x0:x1] == np.array(BG)), f'{sheet}: wrong pre-JPEG background')
    turn=measured['turnaround']
    if not turn.get('creature'):
        ppm=turn['px_per_m']; height=data['design']['overall_height_m']; baseline=turn['baseline_y_px']
        require(height==turn['overall_height_m'],'Design overall height changed; recompose')
        require(turn['ruler']['top_y_px']==baseline-round(height*ppm),'Ruler endpoint does not match ppm')
        require(turn['ruler']['endpoint_m']==height,'Wrong ruler height')
        require(turn['ruler']['baseline_y_px']==baseline,'Wrong ruler baseline')
        for v in turn['views']:
            b=v['sheet_bbox_px']
            require(b[3]==baseline and v['baseline_y_px']==baseline,'Views do not share baseline')
            require(b[3]-b[1]==round(height*ppm),'View silhouette height does not match ppm')
        for tick in turn['ruler']['ticks']:
            require(tick['y_px']==baseline-round(tick['value_m']*ppm),'Tick calibration wrong')
    else:
        r=turn['ruler']
        if r['axis']=='horizontal':
            require(r['end_x_px']-r['start_x_px']==round(r['endpoint_m']*r['px_per_m']),'Creature ruler endpoint wrong')
            for t in r['ticks']:
                require(t['x_px']==r['start_x_px']+round(t['value_m']*r['px_per_m']),'Creature tick wrong')
        else:
            require(r['top_y_px']==r['baseline_y_px']-round(r['endpoint_m']*turn['px_per_m']),'Creature vertical ruler wrong')
        for v in turn['views']:
            human_rec=v['human']
            require(human_rec['height_px']==round(1.85*turn['px_per_m']),'Human comparison height wrong')
    require(data.get('observed',{}).get('interpretation')=='rendered and lit, not albedo' or data.get('composition',{}).get('silhouette_only'), 'Missing observed rendered colour samples')
    for s in data.get('observed',{}).get('samples',{}).values():
        require(digest(folder/s['sheet'])==s['sheet_sha256'],'Observed sample is stale')
        im=np.asarray(Image.open(folder/s['sheet']).convert('RGB'))
        x0,y0,x1,y1=s['rect_px']
        rgb=np.floor(np.median(im[y0:y1,x0:x1].reshape(-1,3),axis=0)+.5).astype(int).tolist()
        require(rgb==s['rgb'],'Observed sample does not match median pixels')
    total=stored_bytes(folder)
    library=stored_bytes(ROOT)
    require(total<=CHAR_BUDGET,f'Character exceeds 2.5 MB: {total}')
    require(library<=LIB_BUDGET,f'Library exceeds 70 MB: {library}')
    return {'id':cid,'status':'PASS','checked':'schema, required files, reconstructed pre-JPEG canvas, JPEG tolerance, calibration, baseline, layout, source hashes, sample medians, no mirroring, budgets',
            'character_bytes':total,'character_budget_bytes':CHAR_BUDGET,'library_bytes':library,'library_budget_bytes':LIB_BUDGET,
            'px_per_m':turn['px_per_m'],'visual_review':'Separate by-eye gate; not certified by this command.'}



DESIGN_FIELDS = ('source','display_name','height_m','overall_height_m','proportions','face','hair','outfit_layers','armor','weapons','silhouette_keywords','avoid')
PROPORTION_FIELDS = ('head_height_m','shoulder_width_m','hip_width_m','arm_length_m','leg_length_m','hand_length_m','neck_length_m','bulk_0to1','hunch_0to1')


def validate_schema(data):
    design=data['design']
    for field in DESIGN_FIELDS:
        require(field in design, f'Missing design.{field}')
    require(design['source']=='design_target','Wrong design source')
    require(design['height_m']>0 and design['overall_height_m']>0,'Invalid height targets')
    for field in PROPORTION_FIELDS:
        require(field in design['proportions'],f'Missing proportion {field}')
    for field in ('shape','eyes','brow','nose','lips','ears','skin_base_hex','skin_variation'):
        require(field in design['face'],f'Missing face.{field}')
    for field in ('root_hex','tip_hex','length_m','style','braids'):
        require(field in design['hair'],f'Missing hair.{field}')
    require(all(isinstance(design[f],list) for f in ('outfit_layers','armor','weapons','silhouette_keywords','avoid')), 'Design list fields must be arrays')


def stored_bytes(folder):
    # Python bytecode is disposable tooling cache, never a retained library asset.
    return sum(p.stat().st_size for p in Path(folder).rglob('*') if p.is_file() and '__pycache__' not in p.parts and p.suffix!='.pyc')


def reconstruct(cid, sheet):
    # Re-render from retained sources and geometry to check the exact unencoded
    # canvas, without retaining a duplicate lossless sheet or mutating any file.
    captured=[]
    oldsave,oldwrite=globals()['save_sheet'],globals()['write_spec']
    def capture(im,path):
        captured.append(im.copy())
        return {}
    try:
        globals()['save_sheet']=capture
        globals()['write_spec']=lambda path,data: None
        globals()[{'turnaround':'turnaround','face':'face','details':'grid'}[sheet]](cid)
    finally:
        globals()['save_sheet']=oldsave
        globals()['write_spec']=oldwrite
    require(len(captured)==1,'Composition failed to produce one canvas')
    return captured[0]


def check_all():
    results=[]
    statepath=ROOT/'progress.json'
    entries=json.loads(statepath.read_text())['entries'] if statepath.exists() else {p.parent.name:{} for p in ROOT.glob('*/spec.json')}
    for cid,entry in entries.items():
        if entry.get('kind')=='supplement':
            statuses=[d['status'] for d in entry['deliverables'].values()]
            status='PASS' if all(s=='accepted' for s in statuses) else 'BLOCKED' if 'blocked' in statuses else 'REJECTED' if 'rejected' in statuses else 'PENDING'
            results.append({'id':cid,'status':status})
            continue
        try:
            result=check(cid)
        except (ValueError,KeyError,OSError,StopIteration) as error:
            statuses=[d['status'] for d in entry.get('deliverables',{}).values()]
            result={'id':cid,'status':'BLOCKED' if 'blocked' in statuses else 'REJECTED' if 'rejected' in statuses else 'PENDING','reason':str(error)}
        results.append(result)
    library=stored_bytes(ROOT)
    require(library<=LIB_BUDGET,f'Library exceeds 70 MB: {library}')
    return {'status':'PASS' if all(r['status']=='PASS' for r in results) else 'PARTIAL','library_bytes':library,'library_budget_bytes':LIB_BUDGET,'entries':results}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    commands=parser.add_subparsers(dest='command',required=True)
    s=commands.add_parser('segment')
    s.add_argument('input');s.add_argument('output')
    s.add_argument('--threshold',type=float,default=38)
    s.add_argument('--max-height',type=int,default=768)
    s.add_argument('--backend',choices=('auto','threshold','rembg'),default='auto')
    for name in ('turnaround','face','grid','sample','preview64','check'):
        p=commands.add_parser(name);p.add_argument('id', nargs='?');
        if name=='check':p.add_argument('--all',action='store_true')
    args=parser.parse_args()
    try:
        if args.command=='segment':
            result=segment(args.input,args.output,args.threshold,args.max_height,args.backend)
        elif args.command=='check' and args.all:
            result=check_all()
            print(json.dumps(result,indent=2))
            return 0 if result['status']=='PASS' else 1
        else:
            require(args.id is not None, 'An id is required')
            result=globals()[args.command](args.id)
        print(json.dumps(result,indent=2))
    except (ValueError,KeyError,OSError,StopIteration) as error:
        print(json.dumps({'status':'FAIL','error':str(error)}),file=sys.stderr)
        return 1
    return 0


if __name__=='__main__':
    sys.exit(main())
