"""Poll the owner's public main branch; preserve host secrets, data and infrastructure."""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time
import urllib.request

REPOSITORY='https://github.com/khushalmidha/MediPulse.git'
ROOT=Path('/srv/medipulse/autodeploy')
STATE=Path('/var/lib/medipulse-autodeploy/state.json')
LOGS=Path('/var/log/medipulse-autodeploy')
FRONTEND=Path('/srv/medipulse/frontend')
OVERLAY=Path('/opt/medipulse/deploy/aws/reels-enabled.override.yml')
SERVICE='medipulse-fullsite.service'
SHA=re.compile(r'[0-9a-f]{40}')

def command(*args,cwd=None,timeout=120,log=None,env=None):
    if log:
        with open(log,'ab') as output:
            subprocess.run(args,cwd=cwd,timeout=timeout,check=True,stdout=output,stderr=subprocess.STDOUT,env=env)
        return ''
    return subprocess.check_output(args,cwd=cwd,timeout=timeout,stderr=subprocess.PIPE,env=env,text=True).strip()

def atomic(path,content,mode=0o600):
    temporary=path.with_name(path.name+'.next')
    with temporary.open('wb') as file:
        os.chmod(temporary,mode);file.write(content);file.flush();os.fsync(file.fileno())
    os.replace(temporary,path)

def save(state):atomic(STATE,(json.dumps(state,indent=2)+'\n').encode())

def runtime_files(paths,prefix):
    return [p for p in paths if p.startswith(prefix+'/') and not any(part in p.split('/') for part in ['tests','e2e','node_modules','coverage']) and not p.endswith(('.md','.test.js','.test.mjs','.spec.js')) and '/.env' not in p]

def migration_changes(paths):
    return [p for p in paths if p.startswith('backend/model/') or p=='backend/Dockerfile' or p.startswith('backend/scripts/') and ('migration' in p.lower() or 'schema' in p.lower() or 'seed' in p.lower() or 'bootstrap' in p.lower())]

def image_overlay(content,image):
    assert re.fullmatch(r'sha256:[0-9a-f]{64}',image)
    result,count=re.subn(rb'(?m)^(    image: )sha256:[0-9a-f]{64}\s*$',lambda m:m[1]+image.encode(),content)
    assert count==1,'Existing host image override differs; manual review required'
    return result+b'\n' if not result.endswith(b'\n') else result

def health(timeout=180):
    deadline=time.monotonic()+timeout
    while True:
        try:
            with urllib.request.urlopen('http://127.0.0.1/__aws-health',timeout=8) as response:
                value=json.load(response)
                if response.status==200 and value.get('ready') is True:return
        except Exception:pass
        if time.monotonic()>=deadline:raise RuntimeError('Application readiness failed')
        time.sleep(3)

def restart_backend(overlay):
    command('systemctl','stop',SERVICE,timeout=90)
    atomic(OVERLAY,overlay,0o644)
    command('systemctl','start',SERVICE,timeout=90)
    health()

def publish_frontend(dist):
    assert (dist/'index.html').is_file() and (dist/'assets').is_dir()
    # Assets first; retain older content-addressed assets for open tabs and rollback.
    for source in dist.rglob('*'):
        relative=source.relative_to(dist)
        assert not source.is_symlink(),'Unexpected frontend build symlink'
        if not source.is_file() or str(relative)=='index.html':continue
        destination=FRONTEND/relative
        assert destination.resolve().is_relative_to(FRONTEND.resolve())
        destination.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(source,destination);os.chmod(destination,0o644)
    atomic(FRONTEND/'index.html',(dist/'index.html').read_bytes(),0o644)

def verify_frontend(expected):
    request=urllib.request.Request('https://www.medipulse.live/',headers={'Cache-Control':'no-cache'})
    with urllib.request.urlopen(request,timeout=20) as response:
        assert response.headers.get('X-MediPulse-Origin')=='aws-ec2'
        assert hashlib.sha256(response.read()).hexdigest()==expected,'Public frontend does not match the candidate'

def deploy(state,source,work,frontend_changed,backend_changed):
    old_index=(FRONTEND/'index.html').read_bytes()
    old_overlay=OVERLAY.read_bytes()
    marker_path=FRONTEND/'__deployment.json'
    old_marker=marker_path.read_bytes() if marker_path.exists() else None
    before=dict(state)
    image=command('docker','inspect','medipulse-ec2-backend-1','--format','{{.Image}}')
    log=LOGS/(source+'.log')
    assert shutil.disk_usage(ROOT).free>5*1024**3,'Less than5GiB free; keep current deployment'
    health(20)
    if backend_changed:
        manifest=json.loads((work/'backend/package.json').read_text())
        assert manifest['scripts']['start']=='node index.js','Changed startup command requires manual review'
        tag='medipulse-auto:'+source[:12]
        environment=dict(os.environ,DOCKER_BUILDKIT='0')
        command('docker','build','--memory','1024m','--memory-swap','1024m','--cpu-period','100000','--cpu-quota','80000','--label','org.opencontainers.image.revision='+source,'-t',tag,str(work/'backend'),timeout=1200,log=log,env=environment)
        image=command('docker','image','inspect',tag,'--format','{{.Id}}')
        # Synthetic units only: no backend.env, provider keys or production database.
        command('docker','run','--rm','--pull=never','--network','none','--memory','1024m','--memory-swap','1024m','--cpus','.8','--mount','type=bind,source='+str(work/'backend/tests')+',target=/app/tests,readonly','--entrypoint','/bin/sh',image,'-c','node --import ./tests/bootstrap.js --test tests/*.test.js',timeout=600,log=log)
        # Real offline media/model regression, still with no production environment.
        command('docker','run','--rm','--pull=never','--network','none','--memory','1024m','--memory-swap','1024m','--cpus','.8','-e','NODE_ENV=test','-e','MAIL_DELIVERY=disabled','-e','REELS_REAL_MEDIA_TESTS=true','-e','REELS_EMBEDDING_ALLOW_DOWNLOAD=false','-e','REELS_EMBEDDING_CACHE_DIR=/models','--mount','type=bind,source=/srv/medipulse/models,target=/models,readonly','--mount','type=bind,source='+str(work/'backend/tests')+',target=/app/tests,readonly','--entrypoint','node',image,'--test','tests/reel-real-media.test.js',timeout=420,log=log)
    if frontend_changed:
        command('docker','run','--rm','--pull=never','--user','0:0','--memory','1024m','--memory-swap','1024m','--cpus','.8','--env-file','/etc/medipulse/frontend.env','-e','NODE_OPTIONS=--max-old-space-size=768','--mount','type=bind,source='+str(work/'frontend')+',target=/frontend','--workdir','/frontend','--entrypoint','/bin/sh',image,'-c','npm ci --ignore-scripts --no-audit --no-fund && npm run test:ui && npm run build',timeout=900,log=log)
    try:
        if backend_changed:
            restart_backend(image_overlay(old_overlay,image))
            # Readiness includes startup schema; Reels additionally checks its named indexes.
            check="import mongoose from 'mongoose';import {inspectReelsDeployment} from './scripts/reelsPreflight.js';await mongoose.connect(process.env.DATABASE_URL,{autoIndex:false,autoCreate:false,serverSelectionTimeoutMS:5000});try{const r=await inspectReelsDeployment();if(!r.featureEnabled||r.publicationMode!=='author'||!r.technicalChecksPassed)throw Error('Reels preflight failed');}finally{await mongoose.disconnect();}"
            command('docker','exec','medipulse-ec2-backend-1','node','--input-type=module','-e',check,timeout=60,log=log)
            state['backend_source']=source
        if frontend_changed:
            publish_frontend(work/'frontend/dist')
            verify_frontend(hashlib.sha256((work/'frontend/dist/index.html').read_bytes()).hexdigest())
            state['frontend_source']=source
        health(20)
        state.update(observed_source=source,status='deployed',failed_source=None,deployed_at=dt.datetime.now(dt.timezone.utc).isoformat())
        save(state)
        marker={k:state[k] for k in ['frontend_source','backend_source','deployed_at']}
        atomic(FRONTEND/'__deployment.json',(json.dumps(marker)+'\n').encode(),0o644)
    except BaseException:
        rollback_errors=[]
        try:
            if backend_changed:restart_backend(old_overlay)
        except Exception as error:rollback_errors.append(type(error).__name__)
        try:
            atomic(FRONTEND/'index.html',old_index,0o644)
            if old_marker is not None:atomic(marker_path,old_marker,0o644)
            elif marker_path.exists():marker_path.unlink()
        except Exception as error:rollback_errors.append(type(error).__name__)
        state.clear();state.update(before)
        if rollback_errors:state['rollback_needs_attention']=rollback_errors
        save(state)
        raise

def checkout(source):
    work=ROOT/'work'/source
    if not (work/'.git').exists():
        work.mkdir(parents=True,exist_ok=True)
        command('git','init','-q',str(work))
        command('git','remote','add','origin',REPOSITORY,cwd=work)
        command('git','fetch','-q','--depth=1','--filter=blob:none','origin',source,cwd=work,timeout=180)
        command('git','sparse-checkout','init','--cone',cwd=work)
        command('git','sparse-checkout','set','backend','frontend',cwd=work)
        command('git','-c','core.hooksPath=/dev/null','checkout','-q','--detach',source,cwd=work,timeout=180)
    assert command('git','rev-parse','HEAD',cwd=work)==source
    return work

def changed(work,base,source,prefix):
    assert SHA.fullmatch(base) and SHA.fullmatch(source)
    if base==source:return []
    command('git','fetch','-q','--depth=1','--filter=blob:none','origin',base,cwd=work,timeout=180)
    return runtime_files(command('git','diff','--name-only',base,source,'--',prefix,cwd=work).splitlines(),prefix)

def prune_work(state):
    root=ROOT/'work'
    protected={state.get('frontend_source'),state.get('backend_source'),state.get('observed_source')}
    directories=sorted((p for p in root.iterdir() if SHA.fullmatch(p.name) and p.is_dir() and not p.is_symlink()),key=lambda p:p.stat().st_mtime,reverse=True)
    for path in directories[3:]:
        if path.name not in protected and path.resolve().parent==root.resolve():shutil.rmtree(path)

def run():
    state=json.loads(STATE.read_text())
    source=command('git','ls-remote',REPOSITORY,'refs/heads/main').split()[0]
    assert SHA.fullmatch(source)
    if source in [state.get('observed_source'),state.get('failed_source')]:return
    try:
        work=checkout(source)
        front=changed(work,state['frontend_source'],source,'frontend')
        back=changed(work,state['backend_source'],source,'backend')
        blocked=migration_changes(back)
        assert not blocked,'Schema/Dockerfile changes need a reviewed manual release: '+','.join(blocked)
        if front or back:deploy(state,source,work,bool(front),bool(back))
        else:state.update(observed_source=source,status='no-runtime-changes');save(state)
        prune_work(state)
    except Exception as error:
        state.update(status='rollback-needs-attention' if state.get('rollback_needs_attention') else 'failed-current-release-retained',failed_source=source,last_error=type(error).__name__+': '+str(error)[:500]);save(state)
        raise

def initialize(source):
    assert SHA.fullmatch(source)
    for path in [STATE.parent,LOGS,ROOT/'work']:path.mkdir(parents=True,exist_ok=True,mode=0o700)
    image=command('docker','inspect','medipulse-ec2-backend-1','--format','{{.Image}}')
    assert command('docker','image','inspect',image,'--format','{{index .Config.Labels "org.opencontainers.image.revision"}}')==source
    assert (FRONTEND/'index.html').is_file() and OVERLAY.is_file()
    if not STATE.exists():save({'frontend_source':source,'backend_source':source,'observed_source':None,'failed_source':None,'status':'installed-not-yet-deployed'})

def main():
    import fcntl
    parser=argparse.ArgumentParser();parser.add_argument('--initialize');args=parser.parse_args()
    if args.initialize:initialize(args.initialize);return
    with (STATE.parent/'deploy.lock').open('w') as lock:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:return
        run()

if __name__=='__main__':main()
