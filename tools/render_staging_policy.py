"""Prepare owner-reviewed staging grants locally; no IAM writes or provisioning."""
import copy
import json
import aws_native_pilot as pilot

STAGE = 'medipulse-staging-20261108'


def build():
    base = json.loads((pilot.REPO / 'deploy/aws/iam-native-pilot.template.json').read_text(encoding='utf-8'))
    statements = []
    for item in base['Statement']:
        name = item.pop('Sid')
        if name in ['ImportOnlyPilotTaggedPublicSshKey', 'CleanupOnlyNewPilotImportedKey']:
            continue
        item = json.loads(json.dumps(item).replace('aws:RequestTag/PilotId', 'aws:RequestTag/DeploymentId')
                          .replace('aws:ResourceTag/PilotId', 'aws:ResourceTag/DeploymentId')
                          .replace(pilot.PILOT, STAGE))
        if name == 'ReadPilotLaunchMetadata':
            item['Action'] = [a for a in item['Action'] if a != 'ec2:DescribeKeyPairs']
        if name == 'LaunchOnlyEncrypted40GiBDefaultPerformanceGp3':
            item['Condition']['NumericEquals']['ec2:VolumeSize'] = '30'
        if name == 'LaunchUsingOnlyPilotTaggedKeyAndSecurityGroup':
            item['Resource'] = [r for r in item['Resource'] if ':key-pair/' not in r]
        if name == 'TagOnlyDuringApprovedResourceCreation':
            item['Resource'] = [r for r in item['Resource'] if ':key-pair/' not in r] + ['arn:aws:ec2:us-east-1::snapshot/*']
            item['Condition']['StringEquals']['ec2:CreateAction'] = ['RunInstances', 'CreateSecurityGroup', 'CreateSnapshot', 'CreateVolume']
        if name == 'ManageOnlyNewPilotGroupRulesAndCleanup':
            item['Action'] = ['ec2:DeleteSecurityGroup']
        conditions = item['Condition'].setdefault('StringEquals', {})
        if 'aws:RequestTag/DeploymentId' in conditions:
            conditions['aws:RequestTag/DataClass'] = 'synthetic-only'
        if 'aws:ResourceTag/DeploymentId' in conditions:
            conditions['aws:ResourceTag/DataClass'] = 'synthetic-only'
        # Remove empty condition operators; no effective grant is widened.
        if not conditions:
            item['Condition'].pop('StringEquals')
        statements.append(item)

    account = 'arn:aws:ec2:us-east-1:__ACCOUNT_ID__:'
    snapshot = 'arn:aws:ec2:us-east-1::snapshot/*'

    def own():
        return {'StringEquals': {'aws:ResourceTag/DeploymentId': STAGE, 'aws:ResourceTag/DataClass': 'synthetic-only'},
                'DateLessThan': {'aws:CurrentTime': '2026-11-15T00:00:00Z'}}

    def request():
        return {'StringEquals': {'aws:RequestTag/DeploymentId': STAGE, 'aws:RequestTag/DataClass': 'synthetic-only'},
                'DateLessThan': {'aws:CurrentTime': '2026-11-13T00:00:00Z'}}

    def grant(actions, resources, condition):
        statements.append({'Effect': 'Allow', 'Action': actions, 'Resource': resources, 'Condition': condition})

    c = own(); c['StringEquals']['aws:ResourceTag/Role'] = 'staging-root'
    grant('ec2:CreateSnapshot', account + 'volume/*', c)
    c = request(); c['StringEquals']['aws:RequestTag/Role'] = 'synthetic-backup'; c['NumericEquals'] = {'ec2:VolumeSize': '30'}
    grant('ec2:CreateSnapshot', snapshot, c)
    c = own(); c['StringEquals']['aws:ResourceTag/Role'] = 'synthetic-backup'
    grant(['ec2:CreateVolume', 'ec2:DeleteSnapshot'], snapshot, c)
    c = request(); c['StringEquals'].update({'aws:RequestTag/Role': 'restore', 'ec2:VolumeType': 'gp3'})
    c['NumericEquals'] = {'ec2:VolumeSize': '30', 'ec2:VolumeIops': '3000', 'ec2:VolumeThroughput': '125'}
    c['Bool'] = {'ec2:Encrypted': 'true'}; c['Null'] = {'ec2:ParentSnapshot': 'false'}
    grant('ec2:CreateVolume', account + 'volume/*', c)
    c = own(); c['StringEquals']['aws:ResourceTag/Role'] = 'restore'
    grant(['ec2:AttachVolume', 'ec2:DetachVolume'], account + 'volume/*', c)
    grant(['ec2:AttachVolume', 'ec2:DetachVolume'], account + 'instance/*', own())
    grant('ssm:SendCommand', account + 'instance/*', {
        'StringEquals': {'ssm:resourceTag/DeploymentId': STAGE, 'ssm:resourceTag/DataClass': 'synthetic-only'},
        'DateLessThan': {'aws:CurrentTime': '2026-11-13T00:00:00Z'}})

    # Merge only the disjoint EC2 lifecycle/cleanup resource types. Each action
    # supports its own ARN type; this does not introduce any valid new pair.
    merge_actions = {'ec2:DeleteSecurityGroup', 'ec2:StartInstances', 'ec2:StopInstances',
                     'ec2:RebootInstances', 'ec2:TerminateInstances', 'ec2:GetConsoleOutput', 'ec2:DeleteVolume'}
    merged = None
    output = []
    for item in statements:
        actions = item['Action'] if isinstance(item['Action'], list) else [item['Action']]
        if item['Condition'] == own() and set(actions) <= merge_actions:
            if merged is None:
                merged = copy.deepcopy(item); merged['Action'] = []; merged['Resource'] = []
                output.append(merged)
            merged['Action'].extend(actions)
            resources = item['Resource'] if isinstance(item['Resource'], list) else [item['Resource']]
            merged['Resource'].extend(resources)
        else:
            output.append(item)
    return {'Version': '2012-10-17', 'Statement': output}


def main():
    pilot.identity()
    policy = build()
    compact = json.dumps(policy, separators=(',', ':'))
    rendered = compact.replace('__ACCOUNT_ID__', pilot.ACCOUNT)
    assert len(rendered) <= 6144, 'Use customer-managed policy; never strip guards to fit user-inline limits'
    (pilot.REPO / 'deploy/aws/iam-staging.template.json').write_text(json.dumps(policy, indent=2) + '\n', encoding='utf-8', newline='\n')
    target = pilot.PRIVATE / 'iam-staging.compact.json'
    target.write_text(rendered + '\n', encoding='utf-8', newline='\n')
    print(json.dumps({'managedPolicyCharacters': len(rendered), 'ownerReviewFile': str(target),
                      'iamWrites': False, 'resourcesCreated': False}))


if __name__ == '__main__':
    main()
