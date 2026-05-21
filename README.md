
# MediPulse

MediPulse is a full-stack healthcare web application that connects patients, doctors, and community organizations with a focus on fast, reliable interactions, real-time communication, and an intuitive user experience. The project demonstrates production-ready patterns including authentication, real-time messaging and calls, appointment booking, community features, and deployable infrastructure.

**Live demo:** https://medi-pulse-gamma.vercel.app/

**Table of Contents**
- [Overview](#overview)
- [Key Features](#key-features)
- [Tech Stack & Architecture](#tech-stack--architecture)
- [Project Structure](#project-structure)
- [Run Locally](#run-locally)
- [Environment Variables](#environment-variables)
- [Deployment](#deployment)
- [For Recruiters / What to Look For](#for-recruiters--what-to-look-for)
- [Contributing](#contributing)
- [Contact](#contact)

## Overview

MediPulse delivers an end-to-end healthcare experience: users can discover doctors and NGOs, book and join timed doctor appointments (video calls), participate in community posts and events, and exchange real-time messages. The application is built for responsiveness, accessibility, and developer-friendly maintainability.

## Key Features

- **User Authentication & Profiles:** Secure signup/login with profile management for patients, doctors, and NGOs.
- **Doctor Directory & Profiles:** Search and browse doctors; view detailed doctor profiles and availability.
- **Appointment Booking:** Queue-based appointment system where users can request bookings; doctors manage and accept appointments.
- **Timed Video Consultations:** In-app 1:1 video calls for appointments that auto-end after the configured session duration (5 minutes by default) using WebRTC and Socket.IO signaling.
- **Real-time Chat:** Instant messaging between users and doctors using Socket.IO for low-latency communication.
- **Community & Events:** Users can create and join community posts and events; NGOs can list activities and announcements.
- **Google Maps Integration:** Clinic and event locations are displayed using Google Maps APIs.
- **Role-based Routes & Middleware:** Backend enforces user roles and validation via `middleware/validateUser.js`.
- **Scalable Backend:** Express.js API with modular controllers and MongoDB for document storage.
- **Responsive UI:** Built with React + Vite and styled with Tailwind CSS for a modern, mobile-first design.

## Tech Stack & Architecture

- **Frontend:** React (Vite) — fast dev experience, file-based routing, and modern build pipeline.
- **Styling:** Tailwind CSS for utility-first responsive design.
- **Realtime & Calls:** Socket.IO for signaling and real-time events; browser-native WebRTC for peer-to-peer audio/video.
- **Backend:** Node.js + Express — modular controllers in `backend/controller/` for clear separation of concerns.
- **Database:** MongoDB (document-oriented storage) with models in `backend/model/`.
- **Deployment:** Frontend hosted on Vercel; backend can be deployed to any Node-friendly host or cloud provider.
- **Utilities:** Helper utilities in `backend/util/` (e.g., `createSecret.js`).

### Architecture Overview

- Client (React) ↔ Socket.IO (signaling & real-time) ↔ Express API ↔ MongoDB
- WebRTC peer connections are established between users for video calls; Socket.IO is used to coordinate call setup and room state.

## Project Structure

- `backend/` — Express server, controllers, models, routes, and realtime socket handling
	- `backend/index.js` — main server entry
	- `backend/socket.js` — Socket.IO setup and events
	- `backend/controller/` — route handlers (appointments, auth, community, doctor, event, gemini, message, ngo, user)
	- `backend/model/` — Mongoose models for domain entities
- `frontend/` — React app (Vite)
	- `frontend/src/` — components, pages, context, and socket client

Refer to the codebase for details of implementation.

## Run Locally

Prerequisites: Node.js >= 16, pnpm or npm, MongoDB (local or cloud).

1. Start the backend

```bash
cd backend
pnpm install
pnpm start
```

2. Start the frontend

```bash
cd frontend
pnpm install
pnpm dev
```

Open `http://localhost:5173` (default Vite port) to view the frontend.

## Environment Variables

Create a `.env` file in `backend/` with the following (names may vary in code):

- `MONGODB_URI` — MongoDB connection string
- `JWT_SECRET` — JWT signing secret (or generated via `backend/util/createSecret.js`)
- `GOOGLE_MAPS_API_KEY` — (optional) API key for Google Maps features

## Deployment

- Frontend: Deploy to Vercel for fast CDN delivery (project already configured for Vercel).
- Backend: Deploy to a Node-ready host (Heroku, Render, Azure App Service, DigitalOcean App Platform) and configure environment variables.
- Use managed MongoDB (MongoDB Atlas) for production reliability.

## For Recruiters / What to Look For

This project highlights practical, in-demand engineering skills:

- **Full-stack development:** End-to-end implementation (React frontend + Express API + MongoDB).
- **Real-time systems:** Implemented real-time chat, notifications, and signaling via Socket.IO.
- **WebRTC experience:** Peer-to-peer video call integration and session management.
- **System design basics:** Queue-based appointment flow, role-based access control, and modular API structure.
- **Deployment & Reliability:** Frontend deployed to Vercel; backend designed for cloud deployment.
- **Developer ergonomics:** Vite for fast local development, Tailwind for scalable styling, modular code organization for maintainability.

If you'd like to see specific code walkthroughs or live demos of features (call flow, realtime chat, appointment queue), I can prepare short guided recordings or a technical write-up.

## Contributing

Contributions, issues, and feature requests are welcome. To contribute:

1. Fork the repo
2. Create a feature branch
3. Open a pull request with a concise description of changes

## Contact

Project maintained by the MediPulse team. For questions or interviews, reach out via the repo owner profile or open an issue.

---
_Thank you for checking out MediPulse — a concise example of modern full-stack and realtime web engineering._

