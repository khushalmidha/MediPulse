import json
import subprocess
import tempfile
from pathlib import Path
import unittest
import aws_reels_completion as reels
import render_production_restore_policy as restore

class CompletionSafety(unittest.TestCase):
    def test_fixtures_have_no_production_config_or_public_ports(self):
        for script in [reels.native_script(),reels.capacity_script(),reels.capacity_script(integration=True)]:
            self.assertNotIn('/etc/medipulse',script)
            self.assertNotIn('--env-file',script)
            self.assertNotIn('mongodb+srv',script)
            self.assertNotIn('--publish',script)
            self.assertNotIn(' -p ',script)
            self.assertNotIn('docker rm -f medipulse-ec2-',script)
            self.assertNotIn('terminate-instances',script)
            with tempfile.TemporaryDirectory() as folder:
                file=Path(folder)/'check.sh';file.write_bytes(script.encode())
                subprocess.run(['C:/Program Files/Git/bin/bash.exe','-n',str(file)],check=True,capture_output=True)
        script=reels.capacity_script()
        self.assertIn('--internal',script)
        self.assertIn('--memory 896m --memory-swap 896m',script)
        self.assertIn('medipulse_test_capacity_',script)
        self.assertIn('--network-alias redis',script)
    def test_restore_grant_has_one_snapshot_and_no_production_root_deletion(self):
        state={'account':'123456789012','deploymentId':'fixture-production','snapshotId':'snap-fixture','instanceId':'i-fixture'}
        doc=restore.build(state);encoded=json.dumps(doc)
        self.assertNotIn('TerminateInstances',encoded);self.assertNotIn('DeleteSnapshot',encoded)
        source=doc['Statement'][0];self.assertTrue(source['Resource'].endswith('/snap-fixture'))
        disk=doc['Statement'][1];self.assertEqual(disk['Condition']['NumericEquals']['ec2:VolumeSize'],'30')
        self.assertEqual(disk['Condition']['Bool']['ec2:Encrypted'],'true')
        delete=next(s for s in doc['Statement'] if 'ec2:DeleteVolume' in s['Action'])
        self.assertEqual(delete['Condition']['StringEquals']['aws:ResourceTag/Role'],'production-restore')

if __name__=='__main__':unittest.main()
