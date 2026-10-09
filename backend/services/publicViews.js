const plain = (record) => record?.toObject ? record.toObject() : (record || {});
const pick = (record, fields) => {
  const source = plain(record);
  return Object.fromEntries(fields.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]));
};

export const publicHospital = (hospital) => {
  const h = plain(hospital);
  return {
    ...pick(h, ["_id", "name", "slug", "type", "medicineSystem", "email", "phone", "website"]),
    address: { ...pick(h.address, ["line1", "city", "state", "pincode"]), coordinates: pick(h.address?.coordinates, ["lat", "lng"]) },
    branding: { ...pick(h.branding, ["logo", "coverImage", "primaryColor", "tagline", "about", "establishedYear", "specializations", "accreditations"]),
      socialLinks: pick(h.branding?.socialLinks, ["facebook", "instagram", "twitter"]) },
    websiteConfig: pick(h.websiteConfig, ["subdomainEnabled", "seoTitle", "seoDescription", "showRatings", "showDoctorList", "showFees", "theme"]),
    stats: pick(h.stats, ["totalDoctors", "totalDepartments", "totalAppointments", "avgRating", "totalReviews"]),
    settings: pick(h.settings, ["appointmentConfirmationRequired", "allowWalkIns", "tokenPrefix", "workingDays", "emergencyContact", "timezone", "queueSessionIds"]),
  };
};

export const publicDoctor = (record) => {
  const doctor = plain(record);
  return {
    ...pick(doctor, ["_id", "name", "profilePhoto", "doctorId"]),
    departmentIds: (doctor.departmentIds || []).map((department) => department?.name ? pick(department, ["_id", "name"]) : department),
    doctorProfile: pick(doctor.doctorProfile, ["qualification", "specialization", "experience", "registrationNumber", "consultationFee", "bio", "languages", "rating", "totalReviews"]),
  };
};

export const publicDepartment = (record) => {
  const department = plain(record);
  return { ...pick(department, ["_id", "hospitalId", "name", "code", "description", "icon", "color", "status"]),
    opd: { ...pick(department.opd, ["isActive", "consultationFee", "followUpFee", "slotDurationMinutes", "maxPatientsPerSlot"]),
      timings: (department.opd?.timings || []).map((timing) => pick(timing, ["day", "startTime", "endTime", "doctorIds"])) } };
};

export const publicHospitalProfile = (profile) => profile && ({
  hospital: publicHospital(profile.hospital),
  departments: (profile.departments || []).map(publicDepartment),
  doctors: (profile.doctors || []).map(publicDoctor),
});

export const publicReview = (record) => {
  const review = plain(record);
  const patient = plain(review.patientId);
  return {
    ...pick(review, ["_id", "overallRating", "rating", "comment", "isAnonymous", "createdAt"]),
    ratings: pick(review.ratings, ["doctorQuality", "waitTime", "staffBehavior", "cleanliness", "valueForMoney"]),
    reviewerName: review.isAnonymous ? "Anonymous Patient" : [patient.firstName, patient.lastName].filter(Boolean).join(" ") || "MediPulse Patient",
    ...(review.hospitalId?.name ? { hospital: pick(review.hospitalId, ["_id", "name"]) } : {}),
    ...(review.doctorId?.name ? { doctor: { ...pick(review.doctorId, ["_id", "name"]), doctorProfile: pick(review.doctorId.doctorProfile, ["specialization"]) } } : {}),
    ...(review.hospitalResponse ? { hospitalResponse: pick(review.hospitalResponse, ["text", "respondedAt"]) } : {}),
  };
};
