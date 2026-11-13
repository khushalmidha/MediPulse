"""One explicitly approved, disposable 72h/3USD staging host; never production."""
import datetime as dt
import json
import time
import aws_native_pilot as api
import aws_ssm_preflight as ssm
from render_staging_policy import STAGE

STATE = api.PRIVATE / 'aws-staging-state.json'
LOGS = api.PRIVATE / 'aws-staging-logs'
ROOT = '/srv/medipulse-staging'


def now():
    return dt.datetime.now(dt.timezone.utc)


def load():
    return json.loads(STATE.read_text(encoding='utf-8'))


def save(state):
    state['updatedAtUtc'] = now().isoformat()
    STATE.write_text(json.dumps(state, indent=2) + '\n', encoding='utf-8')


def tags(kind, role):
    return json.dumps([{'ResourceType': kind, 'Tags': [
        {'Key': 'DeploymentId', 'Value': STAGE}, {'Key': 'Project', 'Value': 'MediPulse'},
        {'Key': 'DataClass', 'Value': 'synthetic-only'}, {'Key': 'Role', 'Value': role},
        {'Key': 'Name', 'Value': STAGE}]}])


def own(obj, role=None):
    values = {x['Key']: x['Value'] for x in obj.get('Tags', [])}
    assert values.get('DeploymentId') == STAGE and values.get('DataClass') == 'synthetic-only'
    if role:
        assert values.get('Role') == role


def instance(state, item, running=False):
    own(item, 'staging-host')
    assert state['account'] == api.ACCOUNT and state['deploymentId'] == STAGE
    assert item['InstanceId'] == state['instanceId'] != 'i-07b4f6961dc550de0'
    assert item['InstanceType'] == 't4g.small' and item['ClientToken'] == state['clientToken'] == STAGE + '-one'
    if item.get('IamInstanceProfile'):
        assert item['IamInstanceProfile']['Arn'] == 'arn:aws:iam::' + api.ACCOUNT + ':instance-profile/' + ssm.ROLE
    else:
        assert item['State']['Name'] == 'terminated'
    if running:
        scope(state)
        assert item['State']['Name'] == 'running' and now() < dt.datetime.fromisoformat(state['deadlineUtc'])


def scope(state):
    assert state['reserveGrossUSD'] == 3 and state['deploymentId'] == STAGE
    start = dt.datetime.fromisoformat(state['preparedAtUtc'])
    end = dt.datetime.fromisoformat(state['deadlineUtc'])
    assert start <= now() and start < end <= start + dt.timedelta(hours=72)


def require_open_window(state):
    """Reject a stale journal before cloud calls; never reset its fixed deadline."""
    scope(state)
    if now() >= dt.datetime.fromisoformat(state['deadlineUtc']):
        raise RuntimeError(
            'Staging window expired; no launch is permitted. Preserve the existing '
            'manifest and approval. Prepare a separately reviewed renewal with fresh '
            'date-bound IAM grants; --cleanup remains available for exact old resources.'
        )


def target(state, item):
    instance(state, item, running=True)
    if state.get('restoreCreatedAtUtc') and not state.get('restoreDeletedAtUtc'):
        assert now() < dt.datetime.fromisoformat(state['restoreCreatedAtUtc']) + dt.timedelta(hours=2), 'Restore window expired: cleanup only'


def volume(item, role):
    own(item, role)
    assert item['Size'] == 30 and item['VolumeType'] == 'gp3' and item['Encrypted']


def find(operation, key):
    return api.aws(operation, '--filters', 'Name=tag:DeploymentId,Values=' + STAGE)[key]


def prepare():
    api.identity()
    approval = json.loads((api.PRIVATE / 'aws-staging-approval.json').read_text(encoding='utf-8'))
    assert approval['approved'] and approval['deploymentId'] == STAGE
    assert approval['maxDurationHours'] == 72 and approval['reserveGrossUSD'] == 3 and approval['gp3GiB'] == 30
    assert approval['cleanupExactNewResourcesApproved'] and not approval['dnsOrProductionChangesApproved']
    if STATE.exists():
        state = load()
        assert state['status'] == 'prepared', 'Never overwrite an existing launch or cleaned resource manifest'
        require_open_window(state)
        return state
    prior = json.loads(api.STATE.read_text(encoding='utf-8'))
    assert prior['status'] == 'cleaned'
    started = now()
    state = {'deploymentId': STAGE, 'account': api.ACCOUNT, 'status': 'prepared', 'preparedAtUtc': started.isoformat(),
             'clientToken': STAGE + '-one', 'reserveGrossUSD': 3,
             'modelHashes': prior['modelHashes'], 'deadlineUtc': (started + dt.timedelta(hours=72)).isoformat(),
             'maxRestoreHours': 2, 'productionAcceptance': False, 'failures': []}
    save(state)
    return state


def network():
    vpc = next(v['VpcId'] for v in api.aws('describe-vpcs')['Vpcs'] if v.get('IsDefault'))
    rows = api.aws('describe-subnets', '--filters', 'Name=vpc-id,Values=' + vpc)['Subnets']
    subnet = sorted([s for s in rows if s.get('DefaultForAz') and s['AvailableIpAddressCount'] > 3], key=lambda s: s['AvailabilityZone'])[0]
    api.network_preflight(subnet)
    routes = api.aws('describe-route-tables', '--filters', 'Name=vpc-id,Values=' + vpc)['RouteTables']
    selected = [r for r in routes if any(a.get('SubnetId') == subnet['SubnetId'] for a in r['Associations'])]
    selected = selected or [r for r in routes if any(a.get('Main') for a in r['Associations'])]
    assert len(selected) == 1 and any(r.get('DestinationCidrBlock') == '0.0.0.0/0' and r.get('GatewayId', '').startswith('igw-') and r['State'] == 'active' for r in selected[0]['Routes'])
    return vpc, subnet


def launch():
    api.identity()
    state = load()
    require_open_window(state)
    assert state['status'] == 'prepared' and state['account'] == api.ACCOUNT and state['reserveGrossUSD'] == 3
    assert now() + dt.timedelta(hours=2) < dt.datetime.fromisoformat(state['deadlineUtc'])
    assert not [i for r in find('describe-instances', 'Reservations') for i in r['Instances'] if i['State']['Name'] != 'terminated']
    assert not find('describe-volumes', 'Volumes') and not find('describe-security-groups', 'SecurityGroups')
    assert not find('describe-snapshots', 'Snapshots')
    vpc, subnet = network()
    image = api.aws('describe-images', '--image-ids', api.AMI)['Images'][0]
    assert image['ImageId'] == api.AMI and image['OwnerId'] == '099720109477' and image['Architecture'] == 'arm64'
    assert image['State'] == 'available' and image['Public'] and not image.get('ProductCodes')
    state['availabilityZone'] = subnet['AvailabilityZone']; save(state)
    group = api.aws('create-security-group', '--group-name', STAGE, '--description', 'Approved disposable staging; no inbound ports',
                    '--vpc-id', vpc, '--tag-specifications', tags('security-group', 'staging-network'))
    state['groupId'] = group['GroupId']; save(state)
    calendar = dt.datetime.fromisoformat(state['deadlineUtc']).strftime('%Y-%m-%d %H:%M:%S UTC')
    userdata = '''#!/bin/bash
set -euo pipefail
cat >/etc/systemd/system/medipulse-staging-expire.service <<'SERVICE'
[Unit]
Description=Terminate only the approved disposable synthetic staging host
[Service]
Type=oneshot
ExecStart=/usr/sbin/shutdown -P now
SERVICE
cat >/etc/systemd/system/medipulse-staging-expire.timer <<'TIMER'
[Unit]
Description=Absolute disposable staging deadline
[Timer]
OnCalendar=''' + calendar + '''
Persistent=true
AccuracySec=1s
Unit=medipulse-staging-expire.service
[Install]
WantedBy=timers.target
TIMER
systemctl daemon-reload
systemctl enable --now medipulse-staging-expire.timer
'''
    LOGS.mkdir(exist_ok=True)
    userfile = LOGS / 'user-data.sh'; userfile.write_text(userdata, encoding='utf-8', newline='\n')
    request = {'ImageId': api.AMI, 'InstanceType': 't4g.small', 'MinCount': 1, 'MaxCount': 1,
               'ClientToken': state['clientToken'], 'Placement': {'Tenancy': 'default'},
               'CreditSpecification': {'CpuCredits': 'standard'}, 'InstanceInitiatedShutdownBehavior': 'terminate',
               'IamInstanceProfile': {'Name': ssm.ROLE}, 'MetadataOptions': {'HttpTokens': 'required', 'HttpPutResponseHopLimit': 1},
               'NetworkInterfaces': [{'DeviceIndex': 0, 'SubnetId': subnet['SubnetId'], 'AssociatePublicIpAddress': True,
                                      'Groups': [state['groupId']], 'DeleteOnTermination': True}],
               'BlockDeviceMappings': [{'DeviceName': image['RootDeviceName'], 'Ebs': {'VolumeSize': 30, 'VolumeType': 'gp3',
                                        'Iops': 3000, 'Throughput': 125, 'Encrypted': True, 'DeleteOnTermination': True}}],
               'TagSpecifications': json.loads(tags('instance', 'staging-host')) + json.loads(tags('volume', 'staging-root'))}
    file = LOGS / 'launch.json'; file.write_text(json.dumps(request), encoding='utf-8')
    arguments = ['--cli-input-json', 'file://' + str(file), '--user-data', 'file://' + str(userfile)]
    assert api.aws('run-instances', *arguments, dry=True) == 'DryRunOperation'
    negative = {**request, 'InstanceType': 't4g.large'}
    denied = LOGS / 'denied.json'; denied.write_text(json.dumps(negative), encoding='utf-8')
    assert api.aws('run-instances', '--cli-input-json', 'file://' + str(denied), dry=True) == 'UnauthorizedOperation'
    assert api.aws('terminate-instances', '--instance-ids', 'i-07b4f6961dc550de0', dry=True) == 'UnauthorizedOperation'
    state['status'] = 'launch-requested'; save(state)
    result = api.aws('run-instances', *arguments)['Instances']; assert len(result) == 1
    state.update(instanceId=result[0]['InstanceId'], launchedAtUtc=result[0]['LaunchTime'], status='launched'); save(state)
    for _ in range(60):
        item = api.aws('describe-instances', '--instance-ids', state['instanceId'])['Reservations'][0]['Instances'][0]
        if item['State']['Name'] == 'running':
            target(state, item)
            blocks = item['BlockDeviceMappings']; assert len(blocks) == 1 and blocks[0]['Ebs']['DeleteOnTermination']
            state['volumeId'] = blocks[0]['Ebs']['VolumeId']
            volume(api.aws('describe-volumes', '--volume-ids', state['volumeId'])['Volumes'][0], 'staging-root')
            groups = api.aws('describe-security-groups', '--group-ids', state['groupId'])['SecurityGroups']
            own(groups[0], 'staging-network'); assert not groups[0]['IpPermissions']
            credits = api.aws('describe-instance-credit-specifications', '--instance-ids', state['instanceId'])['InstanceCreditSpecifications'][0]
            assert credits['CpuCredits'] == 'standard' and item['MetadataOptions']['HttpTokens'] == 'required'
            assert api.aws('terminate-instances', '--instance-ids', state['instanceId'], dry=True) == 'DryRunOperation'
            state['status'] = 'ready'; save(state)
            api.emit('approved-staging-running', encryptedGp3GiB=30, noInboundPorts=True, reserveGrossUSD=3)
            return
        time.sleep(5)
    raise RuntimeError('Bounded staging startup timeout')


def remove_restore(state):
    if not state.get('restoreVolumeId'):
        return
    rows = api.aws('describe-volumes', '--filters', 'Name=volume-id,Values=' + state['restoreVolumeId'])['Volumes']
    if not rows:
        return
    v = rows[0]; volume(v, 'restore'); assert v['VolumeId'] != state.get('volumeId')
    for attachment in v['Attachments']:
        assert attachment['InstanceId'] == state['instanceId'] and attachment['Device'] == '/dev/sdf'
        api.aws('detach-volume', '--volume-id', v['VolumeId'], '--instance-id', state['instanceId'], '--device', '/dev/sdf')
    for _ in range(60):
        v = api.aws('describe-volumes', '--volume-ids', v['VolumeId'])['Volumes'][0]
        if v['State'] == 'available':
            volume(v, 'restore'); assert not v['Attachments']
            api.aws('delete-volume', '--volume-id', v['VolumeId'])
            state['restoreDeletedAtUtc'] = now().isoformat(); save(state)
            return
        time.sleep(3)
    raise RuntimeError('Restore disk detach still pending; do not force-detach')


def cleanup():
    api.identity(); state = load()
    assert state['deploymentId'] == STAGE and state['account'] == api.ACCOUNT
    # Recover ambiguous requests by their fixed token/tag, never by an unrelated ID.
    if state.get('status') == 'launch-requested' and not state.get('instanceId'):
        rows = [i for r in find('describe-instances', 'Reservations') for i in r['Instances']
                if i.get('ClientToken') == state['clientToken'] and i['State']['Name'] != 'terminated']
        assert len(rows) <= 1
        if rows:
            state['instanceId'] = rows[0]['InstanceId']; save(state)
    if state.get('instanceId'):
        rows = api.aws('describe-instances', '--instance-ids', state['instanceId'])['Reservations']
        item = rows[0]['Instances'][0]; instance(state, item)
        if item['State']['Name'] != 'terminated':
            for block in item['BlockDeviceMappings']:
                v = api.aws('describe-volumes', '--volume-ids', block['Ebs']['VolumeId'])['Volumes'][0]
                own(v); assert v['Size'] == 30
                if v['VolumeId'] != state.get('restoreVolumeId'):
                    volume(v, 'staging-root'); assert block['Ebs']['DeleteOnTermination']
                    state['volumeId'] = v['VolumeId']; save(state)
            # Terminate first on failure: releases IP and safely unmounts all disks.
            api.aws('terminate-instances', '--instance-ids', state['instanceId'])
        for _ in range(60):
            item = api.aws('describe-instances', '--instance-ids', state['instanceId'])['Reservations'][0]['Instances'][0]
            if item['State']['Name'] == 'terminated':
                break
            time.sleep(3)
        assert item['State']['Name'] == 'terminated'
    # Discover only newly tagged synthetic restore artifacts after ambiguous writes.
    volumes = find('describe-volumes', 'Volumes')
    assert len(volumes) <= 2
    for v in volumes:
        own(v); assert v['State'] == 'available' and not v['Attachments'] and v['Size'] == 30
        role = {t['Key']: t['Value'] for t in v['Tags']}['Role']; assert role in ['restore', 'staging-root']
        volume(v, role)
        api.aws('delete-volume', '--volume-id', v['VolumeId'])
    snapshots = find('describe-snapshots', 'Snapshots'); assert len(snapshots) <= 1
    for snap in snapshots:
        own(snap, 'synthetic-backup'); assert snap['VolumeSize'] == 30 and snap['Encrypted']
        assert snap['VolumeId'] == state['volumeId']
        api.aws('delete-snapshot', '--snapshot-id', snap['SnapshotId'])
    groups = find('describe-security-groups', 'SecurityGroups'); assert len(groups) <= 1
    for group in groups:
        own(group, 'staging-network'); assert group['GroupName'] == STAGE
        for attempt in range(12):
            try:
                api.aws('delete-security-group', '--group-id', group['GroupId']); break
            except RuntimeError as error:
                if 'DependencyViolation' not in str(error) or attempt == 11:
                    raise
                time.sleep(3)
    assert not find('describe-volumes', 'Volumes') and not find('describe-snapshots', 'Snapshots')
    assert not find('describe-security-groups', 'SecurityGroups')
    state.update(status='cleaned', cleanupCompletedAtUtc=now().isoformat()); save(state)
    api.emit('staging-cleaned', existingResourcesChanged=False)
