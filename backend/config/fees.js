// Single source of truth for consultation fees.
//
// Every doctor sets their own consultation fee on their profile. This default is only used for
// legacy doctor documents saved before the `consultationFee` field existed, so the fee shown in
// the UI always matches the amount actually debited from the patient's wallet at booking time.
const DEFAULT_CONSULTATION_FEE_INR = Number(process.env.DEFAULT_CONSULTATION_FEE_INR || 500);

const MAX_CONSULTATION_FEE_INR = Number(process.env.MAX_CONSULTATION_FEE_INR || 100000);

/**
 * Resolve the fee to charge for a doctor, falling back to the platform default when the doctor
 * has not set one yet.
 * @param {{ consultationFee?: number }} doctor
 * @returns {number} fee in INR
 */
const resolveConsultationFee = (doctor) => {
  const fee = Number(doctor?.consultationFee);
  if (!Number.isFinite(fee) || fee < 0) return DEFAULT_CONSULTATION_FEE_INR;
  return Math.round(fee * 100) / 100;
};

export { DEFAULT_CONSULTATION_FEE_INR, MAX_CONSULTATION_FEE_INR, resolveConsultationFee };
