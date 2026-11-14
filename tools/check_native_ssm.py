"""Approved synthetic native checks over SSM. No inbound ports or production secrets."""
import argparse
import base64
import datetime as dt
import json
import re
import shlex
import subprocess
import time
import uuid
import aws_native_pilot as pilot
import aws_ssm_preflight as preflight

SOURCE = 'dfa1c8489f624ce3f5351ad9a9e00c5e89027b24'
ROOT = '/srv/medipulse-native-pilot'


def target(state, instance):
    assert state['account'] == pilot.ACCOUNT and state['transport'] == 'ssm'
    assert instance['InstanceId'] == state['instanceId'] != 'i-07b4f6961dc550de0'
    assert pilot.tagged(instance) and instance['InstanceType'] == 't4g.small'
    assert instance['ClientToken'] == state['clientToken'] == pilot.PILOT + '-ssm1'
    tags = {item['Key']: item['Value'] for item in instance['Tags']}
    assert tags['DataClass'] == 'synthetic-only'
    assert instance['IamInstanceProfile']['Arn'] == 'arn:aws:iam::' + pilot.ACCOUNT + ':instance-profile/' + preflight.ROLE
    assert instance['State']['Name'] == 'running'
    assert dt.datetime.fromisoformat(state['deadlineUtc']) > dt.datetime.now(dt.timezone.utc)


class Session:
    def __init__(self, state_path=None, logs_path=None, validator=None):
        self.state_path = state_path or pilot.STATE
        self.state = json.loads(self.state_path.read_text(encoding='utf-8'))
        self.validator = validator or target
        self.logs = logs_path or pilot.PRIVATE / 'native-ssm-logs'
        self.logs.mkdir(exist_ok=True)

    def save(self, state):
        state['updatedAtUtc'] = dt.datetime.now(dt.timezone.utc).isoformat()
        self.state_path.write_text(json.dumps(state, indent=2) + '\n', encoding='utf-8')

    def verify(self):
        self.state = json.loads(self.state_path.read_text(encoding='utf-8'))
        pilot.identity()
        instance = pilot.aws('describe-instances', '--instance-ids', self.state['instanceId'])['Reservations'][0]['Instances'][0]
        self.validator(self.state, instance)

    def online(self):
        deadline = time.monotonic() + 300
        while time.monotonic() < deadline:
            rows = preflight.read('ssm', 'describe-instance-information', '--filters', json.dumps([
                {'Key': 'InstanceIds', 'Values': [self.state['instanceId']]}]))['InstanceInformationList']
            if any(row['InstanceId'] == self.state['instanceId'] and row['PingStatus'] == 'Online' for row in rows):
                return
            time.sleep(5)
        raise RuntimeError('SSM registration timeout; do not relax IAM or touch another instance')

    def run(self, script, label, timeout=600):
        assert re.fullmatch('[a-z0-9-]+', label) and 10 <= timeout <= 1200
        self.verify()
        payload = {'InstanceIds': [self.state['instanceId']], 'DocumentName': 'AWS-RunShellScript',
                   'DocumentVersion': '1', 'TimeoutSeconds': 120, 'MaxConcurrency': '1', 'MaxErrors': '0',
                   'CloudWatchOutputConfig': {'CloudWatchOutputEnabled': False},
                   'Parameters': {'commands': ['/bin/bash -c ' + shlex.quote('set -euo pipefail\n' + script)],
                                  'executionTimeout': [str(timeout)]}}
        encoded = json.dumps(payload)
        assert len(encoded.encode()) < 24000, 'Do not send oversized or credential-bearing artifacts'
        file = self.logs / (label + '-' + uuid.uuid4().hex + '.request.json')
        file.write_text(encoded, encoding='utf-8')
        result = preflight.read('ssm', 'send-command', '--cli-input-json', 'file://' + str(file))
        command_id = result['Command']['CommandId']
        state = json.loads(self.state_path.read_text(encoding='utf-8'))
        state.setdefault('ssmCommands', []).append({'label': label, 'commandId': command_id})
        self.save(state)
        deadline = time.monotonic() + timeout + 90
        last_update = 0
        while time.monotonic() < deadline:
            try:
                invocation = preflight.read('ssm', 'get-command-invocation', '--command-id', command_id,
                                            '--instance-id', self.state['instanceId'])
            except RuntimeError as error:
                if 'InvocationDoesNotExist' not in str(error):
                    raise
                time.sleep(3)
                continue
            status = invocation['Status']
            if status in ['Success', 'Failed', 'TimedOut', 'Cancelled', 'Undeliverable', 'Terminated']:
                (self.logs / (label + '.result.json')).write_text(json.dumps(invocation), encoding='utf-8')
                assert status == 'Success' and invocation['ResponseCode'] == 0, label + ': ' + status + '; private result retained'
                return invocation.get('StandardOutputContent', '')
            if time.monotonic() - last_update >= 40:
                pilot.emit('ssm-command-running', step=label, status=status)
                last_update = time.monotonic()
            time.sleep(4)
        raise RuntimeError(label + ': bounded command poll timeout')


def reviewed_source():
    paths = ['backend', 'frontend/src/utils', 'tools/reels_capacity_check.mjs']
    result = subprocess.run(['git', 'diff', '--quiet', SOURCE, 'HEAD', '--', *paths],
                            cwd=pilot.REPO, capture_output=True)
    if result.returncode:
        raise RuntimeError('Pinned application source differs from the reviewed candidate; update the immutable source before launching')
    manifest = json.loads(subprocess.check_output(['git', 'show', SOURCE + ':backend/package.json'], cwd=pilot.REPO))
    lock = json.loads(subprocess.check_output(['git', 'show', SOURCE + ':backend/package-lock.json'], cwd=pilot.REPO))
    assert manifest['dependencies'] == lock['packages']['']['dependencies'], 'Pinned manifest and lock differ'


def bootstrap(state):
    reviewed_source()
    q = shlex.quote
    script = '''test "$(uname -m)" = aarch64
systemctl is-active --quiet medipulse-native-pilot-expire.timer
cloud-init status --wait
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq >/tmp/pilot-install.log 2>&1
apt-get install -y -qq docker.io git ca-certificates curl >>/tmp/pilot-install.log 2>&1
systemctl enable --now docker
install -d -m 0755 /srv/medipulse-native-pilot
cd /srv/medipulse-native-pilot
git init -q source
cd source
git remote add origin https://github.com/khushalmidha/MediPulse.git
git fetch -q --depth=1 --filter=blob:none origin ''' + SOURCE + '''
git sparse-checkout init --cone
git sparse-checkout set backend
git checkout -q ''' + SOURCE + '\n'
    # Fetch the coherent manifest/lock from the immutable release together.
    # Embedding a full npm lock into SSM commands exceeds the transport size cap.
    script += 'docker build --quiet -t ' + q(pilot.IMAGE) + ' backend >/srv/medipulse-native-pilot/build.log 2>&1 || { tail -n 40 /srv/medipulse-native-pilot/build.log; exit 1; }\n'
    model_repo, revision = pilot.MODEL.rsplit('/', 1)
    for name, digest in state['modelHashes'].items():
        path = ROOT + '/models/' + pilot.MODEL + '/' + name
        script += 'install -d -m 0755 ' + q(path.rsplit('/', 1)[0]) + '\n'
        script += 'curl --fail --silent --show-error --location --proto =https --tlsv1.2 ' + q('https://huggingface.co/' + model_repo + '/resolve/' + revision + '/' + name) + ' -o ' + q(path) + '\n'
        script += "printf '%s\\n' " + q(digest + '  ' + path) + ' | sha256sum -c -\n'
    script += '''find /srv/medipulse-native-pilot/models -type f -print0 | sort -z | xargs -0 sha256sum >/srv/medipulse-native-pilot/models.sha256
install -d -m 0755 -o 1000 -g 1000 /srv/medipulse-native-pilot/reels
printf 'node --test --test-concurrency=1 /app/tests/reel-real-media.test.js\nresult=$?\nprintf PILOT_MEMORY_PEAK_BYTES=\ncat /sys/fs/cgroup/memory.peak\nexit "$result"\n' >/srv/medipulse-native-pilot/native-check.sh
echo PILOT_SSM_BUILD_AND_CACHE_READY
'''
    return script


def native_script():
    return '''systemctl is-active --quiet medipulse-native-pilot-expire.timer
test "$(uname -m)" = aarch64
docker run --rm --pull=never --platform linux/arm64 --network none \\
 --memory 1280m --memory-swap 1280m --cpus 1.6 \\
 -e NODE_ENV=test -e REELS_REAL_MEDIA_TESTS=true \\
 -e REELS_EMBEDDING_CACHE_DIR=/models -e REELS_EMBEDDING_ALLOW_DOWNLOAD=false \\
 --mount type=bind,source=/srv/medipulse-native-pilot/models,target=/models,readonly \\
 --mount type=bind,source=/srv/medipulse-native-pilot/source/backend/tests/reel-real-media.test.js,target=/app/tests/reel-real-media.test.js,readonly \\
 --mount type=bind,source=/srv/medipulse-native-pilot/native-check.sh,target=/audit/native-check.sh,readonly \\
 --entrypoint /bin/sh medipulse-reels-arm-review:local /audit/native-check.sh
'''


def persist_fixture():
    return '''docker run --rm -i --pull=never --network none --memory 1280m --memory-swap 1280m --cpus 1.6 \\
 -e NODE_ENV=test -e REELS_MEDIA_ROOT=/persist \\
 --mount type=bind,source=/srv/medipulse-native-pilot/reels,target=/persist \\
 --entrypoint node medipulse-reels-arm-review:local --input-type=module <<'PILOT_NODE'
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { processVideo } from './services/reelMedia.js';
const id='e'.repeat(24), dir='/persist/'+id+'/originals';
await fs.mkdir(dir,{recursive:true});
const source=dir+'/short.mp4';
const result=spawnSync('/usr/bin/ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=teal:s=360x640:r=1','-t','2','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p',source],{timeout:60000});
assert.equal(result.status,0);
const output=await processVideo(id,source,.5);
await fs.writeFile('/persist/master-path.txt',output.outputDirectory+'/master.m3u8');
console.log('PILOT_PERSISTENT_HLS_CREATED');
PILOT_NODE
find /srv/medipulse-native-pilot/reels -type f -print0 | sort -z | xargs -0 sha256sum >/srv/medipulse-native-pilot/reels.sha256
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-approved', action='store_true')
    args = parser.parse_args()
    preflight.main()
    if not args.run_approved:
        return
    state = json.loads(pilot.STATE.read_text())
    assert state['status'] == 'prepared' and state['transport'] == 'ssm'
    assert state['clientToken'] == pilot.PILOT + '-ssm1' and state['totalPilotReserveUSD'] == 1
    try:
        pilot.launch()
        session = Session()
        session.verify()
        pilot.emit('waiting-for-ssm-agent-no-inbound-ports')
        session.online()
        pilot.emit('ssm-online-building-native-backend')
        output = session.run(bootstrap(state), 'bootstrap-and-build', 1200)
        assert 'PILOT_SSM_BUILD_AND_CACHE_READY' in output
        first = session.run(native_script(), 'native-before-reboot', 420)
        assert 'pass 2' in first and 'fail 0' in first and 'skipped 0' in first
        assert 'PILOT_PERSISTENT_HLS_CREATED' in session.run(persist_fixture(), 'persistent-hls-fixture', 180)
        boot_before = session.run('cat /proc/sys/kernel/random/boot_id', 'boot-before').strip()
        pilot.emit('native-passed-rebooting-to-verify-model-and-video-persistence')
        pilot.aws('reboot-instances', '--instance-ids', session.state['instanceId'])
        time.sleep(15)
        session.online()
        boot_after = session.run('cat /proc/sys/kernel/random/boot_id', 'boot-after').strip()
        assert boot_before != boot_after, 'Actual reboot not observed'
        session.run('sha256sum -c ' + ROOT + '/models.sha256\nsha256sum -c ' + ROOT + '/reels.sha256', 'persistence-hashes')
        master = '$(cat ' + ROOT + '/reels/master-path.txt)'
        session.run('docker run --rm --pull=never --network none --memory 128m --memory-swap 128m --mount type=bind,source=' + ROOT + '/reels,target=/persist,readonly --entrypoint /usr/bin/ffprobe ' + pilot.IMAGE + ' -v error -show_entries format=duration -of json "' + master + '"', 'persistent-hls-probe')
        second = session.run(native_script(), 'native-after-reboot', 420)
        assert 'pass 2' in second and 'fail 0' in second and 'skipped 0' in second
        latest = json.loads(pilot.STATE.read_text())
        latest.update(nativeChecksCompleted=True, nativeMediaModelBeforeRebootPassed=2,
                      nativeMediaModelAfterRebootPassed=2, rebootObserved=True,
                      pinnedModelFingerprintsPersisted=True, processedHlsFingerprintsPersisted=True,
                      processedHlsProbeAfterRebootPassed=True, status='native-checks-passed')
        pilot.save(latest)
        pilot.emit('native-ssm-and-real-video-persistence-passed', before=2, after=2, productionAcceptance=False)
    except BaseException as error:
        latest = json.loads(pilot.STATE.read_text())
        latest.update(nativeChecksCompleted=False, nativeChecksFailure=type(error).__name__ + ': ' + str(error))
        pilot.save(latest)
        raise
    finally:
        pilot.cleanup()


if __name__ == '__main__':
    main()
