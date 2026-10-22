import { accessError } from "./hospitalAccess.js";

// Local test evidence is not hospital operating approval. Keep newly mounted
// enterprise workflows closed until their remaining role/policy/data gates pass.
export const assertEnterprisePilot = () => {
  if (process.env.NODE_ENV !== "test" && process.env.ENTERPRISE_PILOT_ENABLED !== "true") {
    throw accessError(503, "Enterprise workflows are awaiting operating approval. Existing outpatient services remain available.");
  }
};
