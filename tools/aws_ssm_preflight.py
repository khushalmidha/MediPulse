"""Read-only SSM role/document preflight; never launches a host or grants IAM access."""
import json
import os
import re
import subprocess
import aws_native_pilot as pilot

ROLE = 'MediPulseEc2SSM'
CORE = 'arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore'


def read(service, operation, *arguments):
    env = os.environ.copy()
    env.update(PYTHONIOENCODING='utf-8', PYTHONUTF8='1', AWS_CLI_OUTPUT_ENCODING='UTF-8')
    result = subprocess.run(['aws', '--profile', pilot.PROFILE, '--region', pilot.REGION,
                             service, operation, *arguments, '--output', 'json', '--no-cli-pager'],
                            capture_output=True, text=True, encoding='utf-8', errors='replace',
                            env=env, timeout=35)
    if result.returncode:
        code = re.search(r'\(([A-Za-z0-9.]+)\) when calling', result.stderr)
        raise RuntimeError(service + ':' + operation + ':' + (code.group(1) if code else 'session_or_request_unavailable'))
    return json.loads(result.stdout)


def validate(account, profile, role, attached, inline):
    arn = 'arn:aws:iam::' + account + ':role/' + ROLE
    assert profile['Arn'] == 'arn:aws:iam::' + account + ':instance-profile/' + ROLE
    assert [item['Arn'] for item in profile['Roles']] == [arn]
    assert role['Arn'] == arn and not role.get('PermissionsBoundary'), 'Unexpected role/boundary: owner review required'
    statements = role['AssumeRolePolicyDocument']['Statement']
    assert len(statements) == 1
    trust = statements[0]
    principal = trust['Principal']
    services = principal.get('Service')
    services = services if isinstance(services, list) else [services]
    assert trust['Effect'] == 'Allow' and set(principal) == {'Service'} and services == ['ec2.amazonaws.com']
    actions = trust['Action'] if isinstance(trust['Action'], list) else [trust['Action']]
    assert actions == ['sts:AssumeRole'] and not trust.get('NotPrincipal')
    assert {item['PolicyArn'] for item in attached} == {CORE}, 'Unexpected attached role policies'
    assert not inline, 'Unexpected inline role policy'


def main():
    pilot.identity()
    profile = read('iam', 'get-instance-profile', '--instance-profile-name', ROLE)['InstanceProfile']
    role = read('iam', 'get-role', '--role-name', ROLE)['Role']
    attached = read('iam', 'list-attached-role-policies', '--role-name', ROLE)['AttachedPolicies']
    inline = read('iam', 'list-role-policies', '--role-name', ROLE)['PolicyNames']
    validate(pilot.ACCOUNT, profile, role, attached, inline)
    document = read('ssm', 'describe-document', '--name', 'AWS-RunShellScript')['Document']
    assert document['Name'] == 'AWS-RunShellScript' and document['DocumentType'] == 'Command'
    assert document['Status'] == 'Active'
    read('ssm', 'describe-instance-information', '--max-results', '5')
    pilot.emit('ssm-read-only-preflight-passed', iamWrites=False, resourcesCreated=False,
               instanceRegistrationVerified=False, sendCommandVerified=False, productionAcceptance=False)


if __name__ == '__main__':
    main()
