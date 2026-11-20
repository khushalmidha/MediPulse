# AWS auto-deployment

The owner requested automatic deployment on 20 November 2026. This replaces manual-only application releases on the existing single EC2 host; it creates no additional cloud resources. Installation/live verification is recorded in IMPLEMENTATION_STATUS.md, not inferred from these files existing.

The root-owned `medipulse-autodeploy.timer` checks the public GitHub `main` branch two minutes after the previous check finishes. The matching oneshot service and a file lock prevent overlapping builds. Push/merge application changes to `main`; the owner must review what enters that branch. No GitHub credential or inbound deployment port is required. Timer behavior follows the [systemd timer documentation](https://www.freedesktop.org/software/systemd/man/latest/systemd.timer.html).

Frontend changes build in a capped Docker container with only public frontend settings. UI units and the production build must pass. Assets copy first; index.html changes atomically. The backend is not restarted for a frontend-only change. A public HTML/AWS-origin smoke check must match the new build, or the old HTML is restored.

Backend changes build an immutable image, run isolated units and real offline model/media tests without production credentials, then restart the existing stack with only its image override changed. Existing private environment, Reels author mode, persistent files, Redis, certificates, network and instance settings are preserved. Application/Reels readiness must pass; failure restores the previous override and HTML. Database migrations, seed/index operations, model/schema scripts and Dockerfile changes are held for a reviewed manual release. The updater does not apply repository infrastructure files or change its own installed code automatically.

Build memory is capped at 1 GiB; frontend builds use 0.8 CPU. Builds run sequentially beside the existing application. Disk free space must remain above 5 GiB. Up to three recent checkout directories plus active source directories are retained. Previous hashed frontend assets remain for open tabs/rollback. A failed SHA is not rebuilt repeatedly; a subsequent push triggers another check. A backend update can cause a short service restart. This is single-host deployment, not zero-downtime orchestration.

On the host:

```sh
systemctl status medipulse-autodeploy.timer
systemctl status medipulse-autodeploy.service
journalctl -u medipulse-autodeploy.service -n 60 --no-pager
cat /var/lib/medipulse-autodeploy/state.json
```

Build logs are root-only in `/var/log/medipulse-autodeploy/`. Check the public `https://www.medipulse.live/__deployment.json` for frontend/backend source revisions after a successful release. Docs/tests-only changes do not trigger an application rebuild. To pause automatic checks, stop/disable the timer; the application keeps running.

One-time installation: after committing/pushing the reviewed installer files, `python tools/install_autodeploy.py` creates an exact checksum-verified, fixed-instance owner command privately. `--install-approved` runs it through the existing non-root SSM profile if that profile still has access. If the operator session/grant is unavailable, the owner can run that exact command once using AWS Systems Manager Run Command on `i-0e99a3d554dfd8921`; no broad IAM grant is necessary. Enabling the timer does not prove the first release succeeded: check timer/state/public marker and the actual community bundle.
