<p align="center">
  <img src="./frontend/public/heart.svg" alt="MediPulse logo" width="86" />
</p>

<h1 align="center">MediPulse</h1>

<p align="center">
  <b>A multi-tenant healthcare SaaS platform combining AI triage, real-time telemedicine, and smart OPD management.</b>
</p>

<p align="center">
  <a href="https://www.medipulse.live/"><b>Live Demo</b></a>
</p>

<p align="center">
  <img alt="React" src="https://img.shields.io/badge/Frontend-React%20%2B%20Vite%20%2B%20Tailwind-2563eb?style=for-the-badge" />
  <img alt="Node" src="https://img.shields.io/badge/Backend-Node.js%20%2B%20Express-16a34a?style=for-the-badge" />
  <img alt="MongoDB" src="https://img.shields.io/badge/Data-MongoDB%20%2B%20Redis%20%2B%20Kafka-047857?style=for-the-badge" />
  <img alt="Realtime" src="https://img.shields.io/badge/Realtime-Socket.IO%20%2B%20WebRTC-111827?style=for-the-badge" />
  <img alt="AI" src="https://img.shields.io/badge/AI-Gemini%20%2B%20FastAPI%20ML-8b5cf6?style=for-the-badge" />
</p>

---

## 📊 At a Glance

| Metric | Count |
|---|---|
| REST endpoints | **125** across 18 route modules |
| Mongoose models | **24** |
| Express controllers | **20** |
| Backend services (Redis, Kafka, ledger, AI tools) | **9** |
| Socket.IO event handlers | **15** |
| React pages / components | **34** / **12** (35 client routes) |
| Kafka topics (event-driven payments) | **8** |
| Python ML microservices | **1** (FastAPI Engine) |
| Deep Learning Models (Hugging Face) | **2** (TriageBERT & PubMedBERT) |
| Staff roles enforced via RBAC | **7** |

---

## 🚀 What It Does

MediPulse connects hospitals, doctors, and patients in one system — **Practo for patients, an admin suite for hospitals, and an AI copilot for doctors**.

It combines hospital management with AI triage and peer-to-peer WebRTC telemedicine to cut patient wait times and automate clinical documentation.

---

## ✨ Core Features

### 🤖 AI Pre-Triage & Smart Routing (Powered by BERT)
- **Smart Assessment Engine** — Patients describe symptoms in natural language. A dedicated Python FastAPI microservice leverages **Hugging Face Transformers** to run state-of-the-art NLP models concurrently.
- **Severity Prediction (`TriageBERT`)** — Extracts clinical severity (ESI Level 1-5) directly from unstructured symptom text and overrides with deterministic rule-based safety nets for critical emergencies (e.g. "heart attack").
- **Specialty Routing (`PubMedBERT`)** — Maps symptoms to **13 distinct medical specialties** with calibrated confidence scores and differential alternatives, significantly narrowing the search space for doctors.
- **Conversational pre-consultation** — A Gemini-driven multi-turn triage chat synthesizes conversations into a structured brief: chief complaint, duration, severity, and urgency. Conversation state is cached in Redis.

### 🎥 WebRTC Video Consultations & Doctor Copilot
- **Peer-to-peer telemedicine** — Direct WebRTC video/audio with no third-party meeting links. Socket.IO handles signalling (offer/answer/ICE) and presence, with STUN plus optional TURN relay for restrictive NATs.
- **Robust audio** — Echo cancellation, noise suppression, and auto-gain control. Graceful `getUserMedia` degradation: video → audio-only → placeholder canvas track, so a missing webcam never blocks a consult.
- **Reliable call lifecycle** — A single shared teardown path (guarded by a ref) means ending a call fires cleanup exactly once, releases the microphone, and never leaves either party on a stale "Waiting for…" screen.
- **Live copilot** — Streams the consultation transcript in batched chunks, flags drug/symptom red flags against the patient's history, and auto-generates **SOAP** notes.
- **In-call chat & report viewer** — Side panels for messaging and reviewing the patient's uploaded reports without leaving the call.

### 🏥 Multi-Tenant Hospitals & Smart OPD
- **RBAC across 7 staff roles** — `HOSPITAL_ADMIN`, `DEPARTMENT_HEAD`, `DOCTOR`, `NURSE`, `LAB_TECH`, `RECEPTIONIST`, `PHARMACIST`, plus an `adminAccess` flag so a clinician can hold portal access without losing their clinical role.
- **Custom-branded hospital websites** — Each tenant gets a subdomain-resolved public site.
- **Live OPD queues** — Atomic per-hospital token sequences, real-time position updates over Socket.IO, and dedicated consoles for doctors, nursing stations, and staff communication.
- **Identity resolution** — Queues and appointments stay in sync across a doctor's independent practice and their linked hospital-staff profile.

### 💳 Virtual Payment Gateway
- **Concurrency-safe ledger** — Redis distributed locks (`SET NX PX`) acquired in **deterministic sorted order** to prevent deadlocks between concurrent transfers, wrapped in **atomic MongoDB multi-document transactions** so no double-spend or partial debit is possible.
- **Idempotent refunds** — Refunds are keyed by an idempotency key, so retries and duplicate webhooks can never double-refund.
- **Event-driven** — Every payment, refund, wallet update, notification, and analytics event publishes to **8 Kafka topics** consumed by a separate worker process, keeping the request path fast.

### 🔐 Auth & Security
- JWT (httpOnly cookies) with Google OAuth, email OTP flows for password reset and booking verification, a NoSQL-injection guard middleware, and CORS allow-listing.

---

## 🛠️ Tech Stack

| Layer | Technologies |
|---|---|
| **Frontend** | React, Vite, React Router, Tailwind CSS v4, Axios, Lucide, jsPDF |
| **Backend** | Node.js, Express, JWT, Google OAuth, Nodemailer |
| **Database** | MongoDB + Mongoose (multi-document transactions) |
| **Cache & Locks** | Redis (state caching, distributed locks, TTL keys) with an in-memory fallback shim for local dev |
| **Messaging** | Apache Kafka (KafkaJS) — 8 topics, producer + consumer worker |
| **Real-time** | Socket.IO (queues, presence, signalling), WebRTC (media) |
| **AI / ML** | Google Gemini, Python, FastAPI, Hugging Face Transformers (`TriageBERT`, `PubMedBERT`), PyTorch, LightGBM |
| **DevOps** | Docker, Docker Compose, Render, Vercel |

---

## 🧩 Architecture

Heavy ML work is decoupled from the Node event loop into standalone FastAPI services. The backend calls them over HTTP with defensive error handling and Docker-network fallback routing (`host.docker.internal`), degrading gracefully when a service is unreachable.

```text
React (Vercel)
      │  REST + Socket.IO + WebRTC signalling
      ▼
Node/Express API ──── Redis (cache, locks, triage state)
      │          └─── Kafka ──► vpay consumer worker ──► MongoDB
      │  HTTP
      └──► medipulse-ranking-engine  (FastAPI · TriageBERT · Specialty Classifier · Ranker)
```

- **medipulse-ranking-engine** — A unified AI engine that runs dual Hugging Face NLP pipelines concurrently on thread pools. Exposes `/v2/assessment` to predict specialty and clinical severity (ESI). It also houses the Learning-to-Rank logic (currently an MVP heuristic ranker, upgrading to LightGBM LambdaMART) for personalized doctor recommendations.

### Fallback strategy

The AI prediction is intentionally layered so one failure never leaves a doctor with an empty panel:

1. **ML microservice** (primary — high accuracy NLP)
2. **Deterministic Rules** (flags critical keywords natively in Node/Python for immediate triage overrides)
3. **Reported chief complaint** (final fallback — surfaces what the patient actually said instead of a bare "Unknown")

---

## 🚦 Getting Started

```bash
# Full stack (Mongo, Redis, Kafka, API, consumer, frontend)
docker compose up --build

# Or run pieces individually
cd backend  && npm install && npm run dev
cd frontend && npm install && npm run dev

# ML service (Downloads ~860MB of BERT weights on first run)
cd medipulse-ranking-engine
pip install -r requirements.txt
uvicorn app.main:app --port 8000 --reload
```

Copy `.env.example` to `.env` and fill in `DATABASE_URL`, `TOKEN_KEY`, `GEMINI_API_KEY`, `REDIS_URL`, `KAFKA_BROKERS`, `GOOGLE_CLIENT_ID`, and `ML_MICROSERVICE_URL`.

---

## 🛣️ Roadmap

- **Phase 1 (done)** — Multi-tenant models, OPD tokens, WebRTC consults, virtual wallet.
- **Phase 2 (done)** — AI triage, TriageBERT integration, SOAP copilot, Kafka payment events.
- **Phase 3 (next)** — Lab orders, report uploads, QR-verified digital prescriptions, family record manager.
- **Phase 4** — Swap the heuristic ranking stub with trained LightGBM LambdaMART models using live interaction data; wait-time prediction.
- **Phase 5** — ABHA (Ayushman Bharat Health Account) integration, enterprise API access, mobile rollout.

---

## 💡 Why It Matters

Hospitals lose time because queues, communication, reports, billing, and records live in separate silos. Patients lose trust because wait times are opaque and follow-ups are manual.

MediPulse makes the journey transparent and measurable — built for concurrency correctness (distributed locks, atomic transactions, idempotent refunds) and honest AI (layered fallbacks) rather than demo-only shortcuts.
