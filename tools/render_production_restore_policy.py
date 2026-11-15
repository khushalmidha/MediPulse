"""Prepare a snapshot-specific temporary restore grant; no IAM writes."""
import json
import aws_production as core

def build(state):
    account=state['account'];region=core.api.REGION
    arn='arn:aws:ec2:'+region+':'+account+':'
    deployment=state['deploymentId'];expiry='2026-11-17T00:00:00Z'
    tagged={'StringEquals':{'aws:ResourceTag/DeploymentId':deployment,'aws:ResourceTag/DataClass':'production','aws:ResourceTag/Role':'production-restore'},'DateLessThan':{'aws:CurrentTime':expiry}}
    request={'StringEquals':{'aws:RequestTag/DeploymentId':deployment,'aws:RequestTag/DataClass':'production','aws:RequestTag/Role':'production-restore','ec2:VolumeType':'gp3'},'NumericEquals':{'ec2:VolumeSize':'30','ec2:VolumeIops':'3000','ec2:VolumeThroughput':'125'},'Bool':{'ec2:Encrypted':'true'},'DateLessThan':{'aws:CurrentTime':expiry}}
    return {'Version':'2012-10-17','Statement':[
        {'Effect':'Allow','Action':'ec2:CreateVolume','Resource':'arn:aws:ec2:'+region+'::snapshot/'+state['snapshotId'],'Condition':{'DateLessThan':{'aws:CurrentTime':expiry}}},
        {'Effect':'Allow','Action':'ec2:CreateVolume','Resource':arn+'volume/*','Condition':request},
        {'Effect':'Allow','Action':'ec2:CreateTags','Resource':arn+'volume/*','Condition':{'StringEquals':{'ec2:CreateAction':'CreateVolume','aws:RequestTag/DeploymentId':deployment,'aws:RequestTag/DataClass':'production','aws:RequestTag/Role':'production-restore'},'DateLessThan':{'aws:CurrentTime':expiry}}},
        {'Effect':'Allow','Action':['ec2:AttachVolume','ec2:DetachVolume','ec2:DeleteVolume'],'Resource':arn+'volume/*','Condition':tagged},
        {'Effect':'Allow','Action':['ec2:AttachVolume','ec2:DetachVolume'],'Resource':arn+'instance/'+state['instanceId'],'Condition':{'StringEquals':{'aws:ResourceTag/DeploymentId':deployment,'aws:ResourceTag/DataClass':'production','aws:ResourceTag/Role':'production-host'},'DateLessThan':{'aws:CurrentTime':expiry}}}
    ]}

if __name__=='__main__':
    state=core.load();assert state.get('snapshotId') and state.get('productionLive')
    doc=build(state);text=json.dumps(doc,separators=(',',':'));assert len(text)<6144
    path=core.api.PRIVATE/'iam-production-restore.compact.json';path.write_bytes((text+'\n').encode())
    print(json.dumps({'file':str(path),'policyName':'MediPulseProductionRestore','characters':len(text),'iamWrites':False,'scope':'one source snapshot; encrypted30GiBgp3 restore only; existing host only; no root-volume delete grant'}))
