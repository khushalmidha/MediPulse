import Community from "../model/community.js";
import Doctor from "../model/doctor.js";

const getDoctorById = async (req, res) => {
	const user = await Doctor.findById(req.params.id);
	if (!user) {
		return res.json({ message: "Doctor does not exist" });
	}
	const communities = await Community.find({ author: req.params.id });
	return res.json({ user, communities });
};

const getAllDoctors = async (_, res) => {
	const users = await Doctor.find({});
	return res.json(users);
};

const deleteDoctorById = async (req, res) => {
	const result = await Doctor.findByIdAndDelete(req.params.id);
	return res.json(result);
};

const getDoctorHospitals = async (req, res) => {
	try {
		const doctor = await Doctor.findById(req.params.id).select("hospitals").lean();
		if (!doctor) {
			return res.status(404).json({ message: "Doctor not found" });
		}
		return res.status(200).json({ hospitals: doctor.hospitals || [] });
	} catch (error) {
		return res.status(500).json({ message: error.message });
	}
};

export { getDoctorById, getAllDoctors, deleteDoctorById, getDoctorHospitals };
