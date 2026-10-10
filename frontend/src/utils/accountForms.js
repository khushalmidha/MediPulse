export const staffDestination = staff => staff?.role === "DOCTOR" ? "/hospital/doctor-opd" : ["NURSE", "RECEPTIONIST"].includes(staff?.role) ? "/hospital/nursing-station" : staff?.role === "HOSPITAL_ADMIN" || staff?.adminAccess ? "/hospital/admin" : "/hospital/staff-communication";
export const phoneValid = value => !String(value || "").trim() || /^[1-9]\d{9}$/.test(String(value).trim());
export const profileDraft = user => ({ firstName: user.firstName || "", lastName: user.lastName || "", bio: user.bio || "", gender: user.gender || "other", phoneNumber: String(user.phone ?? user.phoneNumber ?? ""), expertise: user.experience?.expertise || "", years: String(user.experience?.years ?? ""), clinicName: user.clinic?.name || "", clinicLocation: user.clinic?.location || "", consultationFee: String(user.consultationFee ?? "") });
export const profilePayload = (form, user, role) => {
  if (!form.firstName.trim()) throw new Error("First name is required.");
  if (!phoneValid(form.phoneNumber)) throw new Error("Phone number must contain 10 digits.");
  const body = { firstName: form.firstName.trim(), lastName: form.lastName.trim(), bio: form.bio, gender: form.gender };
  if (role === "doctor") {
    if (!form.expertise.trim()) throw new Error("Specialty is required.");
    if (form.years !== "" && (!Number.isInteger(Number(form.years)) || Number(form.years) < 0)) throw new Error("Years of experience must be a non-negative whole number.");
    if (form.consultationFee !== "" && (!Number.isFinite(Number(form.consultationFee)) || Number(form.consultationFee) < 0)) throw new Error("Consultation fee must be a non-negative amount.");
    body.experience = { ...user.experience, expertise: form.expertise.trim(), ...(form.years !== "" ? { years: Number(form.years) } : {}) };
    body.clinic = { ...user.clinic, name: form.clinicName.trim(), location: form.clinicLocation.trim() };
    if (form.phoneNumber.trim()) body.phone = form.phoneNumber.trim();
    if (form.consultationFee !== "") body.consultationFee = Math.round(Number(form.consultationFee) * 100) / 100;
  } else if (form.phoneNumber.trim()) body.phoneNumber = form.phoneNumber.trim();
  return body;
};
export const signupPayload = form => Object.fromEntries(Object.entries(form).filter(([key, value]) => key !== "confirmPassword" && value !== ""));

// The invite endpoint uses a truthy fallback before Number(); "0" preserves an explicit zero.
export const invitationDoctorProfile = form => ({ specialization: form.specialization, qualification: form.qualification, ...(form.experience !== "" ? { experience: String(form.experience) } : {}) });
