"""Synthetic native media/model/reboot checks; always clean ONLY the approved pilot."""
import json
from pathlib import Path
import subprocess
import time
import aws_native_pilot as pilot


def main():
    pilot.identity()
    state = json.loads(pilot.STATE.read_text())
    assert state['status'] == 'ready-for-synthetic-checks' and state['account'] == pilot.ACCOUNT
    instance = pilot.aws('describe-instances', '--instance-ids', state['instanceId'])['Reservations'][0]['Instances'][0]
    assert pilot.tagged(instance) and instance['ClientToken'] == pilot.PILOT
    assert instance['PublicIpAddress'] == state['publicIp'] and instance['InstanceType'] == 't4g.small'
    destination = 'ubuntu@' + state['publicIp']
    options = ['-i', str(pilot.BUNDLE / 'pilot-key'), '-o', 'BatchMode=yes',
        '-o', 'StrictHostKeyChecking=accept-new', '-o', 'UserKnownHostsFile=' + (pilot.BUNDLE / 'known_hosts').as_posix(),
        '-o', 'ConnectTimeout=8', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=4']

    def remote(script, label, timeout=600, required=True):
        result = subprocess.run(['ssh', *options, destination, 'bash -s'], input=script.encode('utf-8'),
                                capture_output=True, timeout=timeout)
        result.stdout = result.stdout.decode('utf-8', errors='replace')
        result.stderr = result.stderr.decode('utf-8', errors='replace')
        (pilot.BUNDLE / (label + '.log')).write_text(result.stdout + '\n' + result.stderr, encoding='utf-8')
        if required and result.returncode:
            raise RuntimeError('Native SSH step failed: ' + label + '; see private log')
        return result

    def wait_ssh():
        for _ in range(60):
            try:
                result = remote('true\n', 'ssh-ready', timeout=12, required=False)
                if result.returncode == 0:
                    return
            except subprocess.TimeoutExpired:
                pass
            time.sleep(5)
        raise RuntimeError('SSH readiness wait exceeded; do not weaken host-key or SG checks')

    test_script = '''set -euo pipefail
sudo systemctl is-active --quiet medipulse-native-pilot-expire.timer
test "$(uname -m)" = aarch64
sudo docker run --rm --pull=never --platform linux/arm64 --network none \\
  --memory 1280m --memory-swap 1280m --cpus 1.6 \\
  -e NODE_ENV=test -e REELS_REAL_MEDIA_TESTS=true \\
  -e REELS_EMBEDDING_CACHE_DIR=/models -e REELS_EMBEDDING_ALLOW_DOWNLOAD=false \\
  --mount type=bind,source=/srv/medipulse-native-pilot/models,target=/models,readonly \\
  --mount type=bind,source=/home/ubuntu/pilot/reel-real-media.test.js,target=/app/tests/reel-real-media.test.js,readonly \\
  --mount type=bind,source=/home/ubuntu/pilot/native-check.sh,target=/audit/native-check.sh,readonly \\
  --entrypoint /bin/sh medipulse-reels-arm-review:local /audit/native-check.sh
'''
    try:
        pilot.emit('waiting-for-pilot-ssh')
        wait_ssh()
        ready = remote('set -e\nsudo cloud-init status --wait\nsudo systemctl is-active --quiet medipulse-native-pilot-expire.timer\nuname -m\nmkdir -p /home/ubuntu/pilot\n', 'bootstrap', timeout=300)
        assert 'aarch64' in ready.stdout
        pilot.emit('pilot-timer-verified-installing-docker')
        remote('set -e\nexport DEBIAN_FRONTEND=noninteractive\nsudo -n apt-get update -qq\nsudo -n env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq docker.io\nsudo systemctl enable --now docker\nsudo install -d -m 0755 /srv/medipulse-native-pilot\n', 'docker-setup', timeout=1200)
        names = list(state['bundleHashes'])
        pilot.emit('uploading-private-synthetic-bundle', bytes=sum((pilot.BUNDLE / n).stat().st_size for n in names))
        transfer = subprocess.run(['scp', *options, *names, destination + ':/home/ubuntu/pilot/'],
            cwd=pilot.BUNDLE, capture_output=True, text=True, timeout=1800)
        (pilot.BUNDLE / 'upload.log').write_text(transfer.stdout + '\n' + transfer.stderr, encoding='utf-8')
        assert transfer.returncode == 0, 'Upload failed; do not loosen authentication'
        checks = ''.join(digest + '  ' + name + '\n' for name, digest in state['bundleHashes'].items())
        remote("set -e\ncd /home/ubuntu/pilot\nsha256sum -c <<'PILOT_HASHES'\n" + checks + 'PILOT_HASHES\nsudo tar -xzf models.tar.gz -C /srv/medipulse-native-pilot\nsudo docker load --input arm-image.tar.gz\n', 'bundle-load', timeout=1200)
        model_paths = ['/srv/medipulse-native-pilot/models/' + pilot.MODEL + '/' + name for name in pilot.MODEL_FILES]
        model_cmd = 'sha256sum ' + ' '.join(model_paths) + '\n'
        before = remote(model_cmd, 'models-before').stdout
        for name, digest in state['modelHashes'].items():
            assert digest + '  /srv/medipulse-native-pilot/models/' + pilot.MODEL + '/' + name in before
        pilot.emit('running-native-offline-media-and-model-checks')
        first = remote(test_script, 'native-check-before-reboot', timeout=420)
        assert 'pass 2' in first.stdout and 'fail 0' in first.stdout and 'skipped 0' in first.stdout
        pilot.emit('native-checks-passed-rebooting-for-persistence')
        boot_before = remote('cat /proc/sys/kernel/random/boot_id\n', 'boot-before').stdout.strip()
        pilot.aws('reboot-instances', '--instance-ids', state['instanceId'])
        time.sleep(15)
        wait_ssh()
        for _ in range(24):
            boot_after = remote('cat /proc/sys/kernel/random/boot_id\n', 'boot-after').stdout.strip()
            if boot_after != boot_before:
                break
            time.sleep(5)
        assert boot_after != boot_before, 'Reboot not actually observed'
        assert remote(model_cmd, 'models-after').stdout == before, 'Pinned model files changed across reboot'
        second = remote(test_script, 'native-check-after-reboot', timeout=420)
        assert 'pass 2' in second.stdout and 'fail 0' in second.stdout and 'skipped 0' in second.stdout
        state.update(nativeMediaModelBeforeRebootPassed=2, nativeMediaModelAfterRebootPassed=2,
                     pinnedModelFingerprintsPersisted=True, rebootObserved=True,
                     sharedJobFinderApiCapacityVerified=False, status='native-checks-passed')
        pilot.save(state)
        pilot.emit('native-and-reboot-checks-passed', before=2, after=2, productionAcceptance=False)
    finally:
        pilot.cleanup()


if __name__ == '__main__':
    main()
