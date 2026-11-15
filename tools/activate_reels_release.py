"""Activate only the specifically approved empty-schema/verified-author release."""
import argparse
import base64
import json
import shlex
import aws_production as core

PROPOSAL=core.api.PRIVATE/'reels-activation-proposal.json'

def index_script():
    js="""import mongoose from 'mongoose';import {reelsModels} from './model/reel.js';import {inspectReelsSchema,applyReelsSchema} from './scripts/reelsSchema.js';await mongoose.connect(process.env.DATABASE_URL,{autoIndex:false,autoCreate:false,serverSelectionTimeoutMS:5000});try{const plan=await inspectReelsSchema();if(plan.some(r=>r.conflicts.length))throw Error('Conflicting indexes require review');for(const model of reelsModels){if(await model.countDocuments({}).maxTimeMS(5000)!==0)throw Error('Collections changed since the empty-schema approval');}const result=await applyReelsSchema();if(result.some(r=>r.missing.length||r.conflicts.length))throw Error('Schema not ready');console.log(JSON.stringify({applied:true,collections:result.length,indexesReady:true}));}finally{await mongoose.disconnect();}"""
    return 'docker exec medipulse-ec2-backend-1 node --input-type=module -e '+shlex.quote(js)+'\n'

def activation_script(state):
    image=state['reelsCandidateImage'];source=state['reelsCandidateSource'];root=state['reelsCandidateRoot']
    overlay='services:\n  backend:\n    image: '+image+'\n    environment:\n      REELS_ENABLED: "true"\n      REELS_PUBLISH_MODE: author\n      REELS_PROCESS_TIMEOUT_MS: "600000"\n'
    unit=core.asset('deploy/aws/medipulse-fullsite.service','/srv/medipulse/recovery/reels-candidate.service')
    script='test "$(docker image inspect '+image+' --format '+shlex.quote('{{index .Config.Labels "org.opencontainers.image.revision"}}')+')" = '+source+'\n'
    script+='test -s '+root+'/frontend/dist/index.html\n'
    script+='cp -p /etc/systemd/system/medipulse-fullsite.service /srv/medipulse/recovery/pre-reels.service\ncp -p /srv/medipulse/frontend/index.html /srv/medipulse/recovery/pre-reels-index.html\n'
    script+='printf %s '+shlex.quote(base64.b64encode(overlay.encode()).decode())+' | base64 -d >/opt/medipulse/deploy/aws/reels-enabled.override.yml\n'
    script+=unit
    script+="sed -i 's/-f fullsite.override.yml /-f fullsite.override.yml -f reels-enabled.override.yml /g' /srv/medipulse/recovery/reels-candidate.service\n"
    rollback='systemctl stop medipulse-fullsite.service || true; cp -p /srv/medipulse/recovery/pre-reels.service /etc/systemd/system/medipulse-fullsite.service; cp -p /srv/medipulse/recovery/pre-reels-index.html /srv/medipulse/frontend/index.html; systemctl daemon-reload; systemctl start medipulse-fullsite.service'
    script+='trap '+shlex.quote(rollback)+' ERR\n'
    script+='systemctl stop medipulse-fullsite.service\ncp -p /srv/medipulse/recovery/reels-candidate.service /etc/systemd/system/medipulse-fullsite.service\nsystemctl daemon-reload\nsystemctl start medipulse-fullsite.service\n'
    script+='ready=0\nfor attempt in $(seq 1 60); do if curl --fail --silent http://127.0.0.1/__aws-health >/dev/null; then ready=1; break; fi; sleep 2; done\ntest "$ready" = 1\n'
    script+='cp -a '+root+'/frontend/dist/assets/. /srv/medipulse/frontend/assets/\ncp -a '+root+'/frontend/dist/. /srv/medipulse/frontend/\ntrap - ERR\necho VERIFIED_AUTHOR_REELS_RELEASE_STARTED\n'
    return script

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--activate-approved',action='store_true');args=parser.parse_args()
    state=core.load();assert state.get('reelsCandidatePrepared') and state.get('restoreVerified')
    recovery=json.loads((core.api.PRIVATE/'production-restore-state.json').read_text(encoding='utf-8'))
    assert recovery.get('status')=='passed' and recovery.get('cleanup')=='deleted-only-temporary-restore-volume'
    approval=json.loads(PROPOSAL.read_text(encoding='utf-8'))
    assert args.activate_approved and approval.get('approved') is True and approval.get('ownerInstruction')
    assert approval['source']==state['reelsCandidateSource'] and approval['image']==state['reelsCandidateImage']
    session=core.native.Session(core.STATE,core.LOGS,core.target)
    print(session.run(index_script(),'approved-empty-reels-schema-apply',120))
    print(session.run(activation_script(state),'activate-verified-author-reels',300))
    current=core.load();current.update(reelsEnabled=True,reelsPublicationMode='author',runtimeSource=state['reelsCandidateSource'],backendImageId=state['reelsCandidateImage'],status='live-reels');core.save(current)
    core.verify_domain()

if __name__=='__main__':main()
