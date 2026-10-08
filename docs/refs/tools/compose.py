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
    return list(draw.textbbox(xy, label, font=font(size), anchor=anchor))


def check_text_boxes(boxes, canvas_size=TURN_SIZE):
    for i,b in enumerate(boxes):
        require(0<=b[0]<b[2]<=canvas_size[0] and 0<=b[1]<b[3]<=canvas_size[1], 'Clipped ruler label')
        for other in boxes[i+1:]:
            require(min(b[2],other[2])<=max(b[0],other[0]) or min(b[3],other[3])<=max(b[1],other[1]), 'Overlapping ruler labels')


def bbox(im, require_transparency=True):
    require(im.mode == 'RGBA', 'Source must be RGBA, not an opaque studio render')
    alpha = np.asarray(im.getchannel('A'))
    mask = alpha > 127
    require(mask.any() and (not require_transparency or (~mask).any()), 'Source needs a nonempty cutout and transparent background')
    yy, xx = np.where(mask)
    return (int(xx.min()), int(yy.min()), int(xx.max()) + 1, int(yy.max()) + 1)


def tight(im):
    # Ignore only near-transparent background. Do not rotate, warp or mirror.
    b = bbox(im)
    return im.crop(b), b


def resize_silhouette(crop, target_height):
    """Uniformly resample, then measure alpha instead of assuming raster bounds.

    Subpixel thin tips can lose one alpha-threshold row during downsampling.
    Preserve one original extremal pixel at each vertical edge if resampling
    fades it below half opacity. This protects thin hair/weapon tips without
    stretching either axis or adding any new subject colour.
    """
    width = max(1, round(crop.width * target_height / crop.height))
    resized = crop.resize((width, target_height), Image.Resampling.LANCZOS)
    pixels = np.array(resized)
    original = np.asarray(crop)
    for edge, original_edge in ((0, 0), (-1, -1)):
        if pixels[edge, :, 3].max() <= 127:
            original_x = int(original[original_edge, :, 3].argmax())
            x = min(width - 1, round(original_x * width / crop.width))
            if pixels[edge, x, 3] == 0:
                pixels[edge, x, :3] = original[original_edge, original_x, :3]
            pixels[edge, x, 3] = 128
    resized = Image.fromarray(pixels, 'RGBA')
    bounds = bbox(resized, require_transparency=False)
    require(bounds[3]-bounds[1] == target_height, 'Resampled alpha height lost calibration')
    return resized.crop(bounds), target_height / crop.height, bounds


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
    ticks, labels = [], []
    stride = max(1,math.ceil(18/(.25*ppm)))
    if stride>1:stride = 4*math.ceil(stride/4)
    for i in range(math.floor(height / .25 + 1e-8) + 1):
        value = i * .25
        y = baseline - round(value * ppm)
        draw.line((x - 8, y, x + 8, y), fill=(225, 225, 225), width=1)
        if i%stride==0:labels.append(text(draw, (x - 12, y), f'{value:.2f}', 16, 'rm'))
        ticks.append({'value_m': value, 'y_px': y})
    # Put endpoint label on the right to avoid overlap with a near-quarter tick.
    draw.line((x - 8, ytop, x + 8, ytop), fill=(225, 225, 225), width=1)
    labels.append(text(draw, (x + 12, ytop - 12), f'{height:.2f} m', 18, 'lm'))
    check_text_boxes(labels)
    result = {'axis': 'vertical', 'x_px': x, 'baseline_y_px': baseline, 'top_y_px': ytop,
              'endpoint_m': height, 'step_m': .25, 'ticks': ticks, 'label_bboxes_px': labels}
    if stride>1:result['label_stride_ticks']=stride
    return result


def human(draw, x, baseline, ppm):
    # A deterministic, original 1.85 m scale icon, not generated imagery.
    h = round(1.85 * ppm)
    require(h>=5, 'Human comparison is too small to draw')
    y = baseline - h
    width = max(2, round(.09*ppm))
    offset = math.ceil(.30*ppm + width + 2)
    icon = Image.new('RGBA',(offset*2+1,h),(0,0,0,0))
    ink = ImageDraw.Draw(icon)
    r = max(2, round(.10 * ppm))
    ink.ellipse((offset-r,0,offset+r,2*r-1), fill=(30,30,30,255))
    shoulder = round(.30 * ppm)
    hip = round(.93 * ppm)
    half = max(3, round(.21 * ppm))
    ink.polygon([(offset-half,shoulder),(offset+half,shoulder),(offset+round(.14*ppm),hip),
                 (offset-round(.14*ppm),hip)],fill=(30,30,30,255))
    for sign in (-1, 1):
        ink.line((offset+sign*half,shoulder,offset+sign*round(.30*ppm),round(1.02*ppm)),fill=(30,30,30,255),width=width)
        foot=offset+sign*round(.13*ppm)
        ink.line((offset+sign*round(.08*ppm),hip,foot,h-1),fill=(30,30,30,255),width=width)
        ink.rectangle((foot-width//2,h-2,foot+width//2,h-1),fill=(30,30,30,255))
    bounds=bbox(icon)
    require(bounds[1]==0 and bounds[3]==h,'Human silhouette lost calibrated height')
    draw.bitmap((x-offset,y),icon.getchannel('A'),fill=(30,30,30))
    text(draw, (x, baseline+18), '1.85 m', 14)
    return {'height_m': 1.85, 'height_px': h, 'top_y_px': y, 'baseline_y_px': baseline,
            'center_x_px': x, 'sheet_bbox_px':[x-offset+bounds[0],y,x-offset+bounds[2],baseline]}


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
    fit_policy = config.get('fit_policy', 'fit')
    if fit_policy == 'fit':
        ppm = min(ppm_height, ppm_width)
    else:
        require(ppm_width >= ppm_height, 'Four views do not fit at diagnostic strict85% height; use composition.fit_policy="fit"')
        ppm = ppm_height
    target_height = round(height * ppm)
    require(target_height > 0, 'Invalid projected height')
    # Set ppm from the actual integer silhouette height, not an unrounded target.
    ppm = target_height / height
    for i, (view, path, crop, srcbox) in enumerate(images):
        resized, uniform_scale, raster_bounds = resize_silhouette(crop, target_height)
        width = resized.width
        require(width <= panel_width, f'{view}: panel overflow')
        x = left + i*(panel_width + gap) + (panel_width-width)//2
        y = baseline-target_height
        canvas.paste(resized, (x, y), resized)
        label = data['composition'].get('turnaround_labels', {}).get(view, LABELS[view])
        text(draw, (left+i*(panel_width+gap)+panel_width//2, 980), label, 18)
        boxes.append({'view': view, 'source': str(path.relative_to(folder)), 'source_sha256': digest(path),
                      'source_bbox_px': list(srcbox), 'sheet_bbox_px': [x, y, x+width, baseline],
                      'silhouette_height_px': target_height, 'baseline_y_px': baseline,
                      'resize_uniform_scale': uniform_scale, 'resampled_alpha_bbox_px': list(raster_bounds),
                      'alpha_threshold': 127, 'mirrored': False})
    scale = ruler(draw, ppm, baseline, height)
    output = folder / f'{cid}_turnaround.jpg'
    result = save_sheet(canvas, output)
    result.update({'px_per_m': ppm, 'baseline_y_px': baseline, 'overall_height_m': height,
                   'height_fill_fraction': target_height/1024, 'fit_policy': fit_policy, 'scale_reduction_reason': 'Horizontal panel fit' if ppm_width < ppm_height else '85 percent height target',
                   'views': boxes, 'ruler': scale, 'interpretation': 'Uniform image normalization to design overall height; not recovered 3D anatomy.'})
    data.setdefault('measured', {})['turnaround'] = result
    write_spec(specpath, data)
    return result


def measurement_span(crop, srcbox, axis, region=None):
    """Measure projected alpha extrema within a reviewed landmark region.

    Region coordinates are author annotations in the retained cutout, not
    claimed anatomical measurements. Only this function computes the span.
    Endpoints use half-open silhouette edges, matching composition bounds.
    """
    require(axis in ('width','height'), 'Invalid measurement axis')
    if region is None:
        region = list(srcbox)
    x0,y0,x1,y1 = map(int,region)
    require(srcbox[0]<=x0<x1<=srcbox[2] and srcbox[1]<=y0<y1<=srcbox[3], 'Landmark region outside cutout silhouette bounds')
    mask = np.asarray(crop.getchannel('A'))[y0-srcbox[1]:y1-srcbox[1],x0-srcbox[0]:x1-srcbox[0]] > 127
    require(mask.any(), 'Landmark region has no subject')
    yy,xx = np.where(mask)
    bounds = [x0+int(xx.min()),y0+int(yy.min()),x0+int(xx.max())+1,y0+int(yy.max())+1]
    if axis=='width':
        mid = (bounds[1]+bounds[3])/2
        points = [[bounds[0],mid],[bounds[2],mid]]
        span = bounds[2]-bounds[0]
    else:
        mid = (bounds[0]+bounds[2])/2
        points = [[mid,bounds[1]],[mid,bounds[3]]]
        span = bounds[3]-bounds[1]
    return {'source_endpoints_px':points,'source_span_px':span,'axis':axis,
            'source_region_px':list(region),'definition':'half-open alpha>127 projected extrema inside author-reviewed landmark region'}


def creature(cid, pose=None):
    folder, specpath, data = load(cid)
    cfg = dict(data['composition'])
    if pose:
        target = cfg['pose_targets'][pose]
        cfg.pop('extent_rules', None)
        cfg.update(views=[pose], reference_view=pose, scale_axis=target['axis'],
                   scale_extent_m=target['extent_m'], projected_extents_m={pose:target['extent_m']})
        cfg['landmark_regions_px'] = {pose:target['region_px']} if target.get('region_px') else {}
    axis = cfg.get('scale_axis', 'width')
    reference_view = cfg.get('reference_view', 'side')
    extent = float(cfg['scale_extent_m'])
    views = cfg.get('views', ['front', 'side', 'top', 'three_quarter'])
    require(len(views) == (1 if pose else 4) and axis in ('width', 'height'), 'Creature requires four views, or one additional pose, and a width/height axis')
    images = []
    for view in views:
        path, im = source(folder, f'views/{view}.png')
        require(im.height <= 1024, 'Creature source exceeds 1024 px')
        crop, srcbox = tight(im)
        images.append((view, path, crop, srcbox))
    measurements = {view:measurement_span(crop,srcbox,cfg.get('scale_axes',{}).get(view,axis),cfg.get('landmark_regions_px',{}).get(view))
                    for view,path,crop,srcbox in images}
    # All creature views are generated at independent crops. Their explicit target
    # projected extents must be supplied; a side length is not a top wingspan.
    extents = dict(cfg.get('projected_extents_m', {}))
    # Explicit projection assumptions for views whose relevant anatomical
    # landmark is occluded or has no height axis (e.g. an overhead oliphaunt).
    # Derive their overall extents from actual reference cutout geometry;
    # these are normalized 2D projection assumptions, not recovered 3D sizes.
    reference_crop = next(crop for view,path,crop,srcbox in images if view==reference_view)
    for view, rule in cfg.get('extent_rules', {}).items():
        require(view in views and view!=reference_view, 'Invalid projected extent rule view')
        require(rule in ('reference_overall_height','reference_overall_width'), 'Unknown projected extent rule')
        pixels = reference_crop.height if rule.endswith('height') else reference_crop.width
        extents[view] = pixels*extent/measurements[reference_view]['source_span_px']
    require(all(view in extents for view in views), 'Supply projected_extents_m for each creature view')
    require(float(extents[reference_view])==extent,'Reference extent differs from ruler target')
    available_w, available_h = (1200, 850) if pose else (440, 360)
    max_ppm = [available_h/1.85]
    for view, path, crop, srcbox in images:
        e = float(extents[view])
        base = measurements[view]['source_span_px']
        max_ppm += [available_w * base / (crop.width * e), available_h * base / (crop.height * e)]
    ppm = data['measured']['turnaround']['px_per_m'] if pose else min(max_ppm)
    require(ppm <= min(max_ppm), 'Additional pose does not fit at the main sheet scale')
    canvas = Image.new('RGB', TURN_SIZE, BG)
    draw = ImageDraw.Draw(canvas)
    boxes = []
    for i, (view, path, crop, srcbox) in enumerate(images):
        e = float(extents[view])
        base = measurements[view]['source_span_px']
        factor = e * ppm / base
        w, h = round(crop.width*factor), round(crop.height*factor)
        panel_x = (i%2)*768
        baseline = 940 if pose else 430 + (i//2)*512
        x = panel_x+205+(available_w-w)//2
        y = baseline-h
        image = crop.resize((w, h), Image.Resampling.LANCZOS)
        canvas.paste(image, (x, y), image)
        text(draw, (panel_x+(805 if pose else 420), baseline+(40 if pose else 50)), cfg.get('turnaround_labels',{}).get(view,LABELS.get(view, view.upper())), 18)
        marker = human(draw, panel_x+100, baseline, ppm)
        annotation = measurements[view]
        points = [[x+round((p[0]-srcbox[0])*w/crop.width),y+round((p[1]-srcbox[1])*h/crop.height)]
                  for p in annotation['source_endpoints_px']]
        coordinate = 0 if annotation['axis']=='width' else 1
        actual_span = points[1][coordinate]-points[0][coordinate]
        boxes.append({'view': view, 'source': str(path.relative_to(folder)), 'source_sha256': digest(path),
                      'source_bbox_px': list(srcbox), 'sheet_bbox_px': [x,y,x+w,baseline],
                      'projected_extent_m': e, 'scale_axis': annotation['axis'], 'mirrored': False,
                      'measurement':dict(annotation,sheet_endpoints_px=points,sheet_span_px=actual_span,
                                         effective_px_per_m=actual_span/e),
                      'human': marker})
    # Calibrated quarter-metre ticks on the reference view's own extent.
    refbox = next(b for b in boxes if b['view'] == reference_view)
    source_bounds = refbox['sheet_bbox_px']
    start,end = refbox['measurement']['sheet_endpoints_px']
    x0,y0 = start
    x1,y1 = end
    axis = refbox['scale_axis']
    ticks, label_boxes = [], []
    if axis == 'width':
        ruler_y = source_bounds[3]+12
        draw.line((x0, ruler_y, x1-1, ruler_y), fill=(225,225,225))
        effective_ppm = (x1-x0)/float(extents[reference_view])
        endpoint_label=f'{extent:g} m'
        endpoint_box=list(draw.textbbox((x1,ruler_y+17),endpoint_label,font=font(12),anchor='mm'))
        for i in range(math.floor(extent/.25)+1):
            value = i*.25
            x = x0 + round(value*effective_ppm)
            draw.line((x,ruler_y-4,x,ruler_y+4),fill=(225,225,225))
            if i % 4 == 0 and abs(value-extent)>1e-7:
                box=list(draw.textbbox((x,ruler_y+17),f'{value:g}',font=font(12),anchor='mm'))
                if all(min(box[2],b[2])<=max(box[0],b[0]) or min(box[3],b[3])<=max(box[1],b[1]) for b in label_boxes+[endpoint_box]):
                    label_boxes.append(text(draw,(x,ruler_y+17),f'{value:g}',12))
            ticks.append({'value_m':value,'x_px':x})
        label_boxes.append(text(draw,(x1,ruler_y+17),endpoint_label,12))
        calibration = {'axis':'horizontal','start_x_px':x0,'end_x_px':x1,'y_px':ruler_y,
                       'endpoint_m':extent,'px_per_m':effective_ppm,'step_m':.25,'ticks':ticks,'label_bboxes_px':label_boxes}
        check_text_boxes(label_boxes)
    else:
        calibration = ruler(draw, (y1-y0)/extent, y1, extent, max(100,source_bounds[0]-25))
        calibration['px_per_m'] = (y1-y0)/extent
    key = f'pose_{pose}' if pose else 'turnaround'
    result = save_sheet(canvas, folder/f'{cid}_{pose if pose else "turnaround"}.jpg')
    result.update({'creature':True,'px_per_m':ppm,'views':boxes,'ruler':calibration,
                   'layout':{'subject_max_width_px':available_w,'subject_max_height_px':available_h,
                             'human_max_height_px':available_h,'scale_reason':'Fit all views and reserve a separate human/ruler lane'},
                   'scale_axis':axis,'reference_view':reference_view,'scale_extent_m':extent,
                   'extent_rules':cfg.get('extent_rules',{}),
                   'interpretation':'Projected extents are design targets; no 3D measurement inferred from generated views.'})
    data.setdefault('measured',{})[key] = result
    write_spec(specpath,data)
    return result


def poses(cid):
    _,_,data = load(cid)
    require(data['composition'].get('pose_targets'), 'No additional pose targets')
    return {name:creature(cid,name) for name in data['composition']['pose_targets']}


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
        require(item['name'] not in samples, 'Duplicate material sample name')
        retained = item.get('source_image')
        if retained:
            require(retained.startswith(('views/','face_views/','details/')), 'Sample must use a retained library source')
            filename = retained
            path, rgba = source(folder, filename)
        else:
            sheet = item['sheet']
            require(sheet in ('turnaround','face','details'), 'Unknown sampling sheet')
            filename = f'{cid}_{sheet}.jpg'
            path = folder/filename
            rgba = Image.open(path).convert('RGBA')
        if item.get('not_visible'):
            require(item['name'] in data['design'].get('concealed_materials',{}), 'Unobservable sample needs an explicit design concealment exception')
            samples[item['name']]={'sheet':filename,'sheet_sha256':digest(folder/filename),
                                  'rect_px':None,'rgb':None,'srgb_hex':None,
                                  'visibility':'not_visible','reason':item['not_visible'],
                                  'interpretation':'rendered and lit, not albedo'}
            continue
        im = rgba.convert('RGB')
        rect = item['rect_px']
        x0,y0,x1,y1 = map(int,rect)
        require(0<=x0<x1<=im.width and 0<=y0<y1<=im.height, 'Invalid sampling rectangle')
        values = np.asarray(im)[y0:y1,x0:x1].reshape(-1,3)
        if retained and Image.open(path).mode == 'RGBA':
            require(np.mean(np.asarray(rgba)[y0:y1,x0:x1,3] > 127) >= .95, f"{item['name']}: source rectangle contains transparent background")
        else:
            require(np.mean(np.any(np.abs(values.astype(int)-np.array(BG))>2,axis=1)) > .60, f"{item['name']}: sample contains mostly background")
        rgb = np.floor(np.median(values,axis=0)+.5).astype(int).tolist()
        samples[item['name']] = {'sheet':filename,'sheet_sha256':digest(folder/filename),
            'source_image':filename, 'rect_px':[x0,y0,x1,y1],
            'coordinate_space':('retained source pixels' if retained else 'final JPEG pixels')+', top-left origin, half-open rectangle',
            'rgb':rgb,'srgb_hex':'#%02x%02x%02x'%tuple(rgb),
            'statistic':'per-channel median sRGB','interpretation':'rendered and lit, not albedo'}
    data['observed'] = {'source':'compose.py sample','interpretation':'rendered and lit, not albedo','samples':samples}
    write_spec(specpath,data)
    return data['observed']


def preview64(cid):
    folder,_,data = load(cid)
    outdir = Path(tempfile.gettempdir())/'greenleaf-reference-previews'/cid
    outdir.mkdir(parents=True,exist_ok=True)
    paths=[]
    thumbnails=[]
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
        thumbnails.append((view['view'],preview))
    strip=Image.new('RGB',(sum(max(70,im.width+12) for _,im in thumbnails),82),BG)
    draw=ImageDraw.Draw(strip);x=0
    for name,im in thumbnails:
        width=max(70,im.width+12)
        strip.paste(im,(x+(width-im.width)//2,0))
        text(draw,(x+width//2,74),name.replace('three_quarter','3/4'),9)
        x+=width
    strip_path=outdir/'review.png';strip.save(strip_path)
    return {'temporary_directory':str(outdir),'previews':paths,'review_strip':str(strip_path)}


def check(cid):
    folder,_,data = load(cid)
    if data.get('composition', {}).get('supplement'):
        return check_supplement(cid)
    validate_schema(data)
    require((folder/'notes.md').is_file(), 'Missing notes.md')
    measured=data.get('measured',{})
    if measured.get('turnaround') and not measured['turnaround'].get('creature'):
        require(data['design']['overall_height_m']==measured['turnaround']['overall_height_m'], 'Design overall height changed; recompose')
    expected={'turnaround':TURN_SIZE,'face':FACE_SIZE,'details':GRID_SIZE}
    if data.get('composition',{}).get('silhouette_only'):
        expected={'turnaround':TURN_SIZE}
    expected.update({f'pose_{name}':TURN_SIZE for name in data.get('composition',{}).get('pose_targets',{})})
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
        cfg=data.get('composition',{})
        expected_names=[sheet[5:]] if sheet.startswith('pose_') else cfg.get('views',list(VIEWS)) if sheet=='turnaround' else ['front','three_quarter','side'] if sheet=='face' else [t['name'] for t in cfg['detail_tiles']]
        actual_names=[v.get('view',v.get('name')) for v in objects]
        require(len(actual_names)==len(expected_names) and set(actual_names)==set(expected_names), f'{sheet}: missing or duplicated object geometry')
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
        rebuilt,actual_geometry = reconstruct(cid, sheet, metadata=True)
        for key in ('views','tiles','ruler','px_per_m','baseline_y_px'):
            if key in actual_geometry:require(rec.get(key)==actual_geometry[key], f'{sheet}: recorded {key} differs from actual composition')
        require(hashlib.sha256(rebuilt.tobytes()).hexdigest() == rec['pre_jpeg_sha256'], f'{sheet}: pre-JPEG canvas or geometry changed')
        require(np.all(np.asarray(rebuilt)[y0:y1,x0:x1] == np.array(BG)), f'{sheet}: wrong pre-JPEG background')
        if sheet.startswith('pose_'):
            require(rec['px_per_m']==measured['turnaround']['px_per_m'], 'Additional pose has a different scale')
            check_text_boxes(rec['ruler']['label_bboxes_px'])
            for obj in rec['views']:
                require(abs(obj['measurement']['sheet_span_px']-obj['projected_extent_m']*rec['px_per_m'])<=1.1, 'Additional pose scale mismatch')
                hb=obj['human']['sheet_bbox_px']
                require(hb[3]-hb[1]==round(1.85*rec['px_per_m']), 'Additional pose human height wrong')
                require(hb[2]<=obj['sheet_bbox_px'][0], 'Additional pose overlaps human')
    turn=measured['turnaround']
    check_text_boxes(turn['ruler']['label_bboxes_px'])
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
            require(r['top_y_px']==r['baseline_y_px']-round(r['endpoint_m']*r['px_per_m']),'Creature vertical ruler wrong')
            for tick in r['ticks']:
                require(tick['y_px']==r['baseline_y_px']-round(tick['value_m']*r['px_per_m']),'Creature vertical tick wrong')
        for v in turn['views']:
            require(abs(v['measurement']['sheet_span_px']-v['projected_extent_m']*turn['px_per_m'])<=1.1,'Creature landmark scale mismatch')
            human_rec=v['human']
            require(human_rec['height_px']==round(1.85*turn['px_per_m']),'Human comparison height wrong')
            hb=human_rec['sheet_bbox_px']; vb=v['sheet_bbox_px']
            require(hb[3]-hb[1]==human_rec['height_px'],'Actual human silhouette height wrong')
            require(0<=hb[0]<hb[2]<=TURN_SIZE[0] and 0<=hb[1]<hb[3]<=TURN_SIZE[1],'Clipped human comparison')
            require(hb[2]<=vb[0],'Human comparison overlaps creature')
    require(data.get('observed',{}).get('interpretation')=='rendered and lit, not albedo' or data.get('composition',{}).get('silhouette_only'), 'Missing observed rendered colour samples')
    samples=data.get('observed',{}).get('samples',{})
    if not data.get('composition',{}).get('silhouette_only'):
        required={'skin','hair'} | {a['name'] for a in data['design']['outfit_layers']+data['design']['armor']}
        aliases=data['design'].get('sample_aliases',{})
        for material in required:
            names=aliases.get(material,[material])
            require(isinstance(names,list) and names and all(n in samples for n in names), f'Missing observed material: {material}')
    for name,s in samples.items():
        path,rgba=source(folder,s['sheet'])
        require(digest(path)==s['sheet_sha256'],'Observed sample is stale')
        if s.get('visibility')=='not_visible':
            require(name in data['design'].get('concealed_materials',{}),'Unobservable material lacks a design exception')
            require(s['rect_px'] is None and s['rgb'] is None and s['srgb_hex'] is None,'Unobservable material must not have fabricated sampled values')
            require(bool(s.get('reason')),'Unobservable material needs a reason')
            continue
        im=np.asarray(rgba.convert('RGB'))
        x0,y0,x1,y1=s['rect_px']
        require(0<=x0<x1<=rgba.width and 0<=y0<y1<=rgba.height,'Observed rectangle outside source')
        if s['coordinate_space'].startswith('retained source pixels') and Image.open(path).mode=='RGBA':
            require(np.mean(np.asarray(rgba)[y0:y1,x0:x1,3]>127)>=.95,'Observed source rectangle contains transparent background')
        rgb=np.floor(np.median(im[y0:y1,x0:x1].reshape(-1,3),axis=0)+.5).astype(int).tolist()
        require(rgb==s['rgb'],'Observed sample does not match median pixels')
        require(s['srgb_hex']=='#%02x%02x%02x'%tuple(rgb),'Observed hex does not match median pixels')
        require(s['interpretation']=='rendered and lit, not albedo','Observed material lacks lighting qualification')
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
    def number(value, label, minimum=0, maximum=None):
        require(isinstance(value,(int,float)) and not isinstance(value,bool) and math.isfinite(value), f'{label}: expected finite number')
        require(value>=minimum and (maximum is None or value<=maximum), f'{label}: outside allowed range')
    def colour(value,label):
        require(isinstance(value,str) and len(value)==7 and value[0]=='#' and all(c in '0123456789abcdefABCDEF' for c in value[1:]), f'{label}: expected sRGB #rrggbb')
    number(design['height_m'],'height_m',.001)
    number(design['overall_height_m'],'overall_height_m',.001)
    for name,value in design['proportions'].items():
        if name in PROPORTION_FIELDS:number(value,'proportions.'+name,0,1 if name in ('bulk_0to1','hunch_0to1') else None)
    eyes=design['face']['eyes']
    require(isinstance(eyes,dict) and all(k in eyes for k in ('iris_hex','shape','size_note')),'Missing structured face.eyes')
    colour(eyes['iris_hex'],'face.eyes.iris_hex');colour(design['face']['skin_base_hex'],'face.skin_base_hex')
    for key in ('root_hex','tip_hex'):colour(design['hair'][key],'hair.'+key)
    number(design['hair']['length_m'],'hair.length_m')
    for category,fields in [('outfit_layers',('name','material','color_hex','roughness','sheen','notes')),('armor',('name','material','color_hex','roughness','metalness'))]:
        for item in design[category]:
            require(isinstance(item,dict) and all(k in item for k in fields),'Missing '+category+' component fields')
            colour(item['color_hex'],category+'.color_hex');number(item['roughness'],category+'.roughness',0,1)
            field='sheen' if category=='outfit_layers' else 'metalness';number(item[field],category+'.'+field,0,1)
    for item in design['weapons']:
        require(isinstance(item,dict) and all(k in item for k in ('kind','length_m','notes')),'Missing weapon fields')
        number(item['length_m'],'weapon.length_m',.001)


def stored_bytes(folder):
    # Python bytecode is disposable tooling cache, never a retained library asset.
    return sum(p.stat().st_size for p in Path(folder).rglob('*') if p.is_file() and '__pycache__' not in p.parts and p.suffix!='.pyc')


def reconstruct(cid, sheet, metadata=False):
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
        result=creature(cid,sheet[5:]) if sheet.startswith('pose_') else globals()[{'turnaround':'turnaround','face':'face','details':'grid'}[sheet]](cid)
    finally:
        globals()['save_sheet']=oldsave
        globals()['write_spec']=oldwrite
    require(len(captured)==1,'Composition failed to produce one canvas')
    return (captured[0],result) if metadata else captured[0]


def check_all():
    results=[]
    statepath=ROOT/'progress.json'
    entries=json.loads(statepath.read_text())['entries'] if statepath.exists() else {p.parent.name:{} for p in ROOT.glob('*/spec.json')}
    for cid,entry in entries.items():
        if entry.get('kind')=='supplement':
            statuses=[d['status'] for d in entry['deliverables'].values()]
            try:
                result = check_supplement(cid)
                require(all(s=='accepted' for s in statuses), 'Supplement review remains incomplete')
            except (ValueError, KeyError, OSError, StopIteration) as error:
                result = {'id':cid, 'status':'FAIL' if all(s=='accepted' for s in statuses) else 'BLOCKED' if 'blocked' in statuses else 'REJECTED' if 'rejected' in statuses else 'PENDING', 'reason':str(error)}
            results.append(result)
            continue
        try:
            result=check(cid)
            statuses=[d['status'] for d in entry.get('deliverables',{}).values()]
            require(not statuses or all(s=='accepted' for s in statuses),'Visual review checklist remains incomplete')
        except (ValueError,KeyError,OSError,StopIteration) as error:
            statuses=[d['status'] for d in entry.get('deliverables',{}).values()]
            result={'id':cid,'status':'FAIL' if statuses and all(s=='accepted' for s in statuses) else 'BLOCKED' if 'blocked' in statuses else 'REJECTED' if 'rejected' in statuses else 'PENDING','reason':str(error)}
        results.append(result)
    library=stored_bytes(ROOT)
    require(library<=LIB_BUDGET,f'Library exceeds 70 MB: {library}')
    return {'status':'PASS' if all(r['status']=='PASS' for r in results) else 'PARTIAL','library_bytes':library,'library_budget_bytes':LIB_BUDGET,'entries':results}


def supplement(cid):
    """Compose reviewed object/variant sources; all layout and scale come from code."""
    folder, specpath, data = load(cid)
    cfg = data['composition']
    require(cfg.get('supplement'), 'Not a supplemental sheet')
    items = cfg['items']
    columns, rows = cfg['columns'], cfg['rows']
    require(0 < len(items) <= columns*rows, 'Invalid supplement grid')
    canvas_size = tuple(cfg.get('canvas_px', TURN_SIZE))
    canvas = Image.new('RGB', canvas_size, BG)
    draw = ImageDraw.Draw(canvas)
    left_margin = 80 if cfg.get('metric', False) else 0
    cw, ch = (canvas_size[0]-left_margin)/columns, canvas_size[1]/rows
    objects = []
    for item in items:
        path, im = source(folder, item['source'])
        require(im.height <= 1024, 'Supplement source exceeds 1024 px')
        crop, srcbox = tight(im)
        objects.append((item, path, crop, srcbox))
    metric = cfg.get('metric', False)
    ppm = None
    if metric:
        # The specified extent is the projected end-to-end vertical span, not
        # a curved surface length. Upright source geometry is reviewed first.
        ppm = min(min((ch-140)/item['extent_m'],
                      (cw-40)*crop.height/(crop.width*item['extent_m']))
                  for item,path,crop,srcbox in objects)
    geometry = []
    for i,(item,path,crop,srcbox) in enumerate(objects):
        factor = item['extent_m']*ppm/crop.height if metric else min((cw-40)/crop.width,(ch-100)/crop.height)
        w,h = round(crop.width*factor),round(crop.height*factor)
        baseline = round((i//columns+1)*ch-90)
        x = round(left_margin+(i%columns)*cw+(cw-w)/2)
        y = baseline-h
        image = crop.resize((w,h),Image.Resampling.LANCZOS)
        canvas.paste(image,(x,y),image)
        text(draw,(round(left_margin+(i%columns+.5)*cw),baseline+35),item['label'],14 if columns>4 else 19)
        geometry.append({'name':item['name'],'source':str(path.relative_to(folder)),
                         'source_sha256':digest(path),'source_bbox_px':list(srcbox),
                         'sheet_bbox_px':[x,y,x+w,baseline], 'mirrored':False,
                         'extent_m':item.get('extent_m'), 'scale_axis':'vertical' if metric else None})
    rulers = []
    if metric:
        # A narrow code ruler occupies the reserved left margin of each row.
        # Item layout is inset enough that it cannot touch the ruler.
        for row in range(rows):
            baseline = round((row+1)*ch-90)
            maximum = max(x['extent_m'] for x in items[row*columns:(row+1)*columns])
            rulers.append(ruler(draw,ppm,baseline,maximum,65))
    result = save_sheet(canvas,folder/f'{cid}.jpg')
    if cfg.get('png_name'):
        pngpath = folder/cfg['png_name']
        require(pngpath.parent == folder, 'PNG must be directly in supplement folder')
        canvas.save(pngpath,optimize=True)
        result['lossless_png'] = {'path':pngpath.name,'sha256':digest(pngpath)}
    result.update({'objects':geometry,'px_per_m':ppm,'rulers':rulers,
                   'scale_requirement':'projected vertical design span' if metric else 'none; original supplemental close-up / upper-body exception'})
    data.setdefault('measured',{})['supplement'] = result
    write_spec(specpath,data)
    return result


def check_supplement(cid):
    folder,_,data = load(cid)
    require(data['design']['source']=='design_target','Wrong supplement design source')
    require((folder/'notes.md').is_file(),'Missing supplement notes')
    rec = data['measured']['supplement']
    cfg = data['composition']
    names = [item['name'] for item in cfg['items']]
    require(len(names)==len(set(names)), 'Duplicated supplement item')
    state_path = ROOT/'progress.json'
    if state_path.exists():
        entry = json.loads(state_path.read_text()).get('entries',{}).get(cid)
        if entry:
            expected = set(entry['deliverables'])-{'sheet','spec','notes','check'}
            require(set(names)==expected,'Supplement roster membership differs from checklist')
    path = folder/rec['path']
    require(digest(path)==rec['sha256'],'Supplement JPEG changed')
    im = Image.open(path)
    require(im.format=='JPEG' and list(im.size)==rec['canvas_px'],'Wrong supplement dimensions')
    require(rec['jpeg_quality']==88,'Wrong supplement JPEG quality')
    captured=[]
    oldsave,oldwrite=globals()['save_sheet'],globals()['write_spec']
    # Disable optional PNG output during reconstruction, without changing the
    # spec on disk. Reconstruction must never mutate retained assets.
    oldload=globals()['load']
    def load_without_png(name):
        folder,specpath,copydata=oldload(name)
        copydata['composition'].pop('png_name',None)
        return folder,specpath,copydata
    try:
        globals()['load']=load_without_png
        globals()['save_sheet']=lambda image,path: captured.append(image.copy()) or {}
        globals()['write_spec']=lambda path,data: None
        rebuilt=supplement(cid)
    finally:
        globals()['save_sheet'],globals()['write_spec'],globals()['load']=oldsave,oldwrite,oldload
    require(len(captured)==1,'Wrong supplement canvas count')
    raw=captured[0]
    require(hashlib.sha256(raw.tobytes()).hexdigest()==rec['pre_jpeg_sha256'],'Supplement pre-JPEG canvas changed')
    for key in ('objects','px_per_m','rulers'):
        require(rec[key]==rebuilt[key],f'Supplement {key} changed')
    require(np.all(np.asarray(raw)[:8,:8]==BG),'Wrong exact supplement background')
    require(np.max(np.abs(np.asarray(im.convert('RGB')).astype(int)[:8,:8]-BG))<=3,'Supplement decoded JPEG background changed')
    if cfg.get('png_name'):
        p=folder/rec['lossless_png']['path']
        require(digest(p)==rec['lossless_png']['sha256'],'Lossless PNG changed')
        require(np.array_equal(np.asarray(Image.open(p).convert('RGB')),np.asarray(raw)),'PNG differs from composition')
    for i,a in enumerate(rec['objects']):
        b=a['sheet_bbox_px']; require(0<=b[0]<b[2]<=im.width and 0<=b[1]<b[3]<=im.height,'Clipped supplement object')
        with Image.open(folder/a['source']) as source_im:
            require(source_im.height<=1024,'Oversized supplement source')
        require(not a['mirrored'],'Mirrored supplement source')
        if cfg.get('metric'):require(b[3]-b[1]==round(a['extent_m']*rec['px_per_m']),'Supplement scale mismatch')
        for other in rec['objects'][i+1:]:
            c=other['sheet_bbox_px']
            require(min(b[2],c[2])<=max(b[0],c[0]) or min(b[3],c[3])<=max(b[1],c[1]),'Overlapping supplement objects')
    require(stored_bytes(folder)<=CHAR_BUDGET,'Supplement exceeds 2.5 MB')
    require(stored_bytes(ROOT)<=LIB_BUDGET,'Library exceeds 70 MB')
    return {'id':cid,'status':'PASS','character_bytes':stored_bytes(folder),'checked':'source reconstruction, scale, layout, PNG, JPEG and budgets'}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    commands=parser.add_subparsers(dest='command',required=True)
    s=commands.add_parser('segment')
    s.add_argument('input');s.add_argument('output')
    s.add_argument('--threshold',type=float,default=38)
    s.add_argument('--max-height',type=int,default=768)
    s.add_argument('--backend',choices=('auto','threshold','rembg'),default='auto')
    for name in ('turnaround','face','grid','sample','preview64','check','supplement','poses'):
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
