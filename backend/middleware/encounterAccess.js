import EncounterJourney from "../model/encounterJourney.js";
import OpdToken from "../model/opdToken.js";
import { accessError, idOf, loadVisit, requireRecordId } from "../services/hospitalAccess.js";

// Authorize against source records, never a presentation DTO missing owner IDs.
export async function requireEncounterRead(req, _res, next) {
  try {
    const id = requireRecordId(req.params.id, "encounter");
    let encounter = await EncounterJourney.findById(id).lean();
    if (!encounter) encounter = await EncounterJourney.findOne({ tokenId: id }).lean();
    if (!encounter) throw accessError(404, "Encounter not found");
    if (!encounter.tokenId) throw accessError(403, "Encounter access is unavailable for this visit");
    const token = req.staff
      ? await loadVisit(req.staff, encounter.tokenId)
      : await OpdToken.findById(encounter.tokenId).lean();
    if (!token || idOf(token.hospitalId) !== idOf(encounter.hospitalId)
      || idOf(token.departmentId) !== idOf(encounter.departmentId)
      || idOf(token.patientId) !== idOf(encounter.patientId)) {
      throw accessError(403, "Encounter identity requires review");
    }
    if (!req.staff && (req.auth?.role !== "user" || !token.patientId
      || idOf(req.auth.id) !== idOf(token.patientId))) {
      throw accessError(403, "You cannot view this encounter");
    }
    req.encounter = encounter;
    next();
  } catch (error) { next(error); }
}

export function pendingEncounterRepair(_req, res) {
  return res.status(503).json({ code: "ENCOUNTER_REPAIR_PENDING",
    message: "This encounter action is temporarily unavailable while identity and handoff safeguards are completed. Please contact reception." });
}
