# MediPulse

MediPulse is a full-stack healthcare web application built to connect patients, doctors, and health-focused communities through one smooth digital experience. The platform helps users discover doctors, join support communities, attend community events, book consultations, and communicate in real time.

## Key Features

- **Authentication:** Secure user and doctor login/signup with JWT cookies, password reset OTP, and Google authentication.
- **Doctor Discovery:** Patients can browse doctors, view detailed profiles, clinic information, expertise, and start appointment booking.
- **Appointment Booking:** Email OTP verification, wallet-based booking fee debit, email approval/cancellation links, queue placement after approval, doctor-controlled meeting start, appointment history, refunds, and downloadable receipts.
- **Live Consultation:** Real-time appointment rooms use Socket.IO and WebRTC-style signaling so calls begin only when the doctor starts the appointment.
- **Virtual Wallet:** Every user receives a starting wallet balance, booking deducts a small fee, cancellations refund the amount, and profile popover shows name, email, initials, role, and balance.
- **Communities:** Users and doctors can join communities, chat in real time, and participate in health support groups.
- **Events:** Doctors can create community events, while users see upcoming events from communities they have joined directly on the dashboard.
- **AI Assistance:** Gemini-powered recommendations and chat support help users explore doctors, communities, and general health guidance.
- **Admin/Payment Tools:** Virtual payment ledgers, transactions, refunds, notifications, analytics-ready events, and admin wallet controls are included.

## Tech Stack

**Frontend:** React, Vite, React Router, Tailwind CSS, Axios, Socket.IO Client, Lucide React, jsPDF, Google Identity Services, and responsive UI components.

**Backend:** Node.js, Express, MongoDB, Mongoose, JWT, cookie-based auth, Nodemailer, Socket.IO, Redis-compatible caching and locks, Kafka-ready event publishing, Razorpay support, Google Auth Library, and Gemini AI.

**Infrastructure:** Dockerfiles, Docker Compose, environment-based configuration, virtual gateway scripts, and deployable frontend/backend separation.

## Project Goal

MediPulse focuses on fast access to doctors, trusted community support, transparent appointment flow, and a practical healthcare experience that feels simple for patients and manageable for doctors.
