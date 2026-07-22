import mongoose from "mongoose";
import Hospital from "../model/hospital.js";
import OpdToken from "../model/opdToken.js";
import Review from "../model/review.js";
import { getRedis } from "../services/redis.js";
import { recalculateDoctorRating, recalculateHospitalRating } from "../services/ratingService.js";
import { verifyReviewSignature } from "../services/reviewRequestWorker.js";

const validRating = (value) => Number(value) >= 1 && Number(value) <= 5;

const normalizeRatings = (ratings = {}) => ({
  doctorQuality: Number(ratings.doctorQuality),
  waitTime: Number(ratings.waitTime),
  staffBehavior: Number(ratings.staffBehavior),
  cleanliness: Number(ratings.cleanliness),
  valueForMoney: Number(ratings.valueForMoney),
});

export const submitReview = async (req, res) => {
  try {
    if (req.auth.role !== "user") return res.status(403).json({ message: "Only patients can submit reviews" });

    const { tokenId, patientId, sig, ratings, overallRating, comment, isAnonymous } = req.body;
    if (!mongoose.Types.ObjectId.isValid(tokenId)) return res.status(400).json({ message: "Invalid token id" });
    if (String(patientId || req.auth.id) !== req.auth.id) return res.status(403).json({ message: "Invalid patient review session" });
    if (!verifyReviewSignature({ tokenId, patientId: req.auth.id, signature: sig })) {
      return res.status(403).json({ message: "Review link is invalid or expired" });
    }

    const token = await OpdToken.findOne({ _id: tokenId, patientId: req.auth.id, status: "completed" }).lean();
    if (!token) return res.status(404).json({ message: "Completed visit not found for review" });

    const normalizedRatings = normalizeRatings(ratings);
    const ratingValues = Object.values(normalizedRatings);
    if (!validRating(overallRating) || ratingValues.some((value) => !validRating(value))) {
      return res.status(400).json({ message: "All ratings must be between 1 and 5" });
    }

    const review = await Review.create({
      hospitalId: token.hospitalId,
      doctorId: token.doctorId,
      departmentId: token.departmentId,
      patientId: req.auth.id,
      tokenId,
      ratings: normalizedRatings,
      overallRating: Number(overallRating),
      comment,
      isAnonymous: Boolean(isAnonymous),
    });

    await Promise.all([
      recalculateHospitalRating(token.hospitalId),
      recalculateDoctorRating(token.doctorId),
    ]);

    res.status(201).json({ message: "Review submitted", review });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: "You already reviewed this visit" });
    res.status(500).json({ message: error.message || "Unable to submit review" });
  }
};

export const getHospitalReviews = async (req, res) => {
  try {
    const { hospitalId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(hospitalId)) return res.status(400).json({ message: "Invalid hospital id" });

    const filter = { hospitalId, status: "published" };
    if (req.query.rating) filter.overallRating = Number(req.query.rating);
    if (req.query.departmentId && mongoose.Types.ObjectId.isValid(req.query.departmentId)) filter.departmentId = req.query.departmentId;

    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 12, 1), 50);
    const [items, total] = await Promise.all([
      Review.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("doctorId", "name doctorProfile.specialization")
        .lean(),
      Review.countDocuments(filter),
    ]);

    res.status(200).json({ items, page, total, pages: Math.ceil(total / limit) });
  } catch (error) {
    res.status(500).json({ message: error.message || "Unable to load reviews" });
  }
};

export const respondToReview = async (req, res) => {
  try {
    const review = await Review.findOne({ _id: req.params.id, hospitalId: req.staff.hospitalId });
    if (!review) return res.status(404).json({ message: "Review not found" });

    review.hospitalResponse = {
      text: String(req.body.text || "").trim().slice(0, 1000),
      respondedAt: new Date(),
      respondedBy: req.staff.id,
    };
    await review.save();

    const hospital = await Hospital.findById(req.staff.hospitalId).select("slug");
    if (hospital?.slug) {
      await getRedis().del(`hospital:public:${hospital.slug}`);
    }

    res.status(200).json({ message: "Response saved", review });
  } catch (error) {
    res.status(500).json({ message: error.message || "Unable to respond to review" });
  }
};

export const flagReview = async (req, res) => {
  try {
    const review = await Review.findById(req.params.id);
    if (!review) return res.status(404).json({ message: "Review not found" });
    review.status = "flagged";
    review.metadata = { ...(review.metadata || {}), flaggedBy: req.auth.id, flagReason: req.body.reason || "Patient flagged" };
    await review.save();
    await recalculateHospitalRating(review.hospitalId);
    await recalculateDoctorRating(review.doctorId);
    res.status(200).json({ message: "Review flagged" });
  } catch (error) {
    res.status(500).json({ message: error.message || "Unable to flag review" });
  }
};
