"""One bounded read-only restore disk; never detaches/deletes the production root."""
import argparse
import datetime as dt
import json
import time
import re
import aws_production as core

STATE=core.api.PRIVATE/'production-restore-state.json'
MOUNT='/mnt/medipulse-production-restore'

def save(state):STATE.write_bytes((json.dumps(state,indent=2)+'\n').encode())

def restore_target(production,instance):
    roots=[m for m in instance['BlockDeviceMappings'] if m['Ebs']['VolumeId']==production['volumeId']]
    extra=[m for m in instance['BlockDeviceMappings'] if m['Ebs']['VolumeId']!=production['volumeId']]
    assert len(roots)==1 and len(extra)<=1
    if extra:
        journal=json.loads(STATE.read_text(encoding='utf-8'))
        assert journal['instanceId']==production['instanceId'] and journal['snapshotId']==production['snapshotId']
        assert extra[0]['Ebs']['VolumeId']==journal['volumeId'] and extra[0]['DeviceName']=='/dev/sdf'
        assert extra[0]['Ebs']['DeleteOnTermination'] is False
        volume=core.api.aws('describe-volumes','--volume-ids',journal['volumeId'])['Volumes'][0]
        validate(volume,production)
    core.target(production,{**instance,'BlockDeviceMappings':roots})

def validate(volume,production):
    core.own(volume,'production-restore')
    assert volume['VolumeId']!=production['volumeId']
    assert volume['SnapshotId']==production['snapshotId'] and volume['Size']==30
    assert volume['Encrypted'] and volume['VolumeType']=='gp3'
    assert volume['Iops']==3000 and volume['Throughput']==125
    # CreateVolume omits Attachments; DescribeVolumes includes the attachment list.
    assert all(a['InstanceId']==production['instanceId'] and a['Device']=='/dev/sdf' for a in volume.get('Attachments',[]))

def request(production,zone,repair=False):
    return ['--snapshot-id',production['snapshotId'],'--availability-zone',zone,'--size','30','--volume-type','gp3','--iops','3000','--throughput','125','--encrypted','--client-token',core.DEPLOYMENT+('-restore-repair-one' if repair else '-restore-one'),'--tag-specifications',core.tags('volume','production-restore')]

def mount_script(volume):
    serial=volume['VolumeId'].replace('-','')
    assert re.fullmatch('vol[0-9a-f]{17}',serial)
    return '''device=/dev/disk/by-id/nvme-Amazon_Elastic_Block_Store_'''+serial+'''
for attempt in $(seq 1 40); do test ! -b "$device-part1" || break; sleep 2; done
test -b "$device-part1"
test "$(lsblk -dn -o SERIAL "$device" | tr -d ' ')" = '''+serial+'''
test "$(lsblk -dn -o FSTYPE "$device-part1")" = ext4
install -d -m 0700 '''+MOUNT+'''
mount -o ro,noload "$device-part1" '''+MOUNT+'''
sed 's#  /#  '''+MOUNT+'''/#' '''+MOUNT+'''/srv/medipulse/recovery/backup.sha256 | sha256sum -c - >/srv/medipulse/recovery/restore-hashes.log
echo RESTORED_ALL_MANIFEST_HASHES_MATCH
'''

def cleanup(state,production,session):
    if not state.get('volumeId'):
        possible=[v for v in core.find('describe-volumes','Volumes') if v['VolumeId']!=production['volumeId']]
        assert len(possible)<=1, 'Ambiguous restore inventory; manual inspection required'
        if not possible:return
        validate(possible[0],production);state['volumeId']=possible[0]['VolumeId'];save(state)
    volume=core.api.aws('describe-volumes','--volume-ids',state['volumeId'])['Volumes'][0];validate(volume,production)
    if volume['Attachments']:
        session.run('if mountpoint -q '+MOUNT+'; then umount '+MOUNT+'; fi\necho RESTORE_MOUNT_RELEASED\n','release-restore-mount',60)
        core.api.aws('detach-volume','--volume-id',volume['VolumeId'],'--instance-id',production['instanceId'],'--device','/dev/sdf')
    for _ in range(60):
        volume=core.api.aws('describe-volumes','--volume-ids',state['volumeId'])['Volumes'][0];validate(volume,production)
        if volume['State']=='available':break
        time.sleep(3)
    assert volume['State']=='available' and not volume['Attachments']
    core.api.aws('delete-volume','--volume-id',volume['VolumeId'])
    state['cleanup']='deleted-only-temporary-restore-volume';save(state)

def exercise(volume,production,session,state):
    assert 'RESTORED_ALL_MANIFEST_HASHES_MATCH' in session.run(mount_script(volume),'mount-and-verify-production-backup',240)
    media=MOUNT+'/srv/medipulse-acceptance-20261115/capacity-media'
    probe='master=$(find '+media+' -name master.m3u8 -type f -print -quit)\ntest -n "$master"\nrelative="${master#'+media+'/}"\ndocker run --rm --pull=never --network none --memory 128m --memory-swap 128m --mount type=bind,source='+media+',target=/persist,readonly --entrypoint /usr/bin/ffprobe '+core.IMAGE+' -v error -protocol_whitelist file,crypto,data -show_entries format=duration -of json "/persist/$relative"\n'
    decoded=session.run(probe,'restored-299-second-hls-probe',120)
    duration=float(re.search(r'"duration"\s*:\s*"([0-9.]+)"',decoded)[1]);assert 298<duration<301
    # No restored secret is sourced or loaded; native tests use only the restored model.
    native='docker run --rm --pull=never --network none --memory 1024m --memory-swap 1024m --cpus .8 -e NODE_ENV=test -e MAIL_DELIVERY=disabled -e REELS_REAL_MEDIA_TESTS=true -e REELS_EMBEDDING_ALLOW_DOWNLOAD=false -e REELS_EMBEDDING_CACHE_DIR=/models --mount type=bind,source='+MOUNT+'/srv/medipulse/models,target=/models,readonly --mount type=bind,source=/srv/medipulse/source/backend/tests,target=/app/tests,readonly --entrypoint node '+core.IMAGE+' --test --test-concurrency=1 /app/tests/reel-real-media.test.js\n'
    output=session.run(native,'restored-offline-model-and-video',420)
    assert 'pass 2' in output and 'fail 0' in output and 'skipped 0' in output
    state.update(status='passed',hashesVerified=True,restoredNativeTests=2,restoredHlsSeconds=duration,atlasRestoreVerified=False);save(state)
    current=core.load();current.update(restoreVerified=True,restoreScope='EC2 snapshot: config/static/models/synthetic HLS hashes plus offline native tests; Atlas excluded');core.save(current)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--run-approved',action='store_true');parser.add_argument('--repair-cleaned-attempt',action='store_true');parser.add_argument('--resume-existing',action='store_true');args=parser.parse_args()
    production=core.load();session=core.native.Session(core.STATE,core.LOGS,restore_target);session.verify()
    instance=core.api.aws('describe-instances','--instance-ids',production['instanceId'])['Reservations'][0]['Instances'][0];restore_target(production,instance)
    snapshot=core.api.aws('describe-snapshots','--snapshot-ids',production['snapshotId'])['Snapshots'][0];core.own(snapshot,'production-backup')
    assert snapshot['State']=='completed' and snapshot['VolumeId']==production['volumeId'] and snapshot['Encrypted'] and snapshot['VolumeSize']==30
    if args.resume_existing:
        assert args.run_approved
        state=json.loads(STATE.read_text(encoding='utf-8'))
        assert state.get('volumeId') and not state.get('cleanup') and state.get('status')=='creating'
        assert dt.datetime.fromisoformat(state['deadlineUtc'])>dt.datetime.now(dt.timezone.utc)
        volume=core.api.aws('describe-volumes','--volume-ids',state['volumeId'])['Volumes'][0];validate(volume,production)
        assert volume['State']=='in-use' and len(volume['Attachments'])==1
        try:exercise(volume,production,session,state)
        finally:cleanup(state,production,session)
        print(json.dumps({'restoreVerified':True,'temporaryDiskDeleted':True,'atlasRestoreVerified':False}),flush=True)
        return
    arguments=request(production,instance['Placement']['AvailabilityZone'],args.repair_cleaned_attempt)
    allowed=core.api.aws('create-volume',*arguments,dry=True)
    print(json.dumps({'restoreDryRun':allowed}),flush=True)
    if not args.run_approved:return
    assert allowed=='DryRunOperation','Restore grant missing; no disk created'
    prior=json.loads(STATE.read_text(encoding='utf-8')) if STATE.exists() else None
    if prior:
        assert args.repair_cleaned_attempt and prior.get('cleanup')=='deleted-only-temporary-restore-volume' and prior.get('attempt',1)==1 and prior.get('status')!='passed','Retain the existing restore journal; no automatic additional disk'
        assert dt.datetime.fromisoformat(prior['deadlineUtc'])>dt.datetime.now(dt.timezone.utc),'Original restore deadline expired'
    else:assert not args.repair_cleaned_attempt
    assert not [v for v in core.find('describe-volumes','Volumes') if v['VolumeId']!=production['volumeId']]
    now=dt.datetime.now(dt.timezone.utc);state={'snapshotId':production['snapshotId'],'instanceId':production['instanceId'],'startedAtUtc':prior['startedAtUtc'] if prior else now.isoformat(),'deadlineUtc':prior['deadlineUtc'] if prior else (now+dt.timedelta(hours=2)).isoformat(),'status':'creating','attempt':2 if prior else 1}
    if prior:state['previousAttempts']=[prior];state['repairReason']='CreateVolume omits Attachments; first temporary disk independently verified deleted; same original deadline and max one active restore disk'
    save(state)
    try:
        volume=core.api.aws('create-volume',*arguments);state['volumeId']=volume['VolumeId'];save(state);validate(volume,production)
        for _ in range(60):
            volume=core.api.aws('describe-volumes','--volume-ids',state['volumeId'])['Volumes'][0];validate(volume,production)
            if volume['State']=='available':break
            time.sleep(3)
        assert volume['State']=='available' and not volume['Attachments']
        core.api.aws('attach-volume','--volume-id',state['volumeId'],'--instance-id',production['instanceId'],'--device','/dev/sdf')
        exercise(volume,production,session,state)
    finally:cleanup(state,production,session)
    print(json.dumps({'restoreVerified':True,'temporaryDiskDeleted':True,'atlasRestoreVerified':False}),flush=True)

if __name__=='__main__':main()
