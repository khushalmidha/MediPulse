"""Render owner-reviewable pilot IAM policy privately; STS read only, no IAM writes."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--profile', default='medipulse-deployer')
    args = parser.parse_args()
    result = subprocess.run(
        ['aws', '--profile', args.profile, '--region', 'us-east-1', 'sts',
         'get-caller-identity', '--output', 'json', '--no-cli-pager'],
        capture_output=True, text=True, timeout=25)
    if result.returncode:
        print('Non-root CLI session unavailable; authenticate medipulse-deployer. No root fallback.')
        return 2
    identity = json.loads(result.stdout)
    account = identity.get('Account', '')
    if not re.fullmatch(r'\d{12}', account) or not identity.get('Arn', '').endswith(':user/medipulse-deployer'):
        raise ValueError('Expected non-root owner identity not selected')
    private = Path(os.environ['LOCALAPPDATA']) / 'MediPulse' / 'Private'
    prior = json.loads((private / 'aws-resource-audit.json').read_text(encoding='utf-8'))
    expected = next(r for r in prior['regions'] if r['region'] == 'us-east-1')['networkInterfaces'][0]['OwnerId']
    if account != expected:
        raise ValueError('Unexpected account; no policy rendered')
    template = Path(__file__).resolve().parents[1] / 'deploy/aws/iam-native-pilot.template.json'
    rendered = template.read_text(encoding='utf-8').replace('__ACCOUNT_ID__', account)
    policy = json.loads(rendered)
    for statement in policy['Statement']:
        resources = statement['Resource']
        for resource in resources if isinstance(resources, list) else [resources]:
            if '${' in resource or '__ACCOUNT_ID__' in resource:
                raise ValueError('Unresolved or unsupported ARN variable')
    private.mkdir(parents=True, exist_ok=True)
    target = private / 'iam-native-pilot.json'
    # Keep the Console paste payload below its editor limit without changing grants.
    compact = json.dumps(policy, separators=(',', ':')) + '\n'
    if len(compact) > 6144:
        raise ValueError('Policy exceeds the Console paste limit; review scope instead of widening it')
    target.write_text(compact, encoding='utf-8')
    target.with_name('iam-native-pilot.compact.json').write_text(compact, encoding='utf-8')
    print(json.dumps({'ownerReviewFile': str(target), 'iamWrites': False, 'resourcesCreated': False,
                      'accountSuffix': account[-4:], 'profile': args.profile}))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
