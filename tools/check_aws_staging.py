"""Approved disposable staging acceptance; finally removes only its new resources."""
import argparse
import base64
import gzip
import hashlib
import json
import re
import shlex
import subprocess
import time
import aws_native_pilot as api
import aws_ssm_preflight as preflight
import aws_staging as stage
import check_native_ssm as native

CAPACITY_SUFFIX = hashlib.sha256(stage.STAGE.encode()).hexdigest()[:16]
REDIS_CONTAINER = 'capacity-redis-' + CAPACITY_SUFFIX


def capacity_environment():
    return {
        'DATABASE_URL': 'mongodb://mongo:27017/medipulse_test_capacity_' + CAPACITY_SUFFIX + '?replicaSet=rs0&directConnection=true',
        'REDIS_URL': 'redis://' + REDIS_CONTAINER + ':6379/15',
        'CAPACITY_VIDEO_SECONDS': '299',
    }


def capacity_env_script():
    values = [shlex.quote(key + '=' + value) for key, value in capacity_environment().items()]
    return r"printf '%s\n' " + ' '.join(values) + ' >' + stage.ROOT + '/capacity.env'


def adapt(script):
    return script.replace(native.ROOT, stage.ROOT).replace('medipulse-native-pilot-expire.timer', 'medipulse-staging-expire.timer')


def overlay(name, destination):
    data = subprocess.check_output(['git', 'show', 'HEAD:' + name], cwd=api.REPO)
    encoded = base64.b64encode(gzip.compress(data)).decode()
    assert destination.startswith(stage.ROOT + '/') and '..' not in destination
    return "printf %s " + shlex.quote(encoded) + ' | base64 -d | gzip -d >' + shlex.quote(destination) + '\n'


def services():
    return '''install -d -m 0755 /srv/medipulse-staging/logs /srv/medipulse-staging/mongo /srv/medipulse-staging/redis /srv/medipulse-staging/capacity-media
chown 1000:1000 /srv/medipulse-staging/capacity-media
test "$(df --output=avail -B1 /srv/medipulse-staging | tail -n 1)" -gt 10737418240
docker pull --quiet mongo:7 >/dev/null
docker pull --quiet redis:7-alpine >/dev/null
docker network create --internal ''' + stage.STAGE + ''' >/dev/null
docker run -d --name medipulse-staging-mongo --network ''' + stage.STAGE + ''' --network-alias mongo \\
 --memory 384m --memory-swap 384m --cpus .35 \\
 --mount type=bind,source=/srv/medipulse-staging/mongo,target=/data/db \\
 mongo:7 --replSet rs0 --bind_ip_all --wiredTigerCacheSizeGB .25 >/dev/null
docker run -d --name ''' + REDIS_CONTAINER + ''' --network ''' + stage.STAGE + ''' --network-alias redis \\
 --memory 64m --memory-swap 64m --cpus .1 \\
 --mount type=bind,source=/srv/medipulse-staging/redis,target=/data \\
 redis:7-alpine redis-server --appendonly yes --appendfsync everysec --maxmemory 32mb --maxmemory-policy noeviction >/dev/null
for attempt in $(seq 1 40); do
 if docker exec medipulse-staging-mongo mongosh --quiet --eval 'db.adminCommand({ping:1}).ok' >/dev/null 2>&1; then break; fi
 sleep 2
done
docker exec medipulse-staging-mongo mongosh --quiet --eval 'rs.initiate({_id:"rs0",members:[{_id:0,host:"mongo:27017"}]})' >/dev/null
for attempt in $(seq 1 40); do
 if docker exec medipulse-staging-mongo mongosh --quiet --eval 'if (!db.hello().isWritablePrimary) quit(1)' >/dev/null 2>&1; then break; fi
 sleep 2
done
docker exec medipulse-staging-mongo mongosh --quiet --eval 'if (!db.hello().isWritablePrimary) quit(1)'
test "$(docker exec ''' + REDIS_CONTAINER + ''' redis-cli ping)" = PONG
docker image inspect medipulse-reels-arm-review:local --format '{{.Id}}'
echo STAGING_ISOLATED_SERVICES_READY
'''


def container(command, capacity=False, shell=False):
    extra = ''
    if capacity:
        extra = ' --mount type=bind,source=' + stage.ROOT + '/capacity-check.mjs,target=/audit/capacity.mjs,readonly --mount type=bind,source=' + stage.ROOT + '/capacity-media,target=/tmp/reels-capacity'
    return 'docker run --rm --pull=never --network ' + stage.STAGE + ''' \\
 --memory 1280m --memory-swap 1280m --cpus 1.6 \\
 -e NODE_ENV=test -e MAIL_DELIVERY=disabled -e USE_REAL_REDIS=true \\
 -e TEST_DATABASE_URL='mongodb://mongo:27017/medipulse_test_aws_staging?replicaSet=rs0&directConnection=true' \\
 -e TEST_REDIS_URL=redis://redis:6379/15 \\
 -e REELS_REAL_MEDIA_TESTS=true \\
 -e REELS_EMBEDDING_ALLOW_DOWNLOAD=false -e REELS_EMBEDDING_CACHE_DIR=/models \\
 --mount type=bind,source=''' + stage.ROOT + '''/models,target=/models,readonly \\
 --mount type=bind,source=''' + stage.ROOT + '''/source/backend/tests,target=/app/tests,readonly \\
 --mount type=bind,source=''' + stage.ROOT + '''/source/frontend,target=/frontend,readonly \\
 --mount type=bind,source=''' + stage.ROOT + '''/source/backend/scripts/testIntegration.js,target=/app/scripts/testIntegration.js,readonly''' + extra + (' --env-file ' + stage.ROOT + '/capacity.env' if capacity else '') + ' --entrypoint ' + ('/bin/sh ' if shell else 'node ') + api.IMAGE + ' ' + ('-c ' + shlex.quote(command) if shell else command)


def logged(command, name):
    log = stage.ROOT + '/logs/' + name + '.log'
    return 'result=0\n' + command + ' >' + log + ' 2>&1 || result=$?\ntail -n 14 ' + log + '\nif test "$result" -ne 0; then tail -n 65 ' + log + '; fi\nexit "$result"\n'


def summary(output):
    counts = {}
    for label in ['tests', 'pass', 'fail', 'skipped']:
        match = re.search(r'\b' + label + r' (\d+)\b', output)
        assert match, 'Actual test totals absent: ' + label
        counts[label] = int(match[1])
    assert counts['tests'] > 0 and counts['fail'] == 0
    return counts


def snapshot_restore(session):
    # Quiesce only this host's synthetic DB/cache before taking an app-consistent
    # fixture snapshot; OS root recovery still uses its normal filesystem journal.
    script = '''docker exec medipulse-staging-mongo mongosh --quiet --eval 'db.getSiblingDB("medipulse_test_restore").proof.updateOne({_id:"scope"},{$set:{kind:"synthetic-only"}},{upsert:true})' >/dev/null
docker exec ''' + REDIS_CONTAINER + ''' redis-cli -n 14 SET medipulse-staging-restore-proof synthetic-only >/dev/null
docker stop medipulse-staging-mongo ''' + REDIS_CONTAINER + ''' >/dev/null
sync
find /srv/medipulse-staging/models /srv/medipulse-staging/reels /srv/medipulse-staging/mongo /srv/medipulse-staging/redis -type f -print0 | sort -z | xargs -0 sha256sum >/srv/medipulse-staging/backup.sha256
echo STAGING_WRITES_QUIESCED
'''
    assert 'STAGING_WRITES_QUIESCED' in session.run(script, 'quiesce-synthetic-backup', 180)
    state = stage.load(); root = api.aws('describe-volumes', '--volume-ids', state['volumeId'])['Volumes'][0]
    stage.volume(root, 'staging-root'); assert not stage.find('describe-snapshots', 'Snapshots')
    # Preflight both source and output resource authorization without a purchase.
    assert api.aws('create-snapshot', '--volume-id', state['volumeId'], '--description', 'Approved synthetic staging recovery rehearsal',
                   '--tag-specifications', stage.tags('snapshot', 'synthetic-backup'), dry=True) == 'DryRunOperation'
    result = api.aws('create-snapshot', '--volume-id', state['volumeId'], '--description', 'Approved synthetic staging recovery rehearsal',
                     '--tag-specifications', stage.tags('snapshot', 'synthetic-backup'))
    state['snapshotId'] = result['SnapshotId']; stage.save(state)
    deadline = time.monotonic() + 1200
    while time.monotonic() < deadline:
        item = api.aws('describe-snapshots', '--snapshot-ids', state['snapshotId'])['Snapshots'][0]
        stage.own(item, 'synthetic-backup'); assert item['VolumeId'] == state['volumeId'] and item['VolumeSize'] == 30 and item['Encrypted']
        if item['State'] == 'completed': break
        assert item['State'] == 'pending'; time.sleep(10)
    assert item['State'] == 'completed', 'Bounded snapshot completion timeout'
    assert not [v for v in stage.find('describe-volumes', 'Volumes') if v['VolumeId'] != state['volumeId']]
    args = ['--snapshot-id', state['snapshotId'], '--availability-zone', state['availabilityZone'], '--size', '30',
            '--volume-type', 'gp3', '--iops', '3000', '--throughput', '125', '--encrypted',
            '--client-token', stage.STAGE + '-restore-one', '--tag-specifications', stage.tags('volume', 'restore')]
    assert api.aws('create-volume', *args, dry=True) == 'DryRunOperation'
    v = api.aws('create-volume', *args); stage.volume(v, 'restore')
    state.update(restoreVolumeId=v['VolumeId'], restoreCreatedAtUtc=stage.now().isoformat()); stage.save(state)
    for _ in range(60):
        v = api.aws('describe-volumes', '--volume-ids', state['restoreVolumeId'])['Volumes'][0]
        if v['State'] == 'available': break
        time.sleep(3)
    assert v['State'] == 'available'
    assert v['SnapshotId'] == state['snapshotId'] and not v['Attachments'] and v['VolumeId'] != state['volumeId']
    api.aws('attach-volume', '--volume-id', v['VolumeId'], '--instance-id', state['instanceId'], '--device', '/dev/sdf')
    serial = v['VolumeId'].replace('-', '')
    script = '''device=/dev/disk/by-id/nvme-Amazon_Elastic_Block_Store_''' + serial + '''
for attempt in $(seq 1 40); do test ! -b "$device-part1" || break; sleep 2; done
test -b "$device-part1"
test "$(lsblk -dn -o SERIAL "$device" | tr -d ' ')" = ''' + shlex.quote(serial) + '''
install -d -m 0755 /mnt/medipulse-staging-restore
mount -o ro,noload "$device-part1" /mnt/medipulse-staging-restore
sed 's#  /srv/medipulse-staging/#  /mnt/medipulse-staging-restore/srv/medipulse-staging/#' /mnt/medipulse-staging-restore/srv/medipulse-staging/backup.sha256 | sha256sum -c - >/srv/medipulse-staging/logs/restore-hashes.log
echo STAGING_RESTORED_ALL_FIXTURE_HASHES_MATCH
'''
    assert 'STAGING_RESTORED_ALL_FIXTURE_HASHES_MATCH' in session.run(script, 'mount-and-verify-restore', 240)
    restored = '/mnt/medipulse-staging-restore' + stage.ROOT
    session.run('docker run --rm --pull=never --network none --mount type=bind,source=' + restored + '/reels,target=/persist,readonly --entrypoint /usr/bin/ffprobe ' + api.IMAGE + ' -v error -show_entries format=duration -of json "$(cat ' + restored + '/reels/master-path.txt)"', 'restored-hls-decode', 60)
    # Native model test uses the restored cache read-only, never an online fallback.
    restored_native = adapt(native.native_script()).replace('source=' + stage.ROOT + '/models,', 'source=' + restored + '/models,')
    counts = summary(session.run(restored_native, 'restored-offline-model-and-media', 420)); assert counts['pass'] == 2 and counts['skipped'] == 0
    script = '''cp -a ''' + restored + '''/mongo /srv/medipulse-staging/restore-check-mongo
cp -a ''' + restored + '''/redis /srv/medipulse-staging/restore-check-redis
docker run -d --name medipulse-restored-mongo --network none --memory 384m --memory-swap 384m --mount type=bind,source=/srv/medipulse-staging/restore-check-mongo,target=/data/db mongo:7 --bind_ip_all --wiredTigerCacheSizeGB .25 >/dev/null
docker run -d --name medipulse-restored-redis --network none --memory 64m --memory-swap 64m --mount type=bind,source=/srv/medipulse-staging/restore-check-redis,target=/data redis:7-alpine redis-server --appendonly yes >/dev/null
for attempt in $(seq 1 40); do
 if docker exec medipulse-restored-mongo mongosh --quiet --eval 'if (db.getSiblingDB("medipulse_test_restore").proof.findOne({_id:"scope"})?.kind !== "synthetic-only") quit(1)' >/dev/null 2>&1; then break; fi
 sleep 2
done
docker exec medipulse-restored-mongo mongosh --quiet --eval 'if (db.getSiblingDB("medipulse_test_restore").proof.findOne({_id:"scope"})?.kind !== "synthetic-only") quit(1)'
test "$(docker exec medipulse-restored-redis redis-cli -n 14 GET medipulse-staging-restore-proof)" = synthetic-only
docker stop medipulse-restored-mongo medipulse-restored-redis >/dev/null
umount /mnt/medipulse-staging-restore
echo STAGING_RESTORED_MONGO_AND_REDIS_PROOFS_PASS
'''
    assert 'STAGING_RESTORED_MONGO_AND_REDIS_PROOFS_PASS' in session.run(script, 'restore-db-and-cache-proofs', 240)
    stage.remove_restore(stage.load())
    state = stage.load(); state.update(snapshotRestorePassed=True, restoredHlsDecodePassed=True,
                                      restoredModelTests=counts, restoredMongoAndRedisProofs=True)
    stage.save(state)


def run():
    state = stage.load(); assert state['status'] == 'prepared'
    native.reviewed_source()  # Refuse source drift before creating paid resources.
    try:
        stage.launch()
        session = native.Session(stage.STATE, stage.LOGS, stage.target)
        session.verify(); session.online()
        api.emit('staging-native-build-started')
        script = adapt(native.bootstrap(state))
        assert 'PILOT_SSM_BUILD_AND_CACHE_READY' in session.run(script, 'staging-build', 1200)
        script = 'cd ' + stage.ROOT + '/source\ngit sparse-checkout set backend frontend/src/utils\n'
        for name in ['backend/scripts/testIntegration.js', 'backend/tests/integration/reels.test.js', 'backend/tests/integration/reels-lifecycle.test.js']:
            script += overlay(name, stage.ROOT + '/source/' + name)
        session.run(script, 'reviewed-test-overlays', 60)
        session.run(overlay('tools/reels_capacity_check.mjs', stage.ROOT + '/capacity-check.mjs'), 'capacity-runner-overlay', 60)
        assert 'STAGING_ISOLATED_SERVICES_READY' in session.run(services(), 'isolated-mongo-redis', 480)
        pressure_before = session.run("grep '^oom_kill ' /proc/vmstat\ndf -PB1 " + stage.ROOT + "\ncat /proc/pressure/memory\ndocker image inspect " + api.IMAGE + " --format '{{.Id}}'", 'host-before-load', 30)
        media = summary(session.run(adapt(native.native_script()), 'staging-real-media-model', 420))
        assert media['pass'] == 2 and media['skipped'] == 0
        units = summary(session.run(logged(container('node --import ./tests/bootstrap.js --test --test-reporter=tap --test-concurrency=1 tests/*.test.js', shell=True), 'backend-units'), 'backend-unit-checks', 600))
        integration = summary(session.run(logged(container('scripts/testIntegration.js'), 'backend-integrations'), 'backend-integration-checks', 1200))
        session.run(capacity_env_script(), 'synthetic-capacity-targets', 30)
        output = session.run(logged(container('--expose-gc /audit/capacity.mjs', capacity=True), 'long-video-capacity'), 'long-video-full-api-capacity', 1200)
        result = next(json.loads(line) for line in output.splitlines() if line.startswith('{') and '"scenario"' in line)
        assert result['videoSeconds'] == 299 and result['httpSamples'] > 0 and result['httpFailures'] == 0
        result['executionContext'] = 'Native AWS ARM64 synthetic staging; Mongo sidecar shares host memory unlike production Atlas'
        result['sourceHarnessLimitations'] = result['limitations']
        result['limitations'] = 'Single synthetic long video/light API load on burst credits; Mongo shares host RAM; no Caddy/TLS, external login/payment/device or sustained production acceptance'
        pressure_after = session.run("grep '^oom_kill ' /proc/vmstat\ndf -PB1 " + stage.ROOT + "\ncat /proc/pressure/memory", 'host-after-load', 30)
        assert re.search(r'oom_kill (\d+)', pressure_before)[1] == re.search(r'oom_kill (\d+)', pressure_after)[1], 'Host OOM occurred during acceptance'
        session.run(adapt(native.persist_fixture()), 'persistent-backup-media', 180)
        state = stage.load(); state.update(nativeTests=media, backendUnits=units, backendIntegrations=integration,
                                           longVideoCapacity=result, hostOomDuringLoad=False,
                                           backendImageId=re.search(r'sha256:[a-f0-9]{64}', pressure_before)[0]); stage.save(state)
        snapshot_restore(session)
        state = stage.load(); state.update(status='tested', stagingAcceptance=True, productionAcceptance=False); stage.save(state)
        api.emit('staging-checks-passed', backendUnitTests=units['pass'], integrationTests=integration['pass'],
                 longVideoSeconds=299, backupRestore=True, productionAcceptance=False)
    except BaseException as error:
        state = stage.load(); state.setdefault('failures', []).append(type(error).__name__ + ': ' + str(error)); stage.save(state)
        raise
    finally:
        stage.cleanup()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-approved', action='store_true')
    parser.add_argument('--cleanup', action='store_true')
    args = parser.parse_args()
    if args.cleanup:
        stage.cleanup(); return
    # Diagnose the local fixed deadline before contacting expired IAM grants.
    # Cleanup deliberately bypasses this gate so old resources remain removable.
    if stage.STATE.exists():
        stage.require_open_window(stage.load())
    preflight.main()
    state = stage.prepare()
    if not args.run_approved:
        vpc, _ = stage.network()
        result = api.aws('create-security-group', '--group-name', stage.STAGE, '--description', 'Approved isolated staging',
                         '--vpc-id', vpc, '--tag-specifications', stage.tags('security-group', 'staging-network'), dry=True)
        api.emit('staging-readiness', scopeApproved=True, groupCreationDryRun=result, paidResourcesCreated=False)
        return
    run()


if __name__ == '__main__':
    main()
