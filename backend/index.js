import express from 'express'
import cookieParser from 'cookie-parser'
import connectMongo from './connection.js'
import userRouter from './routes/user.js'
import communityRouter from './routes/community.js'
import messageRouter from './routes/message.js'
import ngoRouter from './routes/ngos.js'
import doctorRouter from './routes/doctor.js'
import cors from 'cors'
import { createServer } from 'node:http'
import eventRouter from './routes/event.js'
import geminiRouter from './routes/gemini.js'
import appointmentRouter from './routes/appointment.js'
import virtualPaymentRouter from './routes/virtualPayment.js'
import triageRouter from './routes/triage.js'
import hospitalRouter from './routes/hospital.js'
import opdRouter from './routes/opd.js'
import staffMessageRouter from './routes/staffMessage.js'
import reviewRouter from './routes/review.js'
import opdAiRouter from './routes/opdAi.js'
import patientPortalRouter from './routes/patientPortal.js'
import forecastRouter from './routes/forecast.js'
import copilotRouter from './routes/copilot.js'
import { startAutoRefundWorker } from './controller/appointment.js'
import { startReviewRequestWorker } from './services/reviewRequestWorker.js'
import { configDotenv } from 'dotenv'
import { StaffVerifier, Verifier } from './controller/auth.js'
import User from './model/user.js'
import Doctor from './model/doctor.js'
import Community from './model/community.js'
import { initSocket } from './socket.js'
import { verifyMailTransport } from './util/mailer.js'
import { isAllowedOrigin } from './config/corsOrigins.js'

const app = express()
const server = createServer(app)
const PORT = process.env.PORT || 8080
configDotenv({ path: ['.env', '../.env', '../../.env'] })
await connectMongo(process.env.DATABASE_URL)
await verifyMailTransport()

// Initialize Socket.IO
const io = initSocket(server)

app.use(
  cors({
    origin(origin, callback) {
      if (isAllowedOrigin(origin)) {
        return callback(null, true)
      }
      return callback(new Error(`CORS blocked origin: ${origin}`))
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    credentials: true,
  })
)
app.use(cookieParser())
app.use(express.json())
app.use('/user', userRouter)
app.use('/api/auth', userRouter)
app.use('/doctor', doctorRouter)
app.use('/community', communityRouter)
app.use('/message', messageRouter)
app.use('/ngo', ngoRouter)
app.use('/event', eventRouter)
app.use('/gemini', geminiRouter)
app.use('/appointment', appointmentRouter)
app.use('/api/triage', triageRouter)
app.use('/api/hospitals', hospitalRouter)
app.use('/api/opd', opdRouter)
app.use('/api/staff-messages', staffMessageRouter)
app.use('/api/reviews', reviewRouter)
app.use('/api/opd-ai', opdAiRouter)
app.use('/api/patients', patientPortalRouter)
app.use('/api/forecast', forecastRouter)
app.use('/api/copilot', copilotRouter)
app.use('/vpay', virtualPaymentRouter)
app.get('/verify', Verifier)
app.get('/verify/staff', StaffVerifier)
app.get('/count', async (req, res) => {
  const users = await User.countDocuments()
  const doctors = await Doctor.countDocuments()
  const communities = await Community.countDocuments()
  res.status(200).json({ users, doctors, communities })
})

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})

startAutoRefundWorker()
startReviewRequestWorker()
