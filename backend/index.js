import { assertDurableSchema } from "./services/durableSchema.js";
import { startOutboxWorker } from "./services/outbox.js";
import { deliverOutboxJob } from "./services/outboxDelivery.js";
import { consultationDurationMs } from "./services/consultationPolicy.js";
import { assertAuthSchema } from "./services/authSchema.js";
import asyncHandler from "./middleware/asyncHandler.js";
import { originGuard } from "./services/authSessions.js";
import { assertMoneyReady } from "./services/moneyMigration.js";
import { startPaymentRecoveryWorker } from "./services/paymentRecovery.js";
import { assertRuntimeConfig } from "./util/runtimeEnv.js";
import mongoose from "mongoose";
import { closeRedis } from "./services/redis.js";
import { assertQueueIndexes } from "./services/queueMigration.js";
import { attachHealthRoutes, checkDependencies } from "./services/readiness.js";
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
import { StaffVerifier, Verifier } from './controller/auth.js'
import User from './model/user.js'
import Doctor from './model/doctor.js'
import Community from './model/community.js'
import { initSocket } from './socket.js'
import { verifyMailTransport } from './util/mailer.js'
import { isAllowedOrigin } from './config/corsOrigins.js'

const start = async () => {
  try { assertRuntimeConfig(); }
  catch (error) { console.error('Invalid runtime configuration:', error.message); throw error; }
  const app = express()
  const server = createServer(app)
  const PORT = process.env.PORT || 8080
  try { await connectMongo(process.env.DATABASE_URL); }
  catch { throw Object.assign(new Error('MongoDB is unavailable or lacks transaction support'), { dependency: 'mongodb' }); }
  try { await assertQueueIndexes(); }
  catch { throw Object.assign(new Error("Queue migration is required"), { dependency: "queue-migration" }); }
  try { await assertMoneyReady(); }
  catch { throw Object.assign(new Error("Ledger migration is required"), { dependency: "ledger-migration" }); }
  try { await assertAuthSchema(); }
  catch { throw Object.assign(new Error("Auth schema initialization is required"), { dependency: "auth-schema" }); }
  await assertDurableSchema(); consultationDurationMs();
  const readiness = await checkDependencies();
  if (!readiness.ready) {
    console.error('Dependency readiness:', readiness.dependencies);
    throw new Error('Required dependencies are unavailable');
  }
  verifyMailTransport().catch(() => console.error('Mail transport verification failed'));
  attachHealthRoutes(app)

  // Initialize Socket.IO
  const io = initSocket(server)

  app.use(
    cors({
      origin(origin, callback) {
        if (isAllowedOrigin(origin)) {
          return callback(null, true)
        }
        return callback(Object.assign(new Error("Origin is not allowed"), { status: 403 }))
      },
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      credentials: true,
    })
  )
  app.use(cookieParser())
  app.use(express.json())
  app.use(originGuard)
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
  app.get('/verify', asyncHandler(Verifier))
  app.get('/verify/staff', asyncHandler(StaffVerifier))
  app.get('/count', async (req, res) => {
    const users = await User.countDocuments()
    const doctors = await Doctor.countDocuments()
    const communities = await Community.countDocuments()
    res.status(200).json({ users, doctors, communities })
  })

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error.status || (error.name === "ValidationError" || error.name === "CastError" ? 400 : error.code === 11000 ? 409 : 500);
    res.status(status).json({ message: status < 500 ? error.message : "Request could not be completed" });
  })

  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`)
  })

  const stopRecovery = startPaymentRecoveryWorker()
  const stopRefunds = startAutoRefundWorker()
  const stopReviews = startReviewRequestWorker()
  const stopOutbox = startOutboxWorker(job => deliverOutboxJob(job, io))
  let closing = false
  const shutdown = async (code = 0) => {
    if (closing) return
    closing = true
    stopRefunds?.(); stopReviews?.(); stopRecovery?.()
    const deadline = setTimeout(() => process.exit(code || 1), 10000)
    deadline.unref()
    await stopOutbox();
    await new Promise((resolve) => io.close(resolve))
    await mongoose.disconnect()
    await closeRedis()
    process.exit(code)
  }
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => shutdown())
  for (const event of ['uncaughtException', 'unhandledRejection']) process.on(event, () => {
    console.error(`${event}: stopping API`)
    shutdown(1)
  })
}
start().catch(async (error) => {
  console.error('API startup failed:', error.dependency || 'configuration/dependencies')
  await mongoose.disconnect().catch(() => {})
  await closeRedis().catch(() => {})
  process.exitCode = 1
})
