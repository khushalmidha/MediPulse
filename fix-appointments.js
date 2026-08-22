import mongoose from 'mongoose';
import Appointment from './backend/model/appointment.js';
import dotenv from 'dotenv';
dotenv.config({ path: './backend/.env' });

async function fix() {
  await mongoose.connect(process.env.MONGODB_URI);
  const active = await Appointment.find({ status: 'active' });
  console.log('Active appointments found:', active.length);
  for (const apt of active) {
    apt.status = 'completed';
    apt.endedAt = new Date();
    await apt.save();
  }
  console.log('Fixed stuck appointments.');
  process.exit(0);
}
fix();
