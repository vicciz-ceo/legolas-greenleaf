#!/usr/bin/env python3
"""Compare a sheet-calibrated lab turnaround with its reference sheet (docs/refs/<id>/<id>_turnaround.jpg).

Needs Pillow and numpy. Render the lab side first: orthographic, same scale, baseline and panel centres as the
sheet, on a magenta background so the silhouette can be keyed exactly:

    node scripts/snap.mjs "/lab/?subject=<lab subject>&view=turn&ref=<id>&anim=idle&t=0.5&bg=ff00ff&ground=0" \
        --size 1536x1024 --timeout 240000 --out shots/<id>-cal.png
    python3 scripts/sheet-compare.py <id> shots/<id>-cal.png [--out shots/<id>-compare.png]

Outputs
  <out>                sheet on top, lab below (lab composited on the sheet's grey), 1536x2048
  <out>-overlay.png    lab render with the sheet's silhouette outline (red, shifted by the best x offset) and
                       the lab's (cyan); yellow = baseline and panel centres
  stdout (JSON)        per view:
    iou                silhouette intersection-over-union at the best horizontal offset (1 = same outline)
    shift_px           that offset (sheet px; the sheets centre the whole silhouette box, held weapons included,
                       so a differently held weapon moves the body); iou_unshifted is the raw value
    height_m / width_m silhouette height and width, [sheet, lab]
    rows               silhouette width every 0.1 m of height, [sheet, lab] (metres)
    worst              the 5 heights with the largest width difference (lab minus sheet, cm)
The sheet silhouettes come from the reference's own RGBA cutouts (views/*.png placed by spec.json), so they are
exact. Pose differences (the lab's idle holds weapons and arms differently from the sheet's relaxed stance) show up
in the arm, hand and weapon rows: judge the head, hair, torso, hem and leg rows first.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
W, H = 1536, 1024
GREY = np.array([127, 127, 127], dtype=np.float32)


def arg(name, default=None):
    if name in sys.argv:
        i = sys.argv.index(name)
        if i + 1 < len(sys.argv):
            return sys.argv[i + 1]
    return default


def sheet_masks(ref, t):
    """exact per-view silhouettes from the reference's RGBA cutouts, placed as the sheet composer placed them"""
    masks = []
    for v in t['views']:
        full = np.zeros((H, W), dtype=bool)
        try:
            src = Image.open(ROOT / 'docs' / 'refs' / ref / v['source']).convert('RGBA')
            sb = v['source_bbox_px']
            crop = src.crop((sb[0], sb[1], sb[2], sb[3]))
            if v.get('mirrored'):
                crop = crop.transpose(Image.FLIP_LEFT_RIGHT)
            db = v['sheet_bbox_px']
            crop = crop.resize((db[2] - db[0], db[3] - db[1]), Image.LANCZOS)
            a = np.asarray(crop.getchannel('A')) > int(v.get('alpha_threshold', 127))
            full[db[1]:db[3], db[0]:db[2]] = a
        except Exception as e:  # fall back to the sheet image itself
            print(f'[sheet-compare] cutout for {v["view"]} unavailable ({e}); using the sheet image', file=sys.stderr)
            img = np.asarray(Image.open(ROOT / 'docs' / 'refs' / ref / t['path']).convert('RGB').resize((W, H))).astype(np.float32)
            db = v['sheet_bbox_px']
            d = np.abs(img - GREY).max(axis=2) > 20
            full[db[1]:db[3], db[0]:db[2]] = d[db[1]:db[3], db[0]:db[2]]
        masks.append(full)
    return masks


def lab_mask_and_visual(lab):
    """silhouette of the lab render (keyed on its flat background colour) and the render composited on grey"""
    arr = np.asarray(lab).astype(np.float32)
    bg = np.median(np.concatenate([arr[2:12, 2:300].reshape(-1, 3), arr[2:12, -300:-2].reshape(-1, 3)]), axis=0)
    dist = np.abs(arr - bg).max(axis=2)
    magenta = bg[0] > 200 and bg[2] > 200 and bg[1] < 60
    if not magenta:
        print('[sheet-compare] warning: render the lab with bg=ff00ff for an exact silhouette '
              '(grey backgrounds lose lit grey cloth)', file=sys.stderr)
    thresh = 60 if magenta else 14
    mask = dist > thresh
    alpha = np.clip(dist / (thresh * 2.5), 0, 1)[..., None] if magenta else mask[..., None].astype(np.float32)
    vis = arr * alpha + GREY * (1 - alpha) if magenta else arr
    # fill pinholes, drop specks
    m = Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(3))
    m = m.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(3))
    return np.asarray(m) > 0, Image.fromarray(vis.clip(0, 255).astype(np.uint8))


def shift_x(m, dx):
    out = np.zeros_like(m)
    if dx > 0:
        out[:, dx:] = m[:, :-dx]
    elif dx < 0:
        out[:, :dx] = m[:, -dx:]
    else:
        out[:] = m
    return out


def rows_of(m, base, ppm, height):
    rows = {}
    h = 0.1
    while h < height + 1e-6:
        y = int(round(base - h * ppm))
        xs = np.nonzero(m[y])[0] if 0 <= y < H else []
        rows[f'{h:.1f}'] = float((xs.max() - xs.min() + 1) / ppm) if len(xs) else 0.0
        h += 0.1
    return rows


def extent(m, ppm, base):
    ys, xs = np.nonzero(m)
    if not len(ys):
        return 0.0, 0.0
    return float((base - ys.min()) / ppm), float((xs.max() - xs.min() + 1) / ppm)


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    ref = sys.argv[1]
    lab_path = Path(sys.argv[2])
    out = Path(arg('--out', str(lab_path.with_name(f'{ref}-compare.png'))))
    spec = json.loads((ROOT / 'docs' / 'refs' / ref / 'spec.json').read_text())
    t = spec['measured']['turnaround']
    ppm = float(t['px_per_m'])
    base = int(t.get('baseline_y_px', 940))
    sheet = Image.open(ROOT / 'docs' / 'refs' / ref / t['path']).convert('RGB').resize((W, H))
    lab = Image.open(lab_path).convert('RGB')
    if lab.size != (W, H):
        lab = lab.resize((W, H))
    lab_m, lab_vis = lab_mask_and_visual(lab)
    lab_m[base + 2:, :] = False  # labels and the info line live below the baseline
    centres = [(v['sheet_bbox_px'][0] + v['sheet_bbox_px'][2]) / 2 for v in t['views']]
    smasks = sheet_masks(ref, t)
    report = {'ref': ref, 'px_per_m': round(ppm, 2), 'sheet_height_m': t.get('overall_height_m'), 'views': []}
    overlay = lab_vis.copy()
    outlines = []
    for i, v in enumerate(t['views']):
        x0 = 0 if i == 0 else int((centres[i - 1] + centres[i]) / 2)
        x1 = W if i == len(centres) - 1 else int((centres[i] + centres[i + 1]) / 2)
        ms = np.zeros((H, W), dtype=bool)
        ml = np.zeros((H, W), dtype=bool)
        ms[:, x0:x1] = smasks[i][:, x0:x1]
        ml[:, x0:x1] = lab_m[:, x0:x1]
        best = (-1.0, 0)
        raw = 0.0
        for dx in range(-120, 121, 2):
            s = shift_x(ms, dx)
            u = np.logical_or(s, ml).sum()
            iou = float(np.logical_and(s, ml).sum() / u) if u else 0.0
            if dx == 0:
                raw = iou
            if iou > best[0]:
                best = (iou, dx)
        hs, ws = extent(ms, ppm, base)
        hl, wl = extent(ml, ppm, base)
        rs = rows_of(ms, base, ppm, hs)
        rl = rows_of(ml, base, ppm, hl)
        rows = {k: [round(rs.get(k, 0.0), 3), round(rl.get(k, 0.0), 3)] for k in sorted(set(rs) | set(rl), key=float)}
        worst = sorted(rows.items(), key=lambda kv: -abs(kv[1][0] - kv[1][1]))[:5]
        report['views'].append({
            'view': v['view'],
            'iou': round(best[0], 3),
            'shift_px': best[1],
            'iou_unshifted': round(raw, 3),
            'height_m': [round(hs, 3), round(hl, 3)],
            'width_m': [round(ws, 3), round(wl, 3)],
            'rows': rows,
            'worst': [{'at_m': k, 'sheet': a, 'lab': b, 'diff_cm': round((b - a) * 100, 1)} for k, (a, b) in worst],
        })
        outlines.append((shift_x(ms, best[1]), (235, 40, 40)))
        outlines.append((ml, (40, 225, 235)))
    for m, col in outlines:
        im = Image.fromarray((m * 255).astype(np.uint8))
        edge = np.asarray(im.filter(ImageFilter.MaxFilter(3))) > np.asarray(im)
        overlay.paste(Image.new('RGB', (W, H), col), (0, 0), Image.fromarray((edge * 255).astype(np.uint8)))
    d = ImageDraw.Draw(overlay)
    d.line([(0, base), (W, base)], fill=(255, 230, 0), width=1)
    for c in centres:
        d.line([(c, base - 5), (c, base + 5)], fill=(255, 230, 0), width=1)
    stacked = Image.new('RGB', (W, H * 2))
    stacked.paste(sheet, (0, 0))
    stacked.paste(lab_vis, (0, H))
    out.parent.mkdir(parents=True, exist_ok=True)
    stacked.save(out)
    ov = out.with_name(out.stem + '-overlay.png')
    overlay.save(ov)
    report['compare'] = str(out)
    report['overlay'] = str(ov)
    print(json.dumps(report, indent=1))


if __name__ == '__main__':
    main()
