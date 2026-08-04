import Community from "../model/community.js";
import Doctor from "../model/doctor.js";
import HospitalStaff from "../model/hospitalStaff.js";

const MAX_LIMIT = 1000;

const cleanSearch = (value) => String(value || "").trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const parsePagination = (req) => {
	const page = Math.max(1, Number(req.query.page) || 1);
	const limit = Math.min(MAX_LIMIT, Math.max(1, Number(req.query.limit) || 20));
	return { page, limit, skip: (page - 1) * limit };
};

const splitName = (value) => {
	const normalized = String(value || "").trim();
	if (!normalized) return { firstName: "", lastName: "" };
	const [firstName, ...rest] = normalized.split(/\s+/);
	return { firstName, lastName: rest.join(" ") };
};

const mapPlatformDoctor = (doctor, communities = []) => ({
	_id: doctor._id,
	sourceType: "platform",
	platformDoctorId: doctor._id,
	hospitalStaffId: null,
	firstName: doctor.firstName || "",
	lastName: doctor.lastName || "",
	fullName: [doctor.firstName, doctor.lastName].filter(Boolean).join(" ").trim(),
	email: doctor.email || "",
	phone: doctor.phone || "",
	gender: doctor.gender || "other",
	profilePhoto: doctor.profilePhoto || "",
	bio: doctor.bio || "",
	rating: doctor.rating || 0,
	experience: {
		years: doctor.experience?.years || 0,
		expertise: doctor.experience?.expertise || "",
		qualification: doctor.experience?.qualification || "",
	},
	clinic: doctor.clinic || null,
	hospitalContext: null,
	bookingMode: "appointment",
	communities,
});

const mapHospitalDoctor = (staff, communities = []) => {
	const { firstName, lastName } = splitName(staff.name);
	const departmentList = (staff.departmentIds || []).map((department) => ({
		_id: department?._id || department,
		name: department?.name || "",
	}));
	const hospital = staff.hospitalId || {};
	return {
		_id: staff._id,
		sourceType: "hospital",
		platformDoctorId: staff.doctorId?._id || staff.doctorId || null,
		hospitalStaffId: staff._id,
		firstName,
		lastName,
		fullName: staff.name || [firstName, lastName].filter(Boolean).join(" ").trim(),
		email: staff.email || "",
		phone: staff.phone || "",
		gender: "other",
		profilePhoto: staff.profilePhoto || "",
		bio: staff.doctorProfile?.bio || "",
		rating: staff.doctorProfile?.rating || 0,
		experience: {
			years: staff.doctorProfile?.experience || 0,
			expertise: staff.doctorProfile?.specialization || "",
			qualification: staff.doctorProfile?.qualification || "",
		},
		clinic: null,
		hospitalContext: {
			hospitalId: hospital?._id || staff.hospitalId || null,
			hospitalName: hospital?.name || "",
			hospitalSlug: hospital?.slug || "",
			departmentId: departmentList[0]?._id || null,
			departmentName: departmentList[0]?.name || "",
			departments: departmentList,
		},
		bookingMode: "opd-token",
		communities,
	};
};

const getDoctorById = async (req, res) => {
	const { id } = req.params;
	if (!id) {
		return res.status(400).json({ message: "Doctor id is required" });
	}

	const platformDoctor = await Doctor.findById(id).lean();
	if (platformDoctor) {
		const communities = await Community.find({ author: id }).lean();
		return res.json({ user: mapPlatformDoctor(platformDoctor, communities), communities });
	}

	const staffDoctor = await HospitalStaff.findOne({
		_id: id,
		role: "DOCTOR",
		isActive: true,
	})
		.populate("hospitalId", "name slug")
		.populate("departmentIds", "name")
		.populate("doctorId", "firstName lastName")
		.lean();

	if (!staffDoctor) {
		return res.status(404).json({ message: "Doctor does not exist" });
	}

	const communities = staffDoctor.doctorId?._id
		? await Community.find({ author: staffDoctor.doctorId._id }).lean()
		: [];
	return res.json({ user: mapHospitalDoctor(staffDoctor, communities), communities });
};

const getAllDoctors = async (req, res) => {
	const { page, limit, skip } = parsePagination(req);
	const search = cleanSearch(req.query.search);
	const searchRegex = search ? new RegExp(search, "i") : null;

	const platformPipeline = [
		{
			$match: {
				$or: [
					{ hospitals: { $exists: false } },
					{ hospitals: { $size: 0 } },
				],
			},
		},
		{
			$project: {
				_id: 1,
				sourceType: { $literal: "platform" },
				platformDoctorId: "$_id",
				hospitalStaffId: { $literal: null },
				firstName: { $ifNull: ["$firstName", ""] },
				lastName: { $ifNull: ["$lastName", ""] },
				fullName: {
					$trim: {
						input: {
							$concat: [
								{ $ifNull: ["$firstName", ""] },
								" ",
								{ $ifNull: ["$lastName", ""] },
							],
						},
					},
				},
				email: { $ifNull: ["$email", ""] },
				phone: { $ifNull: ["$phone", ""] },
				gender: { $ifNull: ["$gender", "other"] },
				profilePhoto: { $ifNull: ["$profilePhoto", ""] },
				bio: { $ifNull: ["$bio", ""] },
				rating: { $ifNull: ["$rating", 0] },
				experience: {
					years: { $ifNull: ["$experience.years", 0] },
					expertise: { $ifNull: ["$experience.expertise", ""] },
					qualification: { $ifNull: ["$experience.qualification", ""] },
				},
				clinic: "$clinic",
				hospitalContext: { $literal: null },
				bookingMode: { $literal: "appointment" },
				searchBlob: {
					$toLower: {
						$concat: [
							{ $ifNull: ["$firstName", ""] },
							" ",
							{ $ifNull: ["$lastName", ""] },
							" ",
							{ $ifNull: ["$experience.expertise", ""] },
							" ",
							{ $ifNull: ["$clinic.name", ""] },
						],
					},
				},
			},
		},
		{
			$unionWith: {
				coll: HospitalStaff.collection.name,
				pipeline: [
					{
						$match: {
							role: "DOCTOR",
							isActive: true,
							inviteStatus: "accepted",
						},
					},
					{
						$lookup: {
							from: "hospitals",
							localField: "hospitalId",
							foreignField: "_id",
							as: "hospital",
						},
					},
					{
						$lookup: {
							from: "departments",
							localField: "departmentIds",
							foreignField: "_id",
							as: "departments",
						},
					},
					{
						$project: {
							_id: 1,
							sourceType: { $literal: "hospital" },
							platformDoctorId: "$doctorId",
							hospitalStaffId: "$_id",
							firstName: { $ifNull: ["$name", ""] },
							lastName: { $literal: "" },
							fullName: { $ifNull: ["$name", ""] },
							email: { $ifNull: ["$email", ""] },
							phone: { $ifNull: ["$phone", ""] },
							gender: { $literal: "other" },
							profilePhoto: { $ifNull: ["$profilePhoto", ""] },
							bio: { $ifNull: ["$doctorProfile.bio", ""] },
							rating: { $ifNull: ["$doctorProfile.rating", 0] },
							experience: {
								years: { $ifNull: ["$doctorProfile.experience", 0] },
								expertise: { $ifNull: ["$doctorProfile.specialization", ""] },
								qualification: { $ifNull: ["$doctorProfile.qualification", ""] },
							},
							clinic: { $literal: null },
							hospitalContext: {
								hospitalId: "$hospitalId",
								hospitalName: { $ifNull: [{ $arrayElemAt: ["$hospital.name", 0] }, ""] },
								hospitalSlug: { $ifNull: [{ $arrayElemAt: ["$hospital.slug", 0] }, ""] },
								departmentId: { $arrayElemAt: ["$departments._id", 0] },
								departmentName: { $ifNull: [{ $arrayElemAt: ["$departments.name", 0] }, ""] },
								departments: {
									$map: {
										input: "$departments",
										as: "department",
										in: {
											_id: "$$department._id",
											name: "$$department.name",
										},
									},
								},
							},
							bookingMode: { $literal: "opd-token" },
							searchBlob: {
								$toLower: {
									$concat: [
										{ $ifNull: ["$name", ""] },
										" ",
										{ $ifNull: ["$doctorProfile.specialization", ""] },
										" ",
										{ $ifNull: [{ $arrayElemAt: ["$hospital.name", 0] }, ""] },
									],
								},
							},
						},
					},
				],
			},
		},
	];

	if (searchRegex) {
		platformPipeline.push({
			$match: {
				searchBlob: searchRegex,
			},
		});
	}

	platformPipeline.push(
		{
			$sort: { fullName: 1, _id: 1 },
		},
		{
			$facet: {
				items: [
					{ $skip: skip },
					{ $limit: limit },
					{ $project: { searchBlob: 0 } },
				],
				total: [{ $count: "count" }],
			},
		},
	);

	const [result] = await Doctor.aggregate(platformPipeline);
	const items = result?.items || [];
	const total = result?.total?.[0]?.count || 0;
	return res.json({
		items,
		total,
		page,
		limit,
		totalPages: Math.ceil(total / limit) || 1,
	});
};

const deleteDoctorById = async (req, res) => {
	const result = await Doctor.findByIdAndDelete(req.params.id);
	return res.json(result);
};

const getDoctorHospitals = async (req, res) => {
	try {
		const platformDoctor = await Doctor.findById(req.params.id).select("hospitals").lean();
		if (platformDoctor) {
			return res.status(200).json({ hospitals: platformDoctor.hospitals || [] });
		}

		const staffDoctor = await HospitalStaff.findOne({
			_id: req.params.id,
			role: "DOCTOR",
			isActive: true,
		})
			.populate("hospitalId", "name slug")
			.populate("departmentIds", "name")
			.lean();

		if (!staffDoctor) {
			return res.status(404).json({ message: "Doctor not found" });
		}

		return res.status(200).json({
			hospitals: [
				{
					hospitalId: staffDoctor.hospitalId?._id || staffDoctor.hospitalId,
					hospitalName: staffDoctor.hospitalId?.name || "",
					slug: staffDoctor.hospitalId?.slug || "",
					departmentName: staffDoctor.departmentIds?.[0]?.name || "",
					departments: (staffDoctor.departmentIds || []).map((department) => ({
						_id: department?._id || department,
						name: department?.name || "",
					})),
				},
			],
		});
	} catch (error) {
		return res.status(500).json({ message: error.message });
	}
};

export { getDoctorById, getAllDoctors, deleteDoctorById, getDoctorHospitals };
