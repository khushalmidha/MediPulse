"""Bounded same-host Reels acceptance; never loads production config into fixtures."""
import argparse
import base64
import gzip
import json
import shlex
import sys
import re
import subprocess
from pathlib import PurePosixPath
import aws_production as production

ROOT='/srv/medipulse-acceptance-20261115'
SUFFIX='a15c202611150001'
NETWORK='medipulse-acceptance-20261115'
MONGO='medipulse-acceptance-mongo'
REDIS='capacity-redis-'+SUFFIX
MODEL_HASHES={
    'config.json':'05b570bff786faa5c4604152aa16f19f77ed6dfc31e47dd0f3dd987078693ac7',
    'tokenizer.json':'b60b6b43406a48bf3638526314f3d232d97058bc93472ff2de930d43686fa441',
    'tokenizer_config.json':'3f5961b9ac86288cccdb97f32fb848d6187c78e1603958c53f3ea1f296b7d8a2',
    'onnx/model_quantized.onnx':'66fc00f5f29afcaff34092e1bdd20008ca3918265a82fb9695a551e510cc4ebc',
}

def session():
    return production.native.Session(production.STATE,production.LOGS,production.target)

def native_script():
    script='install -d -m 0755 '+ROOT+'/logs\n'
    repo,revision=production.api.MODEL.rsplit('/',1)
    for name,digest in MODEL_HASHES.items():
        assert name in production.api.MODEL_FILES
        path='/srv/medipulse/models/'+production.api.MODEL+'/'+name
        script+='install -d -m 0755 '+shlex.quote(str(PurePosixPath(path).parent))+'\n'
        check='printf %s '+shlex.quote(digest+'  '+path+'\n')+' | sha256sum -c -'
        script+='if ! '+check+' >/dev/null 2>&1; then\n'
        script+='curl --fail --silent --show-error --location --proto =https --tlsv1.2 '+shlex.quote('https://huggingface.co/'+repo+'/resolve/'+revision+'/'+name)+' -o '+shlex.quote(path+'.download')+'\n'
        script+='printf %s '+shlex.quote(digest+'  '+path+'.download\n')+' | sha256sum -c -\nmv '+shlex.quote(path+'.download')+' '+shlex.quote(path)+'\nfi\n'+check+'\n'
    script+='result=0\ndocker run --rm --pull=never --name medipulse-native-acceptance --network none --memory 1024m --memory-swap 1024m --cpus .8 '
    script+='-e NODE_ENV=test -e MAIL_DELIVERY=disabled -e REELS_REAL_MEDIA_TESTS=true -e REELS_EMBEDDING_ALLOW_DOWNLOAD=false -e REELS_EMBEDDING_CACHE_DIR=/models '
    script+='--mount type=bind,source=/srv/medipulse/models,target=/models,readonly '
    script+='--mount type=bind,source=/srv/medipulse/source/backend/tests,target=/app/tests,readonly '
    script+='--entrypoint /bin/sh '+production.IMAGE+' -c '+shlex.quote('node --test --test-concurrency=1 /app/tests/reel-real-media.test.js; result=$?; printf NATIVE_MEMORY_PEAK_BYTES=; cat /sys/fs/cgroup/memory.peak; exit "$result"')
    script+=' >'+ROOT+'/logs/native.log 2>&1 || result=$?\ntail -n 30 '+ROOT+'/logs/native.log\nexit "$result"\n'
    return script

def main():
    sys.stdout.reconfigure(encoding='utf-8')
    parser=argparse.ArgumentParser();parser.add_argument('--native',action='store_true');parser.add_argument('--capacity',action='store_true');parser.add_argument('--integration',action='store_true');parser.add_argument('--prepare-release',action='store_true');parser.add_argument('--author-smoke',action='store_true');args=parser.parse_args()
    if args.native:print(session().run(native_script(),'production-offline-native-acceptance',1200))
    elif args.capacity:print(session().run(capacity_script(),'production-isolated-capacity-299',1200))
    elif args.integration:
        prepare_integration()
        print(session().run(capacity_script(integration=True),'production-author-publish-integration',600))
    elif args.prepare_release:prepare_release()
    elif args.author_smoke:print(session().run(capacity_script(author=True),'production-verified-author-real-workflow',600))
    else:parser.error('Choose an acceptance step')

OVERLAYS=['services/reelService.js','routes/reels.js','scripts/reelsPreflight.js','tests/integration/reels.test.js']

def prepare_integration():
    for index,name in enumerate(OVERLAYS):
        data=(production.api.REPO/'backend'/name).read_bytes()
        destination=ROOT+'/candidate/'+name
        script='install -d -m 0755 '+destination.rsplit('/',1)[0]+'\nprintf %s '+shlex.quote(base64.b64encode(gzip.compress(data)).decode())+' | base64 -d | gzip -d >'+destination+'\n'
        session().run(script,'author-test-overlay-'+str(index),60)

def capacity_script(integration=False,author=False):
    script='install -d -m 0755 '+ROOT+'/capacity-media\nchown 1000:1000 '+ROOT+'/capacity-media\n'
    script+=production.asset('tools/reels_capacity_check.mjs',ROOT+'/capacity.mjs')
    # Refuse pre-existing containers/networks, including abandoned fixtures; repair explicitly.
    for name in [MONGO,REDIS,'medipulse-capacity-acceptance']:
        script+='! docker container inspect '+name+' >/dev/null 2>&1\n'
    script+='! docker network inspect '+NETWORK+' >/dev/null 2>&1\n'
    script+='docker pull --quiet mongo:7 >/dev/null\n'
    redis='redis:7-alpine@sha256:6ab0b6e7381779332f97b8ca76193e45b0756f38d4c0dcda72dbb3c32061ab99'
    script+='docker network create --internal --label medipulse.acceptance=20261115 '+NETWORK+' >/dev/null\n'
    # All cleanup targets are literal disposable fixture names, never production services/data.
    cleanup='docker rm -f medipulse-capacity-acceptance '+MONGO+' '+REDIS+' >/dev/null 2>&1 || true; docker network rm '+NETWORK+' >/dev/null 2>&1 || true'
    script+='trap '+shlex.quote(cleanup)+' EXIT\n'
    script+='docker run -d --name '+MONGO+' --label medipulse.acceptance=20261115 --network '+NETWORK+' --network-alias mongo --memory 384m --memory-swap 384m --cpus .25 --ulimit nofile=65536:65536 mongo:7 --replSet rs0 --bind_ip_all --wiredTigerCacheSizeGB .25 >/dev/null\n'
    script+='docker run -d --name '+REDIS+' --label medipulse.acceptance=20261115 --network '+NETWORK+' --network-alias redis --memory 48m --memory-swap 48m --cpus .1 '+redis+' redis-server --maxmemory 24mb --maxmemory-policy noeviction >/dev/null\n'
    script+='for attempt in $(seq 1 40); do if docker exec '+MONGO+" mongosh --quiet --eval 'db.adminCommand({ping:1}).ok' >/dev/null 2>&1; then break; fi; sleep 2; done\n"
    script+='docker exec '+MONGO+''' mongosh --quiet --eval 'rs.initiate({_id:"rs0",members:[{_id:0,host:"mongo:27017"}]})' >/dev/null
'''
    script+='for attempt in $(seq 1 40); do if docker exec '+MONGO+" mongosh --quiet --eval 'if (!db.hello().isWritablePrimary) quit(1)' >/dev/null 2>&1; then break; fi; sleep 2; done\n"
    script+='docker exec '+MONGO+" mongosh --quiet --eval 'if (!db.hello().isWritablePrimary) quit(1)'\n"
    mounts=''
    if integration:
        for name in OVERLAYS:
            destination=ROOT+'/candidate/'+name
            mounts+='--mount type=bind,source='+destination+',target=/app/'+name+',readonly '
    script+='result=0\ndocker run --rm --pull=never --name medipulse-capacity-acceptance --label medipulse.acceptance=20261115 --network '+NETWORK+' --memory 896m --memory-swap 896m --cpus 1 '
    script+='-e DATABASE_URL='+shlex.quote('mongodb://mongo:27017/medipulse_test_capacity_'+SUFFIX+'?replicaSet=rs0&directConnection=true')+' -e REDIS_URL=redis://'+REDIS+':6379/15 -e CAPACITY_VIDEO_SECONDS='+('10' if author else '299')+' -e CAPACITY_EXECUTION_CONTEXT=aws-same-host-isolated '
    if author:script+='-e CAPACITY_PUBLISH_MODE=author '
    script+='-e REELS_EMBEDDING_ALLOW_DOWNLOAD=false -e REELS_EMBEDDING_CACHE_DIR=/models -e REELS_FFMPEG_PATH=/usr/bin/ffmpeg -e REELS_FFPROBE_PATH=/usr/bin/ffprobe '
    if integration:
        script+='-e TEST_DATABASE_URL='+shlex.quote('mongodb://mongo:27017/medipulse_test_capacity_'+SUFFIX+'?replicaSet=rs0&directConnection=true')+' -e TEST_REDIS_URL=redis://redis:6379/15 --mount type=bind,source=/srv/medipulse/source/backend/tests,target=/app/tests,readonly '+mounts
    script+='--mount type=bind,source=/srv/medipulse/models,target=/models,readonly --mount type=bind,source='+ROOT+'/capacity.mjs,target=/audit/capacity.mjs,readonly --mount type=bind,source='+ROOT+'/capacity-media,target=/tmp/reels-capacity '
    command='--import /app/tests/bootstrap.js --test --test-concurrency=1 /app/tests/integration/reels.test.js' if integration else '--expose-gc /audit/capacity.mjs'
    label='author-integration' if integration else 'capacity'
    image=production.load()['reelsCandidateImage'] if author else production.IMAGE
    script+='--entrypoint node '+image+' '+command+' >'+ROOT+'/logs/'+label+'.log 2>&1 || result=$?\ntail -n 40 '+ROOT+'/logs/'+label+'.log\nexit "$result"\n'
    return script

def prepare_release():
    source=subprocess.check_output(['git','rev-parse','HEAD'],cwd=production.api.REPO,text=True).strip()
    assert re.fullmatch('[a-f0-9]{40}',source)
    # Only the reviewed paths need local-file hydration; the image uses the exact
    # committed checkout below, never this possibly partial OneDrive worktree.
    reviewed=['backend/'+name for name in OVERLAYS]+['frontend/src/pages/ReelStudio.jsx','backend/package.json','backend/package-lock.json','backend/Dockerfile']
    subprocess.run(['git','diff','--quiet','HEAD','--',*reviewed],cwd=production.api.REPO,check=True)
    state=production.load()
    assert not state.get('reelsCandidateSource') or state['reelsCandidateSource']==source, 'Use the retained candidate or explicitly review a replacement'
    root='/srv/medipulse/releases/'+source
    tag='medipulse-release:'+source[:12]
    script='install -d -m 0755 /srv/medipulse/releases\n'
    script+='if test ! -d '+root+'; then git -C /srv/medipulse/source fetch -q --depth=1 origin '+source+'; git -C /srv/medipulse/source worktree add --detach '+root+' '+source+'; fi\n'
    script+='test "$(git -C '+root+' rev-parse HEAD)" = '+source+'\n'
    script+='if ! docker image inspect '+tag+' >/dev/null 2>&1; then docker build --quiet --label org.opencontainers.image.revision='+source+' -t '+tag+' '+root+'/backend >'+ROOT+'/logs/release-build.log 2>&1 || { tail -n 20 '+ROOT+'/logs/release-build.log; exit 1; }; fi\n'
    script+='docker run --rm --pull=never --user 0:0 --memory 1024m --memory-swap 1024m --cpus .8 --env-file /etc/medipulse/frontend.env -e NODE_OPTIONS=--max-old-space-size=768 --mount type=bind,source='+root+'/frontend,target=/frontend --workdir /frontend --entrypoint /bin/sh '+tag+" -c 'npm ci --ignore-scripts --no-audit --no-fund && npm run build' >"+ROOT+'/logs/release-frontend.log 2>&1 || { tail -n 20 '+ROOT+'/logs/release-frontend.log; exit 1; }\n'
    script+='test -s '+root+'/frontend/dist/index.html\ndocker image inspect '+tag+" --format '{{.Id}}'\necho AUTHOR_RELEASE_PREPARED_NOT_ACTIVATED\n"
    output=session().run(script,'prepare-verified-author-release',1200)
    image=re.search(r'sha256:[a-f0-9]{64}',output)[0]
    state=production.load();state.update(reelsCandidateSource=source,reelsCandidateImage=image,reelsCandidateRoot=root,reelsCandidatePrepared=True);production.save(state)
    print(json.dumps({'phase':'author-release-prepared-not-activated','source':source,'image':image}))

if __name__=='__main__':main()
