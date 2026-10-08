"""Transparent generated sources do not require rembg for detail intake."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image, ImageDraw
import intake


class IntakeTests(unittest.TestCase):
    def test_existing_detail_alpha_is_cropped_without_rembg(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            image = Image.new('RGBA', (80, 80), (0, 0, 0, 0))
            ImageDraw.Draw(image).rectangle((20, 20, 59, 59), fill=(90, 60, 30, 255))
            original = root / 'original.png'
            image.save(original)
            with patch.object(intake.compose, 'ROOT', root), patch.object(intake, '_LAST_DETAIL_RGBA', None):
                intake.intake('fixture', 'details/cloth_leather', original, (10, 10, 70, 70), True)
            retained = root / 'fixture/details/cloth_leather.png'
            with Image.open(retained) as result:
                self.assertEqual('RGBA', result.mode)
                self.assertEqual((40, 40), result.size)
            record = json.loads((root/'fixture/sources.json').read_text())['details/cloth_leather']
            self.assertEqual([10, 10, 70, 70], record['crop_px'])
            self.assertEqual([10, 10, 50, 50], record['detail_trim_box_in_cropped_source_px'])
            self.assertEqual(intake.compose.digest(retained), record['cutout_sha256'])


if __name__ == '__main__':
    unittest.main()
