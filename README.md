<p align="center">
  <img src="./frontend/public/heart.svg" alt="MediPulse logo" width="86" />
</p>

<h1 align="center">MediPulse</h1>

<p align="center">
  <b>A healthcare SaaS platform for hospitals, doctors, staff, and patients.</b>
</p>

<p align="center">
  <img alt="React" src="https://img.shields.io/badge/Frontend-React%20%2B%20Vite-2563eb?style=for-the-badge" />
  <img alt="Node" src="https://img.shields.io/badge/Backend-Node.js%20%2B%20Express-16a34a?style=for-the-badge" />
  <img alt="MongoDB" src="https://img.shields.io/badge/Database-MongoDB-047857?style=for-the-badge" />
  <img alt="Realtime" src="https://img.shields.io/badge/Realtime-Socket.IO-111827?style=for-the-badge" />
</p>

---

## Product Vision

MediPulse started as a full-stack healthcare portfolio project, but the long-term vision is much bigger: a multi-tenant healthcare operating system for hospitals. The idea is to combine doctor discovery, smart OPD queues, staff communication, lab workflows, video consultation, wallet payments, health records, reviews, and AI guidance into one connected platform.

Think of MediPulse as **Practo for patients, Zoho for hospitals, and WhatsApp for medical staff**, brought together in a single B2B healthcare SaaS product. Patients can book appointments across registered hospitals, track queue status in real time, receive reports, manage family records, and consult doctors virtually. Hospitals get dashboards for OPD flow, staff roles, lab orders, billing, subscriptions, ratings, and analytics.

---

## Current Platform

The current version already proves the core loop. Users and doctors can sign up, authenticate with JWT sessions, use Google login, book appointments through email OTP verification, and join doctor-controlled queues. A virtual wallet supports booking debits, refunds, wallet updates, and transaction tracking. Doctors can start appointments, run video consultations, save notes, generate receipts, and end sessions.

MediPulse also includes communities, realtime chat, and joined-community events on the dashboard. The Gemini-powered assistant helps with doctor discovery, community suggestions, and general health guidance. The platform is already structured for realtime events through Socket.IO, Redis-compatible services, Kafka-ready virtual payment events, and Docker-based deployment.

---

## Future SaaS Model

The next evolution is multi-tenancy. Each hospital becomes a tenant with its own departments, staff, OPD schedule, lab catalog, subscription, billing rules, and public profile. Patients remain platform-level accounts, so one patient can book anywhere and keep a unified health timeline.

```
Platform
  -> Hospital
      -> Departments
      -> Doctors, Nurses, Lab Techs, Receptionists
      -> OPD Tokens, Lab Orders, Prescriptions
      -> Billing, Reviews, Analytics
Patient
  -> Appointments across hospitals
  -> Reports, prescriptions, family records
```

---

## Core Modules

### Hospital Onboarding

Hospitals can apply with license details, address, type, photos, facilities, timings, and departments. Platform admins approve or reject registrations. After approval, every hospital receives a unique profile and slug. Hospital admins can onboard staff through invite-based accounts with role-based access.

### Smart OPD Management

The OPD token system is the heart of the product. Patients get a token, see estimated wait time, and receive updates when they are close to being called. Doctors get an OPD console showing current patient, vitals, complaint, notes, lab orders, prescriptions, referrals, and next queue item.

### Internal Staff Communication

MediPulse replaces generic chat with patient-context communication. Doctors can message nurses about a token, labs can notify doctors when reports are ready, departments can send referral handoffs, and admins can broadcast announcements.

### Labs, Reports, and Prescriptions

Hospitals can maintain a lab test catalog with price and turnaround time. Doctors can order tests from the consultation screen. Lab technicians manage collection, processing, report upload, and critical-value alerts.

### Patient Portal

Patients get a unified profile with appointment history, digital prescriptions, lab reports, health timeline, and family management. A single account can manage self, spouse, child, or parent appointments.

### Ratings and Reviews

After each visit, patients can rate doctor quality, wait time, staff behavior, cleanliness, and value for money. MediPulse can compute a composite hospital score using satisfaction, wait-time accuracy, completion rate, fee transparency, and lab turnaround time.

---

## Technology Stack

| Layer | Technologies |
|---|---|
| Frontend | React, Vite, React Router, Tailwind CSS, Axios, Lucide React |
| Realtime | Socket.IO, WebRTC signaling, live queue events |
| Backend | Node.js, Express.js, JWT, Cookies, Mongoose |
| Database | MongoDB |
| Cache and Queue | Redis-compatible services |
| Events | Kafka-ready virtual payment and analytics topics |
| Payments | Virtual wallet, ledger, and refund automation |
| Email | OTP, booking confirmation, refund, password reset notifications |
| AI | Gemini-powered assistant and recommendation layer |
| Documents | jsPDF receipts, QR verification support |
| DevOps | Dockerfiles, Docker Compose, environment-based deployment |

---

## Standalone ML Microservices

In addition to the main web platform, MediPulse incorporates advanced Machine Learning capabilities through separate, standalone microservices. These are built in Python and decouple heavy data processing from the core Node.js application:

- **[MediPulse Ranking Engine](https://github.com/khushalmidha/medipulse-ranking-engine)**: A FastAPI service with trained XGBoost models for triage-urgency classification and intelligent doctor-ranking based on symptoms and patient history.
- **[MediPulse Disease Prediction](https://github.com/khushalmidha/medipulse-disease-prediction)**: A specialized service leveraging scikit-learn models for multi-class disease diagnosis from patient inputs.

*Note: These services are maintained in their own repositories to keep the main web app's git history clean and allow independent deployment and scaling.*

---

## Reusable Building Blocks

The current implementation is not throwaway work. Socket.IO can power staff chat, OPD queue updates, and lab notifications. WebRTC can support telemedicine slots. Redis can manage token queues and delayed jobs. Kafka-style events can track appointments, refunds, wallet updates, ratings, and analytics.

---

## Roadmap

**Phase 1:** Multi-tenant hospital model, hospital admin dashboard, departments, staff invites, OPD token system, doctor console, patient booking, basic ratings.

**Phase 2:** Doctor-nurse-lab communication, referral workflow, department announcements, patient notifications.

**Phase 3:** Lab orders, report uploads, prescriptions, patient health timeline, family manager.

**Phase 4:** AI wait-time prediction, smart slot suggestions, symptom triage, doctor co-pilot, no-show prediction, post-visit follow-up automation.

**Phase 5:** ABHA integration, insurance support, mobile app, hospital APIs, enterprise subscriptions, multi-city expansion.

---

## Why MediPulse Matters

Hospitals lose time because queues, communication, reports, billing, and records are scattered. Patients lose trust because wait times are unclear and follow-ups are manual. MediPulse aims to make the healthcare journey transparent, coordinated, and measurable.

It is a portfolio project today, but it is designed like a real startup product: modular, realtime, role-based, AI-assisted, and ready to grow into a serious healthcare SaaS platform.
