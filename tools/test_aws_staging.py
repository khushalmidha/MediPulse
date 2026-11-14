"""Cloud safety regressions; all AWS calls mocked, all manifests temporary."""
import copy
import datetime as dt
import json
import os
import subprocess
from pathlib import Path
import tempfile
import unittest
from contextlib import contextmanager
from unittest.mock import patch
import aws_native_pilot as api
import aws_staging as stage
import check_native_ssm as native
import check_aws_staging as acceptance
import render_staging_policy as policy


class StagingSafety(unittest.TestCase):
    def test_cloud_init_failure_retains_detail_and_stops_before_packages(self):
        script = native.bootstrap({'modelHashes': {}})
        prefix = script.split('export DEBIAN_FRONTEND=noninteractive', 1)[0]
        fake = "uname() { echo aarch64; }; systemctl() { return 0; }; "
        for status in [1, 2]:
            with self.subTest(status=status):
                command = fake + "cloud-init() { echo 'status: done'; echo 'recoverable_errors: synthetic diagnostic'; return " + str(status) + "; };\n" + prefix
                result = subprocess.run(['C:/Program Files/Git/bin/bash.exe', '-c', 'set -Eeuo pipefail\n' + command],
                                        capture_output=True, timeout=10)
                self.assertEqual(result.returncode, status)
                self.assertIn(b'recoverable_errors: synthetic diagnostic', result.stdout)
                self.assertIn(('BOOTSTRAP_FAILURE step=cloud-init code=' + str(status)).encode(), result.stderr)

    @contextmanager
    def retry_fixture(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            state = {**self.state, 'status': 'cleaned', 'cleanupCompletedAtUtc': stage.now().isoformat(),
                     'modelHashes': {'config.json': 'a' * 64}, 'maxRestoreHours': 2}
            approval = {'approved': True, 'approvedAtUtc': stage.now().isoformat(),
                        'deploymentId': stage.STAGE, 'priorInstanceId': state['instanceId'],
                        'proposedClientToken': stage.STAGE + '-two', 'maximumAdditionalAttempts': 1,
                        'maximumActiveInstances': 1, 'reserveGrossUSDTotalAcrossAttempts': 3,
                        'fixedOriginalDeadlineUtc': state['deadlineUtc'], 'instanceType': 't4g.small',
                        'encryptedGp3GiB': 30, 'productionOrDnsChanges': False}
            journal = root / 'state.json'; journal.write_text(json.dumps(state))
            grant = root / 'retry.json'; grant.write_text(json.dumps(approval))
            with patch.object(stage, 'STATE', journal), patch.object(stage, 'RETRY_APPROVAL', grant), \
                 patch.object(api, 'PRIVATE', root), patch.object(api, 'identity'), \
                 patch.object(stage, 'find', return_value=[]) as inventory:
                yield state, approval, journal, grant, inventory

    def test_approved_retry_preserves_window_reserve_and_old_manifest(self):
        with self.retry_fixture() as (old, approval, journal, grant, inventory):
            original = journal.read_bytes()
            new = stage.prepare_retry()
            for key in ['preparedAtUtc', 'deadlineUtc', 'reserveGrossUSD', 'modelHashes']:
                self.assertEqual(new[key], old[key])
            self.assertEqual(new['clientToken'], stage.STAGE + '-two')
            self.assertEqual(new['attempt'], 2)
            self.assertEqual(Path(new['previousManifest']).read_bytes(), original)
            self.assertNotIn('instanceId', new)
            self.assertNotEqual(stage.logs_path(new), stage.LOGS)
            self.assertEqual(inventory.call_count, 4)

    def test_retry_refuses_missing_explicit_approval(self):
        with self.retry_fixture() as (old, approval, journal, grant, inventory):
            approval['approved'] = False; grant.write_text(json.dumps(approval))
            before = journal.read_bytes()
            with self.assertRaises(AssertionError): stage.prepare_retry()
            self.assertEqual(journal.read_bytes(), before)
            inventory.assert_not_called()

    def test_retry_refuses_deadline_reserve_or_instance_scope_changes(self):
        for field, value in [('fixedOriginalDeadlineUtc', '2099-01-01T00:00:00Z'),
                             ('reserveGrossUSDTotalAcrossAttempts', 4), ('priorInstanceId', 'other'),
                             ('instanceType', 't4g.large'), ('maximumAdditionalAttempts', 2)]:
            with self.subTest(field=field), self.retry_fixture() as (old, approval, journal, grant, inventory):
                approval[field] = value; grant.write_text(json.dumps(approval))
                with self.assertRaises(AssertionError): stage.prepare_retry()
                self.assertEqual(json.loads(journal.read_text())['status'], 'cleaned')
                inventory.assert_not_called()

    def test_retry_refuses_resources_still_present(self):
        with self.retry_fixture() as (old, approval, journal, grant, inventory):
            inventory.side_effect = lambda operation, key: [{}] if operation == 'describe-volumes' else []
            with self.assertRaises(AssertionError): stage.prepare_retry()
            self.assertEqual(json.loads(journal.read_text())['status'], 'cleaned')

    def test_retry_cannot_prepare_a_third_attempt(self):
        with self.retry_fixture() as (old, approval, journal, grant, inventory):
            old['attempt'] = 2; journal.write_text(json.dumps(old))
            with self.assertRaises(AssertionError): stage.prepare_retry()
            inventory.assert_not_called()

    def test_second_attempt_has_a_distinct_exact_target_token(self):
        state = {**self.state, 'attempt': 2, 'clientToken': stage.STAGE + '-two'}
        item = {**self.item, 'ClientToken': state['clientToken']}
        stage.instance(state, item)
        with self.assertRaises(AssertionError): stage.instance(state, self.item)

    def test_native_build_transfers_matching_locked_dependency_before_docker_build(self):
        script = native.bootstrap({'modelHashes': {name: 'a' * 64 for name in api.MODEL_FILES}})
        package = json.loads(subprocess.check_output(['git', 'show', native.SOURCE + ':backend/package.json'], cwd=api.REPO))
        lock = json.loads(subprocess.check_output(['git', 'show', native.SOURCE + ':backend/package-lock.json'], cwd=api.REPO))
        self.assertEqual(package['dependencies'], lock['packages']['']['dependencies'])
        self.assertEqual(package['dependencies']['mongoose'], lock['packages']['node_modules/mongoose']['version'])
        self.assertLess(script.index('git checkout -q ' + native.SOURCE), script.index('docker build'))
        self.assertLess(len(json.dumps({'commands': ['/bin/bash -c ' + script]}).encode()), 20000)

    def test_source_drift_is_rejected_before_launch_or_cleanup(self):
        with patch.object(stage, 'load', return_value={'status': 'prepared'}), \
             patch.object(native, 'reviewed_source', side_effect=RuntimeError('source drift')), \
             patch.object(stage, 'launch') as launch, patch.object(stage, 'cleanup') as cleanup:
            with self.assertRaisesRegex(RuntimeError, 'source drift'):
                acceptance.run()
            launch.assert_not_called()
            cleanup.assert_not_called()

    def capacity_guard(self, values):
        source = (api.REPO / 'tools/reels_capacity_check.mjs').read_text(encoding='utf-8')
        # Execute the real target guards before Linux-only processing or DB imports.
        self.assertIn("assert.equal(process.platform, 'linux');", source)
        guard = source.split("assert.equal(process.platform, 'linux');", 1)[0]
        return subprocess.run(['node', '--input-type=module', '-e', guard],
                              env={**os.environ, **values}, capture_output=True, timeout=10)

    def test_renewed_capacity_targets_pass_actual_harness_guards(self):
        values = acceptance.capacity_environment()
        self.assertEqual(self.capacity_guard(values).returncode, 0)
        self.assertIn('--name ' + acceptance.REDIS_CONTAINER, acceptance.services())

    def test_capacity_guards_reject_deployment_id_as_database_or_redis_name(self):
        for field, value in [
            ('DATABASE_URL', 'mongodb://mongo:27017/medipulse_test_capacity_' + stage.STAGE),
            ('REDIS_URL', 'redis://capacity-redis-' + stage.STAGE + ':6379/15'),
        ]:
            with self.subTest(field=field):
                values = {**acceptance.capacity_environment(), field: value}
                self.assertNotEqual(self.capacity_guard(values).returncode, 0)

    def setUp(self):
        self.account = '123456789012'
        self.state = {'account': self.account, 'deploymentId': stage.STAGE, 'instanceId': 'i-staging',
                      'preparedAtUtc': stage.now().isoformat(), 'reserveGrossUSD': 3,
                      'clientToken': stage.STAGE + '-one', 'deadlineUtc': (stage.now() + dt.timedelta(hours=1)).isoformat()}
        self.item = {'InstanceId': 'i-staging', 'InstanceType': 't4g.small', 'ClientToken': self.state['clientToken'],
                     'State': {'Name': 'running'}, 'Tags': json.loads(stage.tags('instance', 'staging-host'))[0]['Tags'],
                     'IamInstanceProfile': {'Arn': f'arn:aws:iam::{self.account}:instance-profile/MediPulseEc2SSM'}}
        self.scope = patch.object(api, 'ACCOUNT', self.account); self.scope.start(); self.addCleanup(self.scope.stop)

    def test_valid_exact_target(self):
        stage.target(self.state, self.item)

    def test_rejects_unrelated_id_type_token_and_profile(self):
        for key, value in [('InstanceId', 'i-07b4f6961dc550de0'), ('InstanceType', 't4g.large'),
                           ('ClientToken', 'different'), ('IamInstanceProfile', {'Arn': 'other'})]:
            with self.subTest(key=key):
                item = copy.deepcopy(self.item); item[key] = value
                with self.assertRaises(AssertionError): stage.target(self.state, item)

    def test_production_tag_and_expiry_rejected(self):
        item = copy.deepcopy(self.item)
        next(t for t in item['Tags'] if t['Key'] == 'DataClass')['Value'] = 'production'
        with self.assertRaises(AssertionError): stage.target(self.state, item)
        self.state['deadlineUtc'] = '2020-01-01T00:00:00+00:00'
        with self.assertRaises(AssertionError): stage.target(self.state, self.item)

    def test_volume_guards(self):
        good = {'Size': 30, 'VolumeType': 'gp3', 'Encrypted': True,
                'Tags': json.loads(stage.tags('volume', 'restore'))[0]['Tags']}
        stage.volume(good, 'restore')
        for key, value in [('Size', 40), ('VolumeType', 'io2'), ('Encrypted', False), ('Tags', [])]:
            with self.subTest(key=key):
                bad = {**good, key: value}
                with self.assertRaises(AssertionError): stage.volume(bad, 'restore')

    def test_cannot_extend_duration_or_reserve(self):
        for changes in [{'reserveGrossUSD': 4}, {'deadlineUtc': (stage.now() + dt.timedelta(hours=73)).isoformat()}]:
            with self.subTest(changes=changes), self.assertRaises(AssertionError):
                stage.scope({**self.state, **changes})

    def test_restore_window_expiry_allows_only_cleanup(self):
        self.state['restoreCreatedAtUtc'] = (stage.now() - dt.timedelta(hours=3)).isoformat()
        with self.assertRaises(AssertionError): stage.target(self.state, self.item)
        stage.instance(self.state, self.item)  # cleanup must still be possible

    def test_expired_prepared_window_stops_before_cloud_calls(self):
        current = stage.now()
        state = {**self.state,
                 'preparedAtUtc': (current - dt.timedelta(hours=73)).isoformat(),
                 'deadlineUtc': (current - dt.timedelta(hours=1)).isoformat()}
        with patch.object(stage.STATE.__class__, 'exists', return_value=True), \
             patch.object(stage, 'load', return_value=state), \
             patch.object(acceptance.preflight, 'main') as preflight, \
             patch('sys.argv', ['check_aws_staging.py', '--run-approved']):
            with self.assertRaisesRegex(RuntimeError, 'Staging window expired'):
                acceptance.main()
            preflight.assert_not_called()
        stage.instance(state, self.item)  # exact cleanup still ignores expiry

    def test_open_window_does_not_change_deadline(self):
        before = copy.deepcopy(self.state)
        stage.require_open_window(self.state)
        self.assertEqual(self.state, before)

    def test_cleanup_bypasses_expired_window_gate(self):
        with patch('sys.argv', ['check_aws_staging.py', '--cleanup']), \
             patch.object(stage, 'cleanup') as cleanup, \
             patch.object(stage, 'require_open_window') as window:
            acceptance.main()
            cleanup.assert_called_once_with()
            window.assert_not_called()

    def test_cleanup_refuses_jobfinder_before_write(self):
        state = {**self.state, 'instanceId': 'i-07b4f6961dc550de0'}
        item = {**self.item, 'InstanceId': state['instanceId']}
        with patch.object(stage, 'load', return_value=state), patch.object(api, 'identity'), \
             patch.object(api, 'aws', return_value={'Reservations': [{'Instances': [item]}]}) as call:
            with self.assertRaises(AssertionError): stage.cleanup()
            self.assertEqual([x.args[0] for x in call.call_args_list], ['describe-instances'])

    def test_restore_refuses_root_disk_before_write(self):
        state = {**self.state, 'restoreVolumeId': 'vol-root', 'volumeId': 'vol-root'}
        v = {'VolumeId': 'vol-root', 'Size': 30, 'VolumeType': 'gp3', 'Encrypted': True,
             'Tags': json.loads(stage.tags('volume', 'restore'))[0]['Tags'], 'Attachments': []}
        with patch.object(api, 'aws', return_value={'Volumes': [v]}) as call:
            with self.assertRaises(AssertionError): stage.remove_restore(state)
            self.assertEqual([x.args[0] for x in call.call_args_list], ['describe-volumes'])

    def test_new_policy_never_grants_iam_ingress_or_unbounded_actions(self):
        obj = policy.build(); compact = json.dumps(obj, separators=(',', ':')).replace('__ACCOUNT_ID__', self.account)
        self.assertLessEqual(len(compact), 6144)
        actions = {a for s in obj['Statement'] for a in (s['Action'] if isinstance(s['Action'], list) else [s['Action']])}
        self.assertFalse(any(a.startswith('iam:') or '*' in a or 'Ingress' in a or 'KeyPair' in a for a in actions))
        restore = next(s for s in obj['Statement'] if s['Action'] == 'ec2:CreateVolume' and ':volume/' in str(s['Resource']))
        self.assertEqual(restore['Condition']['Null'], {'ec2:ParentSnapshot': 'false'})
        self.assertEqual(restore['Condition']['NumericEquals']['ec2:VolumeSize'], '30')

    def test_ssm_journal_stays_in_selected_manifest(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); path = root / 'stage.json'; path.write_text(json.dumps(self.state))
            old = root / 'old-pilot.json'; old.write_text('{"untouched":true}')
            calls = []
            def request(service, operation, *args):
                calls.append((service, operation, args))
                if operation == 'send-command':
                    payload = json.loads(Path(args[-1].removeprefix('file://')).read_text())
                    self.assertEqual(payload['InstanceIds'], ['i-staging'])
                    self.assertNotIn('Targets', payload)
                    self.assertFalse(payload['CloudWatchOutputConfig']['CloudWatchOutputEnabled'])
                    return {'Command': {'CommandId': 'synthetic'}}
                return {'Status': 'Success', 'ResponseCode': 0, 'StandardOutputContent': 'ok'}
            session = native.Session(path, root / 'logs', stage.target)
            with patch.object(session, 'verify'), patch.object(native.preflight, 'read', side_effect=request), patch.object(api, 'STATE', old):
                self.assertEqual(session.run('true', 'safety-check', 10), 'ok')
            self.assertEqual(json.loads(old.read_text()), {'untouched': True})
            self.assertEqual(json.loads(path.read_text())['ssmCommands'][0]['commandId'], 'synthetic')
            self.assertEqual([x[1] for x in calls], ['send-command', 'get-command-invocation'])

    def test_snapshot_restore_tracks_one_owned_source_and_restored_disk(self):
        state = {**self.state, 'volumeId': 'vol-source', 'availabilityZone': 'us-east-1a'}
        source = {'VolumeId': 'vol-source', 'Size': 30, 'Encrypted': True, 'VolumeType': 'gp3',
                  'Tags': json.loads(stage.tags('volume', 'staging-root'))[0]['Tags']}
        restored = {**source, 'VolumeId': 'vol-restore', 'SnapshotId': 'snap-staging', 'State': 'available',
                    'Attachments': [], 'Tags': json.loads(stage.tags('volume', 'restore'))[0]['Tags']}
        snapshot = {'SnapshotId': 'snap-staging', 'VolumeId': 'vol-source', 'VolumeSize': 30,
                    'State': 'completed', 'Encrypted': True, 'Tags': json.loads(stage.tags('snapshot', 'synthetic-backup'))[0]['Tags']}
        operations = []
        def aws(operation, *args, **kwargs):
            operations.append((operation, kwargs.get('dry', False)))
            if kwargs.get('dry'): return 'DryRunOperation'
            if operation == 'describe-volumes': return {'Volumes': [restored if args[-1] == 'vol-restore' else source]}
            if operation == 'create-snapshot': return {'SnapshotId': 'snap-staging'}
            if operation == 'describe-snapshots': return {'Snapshots': [snapshot]}
            if operation == 'create-volume': return restored
            if operation == 'attach-volume':
                self.assertEqual(args, ('--volume-id', 'vol-restore', '--instance-id', 'i-staging', '--device', '/dev/sdf'))
                return {}
            self.fail('Unexpected cloud operation ' + operation)
        scripts = []
        class Session:
            def run(self, script, label, timeout):
                scripts.append(script)
                return {'quiesce-synthetic-backup': 'STAGING_WRITES_QUIESCED',
                        'mount-and-verify-restore': 'STAGING_RESTORED_ALL_FIXTURE_HASHES_MATCH',
                        'restored-hls-decode': '{}', 'restored-offline-model-and-media': 'tests 2\npass 2\nfail 0\nskipped 0',
                        'restore-db-and-cache-proofs': 'STAGING_RESTORED_MONGO_AND_REDIS_PROOFS_PASS'}[label]
        with patch.object(stage, 'load', return_value=state), patch.object(stage, 'save'), \
             patch.object(stage, 'find', side_effect=lambda op, key: [source] if op == 'describe-volumes' else []), \
             patch.object(api, 'aws', side_effect=aws), patch.object(stage, 'remove_restore') as remove:
            acceptance.snapshot_restore(Session())
        self.assertTrue(state['snapshotRestorePassed'])
        self.assertTrue(state['restoredMongoAndRedisProofs'])
        self.assertEqual(state['restoreVolumeId'], 'vol-restore')
        self.assertEqual(operations.count(('create-snapshot', False)), 1)
        self.assertEqual(operations.count(('create-volume', False)), 1)
        self.assertIn('mount -o ro,noload', scripts[1])
        self.assertIn('docker stop medipulse-staging-mongo ' + acceptance.REDIS_CONTAINER, scripts[0])
        self.assertIn('nvme-Amazon_Elastic_Block_Store_volrestore', scripts[1])
        self.assertNotIn('mkfs', '\n'.join(scripts))
        remove.assert_called_once_with(state)


if __name__ == '__main__':
    unittest.main()
