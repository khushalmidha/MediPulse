# MediPulse

MediPulse is a full-stack telehealth platform for patients, doctors, and health communities. It combines appointment booking, doctor queues, live video consultations, virtual wallet payments, real-time community chat, and AI-assisted clinical workflows in one web app.

> Medical AI features in this project are designed to assist clinicians. They are not a replacement for professional medical judgment, diagnosis, emergency care, or a verified drug-interaction database.

## Highlights

- Patient and doctor authentication with role-based access
- Doctor discovery, appointment booking, queue management, refunds, and appointment history
- Live appointment rooms with Socket.IO signaling and WebRTC video
- Virtual wallet ledger for booking fees, transfers, refunds, and notifications
- Health communities with real-time chat and doctor-created events
- Gemini-powered pre-consultation triage for patients
- Real-time AI Doctor Co-Pilot during live consultations
- AI-generated SOAP notes with doctor review and edit flow
- Email OTP, appointment approval/cancellation links, and receipt generation

## AI Workflows

### Pre-Consultation Triage

Before a queued appointment starts, the patient can answer a short AI-guided triage chat. The triage agent gathers the chief complaint, duration, severity, relevant history, and urgency level, then saves a doctor-facing patient brief on the appointment.

### Real-Time Doctor Co-Pilot

During an active video consultation, the doctor-side browser captures live transcript text with the Web Speech API and sends chunks to the backend every 30 seconds. The backend runs a Gemini function-calling tool loop with:

- `get_patient_context`
- `check_drug_safety`
- `flag_red_symptoms`
- `get_relevant_guideline`
- `generate_soap_note`

Suggestions are pushed back to the doctor over Socket.IO in real time. When the appointment ends, the Co-Pilot can generate a structured SOAP note and save it for doctor review.

## Core Features

### Authentication

- Patient and doctor signup/login
- JWT cookie sessions
- Google sign-in support
- Forgot password with email OTP
- Protected routes by role

### Appointment System

- Email OTP before booking
- Doctor approval/cancellation through email action links
- Queue-based doctor dashboard
- Doctor-controlled appointment start/end
- Auto-timeout support
- Doctor notes, receipts, patient briefs, and SOAP notes
- Refund support for cancelled appointments

### Live Consultation

- Socket.IO appointment rooms
- WebRTC signaling for video calls
- TURN/STUN configuration support
- Doctor-only AI Co-Pilot sidebar
- Voice consent detection support

### Virtual Wallet

- Initial wallet balance for new users
- Booking fee debit
- Doctor-side wallet transfer
- Refund ledger entries
- Transaction history and notifications
- Redis-compatible safety locks
- Kafka-ready event publishing

### Communities and Events

- Join/leave health communities
- Real-time community chat
- Doctor-managed communities
- Community event publishing
- Dashboard event visibility for joined members

## Tech Stack

### Frontend

- React 19
- Vite
- React Router
- Tailwind CSS
- Axios
- Socket.IO Client
- Lucide React
- jsPDF

### Backend

- Node.js
- Express.js
- MongoDB + Mongoose
- Socket.IO
- JWT + cookies
- Nodemailer
- Google Gemini SDK
- Razorpay SDK
- Redis/ioredis with local memory fallback
- KafkaJS-ready event flow

## Project Structure

```text
MediPulse/
  backend/
    controller/
    middleware/
    model/
    routes/
    scripts/
    services/
    util/
    index.js
    socket.js
  frontend/
    public/
    src/
      components/
      context/
      pages/
      socket.js
      utils.js
  docker-compose.yml
  README.md
  .env.example
```

## Local Setup

### 1. Clone

```bash
git clone https://github.com/khushalmidha/MediPulse.git
cd MediPulse
```

### 2. Environment

Copy the example environment file:

```bash
cp .env.example .env
```

At minimum, configure:

```env
PORT=8080
DATABASE_URL=mongodb://127.0.0.1:27017/medipulse
TOKEN_KEY=replace-with-a-strong-secret
CLIENT_URLS=http://localhost:5173
GEMINI_API_KEY=your-gemini-api-key
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=your-email@example.com
SMTP_PASS=your-smtp-app-password
MAIL_FROM="MediPulse <your-email@example.com>"
REDIS_URL=redis://127.0.0.1:6379
```

For the frontend, create `frontend/.env`:

```env
VITE_BACKEND_URL=http://localhost:8080
VITE_GOOGLE_CLIENT_ID=your-google-oauth-client-id
VITE_GOOGLE_MAPS_API=your-google-maps-api-key
VITE_CLOUDINARY_API=your-cloudinary-api-url
VITE_TURN_URLS=
VITE_TURN_USERNAME=
VITE_TURN_CREDENTIAL=
```

### 3. Install Dependencies

```bash
cd backend
npm install

cd ../frontend
npm install
```

### 4. Run Development Servers

Backend:

```bash
cd backend
npm run dev
```

Frontend:

```bash
cd frontend
npm run dev
```

Open:

```text
http://localhost:5173
```

## Build

Frontend production build:

```bash
cd frontend
npm run build
```

Backend production start:

```bash
cd backend
npm start
```

## Deployment

### Frontend on Vercel

Use these settings:

```text
Root Directory: frontend
Build Command: npm run build
Output Directory: dist
```

Set Vercel environment variables:

```env
VITE_BACKEND_URL=https://your-backend-url
VITE_GOOGLE_CLIENT_ID=...
VITE_GOOGLE_MAPS_API=...
VITE_CLOUDINARY_API=...
VITE_TURN_URLS=...
VITE_TURN_USERNAME=...
VITE_TURN_CREDENTIAL=...
```

### Backend on Render/Railway/Fly

Use:

```text
Root Directory: backend
Build Command: npm install
Start Command: npm start
```

Set backend environment variables:

```env
PORT=8080
NODE_ENV=production
DATABASE_URL=...
TOKEN_KEY=...
CLIENT_URLS=https://your-frontend-url
GEMINI_API_KEY=...
SMTP_HOST=...
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=...
SMTP_PASS=...
MAIL_FROM=...
REDIS_URL=...
```

After deployment, make sure:

- `CLIENT_URLS` includes your deployed frontend URL
- `VITE_BACKEND_URL` points to your deployed backend URL
- Cookies are allowed between frontend and backend
- TURN credentials are configured for reliable video calls in production

## Important API Areas

```text
/user
/doctor
/appointment
/community
/message
/event
/gemini
/api/triage
/api/copilot
/vpay
```

## Validation Commands

Backend syntax checks:

```bash
node --check backend/services/copilotTools.js
node --check backend/controller/copilot.js
node --check backend/routes/copilot.js
node --check backend/index.js
node --check backend/socket.js
```

Frontend build:

```bash
cd frontend
npm run build
```

## Notes

- Co-Pilot transcript storage is text-only and session-scoped through Redis keys.
- SOAP notes are saved on the appointment after AI generation and doctor review.
- If Redis is not enabled locally, the backend includes an in-memory fallback for development.
- Gemini failures are handled gracefully so live consultations continue even if AI is unavailable.
- High-risk clinical suggestions are phrased as flags for doctor review, not as confirmed diagnoses.

## License

This project is currently maintained as an educational and portfolio healthcare platform.
