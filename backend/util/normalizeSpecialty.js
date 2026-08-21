export const normalizeSpecialty = (specialty) => {
  if (!specialty) return specialty;
  const s = specialty.trim().toLowerCase();
  
  if (s.includes("cardio")) return "Cardiology";
  if (s.includes("derm")) return "Dermatology";
  if (s.includes("neuro")) return "Neurology";
  if (s.includes("pediatri") || s.includes("paediatri")) return "Pediatrics";
  if (s.includes("gynec") || s.includes("gynaec") || s.includes("obgyn")) return "Gynecology";
  if (s.includes("ortho")) return "Orthopedics";
  if (s.includes("ophthal")) return "Ophthalmology";
  if (s.includes("psychi")) return "Psychiatry";
  if (s.includes("dent") || s.includes("teeth")) return "Dentistry";
  if (s.includes("general") || s.includes("physician")) return "General Medicine";
  
  // Return title-cased if no direct match
  return specialty.trim().split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
};
