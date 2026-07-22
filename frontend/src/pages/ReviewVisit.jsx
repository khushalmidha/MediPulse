import { useMemo, useState } from "react";
import axios from "axios";
import { CheckCircle2, Star } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { BACKEND_URL } from "../utils";

const ratingFields = [
  ["doctorQuality", "Doctor quality"],
  ["waitTime", "Wait time"],
  ["staffBehavior", "Staff behavior"],
  ["cleanliness", "Cleanliness"],
  ["valueForMoney", "Value for money"],
];

const RatingInput = ({ label, value, onChange }) => (
  <div className="rounded-lg border border-gray-200 p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span className="text-sm font-semibold text-gray-800">{label}</span>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((score) => (
          <button
            type="button"
            key={score}
            onClick={() => onChange(score)}
            className={`rounded-md p-1 ${score <= value ? "text-yellow-500" : "text-gray-300"}`}
            aria-label={`${label} ${score}`}
          >
            <Star size={22} fill="currentColor" />
          </button>
        ))}
      </div>
    </div>
  </div>
);

const ReviewVisit = () => {
  const [searchParams] = useSearchParams();
  const tokenId = searchParams.get("token") || "";
  const patientId = searchParams.get("patient") || "";
  const sig = searchParams.get("sig") || "";
  const [ratings, setRatings] = useState({
    doctorQuality: 5,
    waitTime: 5,
    staffBehavior: 5,
    cleanliness: 5,
    valueForMoney: 5,
  });
  const [comment, setComment] = useState("");
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [message, setMessage] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const overallRating = useMemo(() => {
    const values = Object.values(ratings);
    return Math.round(values.reduce((sum, value) => sum + Number(value), 0) / values.length);
  }, [ratings]);

  const submitReview = async (event) => {
    event.preventDefault();
    setMessage("");
    setLoading(true);
    try {
      await axios.post(
        `${BACKEND_URL}/api/reviews`,
        { tokenId, patientId, sig, ratings, overallRating, comment, isAnonymous },
        { withCredentials: true },
      );
      setSubmitted(true);
    } catch (error) {
      setMessage(error.response?.data?.message || "Unable to submit review. Please sign in and try again.");
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <section className="max-w-md rounded-xl bg-white p-8 text-center shadow-sm">
          <CheckCircle2 className="mx-auto text-green-600" size={44} />
          <h1 className="mt-4 text-2xl font-extrabold text-gray-950">Thank you for your review</h1>
          <p className="mt-2 text-sm text-gray-600">Your feedback is now part of the hospital quality score.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-10">
      <form onSubmit={submitReview} className="mx-auto max-w-2xl rounded-xl bg-white p-6 shadow-sm">
        <p className="text-sm font-semibold uppercase text-blue-600">MediPulse Visit Review</p>
        <h1 className="mt-2 text-3xl font-extrabold text-gray-950">Rate your hospital visit</h1>
        <p className="mt-2 text-sm text-gray-600">Your feedback helps other patients and improves hospital operations.</p>

        {message && <p className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{message}</p>}

        <div className="mt-6 space-y-3">
          {ratingFields.map(([field, label]) => (
            <RatingInput key={field} label={label} value={ratings[field]} onChange={(value) => setRatings({ ...ratings, [field]: value })} />
          ))}
        </div>

        <textarea
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          maxLength={1000}
          placeholder="Share details about your experience..."
          className="mt-5 min-h-32 w-full rounded-lg border border-gray-300 p-3 text-sm outline-none focus:border-blue-500"
        />

        <label className="mt-4 flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={isAnonymous} onChange={(event) => setIsAnonymous(event.target.checked)} className="h-4 w-4" />
          Submit anonymously
        </label>

        <button disabled={loading || !tokenId || !sig} className="mt-6 w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-bold text-white disabled:bg-gray-400">
          {loading ? "Submitting..." : `Submit ${overallRating}-star review`}
        </button>
      </form>
    </main>
  );
};

export default ReviewVisit;
