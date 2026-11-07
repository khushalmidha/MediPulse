"""One approved synthetic ARM pilot only. Never reads production env or changes DNS."""
import argparse
import base64
import datetime as dt
import gzip
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import time
import urllib.request

PILOT = 'medipulse-native-pilot-20261106'
REGION = 'us-east-1'
PROFILE = 'medipulse-deployer'
IMAGE = 'medipulse-reels-arm-review:local'
AMI = 'ami-09a93d801db0bafae'  # Independently verified Canonical Ubuntu 24.04 ARM64; IAM pins this exact image.
REPO = Path(__file__).resolve().parents[1]
PRIVATE = Path(os.environ['LOCALAPPDATA']) / 'MediPulse/Private'
BUNDLE = PRIVATE / 'native-pilot-bundle'
STATE = PRIVATE / 'native-pilot-state.json'
MODEL = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2/2c4055b12046f11709e9df2c122e59ffbdc2f900'
MODEL_FILES = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx']
ACCOUNT = None


def emit(phase, **data):
    print(json.dumps({'phase': phase, **data}), flush=True)


def command(args, **kw):
    result = subprocess.run(args, capture_output=True, **kw)
    if result.returncode:
        raise RuntimeError('Local command failed: ' + Path(args[0]).name)
    return result.stdout


def aws(operation, *args, dry=False):
    if not dry and not operation.startswith('describe-'):
        identity()  # Never silently execute a write through an accidentally replaced root session.
    raw = subprocess.run(['aws', '--profile', PROFILE, '--region', REGION, 'ec2', operation,
                          *args, *(['--dry-run'] if dry else []), '--output', 'json', '--no-cli-pager',
                          '--cli-connect-timeout', '5', '--cli-read-timeout', '15'],
                         capture_output=True, text=True, timeout=35)
    match = re.search(r'\(([A-Za-z0-9.]+)\) when calling', raw.stderr)
    error = match.group(1) if match else 'request_or_session_unavailable'
    if dry:
        diagnostic = {'operation': operation, 'result': error,
                      'message': raw.stderr.split('Encoded authorization failure message:')[0][:1600]}
        (PRIVATE / 'native-pilot-last-dry-run.json').write_text(json.dumps(diagnostic, indent=2), encoding='utf-8')
        emit('authorization-dry-run', operation=operation, result=error)
        return error if raw.returncode else 'unexpected_success'
    if raw.returncode:
        raise RuntimeError(operation + ': ' + error)
    return json.loads(raw.stdout or '{}')


def identity():
    global ACCOUNT
    raw = command(['aws', '--profile', PROFILE, '--region', REGION, 'sts', 'get-caller-identity',
                   '--output', 'json', '--no-cli-pager'], text=True, timeout=25)
    obj = json.loads(raw)
    prior = json.loads((PRIVATE / 'aws-resource-audit.json').read_text())
    expected = next(r for r in prior['regions'] if r['region'] == REGION)['networkInterfaces'][0]['OwnerId']
    assert obj['Arn'].endswith(':user/medipulse-deployer') and obj['Account'] == expected
    ACCOUNT = expected


def save(state):
    state['updatedAtUtc'] = dt.datetime.now(dt.timezone.utc).isoformat()
    STATE.write_text(json.dumps(state, indent=2) + '\n', encoding='utf-8')


def tags(kind):
    return json.dumps([{'ResourceType': kind, 'Tags': [{'Key': 'PilotId', 'Value': PILOT},
                       {'Key': 'Name', 'Value': PILOT}, {'Key': 'DataClass', 'Value': 'synthetic-only'}]}])


def tagged(obj):
    return any(t['Key'] == 'PilotId' and t['Value'] == PILOT for t in obj.get('Tags', []))


def sha(file):
    with file.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def prepare():
    approval = json.loads((PRIVATE / 'aws-native-pilot-approval.json').read_text())
    assert approval['approved'] and approval['maxDurationHours'] == 24 and approval['newGp3GiB'] == 40
    assert approval.get('exactNewSyntheticInstanceAndDiskCleanupApproved')
    if STATE.exists():
        raise RuntimeError('Pilot state already exists; inspect/cleanup it rather than launch again')
    assert shutil.disk_usage(PRIVATE).free > 2_500_000_000
    info = json.loads(command(['docker', 'image', 'inspect', IMAGE], text=True))[0]
    assert info['Architecture'] == 'arm64'
    BUNDLE.mkdir(parents=True, exist_ok=True)
    image_tar = BUNDLE / 'arm-image.tar'
    image_gz = BUNDLE / 'arm-image.tar.gz'
    if not image_gz.exists():
        emit('exporting-local-arm-image')
        command(['docker', 'save', '--platform', 'linux/arm64', '--output', str(image_tar), IMAGE])
        with image_tar.open('rb') as src, image_gz.open('wb') as dest:
            with gzip.GzipFile(fileobj=dest, mode='wb', compresslevel=1) as packed:
                shutil.copyfileobj(src, packed)
        assert image_tar.resolve().parent == BUNDLE.resolve()
        image_tar.unlink()  # Only this newly generated single file, never a recursive deletion.
    model_hashes = {}
    with tarfile.open(BUNDLE / 'models.tar.gz', 'w:gz') as archive:
        for name in MODEL_FILES:
            source = PRIVATE / 'reels-models' / MODEL / name
            assert source.is_file() and not source.is_symlink()
            archive.add(source, arcname='models/' + MODEL + '/' + name, recursive=False)
            model_hashes[name] = sha(source)
    shutil.copyfile(REPO / 'backend/tests/reel-real-media.test.js', BUNDLE / 'reel-real-media.test.js')
    runner = '''#!/bin/sh
node --test --test-concurrency=1 /app/tests/reel-real-media.test.js
pilot_result=$?
printf 'PILOT_MEMORY_PEAK_BYTES='
cat /sys/fs/cgroup/memory.peak
exit "$pilot_result"
'''
    (BUNDLE / 'native-check.sh').write_bytes(runner.encode('utf-8'))
    key = BUNDLE / 'pilot-key'
    if not key.exists():
        command(['ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-f', str(key)])
    owner = command(['whoami'], text=True).strip()
    command(['icacls', str(key), '/inheritance:r', '/grant:r', owner + ':(R)'], text=True)
    meta = {'pilotId': PILOT, 'account': ACCOUNT, 'status': 'prepared', 'image': IMAGE,
            'bundleHashes': {n: sha(BUNDLE / n) for n in ['arm-image.tar.gz', 'models.tar.gz',
                             'reel-real-media.test.js', 'native-check.sh']}, 'modelHashes': model_hashes}
    save(meta)
    emit('local-bundle-ready', imageCompressedBytes=image_gz.stat().st_size)


def launch():
    state = json.loads(STATE.read_text())
    assert state['account'] == ACCOUNT and state['pilotId'] == PILOT and state['status'] == 'prepared'
    for name, digest in state['bundleHashes'].items():
        assert sha(BUNDLE / name) == digest
    budget = json.loads(command(['aws', '--profile', PROFILE, '--region', REGION, 'budgets',
        'describe-budget', '--account-id', ACCOUNT, '--budget-name', 'MediPulse-AWS-Pilot-Gross-Monthly',
        '--output', 'json', '--no-cli-pager'], text=True, timeout=25))['Budget']
    assert float(budget['CalculatedSpend']['ActualSpend']['Amount']) + 1 <= min(15, float(budget['BudgetLimit']['Amount']))
    existing = aws('describe-instances', '--filters', 'Name=tag:PilotId,Values=' + PILOT)
    assert not [i for r in existing['Reservations'] for i in r['Instances'] if i['State']['Name'] != 'terminated']
    vpcs = [v for v in aws('describe-vpcs')['Vpcs'] if v.get('IsDefault')]
    assert len(vpcs) == 1
    vpc = vpcs[0]['VpcId']
    subnets = [s for s in aws('describe-subnets', '--filters', 'Name=vpc-id,Values=' + vpc)['Subnets']
               if s.get('DefaultForAz') and s['AvailableIpAddressCount'] > 3]
    assert subnets
    subnet = sorted(subnets, key=lambda s: s['AvailabilityZone'])[0]
    routes = aws('describe-route-tables', '--filters', 'Name=vpc-id,Values=' + vpc)['RouteTables']
    selected = [r for r in routes if any(a.get('SubnetId') == subnet['SubnetId'] for a in r['Associations'])]
    selected = selected or [r for r in routes if any(a.get('Main') for a in r['Associations'])]
    assert len(selected) == 1 and any(r.get('DestinationCidrBlock') == '0.0.0.0/0' and
        r.get('GatewayId', '').startswith('igw-') and r['State'] == 'active' for r in selected[0]['Routes'])
    images = aws('describe-images', '--image-ids', AMI)['Images']
    assert len(images) == 1
    image = images[0]
    assert image['ImageId'] == AMI and image['OwnerId'] == '099720109477'
    assert image['Architecture'] == 'arm64' and image['Public'] and image['State'] == 'available'
    assert image['RootDeviceType'] == 'ebs' and not image.get('ProductCodes')
    with urllib.request.urlopen('https://checkip.amazonaws.com', timeout=15) as response:
        operator_ip = str(ipaddress.IPv4Address(response.read().decode().strip()))
    state.update(imageId=image['ImageId'], imageName=image['Name'], subnetId=subnet['SubnetId'], sshCidr=operator_ip + '/32')
    save(state)
    group = aws('create-security-group', '--group-name', PILOT, '--description', 'Synthetic native pilot only',
                '--vpc-id', vpc, '--tag-specifications', tags('security-group'))
    state['groupId'] = group['GroupId']; save(state)
    pair = aws('import-key-pair', '--key-name', PILOT,
               '--public-key-material', 'fileb://' + str(BUNDLE / 'pilot-key.pub'),
               '--tag-specifications', tags('key-pair'))
    state['keyPairId'] = pair['KeyPairId']; state['keyName'] = PILOT; save(state)
    aws('authorize-security-group-ingress', '--group-id', state['groupId'], '--ip-permissions',
        json.dumps([{'IpProtocol': 'tcp', 'FromPort': 22, 'ToPort': 22,
                     'IpRanges': [{'CidrIp': operator_ip + '/32', 'Description': 'Owner SSH only'}]}]))
    deadline = dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=23)
    calendar = deadline.strftime('%Y-%m-%d %H:%M:%S UTC')
    userdata = f'''#!/bin/bash
set -euo pipefail
cat >/etc/systemd/system/medipulse-native-pilot-expire.service <<'SERVICE'
[Unit]
Description=Terminate approved synthetic pilot at its fixed deadline
[Service]
Type=oneshot
ExecStart=/usr/sbin/shutdown -P now
SERVICE
cat >/etc/systemd/system/medipulse-native-pilot-expire.timer <<'TIMER'
[Unit]
Description=Absolute synthetic pilot expiry
[Timer]
OnCalendar={calendar}
Persistent=true
AccuracySec=1s
Unit=medipulse-native-pilot-expire.service
[Install]
WantedBy=timers.target
TIMER
systemctl daemon-reload
systemctl enable --now medipulse-native-pilot-expire.timer
'''
    (BUNDLE / 'user-data.sh').write_bytes(userdata.encode('utf-8'))
    request = {'ImageId': image['ImageId'], 'InstanceType': 't4g.small', 'MinCount': 1, 'MaxCount': 1,
        'KeyName': PILOT, 'ClientToken': PILOT, 'Placement': {'Tenancy': 'default'},
        'CreditSpecification': {'CpuCredits': 'standard'}, 'InstanceInitiatedShutdownBehavior': 'terminate',
        'MetadataOptions': {'HttpTokens': 'required', 'HttpPutResponseHopLimit': 1},
        'NetworkInterfaces': [{'DeviceIndex': 0, 'SubnetId': subnet['SubnetId'],
                               'AssociatePublicIpAddress': True, 'Groups': [state['groupId']], 'DeleteOnTermination': True}],
        'BlockDeviceMappings': [{'DeviceName': image['RootDeviceName'], 'Ebs': {'VolumeSize': 40,
            'VolumeType': 'gp3', 'Iops': 3000, 'Throughput': 125, 'Encrypted': True, 'DeleteOnTermination': True}}],
        'TagSpecifications': json.loads(tags('instance')) + json.loads(tags('volume'))}
    request_file = BUNDLE / 'launch-request.json'
    request_file.write_text(json.dumps(request), encoding='utf-8')
    args = ['--cli-input-json', 'file://' + str(request_file), '--user-data', 'file://' + str(BUNDLE / 'user-data.sh')]
    assert aws('run-instances', *args, dry=True) == 'DryRunOperation', 'Launch authorization denied; no bypass'
    negative = dict(request); negative['InstanceType'] = 't4g.large'
    neg_file = BUNDLE / 'denied-request.json'; neg_file.write_text(json.dumps(negative), encoding='utf-8')
    assert aws('run-instances', '--cli-input-json', 'file://' + str(neg_file), dry=True) == 'UnauthorizedOperation'
    assert aws('terminate-instances', '--instance-ids', 'i-07b4f6961dc550de0', dry=True) == 'UnauthorizedOperation'
    state['authorizationChecks'] = {'validLaunch': 'allowed_dry_run', 'largerType': 'denied_dry_run', 'existingJobFinderTermination': 'denied_dry_run'}
    state['deadlineUtc'] = deadline.isoformat(); state['status'] = 'launch-requested'; save(state)
    launched = aws('run-instances', *args)['Instances']
    assert len(launched) == 1
    state['instanceId'] = launched[0]['InstanceId']; state['status'] = 'launched'; save(state)
    emit('pilot-launched', nativeTestsPending=True)
    for _ in range(60):
        instance = aws('describe-instances', '--instance-ids', state['instanceId'])['Reservations'][0]['Instances'][0]
        if instance['State']['Name'] == 'running' and instance.get('PublicIpAddress'):
            assert tagged(instance) and instance['InstanceType'] == 't4g.small'
            assert len(instance['BlockDeviceMappings']) == 1 and instance['BlockDeviceMappings'][0]['Ebs']['DeleteOnTermination']
            state['volumeId'] = instance['BlockDeviceMappings'][0]['Ebs']['VolumeId']
            volume = aws('describe-volumes', '--volume-ids', state['volumeId'])['Volumes'][0]
            assert tagged(volume) and volume['Size'] == 40 and volume['Encrypted'] and volume['VolumeType'] == 'gp3'
            credit = aws('describe-instance-credit-specifications', '--instance-ids', state['instanceId'])['InstanceCreditSpecifications'][0]
            assert credit['CpuCredits'] == 'standard'
            assert aws('terminate-instances', '--instance-ids', state['instanceId'], dry=True) == 'DryRunOperation'
            state['publicIp'] = str(ipaddress.IPv4Address(instance['PublicIpAddress'])); state['status'] = 'ready-for-synthetic-checks'; save(state)
            emit('pilot-running', encrypted40GiB=True, cpuCredits='standard', sshOnlyOwnerIp=True)
            return
        time.sleep(5)
    raise RuntimeError('Pilot did not become ready within bounded startup wait')


def cleanup():
    state = json.loads(STATE.read_text())
    assert state['pilotId'] == PILOT and state['account'] == ACCOUNT
    if state.get('status') == 'launch-requested' and not state.get('instanceId'):
        found = aws('describe-instances', '--filters', 'Name=tag:PilotId,Values=' + PILOT)
        found = [i for r in found['Reservations'] for i in r['Instances']
                 if i.get('ClientToken') == PILOT and i['State']['Name'] != 'terminated']
        assert len(found) <= 1, 'Unexpected extra instances; do not bulk-delete'
        if found:
            assert tagged(found[0]) and found[0]['InstanceType'] == 't4g.small'
            state['instanceId'] = found[0]['InstanceId']; save(state)
    if state.get('instanceId'):
        instance = aws('describe-instances', '--instance-ids', state['instanceId'])['Reservations'][0]['Instances'][0]
        if instance['State']['Name'] != 'terminated':
            assert tagged(instance) and instance['InstanceType'] == 't4g.small'
            assert instance['InstanceId'] != 'i-07b4f6961dc550de0'
            assert len(instance.get('BlockDeviceMappings', [])) <= 1
            for block in instance.get('BlockDeviceMappings', []):
                v = aws('describe-volumes', '--volume-ids', block['Ebs']['VolumeId'])['Volumes'][0]
                assert tagged(v) and v['Size'] == 40 and block['Ebs']['DeleteOnTermination']
                state['volumeId'] = v['VolumeId']; save(state)
            aws('terminate-instances', '--instance-ids', state['instanceId'])
        for _ in range(36):
            i = aws('describe-instances', '--instance-ids', state['instanceId'])['Reservations'][0]['Instances'][0]
            if i['State']['Name'] == 'terminated':
                break
            time.sleep(5)
        assert i['State']['Name'] == 'terminated', 'Cleanup still pending'
    if state.get('volumeId'):
        remaining = aws('describe-volumes', '--filters', 'Name=volume-id,Values=' + state['volumeId'])['Volumes']
        if remaining:
            v = remaining[0]; assert tagged(v) and v['State'] == 'available' and not v['Attachments'] and v['Size'] == 40
            aws('delete-volume', '--volume-id', v['VolumeId'])
    if state.get('keyPairId'):
        keys = aws('describe-key-pairs', '--filters', 'Name=key-pair-id,Values=' + state['keyPairId'])['KeyPairs']
        if keys:
            assert tagged(keys[0]) and keys[0]['KeyName'] == PILOT
            aws('delete-key-pair', '--key-pair-id', state['keyPairId'])
    if state.get('groupId'):
        groups = aws('describe-security-groups', '--filters', 'Name=group-id,Values=' + state['groupId'])['SecurityGroups']
        if groups:
            assert tagged(groups[0]) and groups[0]['GroupName'] == PILOT
            for attempt in range(12):
                try:
                    aws('delete-security-group', '--group-id', state['groupId']); break
                except RuntimeError:
                    if attempt == 11: raise
                    time.sleep(5)
    state['status'] = 'cleaned'; save(state)
    emit('pilot-cleaned', existingResourcesChanged=False)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['prepare', 'launch', 'cleanup'])
    args = parser.parse_args()
    identity()
    if args.mode == 'prepare': prepare()
    elif args.mode == 'cleanup': cleanup()
    else:
        try: launch()
        except BaseException:
            if STATE.exists(): cleanup()
            raise


if __name__ == '__main__':
    main()
