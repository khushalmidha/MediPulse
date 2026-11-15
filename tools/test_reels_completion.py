import json
import subprocess
import tempfile
from pathlib import Path
import unittest
import aws_reels_completion as reels
import render_production_restore_policy as restore
import aws_production_restore as recovery
import activate_reels_release as activate
from unittest.mock import patch,Mock

class CompletionSafety(unittest.TestCase):
    def test_restore_target_allows_only_the_journaled_clone_and_preserves_the_root_guard(self):
        production={'volumeId':'vol-root','snapshotId':'snap-fixture','instanceId':'i-fixture'}
        root={'DeviceName':'/dev/sda1','Ebs':{'VolumeId':'vol-root','DeleteOnTermination':False}}
        clone={'DeviceName':'/dev/sdf','Ebs':{'VolumeId':'vol-clone','DeleteOnTermination':False}}
        journal={**production,'volumeId':'vol-clone'}
        volume={'VolumeId':'vol-clone','SnapshotId':'snap-fixture','Size':30,'Encrypted':True,'VolumeType':'gp3','Iops':3000,'Throughput':125,'Attachments':[{'InstanceId':'i-fixture','Device':'/dev/sdf'}],'Tags':json.loads(recovery.core.tags('volume','production-restore'))[0]['Tags']}
        with patch.object(recovery,'STATE') as state,patch.object(recovery.core.api,'aws',return_value={'Volumes':[volume]}),patch.object(recovery.core,'target') as target:
            state.read_text.return_value=json.dumps(journal)
            recovery.restore_target(production,{'BlockDeviceMappings':[root,clone]})
            self.assertEqual(target.call_args.args[1]['BlockDeviceMappings'],[root])
            clone['Ebs']['VolumeId']='vol-foreign'
            with self.assertRaises(AssertionError):recovery.restore_target(production,{'BlockDeviceMappings':[root,clone]})
    def test_create_volume_response_can_omit_attachments_but_foreign_attachment_is_rejected(self):
        production={'volumeId':'vol-root','snapshotId':'snap-fixture','instanceId':'i-fixture'}
        volume={'VolumeId':'vol-clone','SnapshotId':'snap-fixture','Size':30,'Encrypted':True,'VolumeType':'gp3','Iops':3000,'Throughput':125,'Tags':json.loads(recovery.core.tags('volume','production-restore'))[0]['Tags']}
        recovery.validate(volume,production)
        volume['Attachments']=[{'InstanceId':'i-foreign','Device':'/dev/sdf'}]
        with self.assertRaises(AssertionError):recovery.validate(volume,production)
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
    def test_recovery_cleanup_refuses_the_production_root_before_any_write(self):
        production={'volumeId':'vol-root','snapshotId':'snap-fixture','instanceId':'i-fixture'}
        volume={'VolumeId':'vol-root','Tags':[{'Key':'DeploymentId','Value':recovery.core.DEPLOYMENT},{'Key':'Project','Value':'MediPulse'},{'Key':'DataClass','Value':'production'},{'Key':'Role','Value':'production-root'}]}
        with patch.object(recovery.core.api,'aws',return_value={'Volumes':[volume]}) as aws:
            with self.assertRaises(AssertionError):recovery.cleanup({'volumeId':'vol-root'},production,Mock())
            self.assertEqual(aws.call_count,1);self.assertEqual(aws.call_args.args[0],'describe-volumes')
    def test_restore_mount_is_read_only_and_activation_has_a_same_host_rollback(self):
        script=recovery.mount_script({'VolumeId':'vol-0123456789abcdef0'})
        self.assertIn('mount -o ro,noload',script);self.assertNotIn('mkfs',script)
        activation=activate.activation_script({'reelsCandidateImage':'sha256:'+'a'*64,'reelsCandidateSource':'b'*40,'reelsCandidateRoot':'/srv/medipulse/releases/'+'b'*40})
        self.assertIn('pre-reels.service',activation);self.assertIn('trap ',activation)
        self.assertNotIn('terminate-instances',activation);self.assertNotIn('docker rm',activation)
        for content in [script,activation,activate.index_script()]:
            with tempfile.TemporaryDirectory() as folder:
                file=Path(folder)/'script.sh';file.write_bytes(content.encode())
                subprocess.run(['C:/Program Files/Git/bin/bash.exe','-n',str(file)],check=True,capture_output=True)

if __name__=='__main__':unittest.main()
