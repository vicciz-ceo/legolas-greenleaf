"""Recovery attempts preserve history and enforce their own four-call cap."""
import copy
import json
import multiprocessing
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import progress


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.state = Path(self.temp.name) / 'progress.json'
        self.history = [{'number': n, 'status': 'accepted', 'path': f'lost-{n}.png'}
                        for n in range(1, 5)]
        self.state.write_text(json.dumps({'version': 1, 'entries': {'fixture': {
            'deliverables': {'views/front': {'status': 'blocked',
                                            'attempts': copy.deepcopy(self.history)}}}}}))
        self.override = patch.object(progress, 'STATE', self.state)
        self.override.start()

    def tearDown(self):
        self.override.stop()
        self.temp.cleanup()

    def item(self):
        return json.loads(self.state.read_text())['entries']['fixture']['deliverables']['views/front']

    def test_preserves_exhausted_history_and_caps_recovery(self):
        for n in range(4):
            progress.record_recovery('fixture', 'views/front', 'rejected', 'defect', f'new-{n}.png', attempt=True)
        before = self.state.read_bytes()
        with self.assertRaisesRegex(ValueError, 'recovery cap'):
            progress.record_recovery('fixture', 'views/front', 'pending', attempt=True)
        self.assertEqual(before, self.state.read_bytes())
        self.assertEqual(self.history, self.item()['attempts'])
        self.assertEqual('4 historical + 4 recovery', progress.attempt_summary(self.item()))
        self.assertEqual(2, json.loads(self.state.read_text())['version'])

    def test_review_updates_only_matching_pending_replacement(self):
        progress.record_recovery('fixture', 'views/front', 'pending', path='new.png', attempt=True)
        progress.record_recovery('fixture', 'views/front', 'accepted', 'review passed', path='new.png')
        item = self.item()
        self.assertEqual(self.history, item['attempts'])
        self.assertEqual('accepted', item['recovery']['attempts'][0]['status'])
        self.assertEqual('review passed', item['recovery']['attempts'][0]['reason'])


class ProgressTests(unittest.TestCase):
 def test_parallel_attempts_are_retained_and_cap_survives_reopen(self):
  previous=progress.STATE
  with tempfile.TemporaryDirectory() as tmp:
   progress.STATE=Path(tmp)/'progress.json'
   try:
    progress.save({'entries':{'fixture':{'deliverables':{'views/front':{'status':'pending','attempts':[]}}}}})
    ctx=multiprocessing.get_context('fork')
    jobs=[ctx.Process(target=progress.record,args=('fixture','views/front','pending','synthetic test',f'synthetic-{i}',True)) for i in range(2)]
    for job in jobs:job.start()
    for job in jobs:job.join(10);self.assertEqual(job.exitcode,0)
    attempts=json.loads(progress.STATE.read_text())['entries']['fixture']['deliverables']['views/front']['attempts']
    self.assertEqual([a['number'] for a in attempts],[1,2])
    self.assertEqual({a['path'] for a in attempts},{'synthetic-0','synthetic-1'})
    for i in (2,3):progress.record('fixture','views/front','pending','synthetic test',f'synthetic-{i}',True)
    with self.assertRaisesRegex(ValueError,'Four-attempt cap'):progress.record('fixture','views/front','pending',attempt=True)
    self.assertEqual(len(json.loads(progress.STATE.read_text())['entries']['fixture']['deliverables']['views/front']['attempts']),4)
   finally:progress.STATE=previous


if __name__ == '__main__':
    unittest.main()
