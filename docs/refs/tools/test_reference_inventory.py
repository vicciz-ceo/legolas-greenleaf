import tempfile
import unittest
from pathlib import Path
from reference_inventory import inventory, library_bytes

class ReferenceInventoryTests(unittest.TestCase):
    def test_every_file_counted_and_shared_charged_to_both_libraries(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            files = {'legolas/source.png': 3, 'scenes/mirkwood/look.jpg': 5,
                     'tools/scene_composition.py': 7, 'reference-inventory.json': 11,
                     'unrecognized/new.bin': 13, 'tools/__pycache__/cache.pyc': 100}
            for name, size in files.items():
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b'x' * size)
            result = inventory(root)
            self.assertEqual(result['combined_bytes'], 39)
            self.assertEqual(result['file_count'], 5)
            self.assertEqual(library_bytes(root, 'characters'), 27)
            self.assertEqual(library_bytes(root, 'scenes'), 23)
            paths = [p for group in result['ownership'].values() for p in group['files']]
            self.assertEqual(len(paths), len(set(paths)))
            self.assertIn('unrecognized/new.bin', result['ownership']['characters']['files'])
