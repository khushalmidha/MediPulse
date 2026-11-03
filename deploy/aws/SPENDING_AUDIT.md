# AWS spending audit — 4 November 2026 IST

**Decision: do not add paid infrastructure yet.** Existing services exceed the USD15 gross monthly ceiling. Both EC2 machines visibly serve separate applications; neither is approved or proven safe to stop/delete. No AWS resources, permissions, DNS, production data, feature flags or existing deployments were changed during this audit. No code was pushed.

## Observed resources and ownership

Read-only AWS metadata collected 3 November 2026 21:05 UTC (4 November 02:35 IST), supplemented with public HTTP checks. Exact instance/volume IDs, public IPs and selected CloudTrail evidence remain outside Git in `%LOCALAPPDATA%/MediPulse/Private/aws-resource-audit.json`. The owner-readable `aws-resource-owners.md` in the same private directory maps every identifier to the following names.

| us-east-1 resource | Observed application/dependency | Storage | Ownership/safe cleanup verdict |
| --- | --- | --- | --- |
| `ThreatGraph-Server`, running Linux t3.micro, one automatically assigned public IPv4 | HTTP80 returned200, nginx, ThreatGraph content | 16GiB gp3 root, in use, unencrypted | Created by Root,22September; no Owner tag. Responsible person, guest data and external dependencies unknown. **Keep until owner review.** |
| `bachat-backend-server`, running Linux t3.micro, one automatically assigned public IPv4 | HTTP3001 returned200 with Bachat content; HTTP80 returned502 | 20GiB gp3 root, in use, unencrypted | Created by Root,23September; no Owner tag. Port80 error does not establish abandonment. **Keep until owner review.** |

Both volumes have **DeleteOnTermination=true**. Terminating either instance would delete its root data. Neither machine has an instance profile or appears in SSM managed-instance inventory. No user-data bootstrap was configured. We did not inspect guest files, processes, application databases, private SSH keys or backups; launch/SSH events identify Root, not the responsible human. No cross-account ownership inference is justified.

Both security groups expose22/80/443 globally; Bachat also exposes3001. After ownership is confirmed, review restricting SSH to the owner's IP and serving the application only through its HTTPS proxy. No security-group change was made.

## Other billable-resource checks

Across17enabled regions, inspected EC2 instances, EBS volumes, account-owned EBS snapshots/AMIs, EIPs, NAT gateways/VPC endpoints, classic/application load balancers, RDS instances/clusters, ElastiCache, MSK, EKS/ECS clusters, Lambda, CloudWatch log groups, EFS, AWS Backup vaults/plans, and Lightsail instances/disks/snapshots/IPs/databases/containers. Only the two machines and their two attached volumes were returned as nonempty resources.

- **No unattached EBS volumes, allocated EIPs or account-owned EBS snapshots/AMIs found.** No verified orphan cleanup candidate was identified. Both public addresses are automatic instance addresses, not retained Elastic IP allocations.
- Global S3 inventory returned no buckets; Route53 returned no hosted zones/health checks. CloudFront returned an empty response with no distribution records.
- Lightsail operations were unsupported in us-west-1/ap-northeast-3:14 explicit coverage errors, retained in private evidence. Other inventoried operations returned successfully, including supplemental EFS/Backup checks in17regions.
- This is a defined service inventory, **not a complete bill attribution**: disabled regions, other service types, Marketplace/support/subscriptions, RDS manual snapshots, cross-account/guest/external backups and unposted usage remain outside verified scope. No owned EBS snapshot is not proof that an application has no backup anywhere. No paid Cost Explorer API request was made.

Repeat the control-plane-only scan with `python tools/aws_resource_audit.py --profile medipulse-deployer` once the owner's non-root identity has the required read permissions. Permission/network/unsupported errors must remain gaps, never be counted as empty inventories. The helper cannot stop/delete/provision resources and writes selected evidence outside Git.

## Cost and budget calculation

AWS Price List verified US East Linux shared t3.micro **USD0.0104/hour**, gp3 **USD0.08/GiB-month**; volumes use the included3000IOPS/125MBps. Public IPv4 costs **USD0.005/hour/address**. These are gross list-price calculations, before credits/free allowances, CPU-surplus charges, transfer, backups and taxes.

| Identified workload | Compute,730hours | IPv4,730hours | Retained gp3/month | Total before extras/tax |
| --- | ---: | ---: | ---: | ---: |
| ThreatGraph | 7.592 | 3.650 | 1.280 | **12.522** |
| Bachat | 7.592 | 3.650 | 1.600 | **12.842** |
| Both | 15.184 | 7.300 | 2.880 | **25.364** |

November has720hours: the same identified resources cost **USD25.056** before extras/tax if running the whole month. These components do not fully reconcile the AWS forecast; do not label the difference an orphan resource without billing evidence. T3 Unlimited CPU surplus/transfer remain possible additional charges.

Existing budget `MediPulse-AWS-Pilot-Gross-Monthly` remains15USD, includes tax and excludes credits/refunds; previously verified actual alerts5/10/12/15 and forecast15 remain configured. Latest returned **actual2.519USD / forecast31.915USD**. Remaining allowance against posted actuals is **12.481USD**, subject to billing lag and unposted charges. Nothing was stopped, so the actual AWS forecast has not improved.

### Conditional cleanup savings, not authorization

1. First identify each owner, whether the app must remain online, DNS/webhooks/IP dependencies, guest databases/uploads/configuration and a usable backup/restore path. Record any approved downtime. A public200 response prevents treating either workload as abandoned.
2. If an owner explicitly approves stopping an identified machine, **stop only that instance, retain its disk**. Each stop saves about **11.242USD per730-hour month** in compute plus automatic public IPv4; both save **22.484USD/month**. Existing EBS remains **2.88USD/month**. Auto IPv4 is released; restart can change the address and break DNS/integrations. Existing Render/Vercel is unrelated and remains running.
3. There is currently **no certified-safe deletion**. No termination, volume deletion, snapshot purchase or data archive has been authorized. A stop is not a backup. If either project is retired, arrange and verify a suitable independent backup before a separate exact deletion approval; include backup storage in the budget.

At the calculation timestamp,3November21:16UTC,650.73hours remained until1DecemberUTC. If **both** instances were approved and stopped immediately, a conservative counterfactual is `31.915 - 650.73 × 2 × (0.0104 + 0.005)` = **11.87USD month-end**, leaving about3.13USD below15. This subtracts only pretax compute/address savings from the existing gross forecast; it is a model, not a refreshed AWS forecast or guaranteed bill. If18% tax applies to those avoided charges, the same arithmetic gives8.26USD. New backup fees, unknown charges and billing lag can change either result. Next full-month identified run rate after both stops is2.88USD before tax/extras, not zero.

## Can a USD12 Lightsail machine fit?

**Not with these retained EC2 disks under the current strict budget.** Keeping the old data is essential until reviewed; it cannot be erased to make a quote fit.

| Proposed next full month | Before applicable tax/overages | At18% tax, illustration only |
| --- | ---: | ---: |
| Both EC2 stopped,36GiB retained, no new deployment | 2.88 | 3.40 |
| Above + Lightsail2GB/60GB/IPv4 +10GiB billed snapshot assumption | **15.38** | **18.15** |
| No legacy disk charges + Lightsail12 +10GiB billed snapshot assumption | 12.50 | 14.75 |
| No legacy disk charges + Lightsail12 +20GiB billed snapshot assumption | 13.00 | 15.34 |

The last two are illustrations, **not permission to delete old disks**. USD0.50/1 backup assumes10/20GiB billed at0.05/GB-month; actual snapshot size, changed blocks and retention must be measured. Necessary backups must not be omitted to hit the cap. Account TaxSettings returned ResourceNotFoundException: the account's tax treatment is **not verified**. AWS lists18% GST for India; confirm the seller/address/invoice in Billing before approving a taxed estimate. Do not assume credits erase gross charges or tax.

Mumbai's verified12USD Lightsail bundle includes2GB RAM,60GB disk, attached public IPv4 and1536GB monthly regional transfer. No extra EC2 IPv4 fee applies to that bundled address. Bandwidth overage, unattached static IPs, snapshots, external provider fees and any additional disks are outside the12USD base. Existing Vercel, Atlas and current required external services are reused; no ALB/NAT/MSK/ElastiCache/new domain/CloudFront migration is required for this hybrid. Existing external provider plans/limits must still be checked, not assumed unlimited/free.

### Actual local capacity evidence

Ran `tools/reels_capacity_check.mjs` inside the existing backend image `medipulse-reels-review:local`, image ID `sha256:39391d527972f3f55e5d9b7601d60b8843ee44918bcf55a82d8c48e084b93515`:

Eight current-source/image SHA256 fingerprints matched for API entrypoint, Reels routes/model and five media/processing/service/embedding/ranking modules; this was not an unrelated stale application image.

- Backend/full startup/outbox + FFmpeg + actual offline pinned HF model capped at1280MiB,1.6CPUs,no swap. Separate Redis capped128MiB with64MiB/noeviction/AOF; observed about7.7MiB. Local replica-set Mongo outside the cap, like remote Atlas.
- **299-second720×1280 moving synthetic H264/AAC source,32,493,055bytes**; actual create/upload/outbox processing,384-dimensional stored embedding, independent review/publish, authenticated HLS master/variant/segment all passed.
- Processing135.59seconds; backend-container cgroup peak **912MiB** (includes test driver);381 concurrent light HTTP liveness/feed/auth samples, **0 failures**,p95 **110ms**,max **4215ms**. Isolated synthetic database removed; test containers removed. No production database/mail/provider calls.
- Raw local output: `%TEMP%/medipulse-full-api-capacity.log`. Harness is Linux/Docker-specific; refuses nonlocal Mongo host or any database outside its unique `medipulse_test_capacity_...` prefix, and only drops that validated synthetic database. Run inside the application image with the pinned read-only model cache and a dedicated local Redis sidecar; never load production environment files.

**Assessment:**2GB is a plausible low-traffic pilot memory envelope, not a production capacity guarantee. No target AWS host/OS/Caddy/reboot/restore/device/load acceptance was performed. Lightsail2GB has only20% baseline **per vCPU**, approximately0.4CPU sustained across two vCPUs; the local1.6CPU test does not simulate depleted burst credits. Repeated long videos can throttle or exceed the current180-second per-process FFmpeg timeout. Stage back-to-back long-video jobs, API traffic, memory pressure, disk growth, exhausted-credit behavior and timeouts before accepting this host. Do not blindly increase timeouts, run multiple workers or deploy Kafka/model training on this machine. Keep Atlas remote and Redis private; reuse the existing broker only if required, otherwise explicitly document the optional analytics scope. Managed Kafka/Redis cannot fit this bill.

## Exact next steps and HTTPS

1. **Now:** preserve Render/Vercel and stop adding AWS charges. Owner answers the pending ownership/use questions for ThreatGraph and Bachat. Review Bills by service/region plus support/Marketplace and tax details in the Console to close the inventory/billing gap without paid Cost Explorer API queries. Complete [manual owner IAM/MFA setup](IAM_CONSOLE_SETUP.md); deployment credentials remain pending.
2. For any cleanup, obtain separate approval naming the exact instance, retained volume, backup plan, expected downtime and IP impact. Execute no deletion under a stop approval. Refresh actual/forecast after billing catches up. Recalculate the whole-account gross bill, including the cost of preserving old data, before asking for a new host.
3. Present a concrete paid-resource quote only when total gross cost including measured backups/tax/traffic headroom fits15. Current recommendation is **existing Vercel + Render,0 additional AWS spend**, with production Reels disabled because Render Free lacks persistent media storage. This preserves existing implemented features but does **not** claim full persistent Reels is live. If existing apps must stay on EC2, no new AWS Reels deployment fits the cap; a budget/scope decision is required.
4. If an affordable Lightsail pilot is separately approved, use one x86 Linux host with private Redis, Caddy, persistent included SSD paths for Reels/models/Redis/certificates, and immutable backend image; adapt the supplied **EC2-reference** Compose/unit before use. Its EBS mount requirement must not be copied blindly. Never point staging workers at production Atlas. Validate backups/restores, media/model fingerprints across reboot/stop/start, independent reviewers, approved indexes, offline model revision/cache and full account/booking/ledger/socket/WebRTC/Reels recommendation flows with isolated synthetic data. Production flags remainfalse; enterprise remainsfalse.
5. **HTTPS cutover after staging and explicit DNS approval:** keep `medipulse.live`/`www.medipulse.live` on Vercel with their current certificates and DNS provider. Point only `api.medipulse.live` to the approved attached static IPv4; open80/443, restrict SSH, expose no3001/6379/27017/8080 publicly. Caddy issues/renews the API certificate; persist its `/data`, keep DNS/ports reachable, and monitor expiry. No paid AWS ACM/CloudFront frontend migration is needed for the chosen hybrid. Confirm any existing API DNS record before editing it.
6. After separate Vercel/config/DB approval, relay existing `/backend` requests to the new HTTPS API, preserving cookie/CSRF, allowed origins, Google OAuth origins/callbacks, API prefix handling, Socket.IO upgrades, authenticated HLS and WebRTC/TURN. Verify normal and failure/reconnect flows from actual devices. Keep one production writer stack during cutover and preserve the old relay/Render deployment for rollback. **REELS_ENABLED=false until all activation checks and approval.**

Current public checks: `https://medipulse.live` redirected to `https://www.medipulse.live/` and returned200 with trusted TLS; `https://www.medipulse.live` also returned200. API-host HTTPS could not be verified; Render readiness timed out at25seconds. These probes do not prove authenticated production workflows or an outage; no production configuration changed. AWS API HTTPS remains an uncompleted deployment gate.

Budget alerts do not enforce a hard cap. Keep the existing actual5/10/12/15 and forecast15 alarms; investigate at5/10 before delayed billing exhausts headroom. No automatic stop/delete action was enabled: stopping Lightsail still bills its bundle, while deleting it destroys data. EC2 stops leave EBS charges. No AWS deployment can promise an absolute account15USD cap under unbounded metered usage.

## Provider references

- [EC2 price and stopped-volume billing](https://aws.amazon.com/ec2/faqs/), [EBS pricing](https://aws.amazon.com/ebs/pricing/), [IPv4 pricing](https://aws.amazon.com/vpc/pricing/), [automatic address release](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/using-instance-addressing.html).
- [Lightsail CPU baseline](https://docs.aws.amazon.com/en_en/lightsail/latest/userguide/baseline-cpu-performance.html), [bundles](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-bundles.html), [billing and snapshots](https://docs.aws.amazon.com/en_en/lightsail/latest/userguide/amazon-lightsail-frequently-asked-questions-faq-billing-and-account-management.html).
- [AWS APAC GST rates](https://aws.amazon.com/tax-help/apac-vat-rates/), [Cost Explorer API pricing](https://aws.amazon.com/aws-cost-management/aws-cost-explorer/pricing/), [Render Free persistence limits](https://render.com/docs/free), [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https).
