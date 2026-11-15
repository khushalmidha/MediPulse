"""One persistent production host. Failures retain it for repair, never relaunch/delete."""
import argparse
import base64
import datetime as dt
import hashlib
import json
import re
import shlex
import subprocess
import time
import urllib.request
import socket
from pathlib import Path
import aws_native_pilot as api
import aws_ssm_preflight as preflight
import check_native_ssm as native
from render_production_policy import DEPLOYMENT

STATE = api.PRIVATE / 'aws-production-state.json'
LOGS = api.PRIVATE / 'aws-production-logs'
IMAGE = 'medipulse-production:' + native.SOURCE[:12]
ROOT = '/srv/medipulse'
COMPOSE = 'v2.40.3'
COMPOSE_SHA = 'd26373b19e89160546d15407516cc59f453030d9bc5b43ba7faf16f7b4980137'


def load():
    return json.loads(STATE.read_text(encoding='utf-8'))


def save(state):
    state['updatedAtUtc'] = dt.datetime.now(dt.timezone.utc).isoformat()
    STATE.write_text(json.dumps(state, indent=2) + '\n', encoding='utf-8')


def tags(kind, role):
    return json.dumps([{'ResourceType': kind, 'Tags': [{'Key': 'DeploymentId', 'Value': DEPLOYMENT},
        {'Key': 'DataClass', 'Value': 'production'}, {'Key': 'Project', 'Value': 'MediPulse'},
        {'Key': 'Role', 'Value': role}, {'Key': 'Name', 'Value': DEPLOYMENT}]}])


def own(item, role):
    values = {t['Key']: t['Value'] for t in item.get('Tags', [])}
    assert values.get('DeploymentId') == DEPLOYMENT and values.get('DataClass') == 'production'
    assert values.get('Project') == 'MediPulse' and values.get('Role') == role


def target(state, instance):
    own(instance, 'production-host')
    assert state['account'] == api.ACCOUNT and state['deploymentId'] == DEPLOYMENT
    assert instance['InstanceId'] == state['instanceId'] != 'i-07b4f6961dc550de0'
    assert instance['ClientToken'] == state['clientToken'] == DEPLOYMENT + '-one'
    assert instance['InstanceType'] == 't4g.small' and instance['ImageId'] == api.AMI
    assert instance['MetadataOptions']['HttpTokens'] == 'required'
    assert instance['State']['Name'] == 'running'
    assert instance['IamInstanceProfile']['Arn'] == 'arn:aws:iam::' + api.ACCOUNT + ':instance-profile/' + preflight.ROLE
    assert len(instance['BlockDeviceMappings']) == 1
    assert instance['BlockDeviceMappings'][0]['Ebs']['DeleteOnTermination'] is False


def find(operation, key, role=None):
    rows = api.aws(operation, '--filters', 'Name=tag:DeploymentId,Values=' + DEPLOYMENT)[key]
    if role:
        for item in rows:
            own(item, role)
    return rows


def runtime_source():
    args = ['git', 'diff', '--quiet', native.SOURCE, 'HEAD', '--', 'backend', 'frontend',
            ':(exclude)backend/scripts/testIntegration.js', ':(exclude)backend/tests/integration/reels.test.js',
            ':(exclude)backend/tests/integration/reels-lifecycle.test.js']
    assert subprocess.run(args, cwd=api.REPO, capture_output=True).returncode == 0, 'Runtime candidate drift; review/pin before deployment'
    native.reviewed_source()


def prepare():
    api.identity(); runtime_source(); LOGS.mkdir(exist_ok=True)
    assert (api.PRIVATE / 'production-environment.json').is_file(), 'Prepare private environment before provisioning'
    if STATE.exists():
        state = load()
        assert state['deploymentId'] == DEPLOYMENT and state['account'] == api.ACCOUNT
        assert state['source'] == native.SOURCE
        return state
    state = {'deploymentId': DEPLOYMENT, 'account': api.ACCOUNT, 'source': native.SOURCE,
        'clientToken': DEPLOYMENT + '-one', 'status': 'prepared', 'maximumInstances': 1, 'maximumAddresses': 1,
        'instanceType': 't4g.small', 'encryptedGp3GiB': 30, 'monthlyTargetUSD': 10,
        'trialAssumptionThrough': '2026-12-31', 'trialQuotaIndependentlyVerified': False,
        'deleteOnTermination': False, 'apiTerminationProtection': True, 'autoTerminate': False,
        'ownerInstruction': 'joo bhi karna hain karron aws pee karna hain complete yaa partial bata doo aur kar bhi do jaldi complete karron deployment work joo easy padde voo path choose karron aws deployment abhi tak complete nahi karren pure ?',
        'scope': 'one persistent AWS full-site core deployment, existing Atlas/provider configuration; Reels/enterprise remain disabled',
        'domain': 'medipulse.live', 'productionLive': False, 'failures': []}
    save(state); return state


def permissions():
    state = prepare()
    vpc = next(v['VpcId'] for v in api.aws('describe-vpcs')['Vpcs'] if v.get('IsDefault'))
    sg = api.aws('create-security-group', '--group-name', DEPLOYMENT, '--description', 'MediPulse production web only',
                 '--vpc-id', vpc, '--tag-specifications', tags('security-group', 'production-network'), dry=True)
    address = api.aws('allocate-address', '--domain', 'vpc', '--tag-specifications', tags('elastic-ip', 'production-address'), dry=True)
    state['permissionChecks'] = {'CreateSecurityGroup': sg, 'AllocateAddress': address}; save(state)
    return sg == address == 'DryRunOperation'


def validate_web_rules(group):
    own(group, 'production-network')
    ports = set()
    for rule in group['IpPermissions']:
        assert rule['IpProtocol'] == 'tcp' and rule['FromPort'] == rule['ToPort']
        assert not rule.get('Ipv6Ranges') and not rule.get('UserIdGroupPairs') and not rule.get('PrefixListIds')
        assert [r['CidrIp'] for r in rule.get('IpRanges', [])] == ['0.0.0.0/0']
        ports.add(rule['FromPort'])
    assert ports <= {80, 443}
    return ports


def launch_request(state, image, subnet_id, group_id):
    return {'ImageId':api.AMI,'InstanceType':'t4g.small','MinCount':1,'MaxCount':1,'ClientToken':state['clientToken'],
        'DisableApiTermination':True,'CreditSpecification':{'CpuCredits':'standard'},'IamInstanceProfile':{'Name':preflight.ROLE},
        'MetadataOptions':{'HttpTokens':'required','HttpPutResponseHopLimit':1},
        'NetworkInterfaces':[{'DeviceIndex':0,'SubnetId':subnet_id,'AssociatePublicIpAddress':False,'Groups':[group_id],'DeleteOnTermination':True}],
        'BlockDeviceMappings':[{'DeviceName':image['RootDeviceName'],'Ebs':{'VolumeSize':30,'VolumeType':'gp3','Iops':3000,'Throughput':125,'Encrypted':True,'DeleteOnTermination':False}}],
        'TagSpecifications':sum([json.loads(tags(kind,role)) for kind,role in [('instance','production-host'),('volume','production-root'),('network-interface','production-interface')]],[])}


def launch():
    state = prepare()
    if state.get('instanceId'):
        rows = api.aws('describe-instances', '--instance-ids', state['instanceId'])['Reservations']
        assert rows, 'Existing production host absent; no automatic replacement'
        target(state, rows[0]['Instances'][0]); return
    rows = [i for r in find('describe-instances', 'Reservations') for i in r['Instances']]
    assert len(rows) <= 1, 'Multiple production resources: stop for review'
    if rows:
        assert rows[0]['ClientToken'] == state['clientToken']
        state['instanceId'] = rows[0]['InstanceId']; save(state)
        target(state, rows[0]); return
    assert permissions(), 'Production IAM grant missing; no paid host launched'
    vpc = next(v['VpcId'] for v in api.aws('describe-vpcs')['Vpcs'] if v.get('IsDefault'))
    subnet = sorted([s for s in api.aws('describe-subnets', '--filters', 'Name=vpc-id,Values=' + vpc)['Subnets']
                     if s.get('DefaultForAz') and s['AvailableIpAddressCount'] > 3], key=lambda s:s['AvailabilityZone'])[0]
    api.network_preflight(subnet)
    groups = find('describe-security-groups', 'SecurityGroups', 'production-network'); assert len(groups) <= 1
    if groups:
        group = groups[0]; assert group['GroupName'] == DEPLOYMENT
    else:
        result = api.aws('create-security-group', '--group-name', DEPLOYMENT, '--description', 'MediPulse web80/443; SSM management',
                         '--vpc-id', vpc, '--tag-specifications', tags('security-group', 'production-network'))
        group = api.aws('describe-security-groups', '--group-ids', result['GroupId'])['SecurityGroups'][0]
    current = validate_web_rules(group)
    for port in sorted({80,443} - current):
        rule = [{'IpProtocol':'tcp','FromPort':port,'ToPort':port,'IpRanges':[{'CidrIp':'0.0.0.0/0'}]}]
        api.aws('authorize-security-group-ingress', '--group-id', group['GroupId'], '--ip-permissions', json.dumps(rule))
    assert validate_web_rules(api.aws('describe-security-groups', '--group-ids', group['GroupId'])['SecurityGroups'][0]) == {80,443}
    image = api.aws('describe-images', '--image-ids', api.AMI)['Images'][0]
    assert image['OwnerId'] == '099720109477' and image['Architecture'] == 'arm64' and not image.get('ProductCodes')
    request = launch_request(state,image,subnet['SubnetId'],group['GroupId'])
    path = LOGS/'launch.json'; path.write_text(json.dumps(request),encoding='utf-8')
    assert api.aws('run-instances','--cli-input-json','file://'+str(path),dry=True)=='DryRunOperation'
    state.update(status='launch-requested',groupId=group['GroupId']); save(state)
    item = api.aws('run-instances','--cli-input-json','file://'+str(path))['Instances'][0]
    state['instanceId']=item['InstanceId']; save(state)
    for _ in range(60):
        item=api.aws('describe-instances','--instance-ids',state['instanceId'])['Reservations'][0]['Instances'][0]
        if item['State']['Name']=='running': break
        time.sleep(3)
    target(state,item)
    volume=api.aws('describe-volumes','--volume-ids',item['BlockDeviceMappings'][0]['Ebs']['VolumeId'])['Volumes'][0]
    own(volume,'production-root'); assert volume['Size']==30 and volume['Encrypted'] and volume['VolumeType']=='gp3'
    credits=api.aws('describe-instance-credit-specifications','--instance-ids',state['instanceId'])['InstanceCreditSpecifications'][0]
    assert credits['CpuCredits']=='standard'
    protection=api.aws('describe-instance-attribute','--instance-id',state['instanceId'],'--attribute','disableApiTermination')
    assert protection['DisableApiTermination']['Value'] is True
    state.update(volumeId=volume['VolumeId'],status='running'); save(state)


def address():
    state=load(); instance=api.aws('describe-instances','--instance-ids',state['instanceId'])['Reservations'][0]['Instances'][0]; target(state,instance)
    rows=find('describe-addresses','Addresses','production-address'); assert len(rows)<=1
    if state.get('allocationId'):
        rows=api.aws('describe-addresses','--allocation-ids',state['allocationId'])['Addresses']; assert len(rows)==1
    if rows:
        item=rows[0]; own(item,'production-address')
    else:
        assert not state.get('addressRequestPending'), 'Ambiguous prior allocation; read-only recovery required, never allocate a second address'
        state['addressRequestPending']=True; save(state)
        item=api.aws('allocate-address','--domain','vpc','--tag-specifications',tags('elastic-ip','production-address'))
        state.update(allocationId=item['AllocationId'],publicIp=item['PublicIp']); save(state)
        item=api.aws('describe-addresses','--allocation-ids',state['allocationId'])['Addresses'][0]; own(item,'production-address')
    if item.get('InstanceId'):
        assert item['InstanceId']==state['instanceId']
    else:
        assert not item.get('AssociationId') and not item.get('NetworkInterfaceId')
        api.aws('associate-address','--allocation-id',item['AllocationId'],'--instance-id',state['instanceId'],'--no-allow-reassociation')
    state.update(allocationId=item['AllocationId'],publicIp=item['PublicIp'],addressRequestPending=False); save(state)


def bootstrap():
    return '''export DEBIAN_FRONTEND=noninteractive
apt-get update -qq >/tmp/medipulse-install.log 2>&1
apt-get install -y -qq docker.io git ca-certificates curl openssl >>/tmp/medipulse-install.log 2>&1
systemctl enable --now docker
install -d -m 0755 /usr/local/lib/docker/cli-plugins
curl -fsSL --proto =https --tlsv1.2 https://github.com/docker/compose/releases/download/''' + COMPOSE + '''/docker-compose-linux-aarch64 -o /usr/local/lib/docker/cli-plugins/docker-compose
echo "''' + COMPOSE_SHA + '''  /usr/local/lib/docker/cli-plugins/docker-compose" | sha256sum -c -
chmod 0755 /usr/local/lib/docker/cli-plugins/docker-compose
test "$(docker compose version --short)" = 2.40.3
install -d -m 0700 /etc/medipulse
install -d -m 0755 /srv/medipulse /srv/medipulse/frontend /srv/medipulse/redis /srv/medipulse/caddy /opt/medipulse/deploy/aws
install -d -m 0755 -o 1000 -g 1000 /srv/medipulse/reels /srv/medipulse/models
if test ! -d /srv/medipulse/source/.git; then
 git init -q /srv/medipulse/source
 git -C /srv/medipulse/source remote add origin https://github.com/khushalmidha/MediPulse.git
 git -C /srv/medipulse/source fetch -q --depth=1 --filter=blob:none origin '''+native.SOURCE+'''
 git -C /srv/medipulse/source sparse-checkout init --cone
 git -C /srv/medipulse/source sparse-checkout set backend frontend
 git -C /srv/medipulse/source checkout -q '''+native.SOURCE+'''
fi
test "$(git -C /srv/medipulse/source rev-parse HEAD)" = '''+native.SOURCE+'''
if ! docker image inspect '''+IMAGE+''' >/dev/null 2>&1; then
 docker build --quiet -t '''+IMAGE+''' /srv/medipulse/source/backend >/srv/medipulse/build.log 2>&1 || { tail -n 25 /srv/medipulse/build.log; exit 1; }
fi
test "$(df --output=avail -B1 /srv/medipulse | tail -n1)" -gt 10737418240
docker image inspect '''+IMAGE+''' --format '{{.Id}}'
echo PRODUCTION_BACKEND_IMAGE_READY
'''


def install_environment(session):
    result=session.run('umask 077\nopenssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out /etc/medipulse/.transport.key 2>/dev/null\nopenssl pkey -in /etc/medipulse/.transport.key -pubout\n','environment-public-key',60)
    pem=re.search(r'-----BEGIN PUBLIC KEY-----.*?-----END PUBLIC KEY-----',result,re.S)[0]
    public=api.PRIVATE/'production-transport.pub.pem'; public.write_text(pem+'\n',encoding='ascii')
    plaintext=(api.PRIVATE/'production-environment.json').read_bytes()
    encrypted=subprocess.run(['node','tools/deployment_seal.mjs',str(public)],input=plaintext,capture_output=True,cwd=api.REPO,check=True).stdout
    encoded=base64.b64encode(encrypted).decode()
    # Only authenticated ciphertext and code enter the AWS command history.
    js="import fs from 'node:fs';import {privateDecrypt,createDecipheriv,constants} from 'node:crypto';const e=JSON.parse(fs.readFileSync('/deploy/.envelope'));if(e.format!=='medipulse-env-v1')throw Error('format');const k=privateDecrypt({key:fs.readFileSync('/deploy/.transport.key'),oaepHash:'sha256',padding:constants.RSA_PKCS1_OAEP_PADDING},Buffer.from(e.key,'base64'));const d=createDecipheriv('aes-256-gcm',k,Buffer.from(e.iv,'base64'));d.setAuthTag(Buffer.from(e.tag,'base64'));const v=JSON.parse(Buffer.concat([d.update(Buffer.from(e.body,'base64')),d.final()]));for(const [name,value]of Object.entries(v)){if(!['backend','frontend'].includes(name))throw Error('file');const p='/deploy/'+name+'.env';if(fs.existsSync(p)&&fs.readFileSync(p,'utf8')!==value)throw Error('Existing environment differs; explicit config update required');if(!fs.existsSync(p))fs.writeFileSync(p,value,{mode:0o600,flag:'wx'});}"
    script="umask 077\nprintf %s "+shlex.quote(encoded)+" | base64 -d >/etc/medipulse/.envelope\n"
    script+='docker run --rm --pull=never --network none --user 0:0 --memory 128m --memory-swap 128m --mount type=bind,source=/etc/medipulse,target=/deploy --entrypoint node '+IMAGE+' --input-type=module -e '+shlex.quote(js)+'\n'
    script+='rm -f /etc/medipulse/.transport.key /etc/medipulse/.envelope\necho SEALED_ENVIRONMENT_INSTALLED\n'
    assert 'SEALED_ENVIRONMENT_INSTALLED' in session.run(script,'install-sealed-environment',60)


def asset(name,destination):
    data=subprocess.check_output(['git','show','HEAD:'+name],cwd=api.REPO)
    return 'printf %s '+shlex.quote(base64.b64encode(data).decode())+' | base64 -d >'+shlex.quote(destination)+'\n'


def configure(session):
    state=load()
    script=''
    for name in ['compose.yml','ec2-root.override.yml','fullsite.override.yml','Caddyfile.fullsite']:
        script+=asset('deploy/aws/'+name,'/opt/medipulse/deploy/aws/'+name)
    script+=asset('deploy/aws/Caddyfile.pending','/opt/medipulse/deploy/aws/Caddyfile.active')
    script+=asset('deploy/aws/medipulse-fullsite.service','/etc/systemd/system/medipulse-fullsite.service')
    script+='docker run --rm --pull=never --user 0:0 --memory 1024m --memory-swap 1024m --cpus 1.6 --env-file /etc/medipulse/frontend.env -e NODE_OPTIONS=--max-old-space-size=768 --mount type=bind,source=/srv/medipulse/source/frontend,target=/frontend --workdir /frontend --entrypoint /bin/sh '+IMAGE+" -c 'npm ci --ignore-scripts --no-audit --no-fund && npm run build' >/srv/medipulse/frontend-build.log 2>&1 || { tail -n 25 /srv/medipulse/frontend-build.log; exit 1; }\n"
    script+='cp -a /srv/medipulse/source/frontend/dist/. /srv/medipulse/frontend/\ntest -s /srv/medipulse/frontend/index.html\n'
    runtime='MEDIPULSE_IMAGE='+state['backendImageId']+'\nAPI_HOST=www.medipulse.live\nTLS_EMAIL=khushalmidha24@gmail.com\n'
    script+='printf %s '+shlex.quote(base64.b64encode(runtime.encode()).decode())+' | base64 -d >/etc/medipulse/runtime.env\n'
    script+='chmod 0600 /etc/medipulse/runtime.env\ntouch /srv/medipulse/.ec2-root-storage-approved\n'
    script+='cd /opt/medipulse/deploy/aws\nset -a\n. /etc/medipulse/runtime.env\nset +a\n'
    script+='docker compose -f compose.yml -f ec2-root.override.yml -f fullsite.override.yml config --quiet\n'
    script+='systemctl daemon-reload\nsystemctl enable --now medipulse-fullsite.service\necho PRODUCTION_CORE_STARTED\n'
    assert 'PRODUCTION_CORE_STARTED' in session.run(script,'configure-full-site',1200)


def run():
    runtime_source(); preflight.main(); prepare()
    try:
        launch(); address()
        state=load()
        if state.get('coreReady'):
            api.emit('aws-core-already-running',publicIp=state['publicIp'],status=state['status']); return
        session=native.Session(STATE,LOGS,target)
        session.verify(); session.online()
        output=session.run(bootstrap(),'build-production-backend',1200)
        state=load(); state['backendImageId']=re.search(r'sha256:[a-f0-9]{64}',output)[0]; save(state)
        install_environment(session); configure(session)
        url='http://'+load()['publicIp']+'/__aws-health'
        deadline=time.monotonic()+180
        while time.monotonic()<deadline:
            try:
                with urllib.request.urlopen(url,timeout=8) as response:
                    assert response.status==200 and response.headers.get('X-MediPulse-Origin')=='aws-ec2'
                    break
            except Exception: time.sleep(5)
        else: raise RuntimeError('AWS core readiness not verified; host retained for repair, no DNS change')
        state=load(); state.update(status='waiting-dns',coreReady=True,productionLive=False); save(state)
        api.emit('aws-core-ready-before-dns',publicIp=state['publicIp'],domain='medipulse.live',reelsEnabled=False,
                 dnsRequired={'A @':state['publicIp'],'CNAME www':'medipulse.live'})
    except BaseException as error:
        state=load(); state.setdefault('failures',[]).append(type(error).__name__+': '+str(error))
        if not state.get('coreReady'): state['status']='needs-repair'
        save(state)
        raise
    # Deliberately no destroy/terminate finally: retain the one production host.


def verify_domain():
    state=load(); assert state.get('coreReady')
    for path in ['/','/backend/health/live','/backend/health/ready']:
        with urllib.request.urlopen('https://www.medipulse.live'+path,timeout=20) as response:
            assert response.status==200 and response.headers.get('X-MediPulse-Origin')=='aws-ec2', 'Traffic is not yet verified on AWS'
            body=response.read()
            if path=='/':
                assert 'text/html' in response.headers.get('Content-Type','') and b'/assets/' in body, 'Frontend build is missing'
            else:
                assert 'application/json' in response.headers.get('Content-Type',''), 'Health route returned a frontend fallback'
                health=json.loads(body)
                if path.endswith('/live'): assert health.get('status')=='alive'
                else: assert health.get('ready') is True and health.get('dependencies',{}).get('mongodb')=='ready' and health.get('dependencies',{}).get('redis')=='ready'
    state.update(status='live-core',productionLive=True,reelsEnabled=False,restoreVerified=False); save(state)
    api.emit('aws-domain-core-verified',url='https://medipulse.live',reelsEnabled=False,restoreVerified=False)


def activate_domain():
    state=load(); assert state.get('coreReady')
    for name in ['medipulse.live','www.medipulse.live']:
        addresses={row[4][0] for row in socket.getaddrinfo(name,443,type=socket.SOCK_STREAM)}
        assert addresses=={state['publicIp']}, 'DNS still points elsewhere (including IPv6); retain existing app and wait'
    session=native.Session(STATE,LOGS,target)
    script=asset('deploy/aws/Caddyfile.fullsite','/opt/medipulse/deploy/aws/Caddyfile.active')
    script+='systemctl restart medipulse-fullsite.service\necho FULL_SITE_HTTPS_ACTIVATION_REQUESTED\n'
    session.run(script,'activate-domain-https',120)
    deadline=time.monotonic()+600
    while time.monotonic()<deadline:
        try:
            verify_domain(); return
        except Exception: time.sleep(10)
    raise RuntimeError('Trusted domain HTTPS not verified; retain host and use saved DNS rollback record if necessary')


def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--run-approved',action='store_true'); parser.add_argument('--verify-domain',action='store_true'); parser.add_argument('--activate-domain',action='store_true')
    args=parser.parse_args()
    if args.activate_domain: activate_domain(); return
    if args.verify_domain: verify_domain(); return
    if args.run_approved: run(); return
    ready=permissions(); api.emit('production-prepared',permissionsReady=ready,resourcesCreated=False,policy='MediPulseProductionHost')


if __name__=='__main__': main()
