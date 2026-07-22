import mongoose from "mongoose";
import Hospital from "../model/hospital.js";
import HospitalStaff from "../model/hospitalStaff.js";
import Review from "../model/review.js";
import { getRedis } from "./redis.js";

const asObjectId = (id) => new mongoose.Types.ObjectId(String(id));

const weightedRating = (result) =>
  Number(result.avgDoctor || 0) * 0.35 +
  Number(result.avgWaitTime || 0) * 0.25 +
  Number(result.avgStaff || 0) * 0.15 +
  Number(result.avgCleanliness || 0) * 0.1 +
  Number(result.avgValue || 0) * 0.15;

export async function recalculateHospitalRating(hospitalId) {
  const [result] = await Review.aggregate([
    { $match: { hospitalId: asObjectId(hospitalId), status: "published" } },
    {
      $group: {
        _id: null,
        avgOverall: { $avg: "$overallRating" },
        avgDoctor: { $avg: "$ratings.doctorQuality" },
        avgWaitTime: { $avg: "$ratings.waitTime" },
        avgStaff: { $avg: "$ratings.staffBehavior" },
        avgCleanliness: { $avg: "$ratings.cleanliness" },
        avgValue: { $avg: "$ratings.valueForMoney" },
        count: { $sum: 1 },
      },
    },
  ]);

  const hospital = await Hospital.findById(hospitalId).select("slug");
  const average = result ? Number(weightedRating(result).toFixed(1)) : 0;
  const count = result?.count || 0;

  await Hospital.findByIdAndUpdate(hospitalId, {
    "stats.avgRating": average,
    "stats.totalReviews": count,
  });

  if (hospital?.slug) {
    await getRedis().del(`hospital:public:${hospital.slug}`);
  }

  return { average, count };
}

export async function recalculateDoctorRating(doctorId) {
  if (!doctorId) return null;

  const [result] = await Review.aggregate([
    { $match: { doctorId: asObjectId(doctorId), status: "published" } },
    {
      $group: {
        _id: null,
        avgRating: { $avg: "$overallRating" },
        count: { $sum: 1 },
      },
    },
  ]);

  const average = result ? Number(Number(result.avgRating || 0).toFixed(1)) : 0;
  const count = result?.count || 0;
  await HospitalStaff.findByIdAndUpdate(doctorId, {
    "doctorProfile.rating": average,
    "doctorProfile.totalReviews": count,
  });

  return { average, count };
}
