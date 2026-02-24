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
import { configDotenv } from 'dotenv'
import { Verifier } from './controller/auth.js'
import User from './model/user.js'
import Doctor from './model/doctor.js'
import Community from './model/community.js'
import { initSocket } from './socket.js'

const app = express()
const server = createServer(app)
const PORT = 8080
configDotenv()
connectMongo(process.env.DATABASE_URL)

// Initialize Socket.IO
const io = initSocket(server)

app.use(
  cors({
    origin: [
      'http://localhost:5173',
      'https://medipulse-azure.vercel.app',
      'https://medipulse-git-main-lakshya0000s-projects.vercel.app',
      'https://medipulse-lakshya0000s-projects.vercel.app',
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true,
  })
)
app.use(cookieParser())
app.use(express.json())
app.use('/user', userRouter)
app.use('/doctor', doctorRouter)
app.use('/community', communityRouter)
app.use('/message', messageRouter)
app.use('/ngo', ngoRouter)
app.use('/event', eventRouter)
app.get('/verify', Verifier)
app.get('/count', async (req, res) => {
  const users = await User.countDocuments()
  const doctors = await Doctor.countDocuments()
  const communities = await Community.countDocuments()
  res.status(200).json({ users, doctors, communities })
})

server.listen(PORT)
console.log('')
