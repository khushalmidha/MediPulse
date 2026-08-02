import { configDotenv } from "dotenv";
import mongoose from "mongoose";
import connectMongo from "../connection.js";
import Department from "../model/department.js";
import Doctor from "../model/doctor.js";
import Hospital from "../model/hospital.js";
import HospitalStaff from "../model/hospitalStaff.js";

configDotenv({ path: [".env", "../.env", "../../.env"] });

const hospitalId = process.env.SEED_HOSPITAL_ID || "6a6a2c4bd6a136ab21624c26";
const staffPassword = process.env.DEMO_STAFF_PASSWORD || "Demo@12345";

const departments = [
  ["Cardiology", "CARD", "HeartPulse", "#dc2626", 750, "Preventive heart care, hypertension, ECG review and post-procedure follow-up."],
  ["Orthopaedics", "ORTH", "Bone", "#2563eb", 650, "Joint pain, sports injuries, fracture follow-up, spine and mobility rehabilitation."],
  ["Neurology", "NEUR", "Brain", "#7c3aed", 900, "Headache, stroke follow-up, seizures, nerve pain and neurological rehabilitation."],
  ["Paediatrics", "PAED", "Baby", "#0891b2", 550, "Child health, fever clinics, allergies, nutrition and vaccination guidance."],
  ["Emergency Medicine", "EMER", "Ambulance", "#ea580c", 800, "Emergency triage, urgent OPD screening and acute care stabilization."],
  ["Diagnostics", "DIAG", "Microscope", "#0f766e", 350, "Lab tests, health packages, imaging coordination and diagnostic follow-ups."],
];

const doctors = [
  ["Dr. Aditi Sharma", "aditi.sharma@alchemist.demo", "Cardiology", "https://images.unsplash.com/photo-1559839734-2b71ea197ec2?auto=format&fit=crop&w=400&q=80", "DM Cardiology", "Interventional Cardiology", 14, 750],
  ["Dr. Kabir Mehta", "kabir.mehta@alchemist.demo", "Orthopaedics", "https://images.unsplash.com/photo-1622253692010-333f2da6031d?auto=format&fit=crop&w=400&q=80", "MS Orthopaedics", "Joint Replacement", 11, 650],
  ["Dr. Naina Kapoor", "naina.kapoor@alchemist.demo", "Neurology", "https://images.unsplash.com/photo-1594824476967-48c8b964273f?auto=format&fit=crop&w=400&q=80", "DM Neurology", "Stroke and Headache Medicine", 13, 900],
  ["Dr. Rohan Batra", "rohan.batra@alchemist.demo", "Paediatrics", "https://images.unsplash.com/photo-1537368910025-700350fe46c7?auto=format&fit=crop&w=400&q=80", "MD Paediatrics", "Child Health", 9, 550],
  ["Dr. Samar Virk", "samar.virk@alchemist.demo", "Emergency Medicine", "https://images.unsplash.com/photo-1582750433449-648ed127bb54?auto=format&fit=crop&w=400&q=80", "MD Emergency Medicine", "Emergency and Trauma Care", 10, 800],
];

const staff = [
  ["Nurse Priya Malik", "priya.malik@alchemist.demo", "NURSE", "Cardiology"],
  ["Nurse Neha Saini", "neha.saini@alchemist.demo", "NURSE", "Paediatrics"],
  ["Nurse Arjun Rana", "arjun.rana@alchemist.demo", "NURSE", "Emergency Medicine"],
  ["Riya Reception", "riya.reception@alchemist.demo", "RECEPTIONIST", "Emergency Medicine"],
  ["Aman Lab", "aman.lab@alchemist.demo", "LAB_TECH", "Diagnostics"],
];

const syncPlatformDoctor = async ({ hospital, department, member, input }) => {
  if (input.role !== "DOCTOR") return member;

  const email = input.email.toLowerCase();
  const [firstName, ...lastNameParts] = input.name.replace(/^Dr\.\s*/i, "").split(/\s+/);
  const affiliation = {
    hospitalId: hospital._id,
    hospitalName: hospital.name,
    slug: hospital.slug,
    departmentName: department?.name || input.doctorProfile?.specialization || "General Medicine",
  };

  let doctor = await Doctor.findOne({ email });
  if (!doctor) {
    doctor = await Doctor.create({
      firstName: firstName || input.name,
      lastName: lastNameParts.join(" "),
      email,
      password: staffPassword,
      gender: "other",
      phone: 9811000000,
      rating: input.doctorProfile?.rating || 4.8,
      bio: input.doctorProfile?.bio,
      experience: {
        years: input.doctorProfile?.experience || 0,
        expertise: input.doctorProfile?.specialization || department?.name || "General Medicine",
        qualification: input.doctorProfile?.qualification || "",
      },
      clinic: {
        name: hospital.name,
        location: [hospital.address?.line1, hospital.address?.city, hospital.address?.state].filter(Boolean).join(", "),
        pin: Number(hospital.address?.pincode) || undefined,
        phoneNumber: 9811000000,
      },
      hospitals: [affiliation],
    });
  } else {
    doctor.firstName = firstName || doctor.firstName;
    doctor.lastName = lastNameParts.join(" ");
    doctor.gender = doctor.gender || "other";
    doctor.phone = doctor.phone || 9811000000;
    doctor.rating = input.doctorProfile?.rating || doctor.rating || 4.8;
    doctor.bio = input.doctorProfile?.bio || doctor.bio;
    doctor.experience = {
      years: input.doctorProfile?.experience || doctor.experience?.years || 0,
      expertise: input.doctorProfile?.specialization || doctor.experience?.expertise || department?.name || "General Medicine",
      qualification: input.doctorProfile?.qualification || doctor.experience?.qualification || "",
    };
    doctor.clinic = {
      ...(doctor.clinic || {}),
      name: hospital.name,
      location: [hospital.address?.line1, hospital.address?.city, hospital.address?.state].filter(Boolean).join(", "),
      pin: Number(hospital.address?.pincode) || doctor.clinic?.pin,
      phoneNumber: doctor.clinic?.phoneNumber || 9811000000,
    };
    const alreadyAffiliated = doctor.hospitals?.some((item) => item.hospitalId?.toString() === hospital._id.toString());
    if (!alreadyAffiliated) {
      doctor.hospitals = [...(doctor.hospitals || []), affiliation];
    }
    await doctor.save();
  }

  member.doctorId = doctor._id;
  await member.save();
  return member;
};

const upsertStaff = async ({ hospital, department, input }) => {
  const member = await HospitalStaff.findOne({ hospitalId: hospital._id, email: input.email });
  const payload = {
    hospitalId: hospital._id,
    departmentIds: department ? [department._id] : [],
    name: input.name,
    email: input.email,
    role: input.role,
    profilePhoto: input.profilePhoto,
    doctorProfile: input.doctorProfile,
    inviteStatus: "accepted",
    joinedAt: new Date(),
    isActive: true,
  };

  if (!member) {
    const created = await HospitalStaff.create({ ...payload, password: staffPassword });
    return syncPlatformDoctor({ hospital, department, member: created, input });
  }

  Object.assign(member, payload);
  await member.save();
  return syncPlatformDoctor({ hospital, department, member, input });
};

const main = async () => {
  await connectMongo(process.env.DATABASE_URL);
  const hospital = await Hospital.findById(hospitalId);
  if (!hospital) throw new Error(`Hospital not found: ${hospitalId}`);

  hospital.name = "Alchemist Hospital";
  hospital.status = "active";
  hospital.phone = hospital.phone || "+91 172 450 0000";
  hospital.website = hospital.website || "https://www.alchemisthospital.com";
  hospital.branding = {
    logo: "https://images.unsplash.com/photo-1586773860418-d37222d8fce3?auto=format&fit=crop&w=240&q=80",
    coverImage: "https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d?auto=format&fit=crop&w=1600&q=80",
    primaryColor: "#0f766e",
    tagline: "Advanced multi-speciality care with smart OPD visibility.",
    about: "Alchemist Hospital combines multi-speciality care, OPD token management, realtime queues and digital patient records through MediPulse.",
    establishedYear: 2008,
    specializations: ["Cardiac Care", "Orthopaedics", "Neurology", "Paediatrics", "Emergency", "Diagnostics"],
    accreditations: ["NABH", "ISO 9001"],
    socialLinks: {},
  };
  hospital.settings = { ...(hospital.settings || {}), tokenPrefix: "A", allowWalkIns: true };
  await hospital.save();

  await Department.deleteMany({
    hospitalId: hospital._id,
    $or: [{ name: /test/i }, { name: "Cardiologist" }],
  });

  const departmentByName = new Map();
  for (const [name, code, icon, color, fee, description] of departments) {
    const department = await Department.findOneAndUpdate(
      { hospitalId: hospital._id, name },
      {
        $set: {
          hospitalId: hospital._id,
          name,
          code,
          icon,
          color,
          description,
          opd: {
            isActive: true,
            consultationFee: fee,
            followUpFee: Math.round(fee * 0.6),
            slotDurationMinutes: name === "Neurology" ? 20 : 15,
            maxPatientsPerSlot: 1,
            timings: [],
          },
          status: "active",
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
    departmentByName.set(name, department);
  }

  for (const [name, email, departmentName, profilePhoto, qualification, specialization, experience, fee] of doctors) {
    await upsertStaff({
      hospital,
      department: departmentByName.get(departmentName),
      input: {
        name,
        email,
        role: "DOCTOR",
        profilePhoto,
        doctorProfile: {
          qualification,
          specialization,
          experience,
          consultationFee: fee,
          bio: `${name} provides ${specialization.toLowerCase()} consultations with a patient-first OPD workflow.`,
          languages: ["Hindi", "English"],
          rating: 4.8,
          totalReviews: 80,
        },
      },
    });
  }

  for (const [name, email, role, departmentName] of staff) {
    await upsertStaff({
      hospital,
      department: departmentByName.get(departmentName),
      input: { name, email, role, profilePhoto: "" },
    });
  }

  for (const department of departmentByName.values()) {
    const departmentDoctors = await HospitalStaff.find({ hospitalId: hospital._id, role: "DOCTOR", departmentIds: department._id });
    department.opd.timings = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => ({
      day,
      startTime: department.name === "Emergency Medicine" ? "00:00" : "09:00",
      endTime: department.name === "Emergency Medicine" ? "23:59" : "14:00",
      doctorIds: departmentDoctors.map((doctor) => doctor._id),
    }));
    department.headDoctorId = departmentDoctors[0]?._id;
    await department.save();
  }

  const [doctorCount, departmentCount] = await Promise.all([
    HospitalStaff.countDocuments({ hospitalId: hospital._id, role: "DOCTOR", isActive: true }),
    Department.countDocuments({ hospitalId: hospital._id, status: "active" }),
  ]);
  await Hospital.findByIdAndUpdate(hospital._id, {
    "stats.totalDoctors": doctorCount,
    "stats.totalDepartments": departmentCount,
    "stats.avgRating": 4.8,
    "stats.totalReviews": 457,
  });

  console.log("Existing Alchemist hospital seeded");
  console.log(`Hospital ID: ${hospital._id}`);
  console.log(`Departments: ${departmentCount}`);
  console.log(`Doctors: ${doctorCount}`);
  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
