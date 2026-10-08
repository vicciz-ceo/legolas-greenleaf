"""Attempt-ledger concurrency and recovery caps, using synthetic records only."""
import json
import multiprocessing
from pathlib import Path
import tempfile
import unittest
import progress


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
