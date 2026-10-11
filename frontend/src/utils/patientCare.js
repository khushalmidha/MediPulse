export const careSystems = [["", "All care systems"], ["allopathic", "Allopathic"], ["ayurveda", "Ayurveda"], ["homeopathy", "Homeopathy"], ["yoga_wellness", "Yoga & Wellness"], ["integrative", "Integrative"]];
export const hospitalLocation = hospital => [hospital?.address?.city, hospital?.address?.state].filter(Boolean).join(", ") || "Location not listed";
export const hospitalPath = hospital => /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/i.test(hospital?.slug || "") ? "/hospitals/" + hospital.slug : null;
export const careSystem = value => careSystems.find(([key]) => key && key === value)?.[1] || "Care system not listed";
export const familyPayload = (form, today) => {
  const name = form.name.trim(), relation = form.relation.trim();
  if (!name || !relation) throw new Error("Enter a name and relationship.");
  const body = { name, relation };
  if (form.dob) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.dob) || !Number.isFinite(Date.parse(form.dob)) || new Date(form.dob).toISOString().slice(0, 10) !== form.dob || form.dob > today) throw new Error("Enter a valid date of birth that is not in the future.");
    body.dob = form.dob;
  }
  if (form.gender) { if (!["male", "female", "other"].includes(form.gender)) throw new Error("Choose a listed gender option."); body.gender = form.gender; }
  if (form.bloodGroup) { if (!["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].includes(form.bloodGroup)) throw new Error("Choose a listed blood group."); body.bloodGroup = form.bloodGroup; }
  return body;
};
export const recordKey = record => record.type + ":" + record.id;
export const personName = (record, family) => record.familyMemberId ? family.find(member => String(member._id) === String(record.familyMemberId))?.name || "Family member (name not available)" : "You";
export const filterRecords = (items, { search = "", person = "all", type = "all" }) => items.filter(item => {
  const identity = item.familyMemberId ? String(item.familyMemberId) : "self";
  const text = [item.title, item.subtitle, item.chiefComplaint, item.doctorNotes].filter(Boolean).join(" ").toLowerCase();
  return (person === "all" || person === identity) && (type === "all" || item.type === type) && text.includes(search.trim().toLowerCase());
});
export const ratingFields = [["doctorQuality", "Doctor quality"], ["waitTime", "Wait time"], ["staffBehavior", "Staff behavior"], ["cleanliness", "Cleanliness"], ["valueForMoney", "Value for money"]];
export const overallRating = ratings => ratingFields.every(([key]) => Number.isInteger(ratings[key]) && ratings[key] >= 1 && ratings[key] <= 5) ? Math.round(ratingFields.reduce((sum, [key]) => sum + ratings[key], 0) / ratingFields.length) : null;
