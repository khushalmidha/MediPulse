import Appointment from "../model/appointment.js";
import Hospital from "../model/hospital.js";
import OpdToken from "../model/opdToken.js";
import User from "../model/user.js";
import LabOrder from "../model/labOrder.js";
import Prescription from "../model/prescription.js";
import EncounterJourney from "../model/encounterJourney.js";
import { patientClinicalView } from "../services/clinicalOrderAccess.js";
import { familyViews, addPatientFamily, archivePatientFamily } from "../services/familyProfiles.js";

const mapOpdToken = (token) => ({
  id: token._id,
  type: "opd_token",
  title: `${token.hospitalId?.name || "Hospital"} OPD visit`,
  subtitle: `${token.departmentId?.name || "Department"} • ${token.displayToken}`,
  status: token.status,
  familyMemberId: token.familyMemberId || null,
  visitMode: "in_person",
  date: token.consultationEndedAt || token.date || token.createdAt,
  hospital: token.hospitalId,
  department: token.departmentId,
  doctor: token.doctorId,
  chiefComplaint: token.chiefComplaint,
  doctorNotes: token.consultationNotes || "",
  vitals: token.vitals,
  patientBrief: token.aiTriage?.patientBrief || null,
  clinicalSummary: token.soapNote?.approvedAt ? {
    subjective: token.soapNote.subjective,
    objective: token.soapNote.objective,
    assessment: token.soapNote.assessment,
    plan: token.soapNote.plan,
    version: token.soapNote.version,
    approvedAt: token.soapNote.approvedAt,
  } : null,
});

const mapAppointment = (appointment) => ({
  id: appointment._id,
  type: "appointment",
  title: appointment.visitMode === "in_person" ? "Hospital appointment" : appointment.doctor?.firstName || appointment.doctor?.lastName ? `Online consultation with Dr. ${appointment.doctor?.firstName || ""} ${appointment.doctor?.lastName || ""}`.trim() : "Online consultation",
  subtitle: appointment.doctor?.experience?.expertise || appointment.doctor?.expertise || (appointment.visitMode === "in_person" ? "In-person consultation" : "Online consultation"),
  status: appointment.status,
  familyMemberId: appointment.familyMemberId || null,
  visitMode: appointment.visitMode || "online",
  date: appointment.endedAt || appointment.startedAt || appointment.createdAt,
  doctor: appointment.doctor,
  doctorNotes: appointment.doctorNotes,
  receiptText: appointment.receiptText,
  patientBrief: appointment.patientBrief || null,
});

export const getHealthTimeline = async (req, res) => {
  try {
    if (req.auth.role !== "user") return res.status(403).json({ message: "Patient account required" });

    const [tokens, appointments] = await Promise.all([
      OpdToken.find({ patientId: req.auth.id, status: "completed" })
        .sort({ consultationEndedAt: -1, date: -1 })
        .populate("hospitalId", "name slug address.city address.state")
        .populate("departmentId", "name")
        .populate("doctorId", "name doctorProfile.specialization")
        .lean(),
      Appointment.find({ user: req.auth.id, status: "completed" })
        .sort({ endedAt: -1, createdAt: -1 })
        .populate("doctor", "firstName lastName expertise experience.expertise")
        .lean(),
    ]);

    // A completed linked hospital token and appointment describe one encounter.
    const linked = new Set(tokens.filter(token => token.appointmentId).map(token => String(token.appointmentId)));
    const byId = new Map(appointments.map(appointment => [String(appointment._id), appointment]));
    const visits = tokens.map(token => {
      const record = mapOpdToken(token), appointment = byId.get(String(token.appointmentId));
      return appointment ? { ...record, doctorNotes: record.doctorNotes || appointment.doctorNotes, receiptText: appointment.receiptText, patientBrief: record.patientBrief || appointment.patientBrief || null } : record;
    });
    const timeline = [...visits, ...appointments.filter(appointment => !linked.has(String(appointment._id))).map(mapAppointment)].sort(
      (left, right) => new Date(right.date || 0) - new Date(left.date || 0),
    );

    res.status(200).json({ items: timeline });
  } catch (error) {
    res.status(500).json({ message: error.message || "Unable to load health timeline" });
  }
};

export const getVisitedHospitals = async (req, res) => {
  try {
    if (req.auth.role !== "user") return res.status(403).json({ message: "Patient account required" });

    const hospitalIds = await OpdToken.distinct("hospitalId", { patientId: req.auth.id });
    const hospitals = await Hospital.find({ _id: { $in: hospitalIds } })
      .select("name slug address branding stats")
      .sort({ name: 1 })
      .lean();

    res.status(200).json({ items: hospitals });
  } catch (error) {
    res.status(500).json({ message: error.message || "Unable to load visited hospitals" });
  }
};

export const getFamilyMembers = async (req, res) => {
  try {
    if (req.auth.role !== "user") return res.status(403).json({ message: "Patient account required" });
    const user = await User.findById(req.auth.id).select("familyMembers").lean();
    if (!user) return res.status(404).json({ message: "Patient account not found" });
    res.status(200).json(familyViews(user));
  } catch (error) {
    res.status(500).json({ message: error.message || "Unable to load family members" });
  }
};

export const addFamilyMember = async (req, res) => {
  try {
    if (req.auth.role !== "user") return res.status(403).json({ message: "Patient account required" });

    res.status(201).json({ message: "Family member added", ...await addPatientFamily(req.auth.id, req.body) });
  } catch (error) {
    res.status(error.status || 500).json({ message: error.status ? error.message : "Unable to add family member" });
  }
};

export const removeFamilyMember = async (req, res) => {
  try {
    if (req.auth.role !== "user") return res.status(403).json({ message: "Patient account required" });
    res.status(200).json({ message: "Family booking profile removed. Visit history retained.", ...await archivePatientFamily(req.auth.id, req.params.memberId) });
  } catch (error) {
    res.status(error.status || 500).json({ message: error.status ? error.message : "Unable to remove family member" });
  }
};

export const getVisitPacket = async (req, res) => {
  try {
    if (req.auth?.role !== "user") return res.status(403).json({ message: "Patient account required" });

    const { id } = req.params;
    if (!id) return res.status(400).json({ message: "Visit identifier is required" });

    let token = await OpdToken.findOne({ _id: id, patientId: req.auth.id })
      .populate("hospitalId", "name slug address branding")
      .populate("departmentId", "name code")
      .populate("doctorId", "name doctorProfile.specialization")
      .lean();

    let encounter = null;
    if (token) {
      encounter = await EncounterJourney.findOne({ tokenId: token._id, hospitalId: token.hospitalId?._id || token.hospitalId })
        .populate("currentDestination.locationId")
        .lean();
    } else {
      encounter = await EncounterJourney.findOne({ _id: id, patientId: req.auth.id })
        .populate("hospitalId", "name slug address branding")
        .populate("departmentId", "name code")
        .populate("currentDestination.locationId")
        .lean();

      if (encounter?.tokenId) {
        token = await OpdToken.findOne({ _id: encounter.tokenId, patientId: req.auth.id })
          .populate("hospitalId", "name slug address branding")
          .populate("departmentId", "name code")
          .populate("doctorId", "name doctorProfile.specialization")
          .lean();
      }
    }

    if (!token && !encounter) {
      const user = await User.findById(req.auth.id).select("familyMembers").lean();
      const familyIds = (user?.familyMembers || []).map(f => String(f._id));

      if (familyIds.length > 0) {
        token = await OpdToken.findOne({ _id: id, familyMemberId: { $in: familyIds } })
          .populate("hospitalId", "name slug address branding")
          .populate("departmentId", "name code")
          .populate("doctorId", "name doctorProfile.specialization")
          .lean();

        if (token) {
          encounter = await EncounterJourney.findOne({ tokenId: token._id, hospitalId: token.hospitalId?._id || token.hospitalId })
            .populate("currentDestination.locationId")
            .lean();
        } else {
          encounter = await EncounterJourney.findOne({ _id: id, familyMemberId: { $in: familyIds } })
            .populate("hospitalId", "name slug address branding")
            .populate("departmentId", "name code")
            .populate("currentDestination.locationId")
            .lean();

          if (encounter?.tokenId) {
            token = await OpdToken.findOne({ _id: encounter.tokenId, familyMemberId: { $in: familyIds } })
              .populate("hospitalId", "name slug address branding")
              .populate("departmentId", "name code")
              .populate("doctorId", "name doctorProfile.specialization")
              .lean();
          }
        }
      }
    }

    if (!token && !encounter) {
      return res.status(404).json({ message: "Visit record not found" });
    }

    const hospital = token?.hospitalId || encounter?.hospitalId;
    const department = token?.departmentId || encounter?.departmentId;
    const patientId = token?.patientId || encounter?.patientId;
    const tokenId = token?._id || encounter?.tokenId;
    const encounterJourneyId = encounter?._id || token?.encounterJourneyId;

    // Fetch released lab orders
    const labFilter = { hospitalId: hospital?._id || hospital };
    if (tokenId) labFilter.tokenId = tokenId;
    else if (encounterJourneyId) labFilter.encounterJourneyId = encounterJourneyId;
    else labFilter.patientId = patientId;

    labFilter.$or = [
      { orderStatus: "released", workflowVersion: { $exists: false } },
      { reportVersions: { $elemMatch: { releasedAt: { $exists: true, $ne: null } } } },
    ];

    const rawLabs = await LabOrder.find(labFilter).sort({ createdAt: -1 }).lean();
    const labReports = rawLabs.map(order => patientClinicalView(order, "lab")).filter(Boolean);

    // Fetch approved/dispensed prescriptions
    const rxFilter = { hospitalId: hospital?._id || hospital };
    if (tokenId) rxFilter.tokenId = tokenId;
    else if (encounterJourneyId) rxFilter.encounterJourneyId = encounterJourneyId;
    else rxFilter.patientId = patientId;

    rxFilter.status = { $in: ["approved_by_doctor", "partially_dispensed", "dispensed", "returned"] };

    const rawRx = await Prescription.find(rxFilter).sort({ createdAt: -1 }).lean();
    const prescriptions = rawRx.map(rx => patientClinicalView(rx, "pharmacy")).filter(Boolean);

    // Extract clinician-approved SOAP summary (drafts without approvedAt are omitted)
    let soapSummary = null;
    if (token?.soapNote?.approvedAt) {
      soapSummary = {
        subjective: token.soapNote.subjective || "",
        objective: token.soapNote.objective || "",
        assessment: token.soapNote.assessment || "",
        plan: token.soapNote.plan || "",
        version: token.soapNote.version || 1,
        approvedAt: token.soapNote.approvedAt,
        approvedByName: token.soapNote.approvedByName || token.doctorId?.name || "Attending Physician",
      };
    }

    const destinationText = encounter?.currentDestination?.name && encounter.currentDestination.name !== "not recorded"
      ? `${encounter.currentDestination.name}${encounter.currentDestination.building ? ` · ${encounter.currentDestination.building}` : ""}${encounter.currentDestination.floor ? ` (${encounter.currentDestination.floor})` : ""}`
      : "not recorded";

    const physicalFileStatus = encounter?.physicalFile?.hasPhysicalFile
      ? (encounter.physicalFile.locationName && encounter.physicalFile.locationName !== "not recorded"
          ? `Tracked at ${encounter.physicalFile.locationName}`
          : "Tracked (location not recorded)")
      : "Electronic record only";

    const packet = {
      visitId: token?._id || encounter?._id,
      tokenId: token?._id,
      encounterId: encounter?._id,
      displayToken: token?.displayToken || encounter?.ticketNumber || "T000",
      status: token?.status || encounter?.currentStage || "reserved",
      serviceDate: token?.serviceDate || (token?.createdAt ? new Date(token.createdAt).toISOString().split("T")[0] : new Date().toISOString().split("T")[0]),
      visitMode: "in_person",
      hospital: {
        _id: hospital?._id || hospital,
        name: hospital?.name || "Hospital",
        slug: hospital?.slug,
      },
      department: {
        _id: department?._id || department,
        name: department?.name || "General OPD",
        code: department?.code,
      },
      doctor: token?.doctorId ? {
        _id: token.doctorId._id,
        name: token.doctorId.name,
        specialization: token.doctorId.doctorProfile?.specialization || "General Medicine",
      } : null,
      patient: token?.patientInfo || encounter?.patientInfo || {},
      familyMemberId: token?.familyMemberId || encounter?.familyMemberId || null,
      consultationNotes: token?.consultationNotes || "",
      vitals: token?.vitals || null,
      soapSummary,
      destination: destinationText,
      physicalFile: physicalFileStatus,
      ticket: encounter ? {
        ticketNumber: encounter.ticketNumber,
        qrPayload: encounter.qrPayload,
        stage: encounter.currentStage,
        issuedAt: encounter.createdAt,
      } : null,
      labReports,
      prescriptions,
      createdAt: token?.createdAt || encounter?.createdAt,
    };

    return res.status(200).json({ packet });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Unable to load visit packet" });
  }
};

