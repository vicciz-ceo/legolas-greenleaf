"""Synthetic regression tests; no generated imagery or fixtures are committed."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

from PIL import Image, ImageDraw

spec = importlib.util.spec_from_file_location('compose', Path(__file__).with_name('compose.py'))
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)


class ComposeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.oldroot = c.ROOT
        c.ROOT = Path(self.temp.name)
        self.folder = c.ROOT/'fixture'
        self.folder.mkdir()
        for part, names in [('views', c.VIEWS), ('face_views', ('front','three_quarter','side'))]:
            (self.folder/part).mkdir()
            for i,name in enumerate(names):
                im=Image.new('RGBA',(80+i*8,220),(0,0,0,0))
                draw=ImageDraw.Draw(im)
                draw.rectangle((20,10,50+i*4,200),fill=(80,60,40,255))
                im.save(self.folder/part/(name+'.png'))
        (self.folder/'details').mkdir()
        tiles=[]
        for i in range(4):
            path=f'details/{i}.png'
            Image.new('RGB',(96,96),(90+i*20,70,60)).save(self.folder/path)
            tiles.append({'name':f'mat{i}','label':f'MATERIAL {i}','source':path})
        self.data={'id':'fixture','design':{'source':'design_target','overall_height_m':1.85},
                   'composition':{'fit_policy':'fit','detail_tiles':tiles},
                   'sampling':[{'name':'cloth','sheet':'details','rect_px':[64,64,128,128]}]}
        design=self.data['design']
        design.update(display_name='Fixture',height_m=1.85,proportions={f:0.2 for f in c.PROPORTION_FIELDS},face={f:'fixture' for f in ('shape','eyes','brow','nose','lips','ears','skin_base_hex','skin_variation')},hair={f:'fixture' for f in ('root_hex','tip_hex','length_m','style','braids')},outfit_layers=[],armor=[],weapons=[],silhouette_keywords=[],avoid=[])
        design['face'].update(eyes={'iris_hex':'#506070','shape':'almond','size_note':'natural'},skin_base_hex='#c0a090')
        design['hair'].update(root_hex='#503020',tip_hex='#503020',length_m=.35)
        (self.folder/'notes.md').write_text('Synthetic fixture only.')
        self.store(self.data)

    def tearDown(self):
        c.ROOT=self.oldroot
        self.temp.cleanup()

    def store(self,data):
        (self.folder/'spec.json').write_text(json.dumps(data))

    def ready(self):
        c.turnaround('fixture');c.face('fixture');c.grid('fixture');c.sample('fixture')

    def test_real_composition_and_observed_median(self):
        self.ready()
        result=c.check('fixture')
        self.assertEqual(result['status'],'PASS')
        data=json.loads((self.folder/'spec.json').read_text())
        self.assertEqual(data['design'],self.data['design'])
        self.assertEqual(data['measured']['turnaround']['baseline_y_px'],940)
        self.assertTrue(all(abs(a-b)<=1 for a,b in zip(data['observed']['samples']['cloth']['rgb'],[90,70,60])))
        with Image.open(self.folder/'fixture_details.jpg') as image:
            self.assertEqual(image.size,(1024,1024))
        self.assertEqual(c.preview64('fixture')['temporary_directory'].startswith(tempfile.gettempdir()),True)

    def test_supplement_actual_scale_png_and_stale_files(self):
        data=copy.deepcopy(self.data)
        data['composition']={'supplement':True,'metric':True,'columns':2,'rows':1,'png_name':'fixture.png',
                             'items':[{'name':v,'source':f'views/{v}.png','label':v.upper(),'extent_m':1.0+i}
                                      for i,v in enumerate(('front','back'))]}
        self.store(data)
        rec=c.supplement('fixture')
        self.assertEqual(c.check('fixture')['status'],'PASS')
        for obj in rec['objects']:
            box=obj['sheet_bbox_px']
            self.assertEqual(box[3]-box[1],round(obj['extent_m']*rec['px_per_m']))
        self.assertEqual(rec['rulers'][0]['top_y_px'],934-round(2*rec['px_per_m']))
        im=Image.open(self.folder/'fixture.png');im.putpixel((1,1),(128,127,127));im.save(self.folder/'fixture.png')
        with self.assertRaisesRegex(ValueError,'PNG changed'):c.check('fixture')

    def test_supplement_accepted_ledger_cannot_hide_missing_assets(self):
        (c.ROOT/'progress.json').write_text(json.dumps({'entries':{'fixture':{'kind':'supplement','deliverables':{'sheet':{'status':'accepted'}}}}}))
        report=c.check_all()
        self.assertEqual(report['status'],'PARTIAL')
        self.assertEqual(report['entries'][0]['status'],'FAIL')

    def test_invalid_design_colours_and_material_ranges_fail(self):
        data=copy.deepcopy(self.data);data['design']['face']['eyes']['iris_hex']='brown'
        with self.assertRaisesRegex(ValueError,'sRGB'):c.validate_schema(data)
        data=copy.deepcopy(self.data);data['design']['armor']=[{'name':'plate','material':'steel','color_hex':'#aaaaaa','roughness':1.1,'metalness':1}]
        with self.assertRaisesRegex(ValueError,'allowed range'):c.validate_schema(data)
        data=copy.deepcopy(self.data);data['design']['hair']['length_m']=True
        with self.assertRaisesRegex(ValueError,'finite number'):c.validate_schema(data)

    def test_concealed_material_never_gets_fabricated_colour(self):
        self.data['design']['concealed_materials']={'hair':'Completely covered by prescribed helmet.'}
        self.data['sampling'].append({'name':'hair','sheet':'face','not_visible':'Completely covered by prescribed helmet.'})
        self.store(self.data);self.ready()
        sample=json.loads((self.folder/'spec.json').read_text())['observed']['samples']['hair']
        self.assertIsNone(sample['rgb']);self.assertIsNone(sample['rect_px'])
        self.assertEqual(c.check('fixture')['status'],'PASS')
        data=json.loads((self.folder/'spec.json').read_text());data['observed']['samples']['hair']['rgb']=[1,2,3];self.store(data)
        with self.assertRaisesRegex(ValueError,'fabricated'):c.check('fixture')

    def test_detects_stale_source_and_height_change(self):
        self.ready()
        source=self.folder/'views/front.png'
        im=Image.open(source).convert('RGBA');im.putpixel((30,30),(100,20,30,255));im.save(source)
        with self.assertRaisesRegex(ValueError,'stale source'):
            c.check('fixture')
        c.turnaround('fixture')
        data=json.loads((self.folder/'spec.json').read_text());data['design']['overall_height_m']=2
        self.store(data)
        with self.assertRaisesRegex(ValueError,'height changed'):
            c.check('fixture')

    def test_detects_wrong_baseline_tick_and_budget(self):
        self.ready()
        base=json.loads((self.folder/'spec.json').read_text())
        data=copy.deepcopy(base);data['measured']['turnaround']['views'][0]['baseline_y_px']=939
        self.store(data)
        with self.assertRaisesRegex(ValueError,'share baseline|recorded views'):
            c.check('fixture')
        data=copy.deepcopy(base);data['measured']['turnaround']['ruler']['ticks'][1]['y_px']+=1
        self.store(data)
        with self.assertRaisesRegex(ValueError,'calibration|recorded ruler'):
            c.check('fixture')
        self.store(base)
        (self.folder/'oversized.bin').write_bytes(bytes(c.CHAR_BUDGET))
        with self.assertRaisesRegex(ValueError,'2.5 MB'):
            c.check('fixture')

    def test_threshold_fallback_with_transparent_hole(self):
        im=Image.new('RGB',(160,240),(210,210,210));d=ImageDraw.Draw(im)
        d.rectangle((40,15,120,225),fill=(45,35,25));d.rectangle((65,80,95,140),fill=(210,210,210))
        inp=c.ROOT/'input.png';out=c.ROOT/'cutout.png';im.save(inp)
        result=c.segment(inp,out,38,160,'threshold')
        self.assertEqual(result['method'],'corner_median_colour_distance_morphology')
        arr=Image.open(out)
        self.assertLessEqual(arr.height,168)
        self.assertEqual(arr.getpixel((0,0))[3],0)
        self.assertEqual(arr.getpixel((arr.width//2,arr.height//2))[3],0)

    def test_strict_layout_rejects_wide_subject(self):
        im=Image.new('RGBA',(240,200),(0,0,0,0));ImageDraw.Draw(im).rectangle((10,10,230,190),fill=(40,40,40,255))
        im.save(self.folder/'views/front.png')
        self.data['composition']['fit_policy']='strict_85_percent';self.store(self.data)
        with self.assertRaisesRegex(ValueError,'do not fit'):
            c.turnaround('fixture')

    def test_creature_ruler_and_human(self):
        (self.folder/'views/side.png').replace(self.folder/'views/top.png')
        im=Image.new('RGBA',(400,150),(0,0,0,0));ImageDraw.Draw(im).rectangle((10,10,390,140),fill=(40,40,40,255))
        im.save(self.folder/'views/side.png')
        self.data['composition'].update({'creature':True,'silhouette_only':True,'reference_view':'side',
            'scale_axis':'width','scale_extent_m':10,'views':['front','side','top','three_quarter'],
            'projected_extents_m':{'front':8,'side':10,'top':10,'three_quarter':9}})
        self.store(self.data)
        c.turnaround('fixture')
        self.assertEqual(c.check('fixture')['status'],'PASS')

    def test_creature_landmark_excludes_headgear_and_changes_axis(self):
        Image.open(self.folder/'views/side.png').save(self.folder/'views/top.png')
        config={'creature':True,'silhouette_only':True,'reference_view':'side',
                'scale_axis':'height','scale_extent_m':14,
                'views':['front','side','top','three_quarter'],
                'projected_extents_m':{'front':14,'side':14,'top':20,'three_quarter':14},
                'scale_axes':{'top':'width'},
                'landmark_regions_px':{'side':[20,60,58,201]}}
        self.data['composition'].update(config);self.store(self.data)
        result=c.turnaround('fixture')
        side=next(v for v in result['views'] if v['view']=='side')
        self.assertEqual(side['measurement']['source_span_px'],141)
        self.assertEqual(side['measurement']['source_endpoints_px'][0][1],60)
        self.assertEqual(result['ruler']['endpoint_m'],14)
        self.assertEqual(c.check('fixture')['status'],'PASS')
        data=json.loads((self.folder/'spec.json').read_text());data['composition']['landmark_regions_px']['side']=[20,59,58,201];self.store(data)
        with self.assertRaisesRegex(ValueError,'recorded views|canvas'):c.check('fixture')


    def test_missing_schema_and_overlap_fail(self):
        self.ready()
        base=json.loads((self.folder/'spec.json').read_text())
        data=copy.deepcopy(base);del data['design']['face']
        self.store(data)
        with self.assertRaisesRegex(ValueError,'Missing design.face'):c.check('fixture')
        data=copy.deepcopy(base);data['measured']['turnaround']['views'][1]['sheet_bbox_px']=data['measured']['turnaround']['views'][0]['sheet_bbox_px']
        self.store(data)
        with self.assertRaisesRegex(ValueError,'overlapping objects'):c.check('fixture')

    def test_pre_encoding_hash_and_library_path(self):
        self.ready()
        data=json.loads((self.folder/'spec.json').read_text())
        data['measured']['face']['pre_jpeg_sha256']='invalid'
        self.store(data)
        with self.assertRaisesRegex(ValueError,'pre-JPEG canvas'):c.check('fixture')
        self.ready()
        self.assertEqual(c.check_all()['status'],'PASS')

if __name__=='__main__':
    unittest.main()
