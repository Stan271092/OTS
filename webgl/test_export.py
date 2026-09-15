import json
from pathlib import Path
import unittest

ROOT = Path(__file__).parent

class GeometryTest(unittest.TestCase):
    def test_export_contains_real_mesh_and_independent_grains(self):
        path = ROOT / 'resin-geometry.json'
        self.assertTrue(path.exists(), 'No actual mesh exported')
        data = json.loads(path.read_text('utf-8'))
        self.assertGreater(len(data['positions']), 3000)
        self.assertEqual(len(data['positions']) % 3, 0)
        self.assertEqual(len(data['normals']), len(data['positions']))
        self.assertTrue(all(i < len(data['positions'])//3 for i in data['indices']))
        self.assertGreater(len(data['indices']), 3000)
        self.assertLess(len(data['indices'])//3, 15000)
        self.assertGreaterEqual(len(data['spheres']), 10)
        self.assertEqual(len(data['clusters']), 4)
        self.assertGreater(sum(len(c['grains']) for c in data['clusters']), 900)
        self.assertTrue(all(g[4] >= .055 for c in data['clusters'] for g in c['grains']), 'Grains can leave resin')
        self.assertLess(path.stat().st_size, 1500000)

if __name__ == '__main__':unittest.main(verbosity=2)
