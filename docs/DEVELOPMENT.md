# Local development and verification

Run commands from the repository root. Use Node 24 LTS and Docker Compose 2.24.4+ with Docker Engine running. No cloud database or provider credentials are needed for the baseline.

P03 adds queue schema initialization; P04 adds integer demo-ledger accounting and requires [P04_MIGRATION.md](P04_MIGRATION.md) before restarting existing financial writers. For an existing P02 database/image, follow [P03_MIGRATION.md](P03_MIGRATION.md) before restarting writers. Fresh empty local stacks initialize through `queue-init`; nonempty legacy queues require review.

## Full Docker stack

```sh
docker compose up --build
```

Frontend: `http://localhost:8081`. API: `http://localhost:8080`. Compose initializes a single-node MongoDB 7 replica set (`rs0`, database `medipulse_dev`), real Redis DB 0 and Kafka. The API and consumer share those targets. Mail is disabled; wallet credits remain demo credits. The frontend supports SPA deep links and proxies its relative `/api/` calls to the API.

The development signing key is public and only suitable for localhost. Ports bind to loopback. Fresh `mongo_dev_data` and `redis_dev_data` volumes isolate this environment from the old Compose volumes; old data is not migrated or deleted. Stop with `docker compose down` to retain data.

## Host development with container dependencies

Copy `backend/.env.local.example` to `backend/.env.local` and `frontend/.env.local.example` to `frontend/.env.local`, without overwriting existing files. Keep the supplied localhost targets. These private files are ignored by Git and excluded from Docker builds.

```sh
docker compose up -d mongo redis zookeeper kafka
docker compose run --rm mongo-init
docker compose build queue-init
docker compose run --rm queue-init
```

In separate terminals:

```sh
cd backend
npm ci
npm run dev
```

```sh
cd backend
npm run consumer:local
```

```sh
cd frontend
npm ci
npm run dev
```

The host API/consumer explicitly load `backend/.env.local`, never the deployment `.env`, and require localhost `medipulse_dev`. The frontend is at `http://localhost:5173`; Vite proxies relative `/api/` requests to port 8080. `directConnection=true` allows a host client to use the Docker replica set whose internal member name is `mongo:27017`.

Optional AI/Google/ML integrations require separate local configuration; they are not exercised by baseline tests. Local mail is disabled. An absent integration should not be interpreted as a working provider connection.

## Checks

```sh
cd backend
npm test
npm run test:integration
```

`npm test` runs the P01 HTTP/socket regressions, P02 config/readiness/consumer tests P03 queue/date/request guards and P04 amount/transaction/gateway checks, with synthetic identities and mocked database methods. A preload disables mail/Kafka/AI and prevents deployment `.env` loading.

`test:integration` requires the running local replica set and Redis. It reads only `TEST_DATABASE_URL` and `TEST_REDIS_URL` from `.env.local` or explicitly supplied environment variables. Mongo must be local, credential-free and named `medipulse_test`; Redis must be local DB 15. There is no `DATABASE_URL` fallback. Each run creates a unique `medipulse_test_<random>` database and Redis key prefix; cleanup removes only that database and those keys. It checks virtual balance conservation/refunds, failed debit rollback, a pre-existing atomic OPD sequence, family ownership and staff visit access. The P03 suite also starts two API processes against another unique test database, exercises concurrent first issuance, request replay, family/walk-in identity, active constraints, linked transitions, date boundaries and migration/rollback rehearsals. The P04 suite adds real concurrent refund limits, persistent HTTP payment keys, rollback/failure windows, restart recovery and ledger migration/recovery.

```sh
cd frontend
npx playwright install chromium
npm run test:e2e
npm run build
npx eslint vite.config.js playwright.config.js e2e/booking.spec.js
```

The eighteen browser cases cover desktop and 390px mobile booking: fee, keyboard confirmation into synthetic triage, failed demo payment, guest sign-in, a reloaded deep link, lost-response retry keys, staff arrival confirmation and separate doctor care queues and persistent demo top-up/refund retries. Playwright starts its own Vite server on port 15173 and synthetic API on 19080, blocks external page requests, and refuses to reuse existing servers. No Mongo/Redis/provider is used. Browser checks validate the current UI contracts, not real payments or the Docker Nginx runtime. On Windows with Edge installed, set `$env:E2E_BROWSER_CHANNEL='msedge'` in PowerShell instead of downloading Chromium. Set `E2E_TRACE=true` to retain failure traces. For OneDrive workspaces, `E2E_OUTPUT_DIR` can point to a temporary folder outside sync.

Validate both Compose configurations without reading production secrets or requiring Docker Engine:

```sh
node backend/scripts/checkCompose.js
```

`testVirtualLedger.js` delegates to the isolated integration runner. `test-gemini.js` requires explicit `ALLOW_PROVIDER_TEST=true` and `TEST_GEMINI_API_KEY`, does not load `.env`, and is excluded from baseline checks.

## Dependency status

API: `/health/live` and `/health/ready`. The consumer exposes those paths internally on port 8082. Readiness requires a writable Mongo replica set, selected Redis and Kafka when configured; the consumer also requires Kafka group membership. Failed checks return 503 with dependency labels, without provider error details. `mail` reports configuration only, not delivery verification. Disabled Kafka and memory Redis are explicitly labeled; the intended Compose stack uses real Redis/Kafka.

Startup exits unsuccessfully on invalid required configuration or unavailable dependencies. Process shutdown stops polling workers and closes sockets/database/Redis. Container health checks use readiness. No durable delivery/restart guarantees are added here; P06 covers that work.

## Production configuration preparation

`docker-compose.prod.yml` is an override, not a standalone file. It excludes local Mongo initialization, requires explicit production `DATABASE_URL`, `TOKEN_KEY` and `CLIENT_URLS`; browser `PUBLIC_API_URL` defaults to the same-origin `/backend` relay (an explicit HTTPS API remains supported), shares Redis/Kafka between API and consumer, and isolates production broker/Redis volumes. Copy the blank `backend/.env.production.example` into a private `backend/.env.production` and fill approved deployment settings only when preparing deployment. Both interpolation and container env files must use that same file:

```sh
docker compose --env-file backend/.env.production -f docker-compose.yml -f docker-compose.prod.yml config --quiet
```

This is validation only. Do not launch production without separate authorization and credential rotation. Fresh production Redis/Kafka/ZooKeeper volumes require an explicit existing-data recovery plan before replacing an established deployment. Ports stay on loopback; an external HTTPS proxy and approved DNS are separate deployment requirements. The bundled broker uses internal plaintext transport; external managed Kafka requires an intentional override of brokers/TLS/SASL. Google/other public frontend build settings also need deployment-specific review before release.

References: [Compose dependency readiness](https://docs.docker.com/compose/how-tos/startup-order/), [MongoDB direct connections](https://www.mongodb.com/docs/manual/reference/connection-string-options/), [Playwright web servers](https://playwright.dev/docs/test-webserver).

P05 adds coordinated frontend/API session rollout and auth indexes. See [P05_SESSIONS.md](P05_SESSIONS.md) before restarting newer writers. Browser sessions require HttpOnly cookies and CSRF; the existing-domain relay avoids third-party cookies.
