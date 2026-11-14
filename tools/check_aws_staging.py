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
 --memory 384m --memory-swap 384m --cpus .35 --ulimit nofile=65536:65536 \\
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
    return 'result=0\n' + command + ' >' + log + ' 2>&1 || result=$?\ntail -n 14 ' + log + '\nif test "$result" -ne 0; then tail -n 65 ' + log + '; fi\ngrep -E "(tests|pass|fail|skipped) [0-9]+$" ' + log + ' | tail -n 4 || true\nexit "$result"\n'


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
docker run -d --name medipulse-restored-mongo --network none --memory 384m --memory-swap 384m --ulimit nofile=65536:65536 --mount type=bind,source=/srv/medipulse-staging/restore-check-mongo,target=/data/db mongo:7 --bind_ip_all --wiredTigerCacheSizeGB .25 >/dev/null
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


def acceptance(session, reuse_services=False):
    script = 'cd ' + stage.ROOT + '/source\ngit sparse-checkout set backend frontend/src/utils\n'
    for name in ['backend/scripts/testIntegration.js', 'backend/tests/integration/reels.test.js', 'backend/tests/integration/reels-lifecycle.test.js']:
        script += overlay(name, stage.ROOT + '/source/' + name)
    session.run(script, 'reviewed-test-overlays', 60)
    session.run(overlay('tools/reels_capacity_check.mjs', stage.ROOT + '/capacity-check.mjs'), 'capacity-runner-overlay', 60)
    if reuse_services:
        ready = "test \"$(docker network inspect --format '{{.Internal}}' " + stage.STAGE + ")\" = true\n"
        ready += "test \"$(docker inspect medipulse-staging-mongo --format '{{.State.Running}}')\" = true\n"
        ready += "test \"$(docker exec " + REDIS_CONTAINER + " redis-cli ping)\" = PONG\necho STAGING_ISOLATED_SERVICES_READY\n"
    else:
        ready = services()
    assert 'STAGING_ISOLATED_SERVICES_READY' in session.run(ready, 'isolated-mongo-redis', 480)
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


def acceptance_with_repair(session, reuse_services=False):
    for index in range(1, 4):
        try:
            if reuse_services:
                acceptance(session, reuse_services=True)
            else:
                acceptance(session)
            return
        except Exception as error:
            state = stage.load()
            state.setdefault('acceptanceRepairFailures', []).append(str(error))
            stage.save(state)
            # Never create a second snapshot/restore while repairing an acceptance.
            if index == 3 or state.get('snapshotId') or state.get('restoreVolumeId'):
                raise
            command = state['ssmCommands'][-1]
            evidence_file = session.logs / (command['label'] + '.result.json')
            evidence_hash = hashlib.sha256(evidence_file.read_bytes()).hexdigest()
            decision_file = session.logs / ('acceptance-decision-' + str(index) + '.json')
            api.emit('acceptance-needs-same-host-repair', reviewIndex=index, failedStep=command['label'],
                     evidenceSha256=evidence_hash, maximumWaitSeconds=900)
            remaining = (stage.dt.datetime.fromisoformat(state['deadlineUtc']) - stage.now()).total_seconds()
            limit = time.monotonic() + min(900, max(0, remaining))
            while not decision_file.exists() and time.monotonic() < limit:
                time.sleep(3)
            assert decision_file.exists(), 'Same-host acceptance review timed out; cleanup only'
            decision = json.loads(decision_file.read_text(encoding='utf-8'))
            assert decision['action'] == 'repair-and-rerun'
            assert decision['failureEvidenceSha256'] == evidence_hash
            assert 10 <= len(decision['reason']) <= 1000
            path = session.logs / ('acceptance-repair-' + str(index) + '.sh')
            assert not path.is_symlink() and path.resolve().parent == session.logs.resolve()
            script = path.read_bytes()
            assert len(script) < 18000 and hashlib.sha256(script).hexdigest() == decision['scriptSha256']
            native.reviewed_source()
            state.setdefault('acceptanceRepairReviews', []).append(decision); stage.save(state)
            session.run(script.decode('utf-8'), 'acceptance-repair-' + str(index), 180)
            reuse_services = True


def run():
    state = stage.load(); assert state['status'] == 'prepared'
    native.reviewed_source()  # Refuse source drift before creating paid resources.
    try:
        stage.launch()
        session = native.Session(stage.STATE, stage.logs_path(stage.load()), stage.target)
        session.verify(); session.online()
        api.emit('staging-native-build-started')
        script = adapt(native.bootstrap(state))
        assert 'PILOT_SSM_BUILD_AND_CACHE_READY' in session.run(script, 'staging-build', 1200)
        acceptance_with_repair(session)

    except BaseException as error:
        state = stage.load(); state.setdefault('failures', []).append(type(error).__name__ + ': ' + str(error)); stage.save(state)
        raise
    finally:
        stage.cleanup()


def initialization_diagnostic():
    return '''systemctl is-active --quiet medipulse-staging-expire.timer
install -d -m 0755 /srv/medipulse-staging
code=0
cloud-init status --wait --format json >/srv/medipulse-staging/cloud-init-report.json 2>/srv/medipulse-staging/cloud-init-report.stderr || code=$?
printf 'CLOUD_INIT_RETURN_CODE=%s\\n' "$code"
printf 'CLOUD_INIT_REPORT_BASE64='
base64 -w 0 /srv/medipulse-staging/cloud-init-report.json
printf '\\n'
if test -s /srv/medipulse-staging/cloud-init-report.stderr; then head -n 20 /srv/medipulse-staging/cloud-init-report.stderr; fi
systemctl is-active --quiet medipulse-staging-expire.timer
echo INITIALIZATION_REPORT_CAPTURED
'''


def mongo_nofile_repair_script():
    return '''image=$(docker inspect medipulse-staging-mongo --format '{{.Image}}')
test "$(docker inspect medipulse-staging-mongo --format '{{.Config.Image}}')" = mongo:7
test "$(docker inspect medipulse-staging-mongo --format '{{.State.Status}}')" = exited
test "$(docker inspect medipulse-staging-mongo --format '{{range .Mounts}}{{if eq .Destination "/data/db"}}{{.Source}}{{end}}{{end}}')" = /srv/medipulse-staging/mongo
docker logs medipulse-staging-mongo 2>&1 | grep -F 'Too many open files' >/dev/null
for test_container in $(docker ps -q --filter ancestor=medipulse-reels-arm-review:local); do
    if test "$(docker inspect "$test_container" --format '{{json .Config.Cmd}}')" = '["scripts/testIntegration.js"]'; then
        docker stop -t 10 "$test_container" >/dev/null
    fi
done
cp /srv/medipulse-staging/logs/backend-integrations.log /srv/medipulse-staging/logs/backend-integrations-first-partial.log
docker rm medipulse-staging-mongo >/dev/null
docker run -d --name medipulse-staging-mongo --network ''' + stage.STAGE + ''' --network-alias mongo \
 --memory 384m --memory-swap 384m --cpus .35 --ulimit nofile=65536:65536 \
 --mount type=bind,source=/srv/medipulse-staging/mongo,target=/data/db \
 "$image" --replSet rs0 --bind_ip_all --wiredTigerCacheSizeGB .25 >/dev/null
for attempt in $(seq 1 40); do
 if docker exec medipulse-staging-mongo mongosh --quiet --eval 'if (!db.hello().isWritablePrimary) quit(1)' >/dev/null 2>&1; then break; fi
 sleep 2
done
docker exec medipulse-staging-mongo mongosh --quiet --eval 'if (!db.hello().isWritablePrimary) quit(1)'
docker exec medipulse-staging-mongo sh -c 'ulimit -n'
echo MONGO_NOFILE_REPAIR_READY
'''


def resume_existing_nofile_repair():
    state = stage.load()
    assert state['attempt'] == 4 and state['completionScopeApproved'] is True and state['status'] == 'ready'
    native.reviewed_source()
    try:
        session = native.Session(stage.STATE, stage.logs_path(state), stage.target)
        session.verify()
        assert any(command['label'] == 'backend-integration-checks' for command in state.get('ssmCommands', []))
        output = session.run(mongo_nofile_repair_script(), 'same-host-mongo-nofile-repair', 180)
        assert 'MONGO_NOFILE_REPAIR_READY' in output and '65536' in output
        state = stage.load(); state['sameHostMongoNofileRepair'] = True; stage.save(state)
        api.emit('same-host-mongo-repaired', openFilesLimit=65536, newInstancesCreated=False)
        acceptance_with_repair(session, reuse_services=True)
    except BaseException as error:
        state = stage.load()
        state.setdefault('failures', []).append(type(error).__name__ + ': ' + str(error))
        stage.save(state)
        raise
    finally:
        stage.cleanup()


def parse_initialization(output):
    encoded = re.search(r'^CLOUD_INIT_REPORT_BASE64=(.+)$', output, re.M)
    code = re.search(r'^CLOUD_INIT_RETURN_CODE=(\d+)$', output, re.M)
    assert encoded and code and 'INITIALIZATION_REPORT_CAPTURED' in output
    raw = base64.b64decode(encoded[1], validate=True)
    return {'returnCode': int(code[1]), 'report': json.loads(raw),
            'reportSha256': hashlib.sha256(raw).hexdigest()}


def reviewed_bootstrap(decision, diagnostic, directory, index):
    assert decision['action'] == 'continue'
    assert decision['cloudInitReportSha256'] == diagnostic['reportSha256']
    assert isinstance(decision['reason'], str) and 10 <= len(decision['reason']) <= 1000
    path = directory / ('reviewed-bootstrap-' + str(index) + '.sh')
    assert path.resolve().parent == directory.resolve() and not path.is_symlink()
    script = path.read_bytes()
    assert hashlib.sha256(script).hexdigest() == decision['bootstrapSha256']
    assert len(script) < 18000
    assert native.SOURCE.encode() in script and b'PILOT_SSM_BUILD_AND_CACHE_READY' in script
    return script.decode('utf-8')


def initialization_is_healthy(diagnostic):
    report = diagnostic['report']
    if diagnostic['returnCode'] != 0 or report.get('status') != 'done' or report.get('extended_status') != 'done':
        return False
    if report.get('errors') != [] or report.get('recoverable_errors') != {}:
        return False
    for name in ['init-local', 'init', 'modules-config', 'modules-final']:
        phase = report.get(name, {})
        if phase.get('errors') != [] or phase.get('recoverable_errors') != {}:
            return False
    return report.get('stage') is None


def run_diagnostic():
    state = stage.load()
    assert state['status'] == 'prepared' and state['attempt'] in [3, 4, 5]
    native.reviewed_source()
    try:
        stage.launch()
        session = native.Session(stage.STATE, stage.logs_path(stage.load()), stage.target)
        session.verify(); session.online()
        diagnostic = parse_initialization(session.run(initialization_diagnostic(), 'initialization-diagnostic', 180))
        state = stage.load(); state['initializationDiagnostic'] = diagnostic; stage.save(state)
        api.emit('initialization-diagnostic-captured', returnCode=diagnostic['returnCode'],
                 status=diagnostic['report'].get('status'), reportSha256=diagnostic['reportSha256'])
        if initialization_is_healthy(diagnostic):
            # Successful, complete, warning-free initialization needs no manual gate.
            api.emit('healthy-initialization-build-started')
            script = adapt(native.bootstrap(stage.load()))
            (session.logs / 'reviewed-bootstrap-1.sh').write_text(script, encoding='utf-8', newline='\n')
            decision = {'action': 'continue', 'reason': 'All initialization phases completed without errors or recoverable warnings',
                        'cloudInitReportSha256': diagnostic['reportSha256'],
                        'bootstrapSha256': hashlib.sha256(script.encode()).hexdigest()}
            (session.logs / 'review-decision-1.json').write_text(json.dumps(decision), encoding='utf-8')
        # One existing host; any repair must be reviewed against its captured report.
        # No decision within five minutes means cleanup, never an unattended host.
        for index in range(1, 4):
            decision_file = session.logs / ('review-decision-' + str(index) + '.json')
            api.emit('awaiting-initialization-review', reviewIndex=index, maximumWaitSeconds=300)
            deadline = time.monotonic() + 300
            while not decision_file.exists() and time.monotonic() < deadline:
                time.sleep(3)
            assert decision_file.exists(), 'Initialization review timed out; cleanup only'
            decision = json.loads(decision_file.read_text(encoding='utf-8'))
            if decision.get('action') == 'stop':
                api.emit('initialization-review-stopped'); return
            script = reviewed_bootstrap(decision, diagnostic, session.logs, index)
            state = stage.load()
            state.setdefault('initializationReviews', []).append(decision)
            stage.save(state)
            try:
                output = session.run(script, 'reviewed-build-' + str(index), 1200)
                assert 'PILOT_SSM_BUILD_AND_CACHE_READY' in output
                break
            except Exception as error:
                state = stage.load()
                state.setdefault('reviewedBuildFailures', []).append(str(error))
                stage.save(state)
                api.emit('reviewed-build-needs-investigation', reviewIndex=index)
        else:
            raise RuntimeError('Reviewed build limit reached; cleanup only')
        acceptance_with_repair(session)
    except BaseException as error:
        state = stage.load()
        state.setdefault('failures', []).append(type(error).__name__ + ': ' + str(error))
        stage.save(state)
        raise
    finally:
        stage.cleanup()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-approved', action='store_true')
    parser.add_argument('--retry-approved', action='store_true', help='Execute only the separately approved second attempt')
    parser.add_argument('--diagnostic-approved', action='store_true', help='One separately approved, two-hour diagnostic host')
    parser.add_argument('--completion-approved', action='store_true', help='One separately approved completion host')
    parser.add_argument('--final-acceptance-approved', action='store_true', help='One separately approved acceptance host after fixture corrections')
    parser.add_argument('--resume-existing-nofile-repair', action='store_true', help='Repair only the currently owned, approved running host')
    parser.add_argument('--cleanup', action='store_true')
    args = parser.parse_args()
    if args.cleanup:
        stage.cleanup(); return
    # Diagnose the local fixed deadline before contacting expired IAM grants.
    # Cleanup deliberately bypasses this gate so old resources remain removable.
    if stage.STATE.exists() and not (args.completion_approved or args.final_acceptance_approved):
        stage.require_open_window(stage.load())
    preflight.main()
    if args.final_acceptance_approved:
        native.reviewed_source()
        stage.prepare_completion(final=True)
        run_diagnostic()
        return
    if args.resume_existing_nofile_repair:
        resume_existing_nofile_repair()
        return
    if args.completion_approved:
        native.reviewed_source()
        stage.prepare_completion()
        run_diagnostic()
        return
    if args.diagnostic_approved:
        native.reviewed_source()
        stage.prepare_diagnostic()
        run_diagnostic()
        return
    if args.retry_approved:
        native.reviewed_source()
        stage.prepare_retry()
    state = stage.prepare()
    if not (args.run_approved or args.retry_approved):
        vpc, _ = stage.network()
        result = api.aws('create-security-group', '--group-name', stage.STAGE, '--description', 'Approved isolated staging',
                         '--vpc-id', vpc, '--tag-specifications', stage.tags('security-group', 'staging-network'), dry=True)
        api.emit('staging-readiness', scopeApproved=True, groupCreationDryRun=result, paidResourcesCreated=False)
        return
    run()


if __name__ == '__main__':
    main()
