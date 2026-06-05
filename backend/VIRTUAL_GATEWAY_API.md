# MediPulse Virtual Payment Gateway

This module is a virtual currency gateway. It does not use banks, UPI, cards,
Razorpay, Stripe, PhonePe, Paytm, or any external payment provider.

Base path: `/vpay`
Auth: existing JWT cookie middleware.
Currency: virtual INR.

## Infrastructure

- MongoDB stores wallets, ledger transactions, refund records, notifications,
  and analytics events.
- Redis stores wallet cache, rate limits, idempotency state, and
  distributed wallet locks.
- Kafka publishes and consumes gateway events.

## Required Headers

Mutation endpoints that move money require idempotency:

```http
x-idempotency-key: unique-client-request-id
```

Alternatively send `requestId` in the JSON body.

## User APIs

- `GET /wallet/dashboard`
- `POST /send`
  - body: `{ receiverId, receiverRole, amount, description, referenceId?, requestId? }`
- `POST /merchant/pay`
  - body: `{ doctorId, amount, description, referenceId?, requestId? }`
- `POST /refund`
  - body: `{ transactionId, amount?, reason, requestId? }`
- `GET /refunds?page=1&limit=10&status=COMPLETED`
- `GET /transactions?page=1&limit=10&type=PAYMENT&status=SUCCESS&fromDate=2026-01-01&toDate=2026-12-31&search=TXN`
- `GET /transactions/export`
- `GET /notifications?page=1&limit=10&unreadOnly=true`
- `PATCH /notifications/:id/read`

## Admin APIs

Admin users are configured with `ADMIN_USER_IDS`.

- `POST /wallet/topup`
  - body: `{ targetId, targetRole, amount, description, requestId? }`
- `GET /admin/wallets?page=1&limit=10&status=active&userRole=user`
- `PATCH /admin/wallets/:walletId/freeze`
- `PATCH /admin/wallets/:walletId/unfreeze`
- `GET /admin/transactions?page=1&limit=20&type=REFUND`
- `GET /admin/refunds?page=1&limit=20&status=COMPLETED`
- `GET /admin/stats`

`/admin/stats` returns:

- total virtual money in circulation
- total payments and refunds
- active wallets
- most active doctors
- daily transaction volume
- recent Kafka analytics events

## Ledger Rules

Money movement must go through `transferVirtualMoney` or `topupWallet`.

- Payments debit sender wallet and credit receiver wallet.
- Refunds debit merchant wallet and credit payer wallet.
- Wallet balances are guarded by Redis locks.
- Duplicate payment requests are blocked by Redis idempotency keys.
- Duplicate refunds are blocked by refund records and remaining refundable amount.

## Kafka Topics

- `payments.created`
- `payments.completed`
- `payments.failed`
- `refunds.created`
- `refunds.completed`
- `wallet.updated`
- `notifications.created`
- `analytics.events`

Start consumers:

```bash
cd backend
npm run consumer:vpay
```

## Seed Data

```bash
cd backend
npm run seed:vpay
```

Creates:

- `demo.patient@medipulse.app / patient123`, wallet INR 10000
- `demo.doctor@medipulse.app / doctor123`, wallet INR 5000
- `demo.admin@medipulse.app / admin123`, wallet INR 50000

Copy the printed admin id into `ADMIN_USER_IDS`.

## Docker

From project root:

```bash
docker compose up --build
```

Services:

- frontend: `http://localhost:8081`
- backend: `http://localhost:8080`
- MongoDB: `localhost:27017`
- Redis: `localhost:6379`
- Kafka: `localhost:9092`
