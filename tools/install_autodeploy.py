"""Prepare an exact one-time installer, then use the existing non-root SSM grant."""
import argparse
import base64
import gzip
import hashlib
import json
from pathlib import Path
import re
import shlex
import subprocess
import aws_production as production

FILES={
    'deploy/aws/autodeploy.py':'/usr/local/lib/medipulse-autodeploy/autodeploy.py',
    'deploy/aws/medipulse-autodeploy.service':'/etc/systemd/system/medipulse-autodeploy.service',
    'deploy/aws/medipulse-autodeploy.timer':'/etc/systemd/system/medipulse-autodeploy.timer',
}

def installer(source,baseline):
    assert re.fullmatch('[a-f0-9]{40}',source) and re.fullmatch('[a-f0-9]{40}',baseline)
    script='set -euo pipefail\n'
    script+='token=$(curl --fail --silent --max-time 5 -X PUT -H "X-aws-ec2-metadata-token-ttl-seconds: 60" http://169.254.169.254/latest/api/token)\n'
    script+='test "$(curl --fail --silent --max-time 5 -H "X-aws-ec2-metadata-token: $token" http://169.254.169.254/latest/meta-data/instance-id)" = i-0e99a3d554dfd8921\nunset token\n'
    script+='test -f /srv/medipulse/.ec2-root-storage-approved\ntest -s /etc/medipulse/frontend.env\ntest -s /opt/medipulse/deploy/aws/reels-enabled.override.yml\n'
    script+='install -d -m 0755 /usr/local/lib/medipulse-autodeploy\n'
    for name,destination in FILES.items():
        data=subprocess.check_output(['git','show',source+':'+name],cwd=production.api.REPO)
        encoded=base64.b64encode(gzip.compress(data)).decode()
        script+='printf %s '+shlex.quote(encoded)+' | base64 -d | gzip -d >'+destination+'.next\n'
        script+='echo '+shlex.quote(hashlib.sha256(data).hexdigest()+'  '+destination+'.next')+' | sha256sum -c -\n'
        script+='chmod 0644 '+destination+'.next\nmv '+destination+'.next '+destination+'\n'
    script+='/usr/bin/python3 /usr/local/lib/medipulse-autodeploy/autodeploy.py --initialize '+baseline+'\n'
    script+='systemctl daemon-reload\nsystemctl enable --now medipulse-autodeploy.timer\nsystemctl start --no-block medipulse-autodeploy.service\nsystemctl is-enabled medipulse-autodeploy.timer\necho AUTO_DEPLOY_INSTALLED_FIRST_BUILD_REQUESTED\n'
    return script

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--install-approved',action='store_true');args=parser.parse_args()
    source=subprocess.check_output(['git','rev-parse','HEAD'],cwd=production.api.REPO,text=True).strip()
    state=production.load();script=installer(source,state['runtimeSource'])
    path=production.api.PRIVATE/'install-autodeploy-owner-command.txt'
    # One literal shell command is convenient for AWS Run Command's commands box.
    command='/bin/bash -c '+shlex.quote(script)
    path.write_bytes((command+'\n').encode())
    print(json.dumps({'preparedSource':source,'commandFile':str(path),'bytes':len(command.encode()),'resourcesCreated':False}),flush=True)
    if args.install_approved:
        session=production.native.Session(production.STATE,production.LOGS,production.target)
        print(session.run(script,'install-main-autodeploy',180))

if __name__=='__main__':main()
