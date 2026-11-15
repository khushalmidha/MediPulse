"""Prepare a separate, owner-installed production grant; never write IAM."""
import copy
import argparse
import json
import aws_native_pilot as api
import render_staging_policy as staging

DEPLOYMENT = 'medipulse-production-20261115'
EXPIRY = '2026-11-17T00:00:00Z'


def build():
    doc = json.loads(json.dumps(staging.build()).replace(staging.STAGE, DEPLOYMENT)
                     .replace('synthetic-only', 'production').replace('staging-root', 'production-root')
                     .replace('synthetic-backup', 'production-backup'))
    out = []
    for item in doc['Statement']:
        actions = item['Action'] if isinstance(item['Action'], list) else [item['Action']]
        # This grant cannot destroy production data or create restore disks.
        actions = [a for a in actions if a not in ['ec2:CreateVolume', 'ec2:DeleteSnapshot',
                   'ec2:AttachVolume', 'ec2:DetachVolume', 'ec2:DeleteVolume', 'ec2:DeleteSecurityGroup',
                   'ec2:StartInstances', 'ec2:StopInstances', 'ec2:RebootInstances', 'ec2:TerminateInstances']]
        if not actions:
            continue
        item['Action'] = actions[0] if len(actions) == 1 else actions
        if actions == ['ec2:GetConsoleOutput']:
            item['Resource'] = 'arn:aws:ec2:us-east-1:__ACCOUNT_ID__:instance/*'
        if 'ec2:CreateTags' in actions:
            item['Resource'].append('arn:aws:ec2:us-east-1:__ACCOUNT_ID__:elastic-ip/*')
            item['Condition']['StringEquals']['ec2:CreateAction'] = ['RunInstances', 'CreateSecurityGroup', 'AllocateAddress', 'CreateSnapshot']
        out.append(item)
    arn = 'arn:aws:ec2:us-east-1:__ACCOUNT_ID__:'
    own = {'StringEquals': {'aws:ResourceTag/DeploymentId': DEPLOYMENT, 'aws:ResourceTag/DataClass': 'production'},
           'DateLessThan': {'aws:CurrentTime': EXPIRY}}
    request = {'StringEquals': {'aws:RequestTag/DeploymentId': DEPLOYMENT, 'aws:RequestTag/DataClass': 'production'},
               'DateLessThan': {'aws:CurrentTime': EXPIRY}}
    out.extend([
        {'Effect': 'Allow', 'Action': 'ec2:AuthorizeSecurityGroupIngress', 'Resource': arn + 'security-group/*', 'Condition': copy.deepcopy(own)},
        {'Effect': 'Allow', 'Action': 'ec2:AllocateAddress', 'Resource': arn + 'elastic-ip/*', 'Condition': request},
        {'Effect': 'Allow', 'Action': 'ec2:AssociateAddress', 'Resource': [arn + kind + '/*' for kind in ['elastic-ip', 'instance', 'network-interface']], 'Condition': copy.deepcopy(own)},
        {'Effect': 'Allow', 'Action': ['ec2:DescribeAddresses', 'ec2:DescribeInstanceAttribute', 'ec2:DescribeInstanceCreditSpecifications',
         'ec2:DescribeInstances', 'ec2:DescribeVolumes', 'ec2:DescribeSecurityGroups', 'ec2:DescribeSubnets',
         'ec2:DescribeVpcs', 'ec2:DescribeRouteTables', 'ec2:DescribeSnapshots', 'ec2:DescribeInstanceStatus'],
         'Resource': '*', 'Condition': {'StringEquals': {'aws:RequestedRegion': api.REGION}}},
    ])
    return {'Version': '2012-10-17', 'Statement': out}


def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--offline',action='store_true'); args=parser.parse_args()
    if args.offline:
        prior=json.loads((api.PRIVATE/'aws-staging-state.json').read_text(encoding='utf-8'))
        audit=json.loads((api.PRIVATE/'aws-resource-audit.json').read_text(encoding='utf-8'))
        expected=next(r for r in audit['regions'] if r['region']==api.REGION)['networkInterfaces'][0]['OwnerId']
        assert prior['account']==expected and len(expected)==12 and expected.isdigit()
        api.ACCOUNT=expected
    else:
        api.identity()
    obj = build()
    compact = json.dumps(obj, separators=(',', ':')).replace('__ACCOUNT_ID__', api.ACCOUNT)
    assert len(compact) <= 6144
    (api.REPO / 'deploy/aws/iam-production-host.template.json').write_text(json.dumps(obj, indent=2) + '\n', encoding='utf-8')
    path = api.PRIVATE / 'iam-production-host.compact.json'
    path.write_text(compact + '\n', encoding='utf-8')
    print(json.dumps({'ownerPolicy': 'MediPulseProductionHost', 'characters': len(compact), 'file': str(path), 'iamWrites': False,'livePermissionsVerified':False,'offlineAccountFromVerifiedManifest':args.offline}))


if __name__ == '__main__':
    main()
