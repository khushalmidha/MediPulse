import mongoose from "mongoose";
import Hospital from "../model/hospital.js";
import OpdToken from "../model/opdToken.js";
import Review from "../model/review.js";
import PlatformFeedback from "../model/platformFeedback.js";
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
export const getGlobalReviews = async (req, res) => {
  try {
    const reviews = await Review.find({ status: "published", comment: { $exists: true, $ne: "" } })
      .populate("patientId", "firstName lastName")
      .populate("hospitalId", "name")
      .populate("doctorId", "name")
      .sort({ overallRating: -1, createdAt: -1 })
      .limit(6);
    res.status(200).json({ reviews });
  } catch (error) {
    res.status(500).json({ message: error.message || "Unable to fetch global reviews" });
  }
};

export const getPendingReview = async (req, res) => {
  try {
    if (req.auth.role !== "user") return res.status(200).json({ pending: null });
    const lastToken = await OpdToken.findOne({ patientId: req.auth.id, status: "completed" })
      .sort({ createdAt: -1 })
      .populate("hospitalId", "name")
      .populate("doctorId", "name");
    
    if (!lastToken) return res.status(200).json({ pending: null });
    
    const existing = await Review.findOne({ tokenId: lastToken._id, patientId: req.auth.id });
    if (existing) return res.status(200).json({ pending: null });
    
    const { buildReviewUrl } = await import("../services/reviewRequestWorker.js");
    const reviewUrl = buildReviewUrl({ tokenId: lastToken._id, patientId: req.auth.id });
    
    res.status(200).json({ pending: { token: lastToken, url: reviewUrl } });
  } catch (error) {
    res.status(500).json({ message: error.message || "Unable to fetch pending review" });
  }
};

export const submitPlatformFeedback = async (req, res) => {
  try {
    if (req.auth.role !== "user") {
      return res.status(403).json({ message: "Only patients can submit reviews" });
    }
    
    const { rating, comment, isAnonymous } = req.body;
    
    if (Number(rating) < 1 || Number(rating) > 5) {
      return res.status(400).json({ message: "Rating must be between 1 and 5" });
    }
    if (!comment || comment.trim() === "") {
      return res.status(400).json({ message: "Comment is required" });
    }

    const feedback = await PlatformFeedback.create({
      patientId: req.auth.id,
      rating: Number(rating),
      comment: comment.trim(),
      isAnonymous: Boolean(isAnonymous),
    });

    res.status(201).json({ message: "Feedback submitted successfully", feedback });
  } catch (error) {
    res.status(500).json({ message: error.message || "Unable to submit feedback" });
  }
};

export const getHomepageFeedbacks = async (req, res) => {
  try {
    const fetchRandom = async (matchStage, limit) => {
      return await PlatformFeedback.aggregate([
        { $match: { status: "published", ...matchStage } },
        { $sample: { size: limit } },
        {
          $lookup: {
            from: "users",
            localField: "patientId",
            foreignField: "_id",
            as: "patientInfo"
          }
        },
        { $unwind: "$patientInfo" },
        {
          $project: {
            rating: 1,
            comment: 1,
            isAnonymous: 1,
            createdAt: 1,
            "patientId.firstName": "$patientInfo.firstName",
            "patientId.lastName": "$patientInfo.lastName"
          }
        }
      ]);
    };

    const positive = await fetchRandom({ rating: { $gte: 4 } }, 6);
    const medium = await fetchRandom({ rating: 3 }, 3);
    const negative = await fetchRandom({ rating: { $lte: 2 } }, 1);

    let combined = [...positive, ...medium, ...negative];
    
    if (combined.length < 10) {
      const existingIds = combined.map(r => r._id);
      const fill = await fetchRandom({ _id: { $nin: existingIds } }, 10 - combined.length);
      combined = [...combined, ...fill];
    }

    combined.sort((a, b) => b.rating - a.rating);

    res.status(200).json({ reviews: combined });
  } catch (error) {
    res.status(500).json({ message: error.message || "Unable to fetch homepage feedbacks" });
  }
};
