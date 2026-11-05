# MediPulse deployment: USD10 target / USD15 gross maximum

## Latest combined-project cost review — 5 November 2026

Non-root `medipulse-deployer` CLI identity verified after owner Console/MFA setup; no root fallback. Current budget15USD, actual3.282USD/forecast39.527USD. Fresh us-east-1 inventory contains a new running `JobFinder-Server` t3.micro/30GiB gp3/publicIPv4; owner explicitly requires preserving it. Its estimated730hour baseline13.642USD before tax/extras makes a separate12USD MediPulse host exceed15. Previous empty-us-east-1 cleanup inventory is historical. No JobFinder/Render/Vercel/DNS/data/flag change or new paid resource was performed.

**New temporary lower-cost candidate, not approved/accepted:** one shared ARM64 `t4g.small`2GiB in us-east-1 for isolated JobFinder/MediPulse containers, one40GiB persistent gp3 root volume, one publicIPv4, existing Vercel/Atlas/private Redis/Caddy,10-20billedGB-month snapshots. AWS explicitly publishes a **750 aggregate hours/month t4g.small compute trial through31December2026UTC**, for new/existing accounts. This is a separate zero-priced compute allowance, not permission to subtract promotional account credits from gross charges. Eligibility/remaining shared quota still needs account verification; two always-on t4g.small instances would exceed750hours/month. No second always-on instance should be purchased under this quote. Standard CPU-credit mode would avoid surplus CPU fees but must pass depleted-credit throughput tests; throttling cannot be hidden as acceptance. No new Kafka/ElastiCache/ALB/NAT is included.

During the verified trial only, assuming compute0:40GiB gp3=3.20USD, IPv4 at730h=3.65USD,10-20billedGB-month snapshot=0.50-1USD =>**7.35-7.85USD/month pretax**, **8.67-9.26USD at illustrative18%GST**, before other account/provider/transfer charges. JobFinder's compute can share this allowance, but **the complete hosting is not permanently or entirely free**. A retained30GiB old JobFinder disk would add2.40USD/month before tax; it cannot be deleted merely to make a quote fit. Live old-instance staging overlap is prorated extra and must be included in the approved window. Existing accrued3.282USD is not erased. Final all-account forecast and budget fit are not established by this arithmetic.

AWS Price List confirms t4g.small Linux shared us-east-1 On-Demand0.0168USD/hour. After trial expiry,730h adds12.264USD: total19.614-20.114USD pretax /23.14-23.73USD at illustrative18%tax, exceeding15. An approved migration/requote is mandatory **before31December2026UTC**; do not assume an extension, buy commitments or automatically delete data at expiry. Lightsail remains the longer-term candidate, not a verified combined-app capacity guarantee.

The earlier912MiB/299second capacity result used amd64 and MediPulse alone. ARM64 ONNX/FFmpeg/native bcrypt compatibility, combined memory/CPU, both applications' imports/jobs/session/cookie routing and durable media/backup/restore remain unverified. Do not resize the existingx86 JobFinder in place to ARM. Its repository was inspected read-only via the connected GitHub app: Node/Express/Mongo/Gemini/SMTP backend, React dashboard/extension. Source includes embedded DB credentials and an insecure signing-key fallback in docker-compose.yml; do not reuse those defaults or copy filled secrets into templates/logs. Remove defaults and coordinate credential rotation across dependent apps before migration, with separate production credential approval. No credentials are reproduced here; no mail/bulk outreach was sent or activated. SMTP/AI provider quotas/fees are outside the host quote and no unlimited-free claim is made.

**Current next step:** Free Tier API returnedAccessDeniedException. The owner can attach the separate `iam-freetier-readonly.json` inline policy as `MediPulseFreeTierRead` from the existing owner Console. It grants only GetFreeTierUsage/GetAccountPlanState, no upgrade/create/stop/delete/IAM write. No broader permission or root retry is appropriate. Then verify account quota/plan, perform isolated ARM64/combined-load testing, and obtain exact paid staging approval for a time-limited host/disk/address/backup/overlap scope. Keep JobFinder running and production Reelsfalse until accepted; no cutover/deletion/DNS permission is implied by this candidate plan.

Sources: [AWS EC2 T4g trial, aggregate quota, extras and expiry](https://aws.amazon.com/ec2/faqs/), [T4g instances](https://aws.amazon.com/ec2/instance-types/t4/), [Free Tier read-only actions](https://docs.aws.amazon.com/service-authorization/latest/reference/list_freetier.html).

Updated 4 November 2026. **This replaces the earlier USD30-35 EC2 proposal.** Credits do not increase the permitted gross spend. Preserve Render/Vercel and production DNS. Owner-approved deletion of the two existing EC2 instances is completed below; no new paid resources, code push or DNS changes are approved.

**Latest: owner-approved cleanup completed,4November03:12IST.** ThreatGraph and Bachat instances are terminated; their16/20GiB root disks are deleted. Fresh us-east-1 inventory has no non-terminated EC2 instances, EBS volumes or allocated EIPs. Removed identified run rate25.364USD per730-hour month before tax/extras. Gross actual2.519USD/forecast31.915USD has not refreshed after cleanup; accrued usage remains payable. This supersedes all stop-only/retained-disk scenarios below. [Cleanup evidence and historical audit](SPENDING_AUDIT.md). No new paid provisioning, DNS/push, Render/Vercel or production MediPulse data/flag changes.12USD Lightsail +0.50backup could total14.75USD at illustrative18%GST but only0.25USD headroom; actual taxes/backup/overages and AWS capacity remain unaccepted. Local299-second full API/outbox/HF/HLS passed (912MiB peak,0/381 HTTP failures). Complete [manual non-root IAM/MFA](IAM_CONSOLE_SETUP.md) and reconcile the bill before any separate paid-resource approval.

## Further cost review — 4 November 2026

No further feature-preserving reduction below the12USD host base is currently verified. Keep Vercel, Atlas and the existing DNS provider; reuse the60GB included SSD, attached bundled IPv4, private Redis and Caddy. No extra EBS, managed Redis/Kafka, load balancer, NAT, paid CDN or domain transfer. The1GB/7USD host is not accepted: tested backend alone peaked912MiB before Redis/OS/proxy. The2GB/10USD IPv6-only host cannot receive **or send** public IPv4 traffic; provider/client compatibility and a safe replacement path are unverified. Spot interruption is unsuitable for uninterrupted consultations. Do not remove backups or clinical records merely to fit a quote.

New safe local drafts: `lightsail.override.yml` reuses the base Compose with1280MiB backend/128MiB Redis/128MiB proxy limits, Redis64MiB noeviction/AOF,30MB total capped Docker logs instead of90MB, and unchangedfalse feature flags. `medipulse-lightsail.service` uses the included persistent root SSD, not the extra-EBS mount guard from the reference unit. It refuses startup until the approved storage marker and four persistent directories exist. No host was purchased/configured, paths created or unit installed. Actual target-OS, resource saturation, certificate and restore checks remain required.

For later approved staging only: place the reviewed immutable image, secret-free runtime metadata and private backend environment at the documented paths; create/review persistent directory ownership and the storage marker on that host; validate `docker compose -f compose.yml -f lightsail.override.yml config --quiet`, then install **medipulse-lightsail.service**, not the EC2 unit. Do not start a production worker against Atlas during staging. Snapshot retention/creation still requires an approved measured storage allowance; the overlay does not create backups or perform destructive pruning.

Backup constraint: `(12 + 0.05 × snapshot_billed_GB_month + other_gross_fees) × 1.18 <= 15` if18%GST applies. With no other fees,14.23billed GB-month is a rounded-down mathematical ceiling; reserving0.25USD after tax reduces it to10billed GB-month. **This is a cost limit, not a retention/deletion policy or a claim that current required backups fit.** Necessary backups above this require a revised decision, not silent deletion or skipped backups.12USD+0.50backup=12.50pretax/14.75illustrative taxed total;20billed GB-month makes15.34. There is no guaranteed account-wide hard cap.

Current CLI session no longer authenticates; only the oldkhushal profile exists. No root re-login or IAM creation retry was attempted. Await owner non-root MFA setup, then refresh costs/tax eligibility using read-only access. AWS now states that old short-term Lightsail trials were replaced by the credit-based Free Tier for new customers; no separate90-day-free discount is assumed. Credits remain separate from the15USD gross ceiling. No new paid-resource or DNS approval is inferred from a request to reduce costs.

Sources: [current bundle prices](https://aws.amazon.com/lightsail/pricing/), [IPv6-only limits](https://docs.aws.amazon.com/lightsail/latest/userguide/migrate-to-ipv6-only-plan.html), [current free-tier and snapshot billing](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-frequently-asked-questions-faq-billing-and-account-management.html).

## Completed account checks and budget change

- Temporary browser AWS CLI login works under profile khushal. STS identified root, with account MFA enabled. This is not the non-root deployment identity required before provisioning. No long-lived AWS keys were created or placed in Git/frontend/logs. New owner IAM/MFA identity selection remains pending; do not use another person's IAM user.
- Billing GetCredits verified four active offers, estimated total USD 170.82. All four include EC2, S3, CloudFront, VPC, supporting services and Amazon Lightsail. EBS gp3/snapshot charges belong to the eligible EC2 billing category. The USD 30.82 offer expires 1 August 2027 at 05:29:59 IST; USD 140 expires20 September 2027. Eligibility does not authorize exceeding USD15 or guarantee coverage of every fee/tax.
- Existing budget MediPulse-AWS-Pilot-Gross-Monthly was updated in place from USD40 to **USD15/month**. IncludeCredit=false, IncludeRefund=false, IncludeTax=true. Old percentage notifications were replaced with absolute USD5,10,12,15 actual alerts and an additional USD15 forecast alert. AWS returned all five configurations; actual thresholds OK, forecast ALARM. Owner email subscriber configuration was preserved. Email delivery at these new thresholds has not yet been observed. No paid budget actions/reports were created.
- Historical3November AWS Budgets snapshot reported gross ActualSpend=USD1.848 and ForecastedSpend=USD31.718; latest audit snapshot is2.519/31.915USD. The forecast already exceeds the cap before adding MediPulse infrastructure. This is not an invoice or a promise of final charges.
- Read-only inventory across17enabled EC2 regions found **two running t3.micro instances, each with public IPv4, and36GB of attached EBS in us-east-1**. No Mumbai instances/volumes/EIPs were found. Latest selected metadata/IDs are private at %LOCALAPPDATA%/MediPulse/Private/aws-resource-audit.json; owner-readable appendix aws-resource-owners.md. Nothing was stopped/deleted. The latest audit expands other-service/snapshot coverage and records limitations; do not claim these two instances explain every dollar.

**Immediate recommendation: add no paid AWS resources until the owner reviews existing costs and the account-wide forecast is brought within the budget.** Any stop/resize/delete needs approval for the exact resources; existing workloads might belong to another application/person. Do not remove storage to hit a budget.

## Realistic comparison

| Option | Gross monthly cost before applicable taxes/overages | Assessment |
| --- | --- | --- |
| Prior EC2 t3a.medium +80GBgp3 +IPv4 | USD28.90 before snapshots/traffic | Rejected: compute alone USD17.96 exceeds15 |
| EC2 t3a.small +30GBgp3 +IPv4 | About USD15.37 before snapshots/traffic | Rejected: no headroom and tight storage |
| EC2 1GB micro | Can be cheaper but memory not accepted | No claim it safely hosts full API+Redis+model/transcoding |
| Lightsail 1GB IPv4 +40GBSSD | USD7 bundle, plus backups | Under target in principle, but full workload not memory/load accepted |
| Lightsail 2GB IPv6-only +60GBSSD | USD10 bundle, plus backups | Not selected: IPv4 clients, Atlas/provider reachability and trusted-origin connectivity must not be assumed |
| **Vercel + Lightsail2GB IPv4 + existing Atlas** | **USD12 bundle + about USD0.50-1 backup = USD12.50-13 before taxes/overages** | Lowest practical persistent Reels pilot candidate, conditional on full load/cost checks |
| Existing Render Free + Vercel | USD0 additional AWS charges | Preserve current deployment, but free Render cannot establish persistent Reels storage/local processing acceptance |

Official AWS Price List Mumbai rates checked: t3a.medium USD0.0246/h; t3a.large USD0.0493/h; gp3 USD0.0912/GB-month; EC2 snapshots USD0.05/GB-month. Public EC2 IPv4 adds USD0.005/h. The small-instance illustration uses the family half-size rate and must be re-quoted if ever considered; it is already rejected. Do not hide these components behind credits/free-trial assumptions.

Authenticated Lightsail get-bundles returned small_3_1 at USD12/month,2GB RAM,60GB included disk and **1536GB regional monthly transfer allowance in Mumbai**. Both1GB/7USD and2GB/12USD IPv4 plans were present. Included Lightsail public IPv4 is not an additional EC2 USD3.65 charge. Attached Lightsail static IPs are free; an unattached static IP can incur charges. Do not allocate an extra EC2 Elastic IP or buy an extra data disk for this candidate.

### Candidate bill, if existing charges are resolved

| Component | Amount |
| --- | --- |
| Lightsail Linux2GB IPv4, CPU/RAM +60GB persistent bundled disk | USD12/month |
| Attached static IPv4 | USD0 extra |
| Traffic within Mumbai bundle allowance | USD0 extra; overage is metered |
| Redis, FFmpeg, pinned local HF model, Caddy on that host | USD0 extra service fee |
| Caddy certificate issuance/renewal and current DNS provider | No added AWS service fee |
| Snapshot billed storage10-20GB assumption at USD0.05/GB-month | USD0.50-1/month; actual used/changed blocks must be measured |
| Vercel frontend + existing MongoDB/broker/provider services | USD0 additional AWS compute; existing external fees are not assumed zero |
| CloudFront/S3/MSK/ElastiCache/ALB/NAT/WAF/ECR/new domain | Not provisioned/required for selected hybrid |
| **Subtotal before taxes/overages** | **USD12.50-13/month** |

The USD10 target cannot currently be claimed for the accepted full Reels workload. The USD12 bundle is above that target but below the ceiling before extras. **All-in USD15 compliance is not established:** verify actual tax/invoice treatment, remaining account charges, real backup size and transfer before approval. For arithmetic only, an18%tax on USD12.50 gives USD14.75, leaving USD0.25 headroom; this is not a statement of the account's tax rate. If actual taxes/backup usage push the total above15, do not deploy this candidate. Snapshot sizing is not permission to omit necessary backups or delete media.

AWS does not provide a universal guaranteed USD15 account spending cap. A fixed instance bundle does not cap transfer, snapshots, detached addresses, taxes or unrelated services. If zero possibility of exceeding15 is non-negotiable, the safe present choice is **no additional metered AWS workload**, preserve the website, and resolve existing charges first.

## Feature-preserving hybrid design

After separate paid-resource/staging approval, use one Lightsail2GB x86Linux host for existing backend/outbox + private Redis + Caddy; keep existing Vercel frontend and Atlas database. No application rewrite, new managed databases or object-storage media rewrite is justified solely to claim a cheap bill.

- Preserve the same Node24 glibc backend image, account/staff auth, cookies, CSRF, appointments, demo ledger, sockets and clinical review boundaries. Keep virtual/demo money distinct from real collection. Staging uses a different Mongo database/signing key and disabled mail; never run two production stacks/workers against the same live DB during staging.
- Browser frontend remains VITE_BACKEND_URL=/backend. Preserve existing medipulse.live/www trusted HTTPS on Vercel; no frontend DNS change. Only after staging acceptance and DNS approval add api.medipulse.live -> attached Lightsail staticIPv4. Caddy handles trusted TLS/automatic renewal, direct API paths and stripping /backend once. Its certificate state is persistent. After separate approval update the Vercel rewrite to that HTTPS API. Keep Render available for rollback.
- Use included persistent Lightsail SSD for models/media/Redis/certificate state. It survives stop/start but not instance deletion. This is not a separate retained EC2 EBS volume; backup/restore is mandatory. **Do not blindly install the existing EC2 medipulse.service**, which requires a separate EBS mount. The supplied EC2 compose/unit are reference drafts, not selected Lightsail provisioning; adapt the host persistence guard only after approval. No deployment command here should purchase EBS.
- Keep model fixed to Xenova/paraphrase-multilingual-MiniLM-L12-v2 revision2c4055b12046f11709e9df2c122e59ffbdc2f900, offline runtime and read-only cache after explicit preparation. Media remains private; every HLS manifest/segment/JPEG passes backend auth. Approved different verified doctor reviews exact version. Run guarded schema tooling only on approved targets.
- REELS_ENABLED=false until disk/cache/index/reviewer/runtime and long-video/device/persistence requirements pass and activation is separately approved. Enterprise remains disabled. Do not use NODE_ENV=test on the public server to bypass flags.
- Private Redis on the same host, small reviewed memory limit/noeviction, no public6379, persistent AOF. Avoid ElastiCache. Existing Render-internal Redis cannot be used directly from AWS; stage/reconcile transient challenges during cutover without copying production data into tests.
- Kafka is optional analytics/event publication in the current code; transactional payment state and clinical/Reels delivery use Mongo outbox. Retain/reuse an existing approved broker if its analytics are required; do not claim disabling analytics preserves that optional feature. No MSK/self-hosted Kafka+ZooKeeper on this tiny host. Existing producer/consumer TLS rejectUnauthorized:false must be fixed before accepting an external broker connection. Never treat a configured broker string as delivered-event proof.
- Socket.IO over current /backend relay intentionally uses polling. Preserve actual signaling/auth scopes; native websocket upgrade needs a separate tested frontend option. WebRTC cross-network reliability needs approved TURN, ephemeral backend-issued credentials and real forced-relay tests. Relay bandwidth counts toward transfer; no paid relay or extra IP is assumed free. Maintain existing working service until a verified replacement exists.
- Separate Python/LightGBM services from older docs are absent from this checkout. Existing Node Gemini/HF clients remain server-side; do not shut an external ML endpoint down without verifying its actual consumers. No SageMaker/new paid inference service.

## Memory and performance: evidence, not promises

A local network-disabled container, capped at1536MiB with swap disabled, ran the actual pinned offline model and processed a5second720x1280 clip into HLS. Measured cgroup peak was **521MiB**. This makes the2GB pilot plausible; it does not include full API traffic, Redis, host OS, long/high-complexity video or concurrency, and does not certify a1GB deployment.

Before migration, run a local/full-stack2GB-equivalent load rehearsal, then an approved isolated staging run:300second videos,200MiB limits, CPU-credit exhaustion/throttling, model cold start, concurrent booking/calls during transcode, Mongo/outbox retries and measured peak memory. Keep one worker/process and bounded processing. A swapfile is not extra RAM. Do not force a1GB host to fit by silently dropping Reels, backups or safety checks. If the full workload needs4GB (LightsailUSD24), it exceeds the budget: retain existing services and request a budget/scope decision instead of upgrading automatically.

## Monitoring and automatic shutdown investigation

Already active: free USD15 gross budget with absolute5/10/12/15 actual alerts and15 forecast. Forecast is currently ALARM due to existing account spend. No shutdown action is enabled or authorized.

1. At USD5 review resource inventory/forecast; at10 prohibit optional provisioning/growth and investigate immediately; at12 follow a reviewed owner-approved runbook with enough margin for delayed billing;15 is an alarm, not a stop guarantee.
2. A scoped IAM deny policy/budget action can prevent a non-root deployer from launching additional resources. It does not stop existing charges, root bypasses ordinary IAM policies, and organization changes/SCPs are not a free prerequisite. Review policies and enable actions only after approval.
3. AWS Budget Actions can use SSM to stop approved EC2/RDS targets. They cannot guarantee a cap: billing is delayed and EC2 EBS/publicIPv4/snapshots can continue billing after compute stops. Do not configure a global action that can shut down the existing two unrelated instances without exact approval.
4. **Stopping ordinary Lightsail does not stop bundle charges.** It bills until deleted. An automatic stop may reduce traffic overage but cannot save its base monthly fee. Automatic deletion would destroy the instance/root disk and is not authorized; do not invent a safe shutdown cap or delete originals to meet a budget.
5. For a later approved Lightsail pilot, use free/local disk/traffic monitoring, strict operator limits and pause uploads well below disk/transfer allowance. Rate limits and early resource quarantine can reduce overage risk, not guarantee an account cap. Paid CloudWatch logs, repeated Cost Explorer API queries, Lambda/SNS controls and extra backups must each be included/reviewed rather than assumed zero.
6. Do not store private clinical data, URLs/tokens or provider credentials in monitoring logs. Cap Docker logs; keep actual AWS credentials only in AWS CLI temporary cache/instance roles. Snapshot restore is rehearsed in isolation and never overwrites production as a test.

## Non-root owner setup status

The owner explicitly selected a new IAM deployer and will enroll MFA personally. Programmatic IAM user/console-password setup was attempted but automatic approval review rejected the command with only "blocked by policy"; the process did not execute and no IAM identity/password/access key was created. No retry bypass was attempted.

Safe manual Console path: create IAM user medipulse-deployer with console access and password-change-on-first-login; attach SignInLocalDevelopmentAccess plus the inline policy in iam-bootstrap-self-service.json. That policy permits only own password/MFA setup, not infrastructure changes or access keys. Owner privately chooses/changes the console password and enrolls MFA using a device name beginning medipulse-deployer. After MFA is confirmed, review/attach iam-readonly-planning.json for metadata/cost inspection only. No broad AdministratorAccess or paid provisioning permission is included. Then use aws login --profile medipulse-deployer --region ap-south-1; never share passwords, QR codes, OTPs or keys in chat. The new owner's non-root CLI login is not yet verified.

## Execution gates

**Now, without paid provisioning:** preserve the website; update/verify budget; identify existing-cost owners; document exact resources requiring cleanup approval; finish non-root IAM/MFA; keep all flags/production unchanged. No push was performed.

**After owner approval only:**

1. Resolve/re-budget existing two EC2 instances and their storage/publicIPv4 with exact resource approval and backups. Merely stopping EC2 leaves storage/network charges; never delete an unknown volume. Review other services/snapshots and the actual tax calculation before deciding any new spend.
2. Accept only a concrete hybrid whose gross estimate fits15 with headroom. Get consent for bundle, backup retention, staging-only DNS/certificate validation and the actual permitted test data. Do not count the USD 170.82 credits as budget headroom.
3. Freeze a release including the two outstanding local Reels verification/preflight commits; build/transfer a pinned amd64 image locally. Do not push until authorized. Reuse Docker/FFmpeg/model/auth infrastructure.
4. Use an isolated staging DB and synthetic linked identities. Adapt/validate persistence for included Lightsail disk and backup restore. No optional Kafka/TURN service is deployed without its explicit scope/cost. Make actual relay/binary/model/persistence measurements.
5. Independently verify cookie/CSRF/Google login/account switching; duplicate booking/token/ledger/refund behavior; Redis recovery; Kafka delivery if retained or explicitly disabled analytics; Socket.IO; two-network WebRTC; record/upload/process/review/publish/HLS; real watch-based recommendation changes/reset/opt-out; private/removed/revoked media denial.
6. Reboot/stop/start with known synthetic media/model fingerprints; verify trusted HTTPS, data integrity, offline model load and Redis persistence. A local5second smoke does not close this requirement.
7. Obtain separate production DB/index/credential/DNS/Vercel-rewrite/deployment approval. Quiesce old writers/workers only within the approved cutover. Keep Atlas records/wallets/recovery archives intact, preserve cookie/CSRF behavior, and coordinate exposed signing-key rotation with encrypted outbox jobs.
8. Keep medipulse.live on Vercel; point only the approved API hostname/rewrite to AWS. Enable production Reels only after its activation gate. On failure restore the old relay/verified backend with one active production writer stack. Do not shut down or delete Render/Vercel until accepted and explicitly approved.

## Prepared artifacts and what is not deployed

budget.json/notifications.json match the active15USD budget. estimate.json records options/current costs/memory evidence. tools/aws-readiness.py is read-only identity/credit inspection. Caddyfile and backend/frontend env examples are reusable; no keys are filled. compose.yml/medipulse.service are **superseded EC2 reference configurations**, not approved15USD provisioning. spa-function.js is an unused future frontend migration draft; S3/CloudFront migration is deferred to preserve Vercel and avoid unnecessary metered services.

Local checks: Compose parse with synthetic metadata/no env-file expansion, JSON validation, CloudFront-function syntax/routing smoke, actual Caddy config validation, Python compile and actual local memory/media/model smoke passed. None provisions AWS resources or verifies AWS application HTTPS/live workflows. Cost data comes from AWS Billing/Budgets/PriceList/Lightsail APIs; no paid Cost Explorer request was made. Owner IAM identity and chargeable-resource approval remain pending.

## Primary references

- [Lightsail bundle specifications](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-bundles.html), [regional transfer allowance](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-faq-data-transfer-allowance.html), [billing while stopped and snapshots](https://docs.aws.amazon.com/en_en/lightsail/latest/userguide/amazon-lightsail-frequently-asked-questions-faq-billing-and-account-management.html).
- [AWS Budgets absolute notifications](https://docs.aws.amazon.com/aws-cost-management/latest/APIReference/API_budgets_Notification.html), [free alert-only pricing](https://aws.amazon.com/aws-cost-management/aws-budgets/pricing/), [budget actions](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-controls.html).
- [AWS browser CLI login](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sign-in.html), [Billing GetCredits](https://docs.aws.amazon.com/aws-cost-management/latest/APIReference/API_billing_GetCredits.html), [EBS pricing](https://aws.amazon.com/ebs/pricing/), [IPv4 pricing](https://aws.amazon.com/vpc/pricing/).
- [Render Free persistence/production limitations](https://render.com/docs/free), [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https).
