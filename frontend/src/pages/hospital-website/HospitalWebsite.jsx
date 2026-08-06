import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Cookies from "js-cookie";
import { Activity, CalendarDays, MapPin, Phone, Search, Star, Stethoscope, Users, X } from "lucide-react";
import { BACKEND_URL } from "../../utils";
import { useAuth } from "../../context/AuthContext";
import { getSocket } from "../../socket";

const resolveHospitalKey = (slug) => (typeof slug === "string" ? slug : slug?.customDomain);

const money = (value) =>
  typeof value === "number" ? `INR ${value.toLocaleString("en-IN")}` : "Fee on request";

const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

const fetchWithBackendWake = async (url, options, retries = 3) => {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, options);
      if (![502, 503, 504].includes(response.status)) return response;
      lastError = new Error(`Backend temporarily unavailable (${response.status})`);
    } catch (error) {
      lastError = error;
    }
    // FIXED: Render free instances can sleep or return brief 502/503/504 responses, so public hospital pages wake and retry before failing.
    await fetch(`${BACKEND_URL}/count`).catch(() => null);
    await wait(1200 * (attempt + 1));
  }
  throw lastError || new Error("Backend temporarily unavailable");
};

const HospitalWebsite = ({ slug }) => {
  const navigate = useNavigate();
  const { isAuth, role, user } = useAuth();
  const hospitalKey = resolveHospitalKey(slug);
  const [profile, setProfile] = useState(null);
  const [queue, setQueue] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [slide, setSlide] = useState(0);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState("");
  const [doctorSearch, setDoctorSearch] = useState("");
  const [bookingDoctor, setBookingDoctor] = useState(null);
  const [chiefComplaint, setChiefComplaint] = useState("");
  const [bookingMessage, setBookingMessage] = useState("");
  const [bookingResult, setBookingResult] = useState(null);
  const [booking, setBooking] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [patientToast, setPatientToast] = useState(null);
  const hasLoadedProfileRef = useRef(false);

  useEffect(() => {
    if (!hospitalKey) return;
    let active = true;

    const load = async (showSpinner = false) => {
      if (showSpinner) setLoading(true);
      setError("");
      try {
        const [profileResponse, queueResponse] = await Promise.all([
          fetchWithBackendWake(`${BACKEND_URL}/api/hospitals/${hospitalKey}`),
          fetchWithBackendWake(`${BACKEND_URL}/api/hospitals/${hospitalKey}/queue-status`),
        ]);

        if (!profileResponse.ok) {
          throw new Error("Hospital website is not available yet");
        }

        const profilePayload = await profileResponse.json();
        const queuePayload = queueResponse.ok ? await queueResponse.json() : null;
        const reviewsResponse = profilePayload?.hospital?._id
          ? await fetchWithBackendWake(`${BACKEND_URL}/api/reviews/hospital/${profilePayload.hospital._id}?limit=6`)
          : null;
        const reviewsPayload = reviewsResponse?.ok ? await reviewsResponse.json() : { items: [] };

        if (active) {
          setProfile(profilePayload);
          setQueue(queuePayload);
          setReviews(reviewsPayload.items || []);
          hasLoadedProfileRef.current = true;
        }
      } catch (err) {
        if (active) {
          setError(
            hasLoadedProfileRef.current
              ? ""
              : "Backend is waking up. Please wait a few seconds and refresh if this stays here.",
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    load(true);
    // FIXED: Public hospital page polling was resetting the whole page to loading, which felt like constant refresh/jumping.
    const interval = window.setInterval(() => load(false), 30000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [hospitalKey]);

  const hospital = profile?.hospital;
  const departments = profile?.departments || [];
  const doctors = profile?.doctors || [];
  const primaryColor = hospital?.branding?.primaryColor || "#2563eb";
  const queueByDepartment = useMemo(() => {
    const map = new Map();
    (queue?.departments || []).forEach((item) => {
      map.set(String(item.id), item);
    });
    return map;
  }, [queue?.departments]);
  const filteredDoctors = useMemo(() => {
    const term = doctorSearch.trim().toLowerCase();
    return doctors.filter((doctor) => {
      const departmentIds = (doctor.departmentIds || []).map((item) => String(item?._id || item));
      const matchesDepartment = !selectedDepartmentId || departmentIds.includes(String(selectedDepartmentId));
      const searchBlob = [
        doctor.name,
        doctor.doctorProfile?.specialization,
        ...(doctor.departmentIds || []).map((item) => item?.name),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return matchesDepartment && (!term || searchBlob.includes(term));
    });
  }, [doctors, doctorSearch, selectedDepartmentId]);
  const sliderImages = useMemo(
    () =>
      hospital?.branding?.galleryImages?.length
        ? hospital.branding.galleryImages
        : [
            "https://images.unsplash.com/photo-1586773860418-d37222d8fce3?w=1200&q=80",
            "https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d?w=1200&q=80",
            "https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=1200&q=80",
            "https://images.unsplash.com/photo-1666214280557-f1b5022eb634?w=1200&q=80",
          ],
    [hospital?.branding?.galleryImages],
  );
  const heroStyle = useMemo(
    () => ({
      backgroundImage: hospital?.branding?.coverImage
        ? `linear-gradient(90deg, rgba(15,23,42,.82), rgba(15,23,42,.35)), url(${hospital.branding.coverImage})`
        : `linear-gradient(135deg, ${primaryColor}, #0f172a)`,
    }),
    [hospital?.branding?.coverImage, primaryColor],
  );

  useEffect(() => {
    if (!sliderImages.length) return undefined;
    const timer = window.setInterval(() => {
      setSlide((current) => (current + 1) % sliderImages.length);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [sliderImages.length]);

  useEffect(() => {
    if (!isAuth || role !== "user") return undefined;
    const socket = getSocket();
    if (!socket.connected) socket.connect();
    const showJoin = (payload = {}) => {
      if (!payload.doctorId) return;
      setPatientToast({
        message: "Doctor has started your consultation.",
        doctorId: payload.doctorId,
      });
    };
    const handleStatus = (payload = {}) => {
      if (payload.status === "active") showJoin(payload);
    };
    socket.on("appointment:started", showJoin);
    socket.on("appointment:user-status", handleStatus);
    return () => {
      socket.off("appointment:started", showJoin);
      socket.off("appointment:user-status", handleStatus);
    };
  }, [isAuth, role]);

  const openBooking = (doctor) => {
    if (!isAuth || role !== "user") {
      navigate("/login");
      return;
    }
    setBookingDoctor(doctor);
    setChiefComplaint("");
    setBookingMessage("");
    setBookingResult(null);
  };

  const bookOpdToken = async () => {
    if (!bookingDoctor || !hospital?._id) return;
    const departmentId = bookingDoctor.departmentIds?.[0]?._id || bookingDoctor.departmentIds?.[0];
    if (!departmentId) {
      setBookingMessage("Doctor department is not configured yet");
      return;
    }
    setBooking(true);
    setBookingMessage("");
    try {
      const response = await fetchWithBackendWake(`${BACKEND_URL}/api/opd/${hospital._id}/${departmentId}/book`, {
        method: "POST",
        credentials: "include",
        // FIXED: Deployed custom domains can drop cross-site cookies; bearer fallback keeps OPD booking authenticated.
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${Cookies.get("token") || ""}` },
        body: JSON.stringify({
          doctorId: bookingDoctor._id,
          visitType: "new",
          chiefComplaint,
          patientInfo: {
            name: [user?.firstName, user?.lastName].filter(Boolean).join(" "),
          },
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || "Could not book OPD token");
      setBookingResult(payload);
      setBookingMessage(`Token ${payload.displayToken} booked. Queue position ${payload.queuePosition}.`);
    } catch (err) {
      setBookingMessage(
        err.message === "Failed to fetch"
          ? "Backend is waking up or temporarily unavailable. Please press Confirm OPD Token again in a few seconds."
          : err.message || "Could not book OPD token",
      );
    } finally {
      setBooking(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen bg-slate-50 px-6 py-10 text-slate-700">Loading hospital website...</div>;
  }

  if (error || !hospital) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
        <div className="max-w-md rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-xl font-bold text-slate-900">Hospital website unavailable</h1>
          <p className="mt-2 text-sm text-slate-600">{error || "This hospital profile could not be found."}</p>
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      {patientToast && (
        <div className="fixed left-4 top-4 z-50 max-w-sm rounded-lg border border-blue-100 bg-white p-4 shadow-xl">
          <p className="text-sm font-bold text-slate-950">Appointment started</p>
          <p className="mt-1 text-sm text-slate-600">{patientToast.message}</p>
          <button
            type="button"
            onClick={() => navigate(`/appointment/book/${patientToast.doctorId}`)}
            className="mt-3 rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700"
          >
            Join meeting
          </button>
        </div>
      )}
      <nav className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            {hospital.branding?.logo ? (
              <img src={hospital.branding.logo} alt={hospital.name} className="h-11 w-11 rounded-md object-cover" />
            ) : (
              <div className="flex h-11 w-11 items-center justify-center rounded-md text-white" style={{ backgroundColor: primaryColor }}>
                <Stethoscope size={22} />
              </div>
            )}
            <div>
              <div className="text-lg font-bold">{hospital.name}</div>
              <div className="text-xs text-slate-500">{hospital.address?.city}, {hospital.address?.state}</div>
            </div>
          </div>
          <a href="#doctors" className="rounded-md px-4 py-2 text-sm font-semibold text-white" style={{ backgroundColor: primaryColor }}>
            Book Appointment
          </a>
        </div>
      </nav>

      <section className="bg-cover bg-center text-white" style={heroStyle}>
        <div className="mx-auto max-w-7xl px-4 py-20">
          <p className="text-sm font-semibold uppercase tracking-wide text-white/80">MediPulse Hospital Network</p>
          <h1 className="mt-3 max-w-3xl text-4xl font-black md:text-6xl">{hospital.name}</h1>
          <p className="mt-4 max-w-2xl text-lg text-white/85">
            {hospital.branding?.tagline || "Smart OPD, trusted doctors, transparent care, and realtime queue visibility."}
          </p>
          <div className="mt-8 grid max-w-3xl gap-3 sm:grid-cols-3">
            <div className="rounded-md bg-white/15 p-4 backdrop-blur">
              <Users className="mb-2" />
              <div className="text-2xl font-bold">{hospital.stats?.totalDoctors || doctors.length}</div>
              <div className="text-sm text-white/75">Doctors</div>
            </div>
            <div className="rounded-md bg-white/15 p-4 backdrop-blur">
              <Activity className="mb-2" />
              <div className="text-2xl font-bold">{hospital.stats?.totalDepartments || departments.length}</div>
              <div className="text-sm text-white/75">Departments</div>
            </div>
            <div className="rounded-md bg-white/15 p-4 backdrop-blur">
              <Star className="mb-2" />
              <div className="text-2xl font-bold">{Number(hospital.stats?.avgRating || 0).toFixed(1)}</div>
              <div className="text-sm text-white/75">Rating</div>
            </div>
          </div>
        </div>
      </section>

      <section className="overflow-hidden">
        <div className="relative h-64 md:h-80">
          {sliderImages.map((src, index) => (
            <div
              key={src}
              className={`absolute inset-0 transition-opacity duration-700 ${index === slide ? "opacity-100" : "opacity-0"}`}>
              <img src={src} alt={`${hospital.name} facility ${index + 1}`} className="h-full w-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
            </div>
          ))}
          <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-2">
            {sliderImages.map((src, index) => (
              <button
                key={src}
                type="button"
                aria-label={`Show slide ${index + 1}`}
                onClick={() => setSlide(index)}
                className={`h-2 rounded-full transition-all ${index === slide ? "w-6 bg-white" : "w-2 bg-white/60"}`}
              />
            ))}
          </div>
          <button
            type="button"
            aria-label="Previous image"
            onClick={() => setSlide((current) => (current - 1 + sliderImages.length) % sliderImages.length)}
            className="absolute left-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/30 text-xl text-white hover:bg-black/50">
            {'<'}
          </button>
          <button
            type="button"
            aria-label="Next image"
            onClick={() => setSlide((current) => (current + 1) % sliderImages.length)}
            className="absolute right-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/30 text-xl text-white hover:bg-black/50">
            {'>'}
          </button>
        </div>
      </section>

      <section id="departments" className="mx-auto max-w-7xl px-4 py-12">
        <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          <div>
            <h2 className="text-2xl font-bold">Departments and OPD Fees</h2>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {departments.map((department) => {
                const stats = queueByDepartment.get(String(department._id));
                const isSelected = selectedDepartmentId === String(department._id);
                return (
                <button
                  key={department._id}
                  type="button"
                  onClick={() => {
                    setSelectedDepartmentId(isSelected ? "" : String(department._id));
                    document.getElementById("doctors")?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                  className={`rounded-lg border bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${isSelected ? "border-blue-500 ring-2 ring-blue-100" : "border-slate-200"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-bold">{department.icon || "🏥"} {department.name}</h3>
                      <p className="mt-2 text-sm text-slate-600">{department.description || "OPD consultation available."}</p>
                      <p className="mt-3 text-xs font-semibold text-blue-700">
                        {stats ? `${stats.todayTokensIssued || 0} tokens today, ~${stats.estimatedWait || 0} min wait` : "Queue opens when OPD starts"}
                      </p>
                    </div>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                      {money(department.opd?.consultationFee)}
                    </span>
                  </div>
                </button>
              )})}
            </div>
          </div>

          <aside className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-xl font-bold">Live OPD Status</h2>
            <div className="mt-4 space-y-3">
              {(queue?.departments || []).slice(0, 6).map((item) => (
                <div key={item.id} className="rounded-md bg-slate-50 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{item.name}</span>
                    <span className="text-xs text-slate-500">{item.todayTokensIssued} tokens</span>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">
                    Current: {item.currentToken || "Not started"} | ETA: {item.estimatedWait || 0} min
                  </p>
                </div>
              ))}
              {!queue?.departments?.length && <p className="text-sm text-slate-500">Queue status will appear here when OPD starts.</p>}
            </div>
          </aside>
        </div>
      </section>

      <section id="doctors" className="bg-white py-12">
        <div className="mx-auto max-w-7xl px-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-2xl font-bold">Doctors</h2>
              {selectedDepartmentId && (
                <button onClick={() => setSelectedDepartmentId("")} className="mt-1 text-sm font-semibold text-blue-600">
                  Clear department filter
                </button>
              )}
            </div>
            <label className="relative w-full max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={17} />
              <input
                value={doctorSearch}
                onChange={(event) => setDoctorSearch(event.target.value)}
                placeholder="Search doctor or specialization"
                className="w-full rounded-lg border border-slate-300 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-blue-500"
              />
            </label>
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredDoctors.map((doctor) => (
              <div key={doctor._id} className="rounded-lg border border-slate-200 p-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 font-bold text-slate-700">
                    {doctor.profilePhoto ? <img src={doctor.profilePhoto} alt={doctor.name} className="h-full w-full rounded-full object-cover" /> : doctor.name?.slice(0, 2)}
                  </div>
                  <div>
                    <h3 className="font-bold">{doctor.name}</h3>
                    <p className="text-sm text-slate-600">{doctor.doctorProfile?.specialization || "Doctor"}</p>
                  </div>
                </div>
                <p className="mt-4 text-sm text-slate-600">{doctor.doctorProfile?.bio || "Available for OPD consultation."}</p>
                <button
                  onClick={() => openBooking(doctor)}
                  className="mt-4 w-full rounded-md px-4 py-2 text-sm font-semibold text-white"
                  style={{ backgroundColor: primaryColor }}>
                  Book with doctor
                </button>
              </div>
            ))}
          </div>
          {!filteredDoctors.length && (
            <p className="mt-5 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
              This hospital has not added matching doctors yet.
            </p>
          )}
        </div>
      </section>

      {bookingDoctor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold text-slate-950">Book OPD Token</h2>
                <p className="mt-1 text-sm text-slate-500">{bookingDoctor.name} · {bookingDoctor.doctorProfile?.specialization || "Doctor"}</p>
              </div>
              <button onClick={() => setBookingDoctor(null)} className="rounded-full p-2 hover:bg-slate-100">
                <X size={18} />
              </button>
            </div>

            {bookingResult ? (
              <div className="mt-5 rounded-xl border border-green-200 bg-green-50 p-5">
                <div className="flex items-center gap-3 mb-3">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-600 text-white">
                    <span className="text-xl font-black">{bookingResult.displayToken}</span>
                  </div>
                  <div>
                    <p className="font-black text-green-900">Token Confirmed!</p>
                    <p className="text-sm text-green-700">Queue position #{bookingResult.queuePosition}</p>
                  </div>
                </div>
                <p className="text-sm text-green-700">Estimated wait: ~{bookingResult.estimatedWaitMinutes} minutes</p>
                <button onClick={() => setBookingDoctor(null)} className="mt-4 w-full rounded-lg border border-green-300 px-4 py-2 text-sm font-bold text-green-800">
                  Close
                </button>
              </div>
            ) : (
              <div className="mt-5 space-y-4">
                <textarea
                  value={chiefComplaint}
                  onChange={(event) => setChiefComplaint(event.target.value)}
                  placeholder="Describe your chief complaint or reason for visit..."
                  className="min-h-28 w-full rounded-lg border border-slate-300 p-3 text-sm outline-none focus:border-blue-500"
                />
                <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-sm text-blue-800">
                  Your OPD token will be added to the live queue immediately. Please arrive at the hospital on time.
                </div>
                <button
                  onClick={bookOpdToken}
                  disabled={booking}
                  className="w-full rounded-lg px-4 py-3 text-sm font-bold text-white disabled:bg-slate-400"
                  style={{ backgroundColor: primaryColor }}>
                  {booking ? "Booking..." : "Confirm OPD Token"}
                </button>
              </div>
            )}
            {bookingMessage && <p className="mt-4 text-sm font-medium text-blue-700">{bookingMessage}</p>}
          </div>
        </div>
      )}

      <section className="bg-slate-50 py-12">
        <div className="mx-auto max-w-7xl px-4">
          <h2 className="text-2xl font-bold">Patient Reviews</h2>
          <div className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {reviews.map((review) => (
              <div key={review._id} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex text-yellow-500">
                    {[1, 2, 3, 4, 5].map((score) => (
                      <Star key={score} size={17} fill={score <= review.overallRating ? "currentColor" : "none"} />
                    ))}
                  </div>
                  <span className="text-xs font-semibold text-slate-500">{review.overallRating}/5</span>
                </div>
                <p className="mt-4 text-sm text-slate-700">{review.comment || "Good care experience."}</p>
                {review.hospitalResponse?.text && (
                  <p className="mt-3 rounded-md bg-slate-50 p-3 text-xs text-slate-600">Hospital response: {review.hospitalResponse.text}</p>
                )}
              </div>
            ))}
          </div>
          {!reviews.length && <p className="mt-4 text-sm text-slate-500">Patient reviews will appear here after completed visits.</p>}
        </div>
      </section>

      <footer className="border-t border-slate-200 bg-slate-950 px-4 py-8 text-white">
        <div className="mx-auto flex max-w-7xl flex-wrap justify-between gap-4">
          <div>
            <div className="font-bold">{hospital.name}</div>
            <p className="mt-1 text-sm text-white/60">{hospital.branding?.about || "Care powered by MediPulse."}</p>
          </div>
          <div className="space-y-1 text-sm text-white/70">
            <p className="flex items-center gap-2"><MapPin size={15} /> {hospital.address?.line1 || hospital.address?.city}</p>
            {hospital.phone && <p className="flex items-center gap-2"><Phone size={15} /> {hospital.phone}</p>}
            <p className="flex items-center gap-2"><CalendarDays size={15} /> OPD schedule may vary by department</p>
          </div>
        </div>
      </footer>
    </main>
  );
};

export default HospitalWebsite;
