"""No AWS, database, production environment or Docker daemon is used."""
import importlib.util
import json
from pathlib import Path
import tempfile
import subprocess
import shlex
import unittest
from unittest.mock import patch,Mock

path=Path(__file__).resolve().parents[1]/'deploy/aws/autodeploy.py'
spec=importlib.util.spec_from_file_location('autodeploy',path)
auto=importlib.util.module_from_spec(spec);spec.loader.exec_module(auto)

class AutoDeploy(unittest.TestCase):
    def test_pinned_installer_checks_exact_instance_and_fits_ssm(self):
        import install_autodeploy as install
        source=subprocess.check_output(['git','rev-parse','HEAD'],cwd=path.parents[2],text=True).strip()
        script=install.installer(source,'7b051cbca5e2acd79410693ef85aed138f9e572a')
        self.assertIn('i-0e99a3d554dfd8921',script)
        self.assertIn('sha256sum -c -',script)
        self.assertNotIn('terminate-instances',script);self.assertNotIn('backend.env',script)
        self.assertLess(len(json.dumps({'commands':['/bin/bash -c '+shlex.quote(script)]}).encode()),23000)
        with tempfile.TemporaryDirectory() as temporary:
            file=Path(temporary)/'install.sh';file.write_bytes(script.encode())
            subprocess.run(['C:/Program Files/Git/bin/bash.exe','-n',str(file)],check=True,capture_output=True)
    def test_frontend_success_publishes_marker_without_changing_backend_source(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);front=root/'live';front.mkdir();(front/'index.html').write_bytes(b'old')
            overlay=root/'overlay';overlay.write_bytes(b'existing settings')
            work=root/'work';dist=work/'frontend/dist';(dist/'assets').mkdir(parents=True);(dist/'index.html').write_bytes(b'new');(dist/'assets/app.js').write_bytes(b'code')
            state={'frontend_source':'1'*40,'backend_source':'1'*40}
            with patch.object(auto,'FRONTEND',front),patch.object(auto,'OVERLAY',overlay),patch.object(auto,'ROOT',root),patch.object(auto,'LOGS',root),patch.object(auto,'save'),patch.object(auto,'health'),patch.object(auto,'command',return_value='sha256:'+'a'*64),patch.object(auto,'verify_frontend'),patch.object(auto,'restart_backend') as restart:
                auto.deploy(state,'2'*40,work,True,False)
                marker=json.loads((front/'__deployment.json').read_text())
                self.assertEqual(marker['frontend_source'],'2'*40);self.assertEqual(marker['backend_source'],'1'*40)
                self.assertEqual((front/'index.html').read_bytes(),b'new');self.assertTrue((front/'assets/app.js').exists());restart.assert_not_called()
    def test_source_selection_ignores_docs_tests_but_preserves_app_changes(self):
        files=['frontend/src/components/CommunityCard.jsx','frontend/README.md','frontend/e2e/a.spec.js','frontend/src/utils/a.test.mjs','frontend/package-lock.json']
        self.assertEqual(auto.runtime_files(files,'frontend'),[files[0],files[-1]])
        self.assertEqual(auto.migration_changes(['backend/model/reel.js','backend/scripts/reelsSchema.js','backend/controller/auth.js']),['backend/model/reel.js','backend/scripts/reelsSchema.js'])
    def test_image_update_preserves_feature_flags_and_rejects_ambiguous_overrides(self):
        image='sha256:'+'a'*64
        old=('services:\n  backend:\n    image: sha256:'+'b'*64+'\n    environment:\n      REELS_ENABLED: "true"\n      REELS_PUBLISH_MODE: author\n').encode()
        updated=auto.image_overlay(old,image)
        self.assertIn(image.encode(),updated);self.assertIn(b'REELS_ENABLED: "true"',updated);self.assertIn(b'REELS_PUBLISH_MODE: author',updated)
        with self.assertRaises(AssertionError):auto.image_overlay(old+old,image)
    def test_failed_frontend_smoke_restores_previous_html_and_keeps_backend_running(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);front=root/'live';front.mkdir();(front/'index.html').write_bytes(b'old html')
            overlay=root/'overlay.yml';overlay.write_bytes(b'host config')
            work=root/'work';(work/'frontend').mkdir(parents=True)
            state={'frontend_source':'1'*40,'backend_source':'2'*40,'observed_source':'1'*40}
            initial=dict(state)
            def publish(dist):(front/'index.html').write_bytes(b'new html')
            with patch.object(auto,'FRONTEND',front),patch.object(auto,'OVERLAY',overlay),patch.object(auto,'ROOT',root),patch.object(auto,'LOGS',root),patch.object(auto,'save'),patch.object(auto,'health'),patch.object(auto,'command',return_value='sha256:'+'a'*64) as command,patch.object(auto,'publish_frontend',side_effect=publish),patch.object(auto,'verify_frontend',side_effect=RuntimeError('bad frontend')),patch.object(auto,'restart_backend') as restart:
                (work/'frontend/dist').mkdir();(work/'frontend/dist/index.html').write_bytes(b'new html')
                with self.assertRaisesRegex(RuntimeError,'bad frontend'):auto.deploy(state,'3'*40,work,True,False)
                self.assertEqual((front/'index.html').read_bytes(),b'old html');self.assertEqual(state,initial);restart.assert_not_called()
                build=next(call.args for call in command.call_args_list if 'run' in call.args)
                self.assertNotIn('/etc/medipulse/backend.env',str(build));self.assertIn('/etc/medipulse/frontend.env',build)
    def test_failed_sha_is_not_rebuilt_each_poll(self):
        source='a'*40
        with patch.object(auto,'STATE') as state,patch.object(auto,'command',return_value=source+' refs/heads/main'),patch.object(auto,'checkout') as checkout:
            state.read_text.return_value=json.dumps({'failed_source':source})
            auto.run();checkout.assert_not_called()
    def test_backend_health_failure_restores_exact_host_override(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);front=root/'live';front.mkdir();(front/'index.html').write_bytes(b'old html')
            old=('services:\n  backend:\n    image: sha256:'+'b'*64+'\n').encode();overlay=root/'overlay';overlay.write_bytes(old)
            work=root/'work';(work/'backend').mkdir(parents=True);(work/'backend/package.json').write_text('{"scripts":{"start":"node index.js"}}')
            state={'frontend_source':'1'*40,'backend_source':'1'*40}
            with patch.object(auto,'FRONTEND',front),patch.object(auto,'OVERLAY',overlay),patch.object(auto,'ROOT',root),patch.object(auto,'LOGS',root),patch.object(auto,'save'),patch.object(auto,'health'),patch.object(auto,'command',return_value='sha256:'+'a'*64),patch.object(auto,'restart_backend',side_effect=[RuntimeError('new backend not ready'),None]) as restart:
                with self.assertRaisesRegex(RuntimeError,'new backend not ready'):auto.deploy(state,'2'*40,work,False,True)
                self.assertEqual(restart.call_args_list[-1].args[0],old);self.assertEqual(state['backend_source'],'1'*40)

if __name__=='__main__':unittest.main()
