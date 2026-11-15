"""Production controller safety: fake resources only, no real config or AWS."""
import copy
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch, Mock
import aws_native_pilot as api
import aws_production as core

class ProductionCore(unittest.TestCase):
    def test_request_is_one_protected_root_host_without_ssh_or_extra_public_ip(self):
        request=core.launch_request({'clientToken':core.DEPLOYMENT+'-one'},{'RootDeviceName':'/dev/sda1'},'subnet-fixture','sg-fixture')
        self.assertEqual((request['MinCount'],request['MaxCount']),(1,1))
        self.assertEqual(request['InstanceType'],'t4g.small')
        self.assertTrue(request['DisableApiTermination'])
        self.assertEqual(request['CreditSpecification'],{'CpuCredits':'standard'})
        self.assertFalse(request['NetworkInterfaces'][0]['AssociatePublicIpAddress'])
        disk=request['BlockDeviceMappings'][0]['Ebs']
        self.assertEqual(disk,{'VolumeSize':30,'VolumeType':'gp3','Iops':3000,'Throughput':125,'Encrypted':True,'DeleteOnTermination':False})
        self.assertNotIn('KeyName',request)
        self.assertNotIn('UserData',request)
        self.assertEqual(request['MetadataOptions']['HttpTokens'],'required')
    def test_web_rules_refuse_management_ports_and_foreign_groups(self):
        group={'Tags':json.loads(core.tags('security-group','production-network'))[0]['Tags'],
               'IpPermissions':[{'IpProtocol':'tcp','FromPort':p,'ToPort':p,'IpRanges':[{'CidrIp':'0.0.0.0/0'}]} for p in [80,443]]}
        self.assertEqual(core.validate_web_rules(group),{80,443})
        bad=copy.deepcopy(group); bad['IpPermissions'][0]['FromPort']=22; bad['IpPermissions'][0]['ToPort']=22
        with self.assertRaises(AssertionError): core.validate_web_rules(bad)
        bad=copy.deepcopy(group); bad['Tags'][0]['Value']='foreign'
        with self.assertRaises(AssertionError): core.validate_web_rules(bad)
    def test_missing_production_grant_never_launches(self):
        with patch.object(core,'prepare',return_value={}), patch.object(core,'find',return_value=[]), \
             patch.object(core,'permissions',return_value=False), patch.object(api,'aws') as aws:
            with self.assertRaisesRegex(AssertionError,'Production IAM grant missing'): core.launch()
            aws.assert_not_called()
    def test_existing_absent_host_never_triggers_replacement(self):
        with patch.object(core,'prepare',return_value={'instanceId':'i-known'}), \
             patch.object(api,'aws',return_value={'Reservations':[]}) as aws:
            with self.assertRaisesRegex(AssertionError,'no automatic replacement'): core.launch()
            self.assertEqual([c.args[0] for c in aws.call_args_list],['describe-instances'])
    def test_target_rejects_delete_on_termination_before_any_command(self):
        account='123456789012'; state={'account':account,'deploymentId':core.DEPLOYMENT,'instanceId':'i-fixture','clientToken':core.DEPLOYMENT+'-one'}
        item={'Tags':json.loads(core.tags('instance','production-host'))[0]['Tags'],'InstanceId':'i-fixture',
              'ClientToken':state['clientToken'],'InstanceType':'t4g.small','ImageId':api.AMI,'State':{'Name':'running'},
              'MetadataOptions':{'HttpTokens':'required'},'IamInstanceProfile':{'Arn':'arn:aws:iam::'+account+':instance-profile/'+core.preflight.ROLE},
              'BlockDeviceMappings':[{'Ebs':{'DeleteOnTermination':False}}]}
        with patch.object(api,'ACCOUNT',account):
            core.target(state,item)
            item['BlockDeviceMappings'][0]['Ebs']['DeleteOnTermination']=True
            with self.assertRaises(AssertionError): core.target(state,item)
    def test_build_failure_keeps_single_host_and_records_repair_state(self):
        state={'instanceId':'i-fixture','failures':[]}; session=Mock(); session.run.side_effect=RuntimeError('build failed')
        with patch.object(core,'runtime_source'), patch.object(core.preflight,'main'), patch.object(core,'prepare'), \
             patch.object(core,'launch') as launch, patch.object(core,'address'), patch.object(core,'load',return_value=state), \
             patch.object(core,'save'), patch.object(core.native,'Session',return_value=session), patch.object(api,'aws') as aws:
            with self.assertRaisesRegex(RuntimeError,'build failed'): core.run()
            launch.assert_called_once(); aws.assert_not_called()
            self.assertEqual(state['status'],'needs-repair')
            self.assertEqual(len(state['failures']),1)
    def test_generated_bootstrap_is_valid_bash(self):
        with tempfile.TemporaryDirectory() as folder:
            p=Path(folder)/'bootstrap.sh'; p.write_text(core.bootstrap(),encoding='utf-8',newline='\n')
            subprocess.run(['C:/Program Files/Git/bin/bash.exe','-n',str(p)],check=True,capture_output=True,timeout=10)

    def test_domain_verification_rejects_spa_fallback_on_health(self):
        from contextlib import nullcontext
        response=Mock(status=200,headers={'X-MediPulse-Origin':'aws-ec2','Content-Type':'text/html'})
        response.read.return_value=b'<script src="/assets/app.js"></script>'
        with patch.object(core,'load',return_value={'coreReady':True}), patch.object(core,'save') as save, \
             patch.object(core.urllib.request,'urlopen',side_effect=lambda *a,**k:nullcontext(response)):
            with self.assertRaisesRegex(AssertionError,'frontend fallback'): core.verify_domain()
            save.assert_not_called()

if __name__=='__main__': unittest.main()
