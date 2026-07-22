import Appointment from "../model/appointment.js";
import Hospital from "../model/hospital.js";
import OpdToken from "../model/opdToken.js";
import User from "../model/user.js";

const mapOpdToken = (token) => ({
  id: token._id,
  type: "opd_token",
  title: `${token.hospitalId?.name || "Hospital"} OPD visit`,
  subtitle: `${token.departmentId?.name || "Department"} • ${token.displayToken}`,
  status: token.status,
  date: token.consultationEndedAt || token.date || token.createdAt,
  hospital: token.hospitalId,
  department: token.departmentId,
  doctor: token.doctorId,
  chiefComplaint: token.chiefComplaint,
  vitals: token.vitals,
  patientBrief: token.aiTriage?.patientBrief || null,
});

const mapAppointment = (appointment) => ({
  id: appointment._id,
  type: "appointment",
  title: `Telehealth appointment with Dr. ${appointment.doctor?.firstName || ""} ${appointment.doctor?.lastName || ""}`.trim(),
  subtitle: appointment.doctor?.expertise || "Online consultation",
  status: appointment.status,
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
        .populate("doctor", "firstName lastName expertise")
        .lean(),
    ]);

    const timeline = [...tokens.map(mapOpdToken), ...appointments.map(mapAppointment)].sort(
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
    res.status(200).json({ items: user?.familyMembers || [] });
  } catch (error) {
    res.status(500).json({ message: error.message || "Unable to load family members" });
  }
};

export const addFamilyMember = async (req, res) => {
  try {
    if (req.auth.role !== "user") return res.status(403).json({ message: "Patient account required" });

    const member = {
      name: String(req.body.name || "").trim(),
      relation: String(req.body.relation || "").trim(),
      dob: req.body.dob ? new Date(req.body.dob) : undefined,
      gender: req.body.gender,
      bloodGroup: req.body.bloodGroup,
    };

    if (!member.name || !member.relation) {
      return res.status(400).json({ message: "Name and relation are required" });
    }

    const user = await User.findByIdAndUpdate(req.auth.id, { $push: { familyMembers: member } }, { new: true }).select("familyMembers");
    res.status(201).json({ message: "Family member added", items: user.familyMembers });
  } catch (error) {
    res.status(500).json({ message: error.message || "Unable to add family member" });
  }
};

export const removeFamilyMember = async (req, res) => {
  try {
    if (req.auth.role !== "user") return res.status(403).json({ message: "Patient account required" });
    const user = await User.findByIdAndUpdate(
      req.auth.id,
      { $pull: { familyMembers: { _id: req.params.memberId } } },
      { new: true },
    ).select("familyMembers");
    res.status(200).json({ message: "Family member removed", items: user.familyMembers });
  } catch (error) {
    res.status(500).json({ message: error.message || "Unable to remove family member" });
  }
};
