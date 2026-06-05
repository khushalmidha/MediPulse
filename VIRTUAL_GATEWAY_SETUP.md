# Virtual Payment Gateway Setup

This gateway uses only virtual INR. It is intentionally not connected to any
real payment provider.

## Local Services

Run MongoDB, Redis, and Kafka locally, then create `backend/.env`:

```env
PORT=8080
DATABASE_URL=mongodb://127.0.0.1:27017/medipulse
TOKEN_KEY=change-me
CLIENT_URLS=http://localhost:5173
REDIS_URL=redis://127.0.0.1:6379
KAFKA_BROKERS=localhost:9092
ADMIN_USER_IDS=
VPAY_RATE_LIMIT_MAX=30
VPAY_RATE_LIMIT_WINDOW_SEC=60
```

Install and run:

```bash
cd backend
npm install
npm run seed:vpay
npm run dev
```

In another terminal:

```bash
cd backend
npm run consumer:vpay
```

In another terminal:

```bash
cd frontend
npm install
npm run dev
```

After seeding, copy the printed admin id into `ADMIN_USER_IDS`.

## Docker

```bash
docker compose up --build
```

Frontend: `http://localhost:8081`
Backend: `http://localhost:8080`

## Frontend Pages

- `/wallet`
- `/wallet/transactions`
- `/wallet/refunds`
- `/wallet/notifications`
- `/admin/virtual-payments`

## Operational Notes

- Send money, doctor pay, top-up, and refund requests require
  `x-idempotency-key` or `requestId`.
- Redis locks protect wallets from concurrent balance mutation.
- Kafka consumer stores all payment/refund/wallet/notification events in the
  analytics event collection.
- Wallet balances should never be edited directly in MongoDB. Use ledger
  services so transactions remain traceable.
