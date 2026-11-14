"""Cloud safety regressions; all AWS calls mocked, all manifests temporary."""
import copy
import base64
import datetime as dt
import hashlib
import json
import os
import subprocess
import shlex
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
    def test_ssm_phase_markers_preserve_actual_shell_exit_status(self):
        for code in [0,7]:
            with self.subTest(code=code):
                raw=subprocess.run(['C:/Program Files/Git/bin/bash.exe','-c',native.command_script('exit '+str(code),'fixture')],capture_output=True,timeout=10)
                self.assertEqual(raw.returncode,code)
                self.assertIn(b'SSM_STEP_START label=fixture',raw.stdout)
                self.assertIn(('SSM_STEP_FINISH code='+str(code)).encode(),raw.stdout)

    def test_remaining_host_requires_renewed_instruction_and_preserves_original_envelope(self):
        for allowed in [False, True]:
            with self.subTest(allowed=allowed), self.retry_fixture() as (old, approval, journal, grant, inventory):
                old.update(attempt=5, clientToken=stage.STAGE+'-five', originalDeadlineUtc=old['deadlineUtc'])
                approval.update(approved=allowed, priorAttempt=5, proposedClientToken=stage.STAGE+'-six',
                                maximumRuntimeHours=2, reserveGrossUSDTotalAcrossAllAttempts=3,
                                ownerDeploymentInstruction='Complete the remaining deployment work now', policyUpdatedConfirmedByOwner=True)
                journal.write_text(json.dumps(old)); grant.write_text(json.dumps(approval))
                with patch.object(stage, 'REMAINING_APPROVAL', grant):
                    if not allowed:
                        with self.assertRaises(AssertionError): stage.prepare_completion(remaining=True)
                        self.assertEqual(json.loads(journal.read_text())['attempt'],5)
                        continue
                    new=stage.prepare_completion(remaining=True)
                self.assertEqual(new['originalDeadlineUtc'],old['originalDeadlineUtc'])
                self.assertEqual(new['reserveGrossUSD'],3)
                self.assertLessEqual(dt.datetime.fromisoformat(new['deadlineUtc']),dt.datetime.fromisoformat(new['diagnosticPreparedAtUtc'])+dt.timedelta(hours=2))
                new['instanceId']='i-six'; item={**self.item,'InstanceId':'i-six','ClientToken':stage.STAGE+'-six'}
                stage.target(new,item)
                new['remainingAcceptanceScopeApproved']=False
                with self.assertRaises(AssertionError): stage.instance(new,item)
                with self.assertRaises(AssertionError): stage.instance({**new,'attempt':7},item)

    def test_remaining_snapshot_denial_cleans_before_ssm_or_build(self):
        state={'status':'prepared','attempt':6,'volumeId':'vol-synthetic'}
        with patch.object(stage,'load',return_value=state), patch.object(stage,'save'), \
             patch.object(stage,'volume'), patch.object(stage,'launch') as launch, \
             patch.object(stage,'cleanup') as cleanup, patch.object(native,'reviewed_source'), \
             patch.object(native,'Session') as session, \
             patch.object(api,'aws',side_effect=[{'Volumes':[{}]},'UnauthorizedOperation']):
            with self.assertRaisesRegex(AssertionError,'Snapshot permission denied before build'): acceptance.run_diagnostic()
            launch.assert_called_once(); cleanup.assert_called_once(); session.assert_not_called()

    def test_identity_transport_retry_keeps_exact_principal_guard(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'aws-resource-audit.json').write_text(json.dumps({'regions': [
                {'region': api.REGION, 'networkInterfaces': [{'OwnerId': self.account}]}]}))
            good = json.dumps({'Account': self.account, 'Arn': 'arn:aws:iam::' + self.account + ':user/medipulse-deployer'})
            with patch.object(api, 'PRIVATE', root), patch.object(api.time, 'sleep'), \
                 patch.object(api, 'command', side_effect=[subprocess.TimeoutExpired('aws', 25), good]) as call:
                api.identity()
                self.assertEqual(call.call_count, 2)
                self.assertEqual(api.ACCOUNT, self.account)
            with patch.object(api, 'PRIVATE', root), patch.object(api, 'command', return_value=json.dumps(
                    {'Account': self.account, 'Arn': 'arn:aws:iam::' + self.account + ':root'})) as call:
                with self.assertRaises(AssertionError): api.identity()
                self.assertEqual(call.call_count, 1)

    def test_transport_resume_never_provisions_and_always_cleans(self):
        for fails in [False, True]:
            with self.subTest(fails=fails):
                state = {'attempt': 5, 'finalAcceptanceScopeApproved': True, 'status': 'ready'}
                session = unittest.mock.Mock(); session.run.return_value = 'VERIFIED_TEST_HOST_UNCHANGED'
                outputs = ['oom_kill 1\nsha256:' + 'a' * 64, 'tests 2 pass 2 fail 0 skipped 0',
                           'tests 250 pass 250 fail 0 skipped 0', 'tests 410 pass 410 fail 0 skipped 0']
                with patch.object(stage, 'load', return_value=state), patch.object(stage, 'save'), \
                     patch.object(stage, 'launch') as launch, patch.object(stage, 'cleanup') as cleanup, \
                     patch.object(native, 'reviewed_source'), patch.object(native, 'Session', return_value=session), \
                     patch.object(acceptance, 'retained_success', side_effect=[(o, 'hash') for o in outputs]), \
                     patch.object(acceptance, 'capacity_and_restore', side_effect=RuntimeError('capacity failed') if fails else None) as capacity:
                    if fails:
                        with self.assertRaisesRegex(RuntimeError, 'capacity failed'): acceptance.resume_existing_verified_tests()
                    else:
                        acceptance.resume_existing_verified_tests()
                    capacity.assert_called_once()
                    launch.assert_not_called()
                    cleanup.assert_called_once_with()

    def test_retained_success_rejects_old_command_and_failed_result(self):
        with tempfile.TemporaryDirectory() as folder:
            session = unittest.mock.Mock(); session.logs = Path(folder)
            state = {'instanceId': 'i-current', 'ssmCommands': [{'label': 'checks', 'commandId': 'new'}]}
            for command_id, status in [('old', 'Success'), ('new', 'Failed')]:
                (session.logs / 'checks.result.json').write_text(json.dumps({'CommandId': command_id,
                    'InstanceId': 'i-current', 'Status': status, 'ResponseCode': 0, 'StandardOutputContent': 'tests 410 pass 410 fail 0 skipped 0'}))
                with patch.object(stage, 'load', return_value=state), self.assertRaises(AssertionError):
                    acceptance.retained_success(session, 'checks')

    def test_failure_output_retains_totals_and_nonzero_status(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); (root / 'logs').mkdir()
            command = "printf '%s\\n' '# tests 3' '# pass 2' '# fail 1' '# skipped 0'; for x in $(seq 1 100); do echo stack; done; exit 7"
            with patch.object(stage, 'ROOT', root.as_posix()):
                script = acceptance.logged('bash -c ' + shlex.quote(command), 'summary-check')
            result = subprocess.run(['C:/Program Files/Git/bin/bash.exe', '-c', 'set -euo pipefail\n' + script],
                                    capture_output=True, timeout=10)
            self.assertEqual(result.returncode, 7)
            self.assertIn(b'# tests 3', result.stdout)
            self.assertIn(b'# fail 1', result.stdout)

    def test_same_host_acceptance_repair_reruns_without_provisioning(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            evidence = b'{"Status":"Failed","ResponseCode":1}'
            (directory / 'backend-integration-checks.result.json').write_bytes(evidence)
            script = b'echo synthetic-repair\n'
            (directory / 'acceptance-repair-1.sh').write_bytes(script)
            decision = {'action': 'repair-and-rerun', 'reason': 'Reviewed fixture configuration failure',
                        'failureEvidenceSha256': hashlib.sha256(evidence).hexdigest(),
                        'scriptSha256': hashlib.sha256(script).hexdigest()}
            (directory / 'acceptance-decision-1.json').write_text(json.dumps(decision))
            state = {'deadlineUtc': (stage.now() + dt.timedelta(hours=1)).isoformat(),
                     'ssmCommands': [{'label': 'backend-integration-checks'}]}
            session = unittest.mock.Mock(); session.logs = directory
            with patch.object(stage, 'load', return_value=state), patch.object(stage, 'save'), \
                 patch.object(stage, 'launch') as launch, patch.object(native, 'reviewed_source'), \
                 patch.object(acceptance, 'acceptance', side_effect=[RuntimeError('fixture failed'), None]) as checks:
                acceptance.acceptance_with_repair(session)
                self.assertEqual(checks.call_args_list, [unittest.mock.call(session), unittest.mock.call(session, reuse_services=True)])
                session.run.assert_called_once()
                launch.assert_not_called()

    def test_snapshot_failure_never_retries_cloud_resource_creation(self):
        state = {'snapshotId': 'snap-owned', 'ssmCommands': []}
        with patch.object(stage, 'load', return_value=state), patch.object(stage, 'save'), \
             patch.object(acceptance, 'acceptance', side_effect=RuntimeError('restore failed')) as checks:
            with self.assertRaisesRegex(RuntimeError, 'restore failed'):
                acceptance.acceptance_with_repair(unittest.mock.Mock())
            self.assertEqual(checks.call_count, 1)

    def test_final_acceptance_requires_its_own_explicit_grant(self):
        with self.retry_fixture() as (old, approval, journal, grant, inventory):
            old.update(attempt=4, clientToken=stage.STAGE + '-four', originalDeadlineUtc=old['deadlineUtc'])
            approval.update(priorAttempt=4, proposedClientToken=stage.STAGE + '-five', maximumRuntimeHours=2,
                            reserveGrossUSDTotalAcrossAllAttempts=3)
            journal.write_text(json.dumps(old)); grant.write_text(json.dumps(approval))
            with patch.object(stage, 'FINAL_APPROVAL', grant):
                new = stage.prepare_completion(final=True)
            self.assertEqual(new['attempt'], 5)
            self.assertTrue(new['finalAcceptanceScopeApproved'])
            self.assertEqual(new['originalDeadlineUtc'], old['originalDeadlineUtc'])
            new['instanceId'] = 'i-final'
            item = {**self.item, 'InstanceId': 'i-final', 'ClientToken': stage.STAGE + '-five'}
            stage.target(new, item)
            new['finalAcceptanceScopeApproved'] = False
            with self.assertRaises(AssertionError): stage.instance(new, item)
        with self.assertRaises(AssertionError): stage.instance({**self.state, 'attempt': 6}, self.item)

    def test_same_host_repair_never_provisions_and_always_cleans(self):
        for succeeds in [True, False]:
            with self.subTest(succeeds=succeeds):
                state = {'attempt': 4, 'completionScopeApproved': True, 'status': 'ready',
                         'ssmCommands': [{'label': 'backend-integration-checks'}]}
                session = unittest.mock.Mock()
                if succeeds:
                    session.run.return_value = '65536\nMONGO_NOFILE_REPAIR_READY'
                else:
                    session.run.side_effect = RuntimeError('repair failed')
                with patch.object(stage, 'load', return_value=state), patch.object(stage, 'save'), \
                     patch.object(stage, 'launch') as launch, patch.object(stage, 'cleanup') as cleanup, \
                     patch.object(native, 'reviewed_source'), patch.object(native, 'Session', return_value=session), \
                     patch.object(acceptance, 'acceptance') as checks:
                    if succeeds:
                        acceptance.resume_existing_nofile_repair()
                        checks.assert_called_once_with(session, reuse_services=True)
                    else:
                        with self.assertRaisesRegex(RuntimeError, 'repair failed'):
                            acceptance.resume_existing_nofile_repair()
                        checks.assert_not_called()
                    launch.assert_not_called()
                    cleanup.assert_called_once_with()

    def healthy_diagnostic(self):
        report = {'status': 'done', 'extended_status': 'done', 'errors': [], 'recoverable_errors': {}, 'stage': None}
        for name in ['init-local', 'init', 'modules-config', 'modules-final']:
            report[name] = {'errors': [], 'recoverable_errors': {}}
        raw = json.dumps(report).encode()
        return {'returnCode': 0, 'report': report, 'reportSha256': hashlib.sha256(raw).hexdigest()}, raw

    def test_only_fully_healthy_initialization_can_continue_automatically(self):
        diagnostic, raw = self.healthy_diagnostic()
        self.assertTrue(acceptance.initialization_is_healthy(diagnostic))
        for changed in [{'returnCode': 2}, {'report': {**diagnostic['report'], 'recoverable_errors': {'WARNING': ['warn']}}},
                        {'report': {**diagnostic['report'], 'status': 'running'}},
                        {'report': {**diagnostic['report'], 'init': {'errors': ['error'], 'recoverable_errors': {}}}}]:
            self.assertFalse(acceptance.initialization_is_healthy({**diagnostic, **changed}))

    def test_healthy_report_starts_build_without_waiting_and_cleans(self):
        diagnostic, raw = self.healthy_diagnostic()
        output = 'CLOUD_INIT_RETURN_CODE=0\nCLOUD_INIT_REPORT_BASE64=' + base64.b64encode(raw).decode() + '\nINITIALIZATION_REPORT_CAPTURED\n'
        state = {'status': 'prepared', 'attempt': 3, 'failures': []}
        with tempfile.TemporaryDirectory() as folder:
            session = unittest.mock.Mock(); session.logs = Path(folder)
            session.run.side_effect = [output, 'PILOT_SSM_BUILD_AND_CACHE_READY']
            script = '# ' + native.SOURCE + '\necho PILOT_SSM_BUILD_AND_CACHE_READY\n'
            with patch.object(stage, 'load', return_value=state), patch.object(stage, 'save'), \
                 patch.object(stage, 'launch'), patch.object(stage, 'cleanup') as cleanup, \
                 patch.object(native, 'reviewed_source'), patch.object(native, 'bootstrap', return_value=script), \
                 patch.object(native, 'Session', return_value=session), patch.object(acceptance, 'acceptance') as app_checks, \
                 patch.object(acceptance.time, 'sleep', side_effect=AssertionError('healthy init must not wait')):
                acceptance.run_diagnostic()
                app_checks.assert_called_once_with(session)
                cleanup.assert_called_once_with()

    def test_completion_scope_requires_explicit_approval_and_keeps_original_bound(self):
        with self.retry_fixture() as (old, approval, journal, grant, inventory):
            old.update(attempt=3, clientToken=stage.STAGE + '-three', originalDeadlineUtc=old['deadlineUtc'])
            approval.update(priorAttempt=3, proposedClientToken=stage.STAGE + '-four', maximumRuntimeHours=2,
                            reserveGrossUSDTotalAcrossAllAttempts=3)
            journal.write_text(json.dumps(old)); grant.write_text(json.dumps(approval))
            with patch.object(stage, 'COMPLETION_APPROVAL', grant):
                new = stage.prepare_completion()
            self.assertEqual(new['attempt'], 4)
            self.assertEqual(new['originalDeadlineUtc'], old['originalDeadlineUtc'])
            self.assertEqual(new['reserveGrossUSD'], old['reserveGrossUSD'])
            self.assertEqual(new['clientToken'], stage.STAGE + '-four')
            self.assertEqual(json.loads(Path(new['previousManifest']).read_text()), old)

    def test_unapproved_completion_and_fifth_target_are_refused(self):
        with self.retry_fixture() as (old, approval, journal, grant, inventory):
            old.update(attempt=3, clientToken=stage.STAGE + '-three', originalDeadlineUtc=old['deadlineUtc'])
            approval.update(approved=False, priorAttempt=3, proposedClientToken=stage.STAGE + '-four')
            journal.write_text(json.dumps(old)); grant.write_text(json.dumps(approval))
            with patch.object(stage, 'COMPLETION_APPROVAL', grant), self.assertRaises(AssertionError):
                stage.prepare_completion()
            inventory.assert_not_called()
        with self.assertRaises(AssertionError): stage.instance({**self.state, 'attempt': 5}, self.item)

    def diagnostic_inputs(self, old, approval):
        old.update(attempt=2, clientToken=stage.STAGE + '-two')
        approval.update(priorAttempt=2, proposedClientToken=stage.STAGE + '-three', maximumRuntimeHours=2,
                        reserveGrossUSDTotalAcrossAllAttempts=3,
                        continueStagingOnlyAfterSpecificInitializationIssueUnderstood=True)

    def test_diagnostic_scope_preserves_parent_and_enforces_shorter_deadline(self):
        with self.retry_fixture() as (old, approval, journal, grant, inventory):
            self.diagnostic_inputs(old, approval)
            journal.write_text(json.dumps(old)); grant.write_text(json.dumps(approval))
            with patch.object(stage, 'DIAGNOSTIC_APPROVAL', grant):
                new = stage.prepare_diagnostic()
            self.assertEqual(new['attempt'], 3)
            self.assertEqual(new['clientToken'], stage.STAGE + '-three')
            self.assertEqual(new['preparedAtUtc'], old['preparedAtUtc'])
            self.assertEqual(new['reserveGrossUSD'], 3)
            self.assertEqual(new['originalDeadlineUtc'], old['deadlineUtc'])
            self.assertLessEqual(dt.datetime.fromisoformat(new['deadlineUtc']),
                                 dt.datetime.fromisoformat(new['diagnosticPreparedAtUtc']) + dt.timedelta(hours=2))
            self.assertEqual(json.loads(Path(new['previousManifest']).read_text()), old)
            new['instanceId'] = 'i-diagnostic'
            item = {**self.item, 'InstanceId': 'i-diagnostic', 'ClientToken': new['clientToken']}
            stage.target(new, item)
            new['deadlineUtc'] = (stage.now() + dt.timedelta(hours=3)).isoformat()
            with self.assertRaises(AssertionError): stage.target(new, item)

    def test_diagnostic_refuses_missing_approval_or_larger_runtime(self):
        for key, value in [('approved', False), ('maximumRuntimeHours', 3), ('priorAttempt', 1)]:
            with self.subTest(key=key), self.retry_fixture() as (old, approval, journal, grant, inventory):
                self.diagnostic_inputs(old, approval); approval[key] = value
                journal.write_text(json.dumps(old)); grant.write_text(json.dumps(approval))
                with patch.object(stage, 'DIAGNOSTIC_APPROVAL', grant), self.assertRaises(AssertionError):
                    stage.prepare_diagnostic()
                inventory.assert_not_called()

    def test_fourth_instance_attempt_is_never_an_accepted_target(self):
        with self.assertRaises(AssertionError):
            stage.instance({**self.state, 'attempt': 4}, self.item)

    def diagnostic_output(self):
        raw = json.dumps({'status': 'done', 'errors': [], 'recoverable_errors': {'WARNING': ['synthetic']}}).encode()
        return 'CLOUD_INIT_RETURN_CODE=2\nCLOUD_INIT_REPORT_BASE64=' + base64.b64encode(raw).decode() + '\nINITIALIZATION_REPORT_CAPTURED\n'

    def test_initialization_report_is_exactly_bound_to_review(self):
        diagnostic = acceptance.parse_initialization(self.diagnostic_output())
        self.assertEqual(diagnostic['returnCode'], 2)
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            script = ('# ' + native.SOURCE + '\necho PILOT_SSM_BUILD_AND_CACHE_READY\n').encode()
            (directory / 'reviewed-bootstrap-1.sh').write_bytes(script)
            decision = {'action': 'continue', 'reason': 'Reviewed synthetic initialization evidence',
                        'cloudInitReportSha256': diagnostic['reportSha256'],
                        'bootstrapSha256': hashlib.sha256(script).hexdigest()}
            self.assertEqual(acceptance.reviewed_bootstrap(decision, diagnostic, directory, 1), script.decode())
            for key in ['cloudInitReportSha256', 'bootstrapSha256']:
                with self.subTest(key=key), self.assertRaises(AssertionError):
                    acceptance.reviewed_bootstrap({**decision, key: '0' * 64}, diagnostic, directory, 1)

    def test_diagnostic_review_timeout_always_cleans_without_acceptance(self):
        state = {'status': 'prepared', 'attempt': 3, 'failures': []}
        with tempfile.TemporaryDirectory() as folder:
            session = unittest.mock.Mock()
            session.logs = Path(folder)
            session.run.return_value = self.diagnostic_output()
            with patch.object(stage, 'load', return_value=state), patch.object(stage, 'save'), \
                 patch.object(stage, 'launch'), patch.object(stage, 'cleanup') as cleanup, \
                 patch.object(native, 'reviewed_source'), patch.object(native, 'Session', return_value=session), \
                 patch.object(acceptance, 'acceptance') as app_checks, \
                 patch.object(acceptance.time, 'monotonic', side_effect=[0, 301]):
                with self.assertRaisesRegex(AssertionError, 'review timed out'):
                    acceptance.run_diagnostic()
                cleanup.assert_called_once_with()
                app_checks.assert_not_called()

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

    def test_snapshot_size_and_encryption_apply_to_required_source_volume(self):
        grants = [s for s in policy.build()['Statement'] if s['Action'] == 'ec2:CreateSnapshot']
        source = next(s for s in grants if ':volume/' in s['Resource'])
        output = next(s for s in grants if ':snapshot/' in s['Resource'])
        self.assertEqual(source['Condition']['NumericEquals'], {'ec2:VolumeSize': '30'})
        self.assertEqual(source['Condition']['Bool'], {'ec2:Encrypted': 'true'})
        self.assertEqual(source['Condition']['StringEquals']['aws:ResourceTag/Role'], 'staging-root')
        self.assertNotIn('NumericEquals', output['Condition'])
        self.assertEqual(output['Condition']['StringEquals']['aws:RequestTag/Role'], 'synthetic-backup')
        for grant in grants:
            self.assertIn('DateLessThan', grant['Condition'])

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
