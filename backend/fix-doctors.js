import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

import Doctor from './model/doctor.js';
import { normalizeSpecialty } from './util/normalizeSpecialty.js';

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const doctors = await Doctor.find({});
  let updated = 0;
  for (const doc of doctors) {
    if (doc.experience && doc.experience.expertise) {
      const normalized = normalizeSpecialty(doc.experience.expertise);
      if (normalized !== doc.experience.expertise) {
        doc.experience.expertise = normalized;
        await doc.save();
        updated++;
        console.log("Updated: ", doc.firstName, "->", normalized);
      }
    }
  }
  console.log("Total updated: ", updated);
  process.exit(0);
};

run().catch(console.error);

