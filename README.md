<p align="center">
  <img src="./frontend/public/heart.svg" alt="MediPulse logo" width="86" />
</p>

<h1 align="center">MediPulse</h1>

<p align="center">
  <b>A next-generation healthcare SaaS platform integrating AI, real-time telemedicine, and smart OPD management.</b>
</p>

<p align="center">
  <img alt="React" src="https://img.shields.io/badge/Frontend-React%20%2B%20Vite%20%2B%20Tailwind-2563eb?style=for-the-badge" />
  <img alt="Node" src="https://img.shields.io/badge/Backend-Node.js%20%2B%20Express-16a34a?style=for-the-badge" />
  <img alt="MongoDB" src="https://img.shields.io/badge/Database-MongoDB%20%2B%20Redis-047857?style=for-the-badge" />
  <img alt="Realtime" src="https://img.shields.io/badge/Realtime-Socket.IO%20%2B%20WebRTC-111827?style=for-the-badge" />
  <img alt="AI" src="https://img.shields.io/badge/AI-Gemini%20%2B%20FastAPI-8b5cf6?style=for-the-badge" />
</p>

---

## 🚀 Product Vision

MediPulse is a multi-tenant healthcare operating system designed to seamlessly connect hospitals, doctors, and patients. It acts as **Practo for patients, Zoho for hospitals, and an AI Copilot for doctors**, unified in a single B2B healthcare SaaS product. 

By combining traditional hospital management features with cutting-edge AI triage and real-time WebRTC telemedicine, MediPulse aims to eliminate scattered health records, reduce patient wait times, and automate clinical documentation.

---

## ✨ Core Features & Recent Integrations

### 🤖 AI-Powered Patient Triage, Disease Prediction & Smart Booking
- **Smart AI Booking**: Patients simply describe their symptoms in natural language. Our AI engine instantly predicts their condition, determines severity (e.g. LOW, EMERGENCY), matches them to the precise medical specialty required, and directly recommends verified doctors for immediate booking.
- **Intelligent Pre-Consultation**: For manual bookings, patients interact with a Gemini-powered conversational AI that synthesizes the chat into a structured patient brief (Chief Complaint, Duration, Severity) for the doctor to review instantly.
- **Disease Prediction Service**: An intelligent fallback pipeline utilizing Gemini and Python/FastAPI microservices to predict diseases using TF-IDF and NLP.

### 🎥 WebRTC Video Consultations & AI Copilot
- **Peer-to-Peer Telemedicine**: Crystal-clear, secure video consultations powered directly by WebRTC without third-party meeting links.
- **Advanced Audio Processing**: Built-in echo cancellation, noise suppression, and auto-gain control to eliminate feedback loops and ensure professional audio quality.
- **Flawless Lifecycle Management**: Graceful call terminations, dynamic UI updates, and real-time Socket.IO presence tracking ensure neither doctor nor patient gets stuck on a frozen screen.
- **Doctor Copilot**: During live consultations, the AI Copilot actively assists the doctor and automatically generates standard **SOAP (Subjective, Objective, Assessment, Plan)** clinical notes, saving doctors hours of documentation time.

### 🏥 Multi-Tenant Hospital & Smart OPD Queues
- **Role-Based Access Control (RBAC)**: Support for Platform Doctors, Hospital Admins, and linked Hospital Staff profiles.
- **Live OPD Queues**: Patients receive dynamic OPD tokens and real-time Socket.IO updates on their queue position.
- **Profile Synchronization**: Sophisticated ID resolution ensures that queues and appointments remain perfectly synced across a doctor's independent practice and their linked hospital staff profiles.

### 💳 Virtual Wallet & Appointment Lifecycle
- **Wallet System**: Patients manage a virtual wallet for seamless, instant booking debits.
- **Automated Refunds**: Failed or missed appointments trigger automated wallet refunds securely backed by MongoDB transactions.

---

## 🛠️ Technology Stack

| Layer | Technologies |
|---|---|
| **Frontend** | React, Vite, React Router, Tailwind CSS v4, Axios, Lucide React |
| **Backend** | Node.js, Express.js, JWT Authentication, Cookies |
| **Database** | MongoDB (with Transactions), Mongoose |
| **Caching & State** | Redis (Conversation state caching, session management) |
| **Real-time** | Socket.IO (Live queues, events), WebRTC (Video calls) |
| **AI & Machine Learning** | Google Gemini API (Function Calling, NLP), Python, FastAPI, Scikit-learn, TF-IDF |
| **Integrations** | Virtual Wallet, Nodemailer (OTP, Confirmations), jsPDF (Receipts, QR) |
| **DevOps & Deployment** | Docker, Docker Compose, Render, Vercel |

---

## 🧩 Microservices Architecture

To ensure the primary Node.js event loop remains unblocked, heavy Machine Learning tasks are decoupled into standalone microservices. 
- The Node backend securely communicates with these internal services, employing robust error handling and Docker-network fallback routing (`host.docker.internal`) to ensure maximum uptime even if a service drops.
- **[MediPulse Disease Prediction](https://github.com/khushalmidha/medipulse-disease-prediction)**: FastAPI service handling diagnostic predictions.
- **[MediPulse Ranking Engine](https://github.com/khushalmidha/medipulse-ranking-engine)**: XGBoost-powered service for intelligent doctor ranking and urgency classification.

---

## 🛣️ Roadmap

- **Phase 1 (Completed):** Multi-tenant models, Smart OPD tokens, WebRTC Video Consults, Virtual Wallet.
- **Phase 2 (Completed):** AI Pre-consultation Triage, ML Disease Prediction integration, AI SOAP Copilot.
- **Phase 3 (Next):** Full Lab orders, report uploads, digital prescriptions with QR verification, and family record managers.
- **Phase 4:** Advanced wait-time predictions, internal hospital staff communication (Doctor-Nurse-Lab routing).
- **Phase 5:** ABHA (Ayushman Bharat Health Account) integration, enterprise API access, and mobile app rollout.

---

## 💡 Why MediPulse Matters

Hospitals lose time because queues, communication, reports, billing, and records are scattered. Patients lose trust because wait times are unclear and follow-ups are manual. 

MediPulse makes the healthcare journey transparent, coordinated, and measurable. Designed for high concurrency and built with modern AI integrations, it is ready to scale into a serious, enterprise-grade healthcare SaaS platform.
