"""Local policy invariants; no live account or environment access."""
import json
import unittest
import render_production_policy as production
import render_staging_policy as staging

class ProductionPolicy(unittest.TestCase):
    def test_no_iam_or_data_destruction_and_fixed_30gib(self):
        before = staging.build()
        obj = production.build()
        self.assertEqual(before, staging.build())
        compact = json.dumps(obj,separators=(',',':')).replace('__ACCOUNT_ID__','123456789012')
        self.assertLessEqual(len(compact),6144)
        actions = {a for s in obj['Statement'] for a in (s['Action'] if isinstance(s['Action'],list) else [s['Action']])}
        self.assertFalse(any(a.startswith('iam:') or a.startswith('ec2:Delete') or a in ['ec2:TerminateInstances','ec2:ReleaseAddress','ec2:ImportKeyPair'] for a in actions))
        self.assertNotIn('synthetic-only',compact)
        volume = next(s for s in obj['Statement'] if s['Action']=='ec2:RunInstances' and ':volume/' in str(s['Resource']))
        self.assertEqual(volume['Condition']['NumericEquals']['ec2:VolumeSize'],'30')
        self.assertEqual(volume['Condition']['Bool'],{'ec2:Encrypted':'true'})
    def test_public_network_changes_are_scoped_to_new_production_resources(self):
        obj=production.build()
        for action in ['ec2:AuthorizeSecurityGroupIngress','ec2:AssociateAddress','ec2:AllocateAddress','ssm:SendCommand']:
            grant=next(s for s in obj['Statement'] if s['Action']==action)
            self.assertNotEqual(grant['Resource'],'*')
            self.assertIn(production.DEPLOYMENT,json.dumps(grant['Condition']))
            self.assertIn('DateLessThan',grant['Condition'])
        # IAM cannot enforce ingress port/count limits; the launcher must verify
        # literal80/443 and a single owned instance/address before every write.

if __name__=='__main__': unittest.main()
