# MediPulse

**MediPulse** is a full-stack healthcare platform for patients, doctors, and health communities. It brings doctor discovery, appointment booking, real-time consultations, community support, events, wallet payments, refunds, and AI guidance into one connected web app.

---

## What MediPulse Does

MediPulse is designed for a practical healthcare workflow:

- Patients can find doctors and book consultations.
- Doctors can manage appointment queues and start meetings.
- Users can join health communities and chat in real time.
- Community events appear on dashboards for joined members.
- Wallet balance, booking debit, cancellation, and refunds are handled virtually.
- AI support helps users explore doctors, communities, and health guidance.

---

## Core Features

### Authentication

- User and doctor signup/login
- JWT cookie-based sessions
- Google sign-in and signup
- Forgot password with email OTP
- Role-based access for users, doctors, and admins

### Doctor Discovery

- Browse doctor listings
- View doctor profile details
- See expertise, clinic data, and contact information
- Start appointment booking directly from a doctor profile

### Appointment Booking

- Email OTP verification before booking
- Virtual wallet booking fee debit
- Email approval and cancellation links
- Approved appointments move into the doctor queue
- Meeting starts only when the doctor clicks **Start**
- Appointment history for patients
- Doctor notes and generated receipts
- Refund flow for cancelled bookings

### Live Consultation

- Real-time appointment rooms
- Socket.IO event updates
- WebRTC-style signaling for video call setup
- Doctor-controlled start and end flow
- Auto session timeout support

### Virtual Wallet

- New users receive an initial wallet balance
- Booking deducts appointment fee
- Cancellation refunds money to the user wallet
- Profile popover shows initials, name, email, role, and balance
- Transaction, refund, notification, and admin wallet tools

### Communities and Events

- Join and leave health communities
- Real-time community chat
- Doctors can create communities
- Doctors can publish community events
- Dashboard shows upcoming events from joined communities

### AI Assistance

- Gemini-powered recommendations
- AI chat support
- Doctor and community discovery assistance
- General health guidance prompts

---

## Technology Stack

### Frontend

- React
- Vite
- React Router
- Tailwind CSS
- Axios
- Socket.IO Client
- Lucide React
- jsPDF
- Google Identity Services

### Backend

- Node.js
- Express.js
- MongoDB
- Mongoose
- JWT authentication
- Cookie-based sessions
- Nodemailer
- Socket.IO
- Google Auth Library
- Gemini AI SDK
- Razorpay integration support

### Wallet, Queue, and Events

- Redis-compatible caching
- Redis-style locks for wallet safety
- Kafka-ready virtual payment events
- Payment, refund, wallet, notification, and analytics event topics
- Virtual ledger for wallet transactions

### DevOps and Deployment

- Dockerfiles for frontend and backend
- Docker Compose setup
- Environment-based configuration
- Separate frontend and backend services
- Deployment-ready structure for cloud hosting

---

## Project Goal

MediPulse focuses on making healthcare access faster, clearer, and more organized. It gives patients a simple path to book doctors, gives doctors a controlled appointment queue, and gives communities a shared space for support, events, and communication.
