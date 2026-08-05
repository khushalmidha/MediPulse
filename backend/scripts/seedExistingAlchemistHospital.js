import { configDotenv } from "dotenv";
import mongoose from "mongoose";
import connectMongo from "../connection.js";
import BedInventory from "../model/bedInventory.js";
import BloodBankInventory from "../model/bloodBankInventory.js";
import Department from "../model/department.js";
import Doctor from "../model/doctor.js";
import Hospital from "../model/hospital.js";
import HospitalStaff from "../model/hospitalStaff.js";
import StaffMessage from "../model/staffMessage.js";

configDotenv({ path: ["backend/.env", ".env", "../.env", "../../.env"] });

const hospitalId = process.env.SEED_HOSPITAL_ID || "6a6a2c4bd6a136ab21624c26";
const staffPassword = process.env.DEMO_STAFF_PASSWORD || "Khushal@123";

const departments = [
  ["Cardiology", "CARD", "HeartPulse", "#dc2626", 750, "Preventive heart care, hypertension, ECG review and post-procedure follow-up."],
  ["Orthopaedics", "ORTH", "Bone", "#2563eb", 650, "Joint pain, sports injuries, fracture follow-up, spine and mobility rehabilitation."],
  ["Neurology", "NEUR", "Brain", "#7c3aed", 900, "Headache, stroke follow-up, seizures, nerve pain and neurological rehabilitation."],
  ["Paediatrics", "PAED", "Baby", "#0891b2", 550, "Child health, fever clinics, allergies, nutrition and vaccination guidance."],
  ["Emergency Medicine", "EMER", "Ambulance", "#ea580c", 800, "Emergency triage, urgent OPD screening and acute care stabilization."],
  ["Diagnostics", "DIAG", "Microscope", "#0f766e", 350, "Lab tests, health packages, imaging coordination and diagnostic follow-ups."],
];

const demoAccounts = [
  {
    name: "Dr. Aarav Midha",
    email: "khushalmidha24@gmail.com",
    role: "DOCTOR",
    department: "Cardiology",
    profilePhoto: "https://images.unsplash.com/photo-1612349317150-e413f6a5b16d?auto=format&fit=crop&w=400&q=80",
    doctorProfile: { qualification: "DM Cardiology", specialization: "Interventional Cardiology", experience: 12, consultationFee: 750, rating: 4.9, totalReviews: 132 },
  },
  {
    name: "Dr. Kavya Midha",
    email: "lci2023048@iiitl.ac.in",
    role: "DOCTOR",
    department: "Neurology",
    profilePhoto: "https://images.unsplash.com/photo-1594824476967-48c8b964273f?auto=format&fit=crop&w=400&q=80",
    doctorProfile: { qualification: "DM Neurology", specialization: "Stroke and Headache Medicine", experience: 10, consultationFee: 900, rating: 4.8, totalReviews: 118 },
  },
  {
    name: "Khushal Midha",
    email: "khushalmidha19@gmail.com",
    role: "HOSPITAL_ADMIN",
    department: "Diagnostics",
    profilePhoto: "https://images.unsplash.com/photo-1560250097-0b93528c311a?auto=format&fit=crop&w=400&q=80",
  },
  {
    name: "Ramesh Chaudhary",
    email: "rameshchaudary241@gmail.com",
    role: "NURSE",
    department: "Emergency Medicine",
    profilePhoto: "https://images.unsplash.com/photo-1582750433449-648ed127bb54?auto=format&fit=crop&w=400&q=80",
  },
  {
    name: "Dr. Ishaan Midha",
    email: "khushalmidha245@gmail.com",
    role: "DOCTOR",
    department: "Orthopaedics",
    profilePhoto: "https://images.unsplash.com/photo-1622253692010-333f2da6031d?auto=format&fit=crop&w=400&q=80",
    doctorProfile: { qualification: "MS Orthopaedics", specialization: "Joint Replacement and Sports Injury", experience: 9, consultationFee: 650, rating: 4.7, totalReviews: 96 },
  },
  {
    name: "Nurse Khushal Midha",
    email: "khushalmidha06@gmail.com",
    role: "NURSE",
    department: "Paediatrics",
    profilePhoto: "https://images.unsplash.com/photo-1559839734-2b71ea197ec2?auto=format&fit=crop&w=400&q=80",
  },
  {
    name: "Dr. Neel Midha",
    email: "khushalmidha18@gmail.com",
    role: "DOCTOR",
    department: "Paediatrics",
    profilePhoto: "https://images.unsplash.com/photo-1537368910025-700350fe46c7?auto=format&fit=crop&w=400&q=80",
    doctorProfile: { qualification: "MD Paediatrics", specialization: "Child Health and Vaccination", experience: 8, consultationFee: 550, rating: 4.8, totalReviews: 104 },
  },
  {
    name: "Sohit Sehgal",
    email: "sohitsehgal09@gmail.com",
    role: "RECEPTIONIST",
    department: "Diagnostics",
    profilePhoto: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=400&q=80",
  },
  {
    name: "Khushal Midha",
    email: "midhakhushal5@gmail.com",
    role: "LAB_TECH",
    department: "Diagnostics",
    profilePhoto: "https://images.unsplash.com/photo-1581093458791-9f3c3900df7b?auto=format&fit=crop&w=400&q=80",
  },
];

const seededEmails = demoAccounts.map((account) => account.email.toLowerCase());

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
  member.password = staffPassword;
  await member.save();
  return syncPlatformDoctor({ hospital, department, member, input });
};

const seedDepartmentMessages = async ({ hospital, departmentByName }) => {
  await StaffMessage.deleteMany({ hospitalId: hospital._id, "metadata.seed": "alchemist-demo" });

  for (const department of departmentByName.values()) {
    const participants = await HospitalStaff.find({
      hospitalId: hospital._id,
      isActive: true,
      inviteStatus: "accepted",
      $or: [{ departmentIds: department._id }, { role: "HOSPITAL_ADMIN" }],
    }).lean();
    if (!participants.length) continue;

    const messages = [
      `Morning handover for ${department.name}: keep today's OPD queue updated every 15 minutes.`,
      `Please tag urgent vitals in ${department.name} before moving patient to doctor console.`,
      `${department.name} team: confirm token status after every completed consultation.`,
    ];

    for (let index = 0; index < messages.length; index += 1) {
      const sender = participants[index % participants.length];
      await StaffMessage.create({
        hospitalId: hospital._id,
        conversationType: "department",
        departmentId: department._id,
        sender: sender._id,
        senderName: sender.name,
        senderRole: sender.role,
        content: messages[index],
        messageType: "text",
        metadata: { seed: "alchemist-demo" },
        readBy: [{ staffId: sender._id, readAt: new Date() }],
      });
    }
  }
};

const main = async () => {
  await connectMongo(process.env.DATABASE_URL);
  const hospital = await Hospital.findById(hospitalId);
  if (!hospital) throw new Error(`Hospital not found: ${hospitalId}`);

  hospital.name = "Alchemist Hospital";
  hospital.status = "active";
  hospital.medicineSystem = "allopathic";
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

  await Promise.all([
    HospitalStaff.deleteMany({ hospitalId: hospital._id, email: { $nin: seededEmails } }),
    Doctor.deleteMany({ email: /@alchemist\.demo$/i }),
  ]);

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

  for (const account of demoAccounts) {
    await upsertStaff({
      hospital,
      department: departmentByName.get(account.department),
      input: {
        ...account,
        doctorProfile: account.role === "DOCTOR"
          ? {
          ...account.doctorProfile,
          bio: `${account.name} provides ${account.doctorProfile.specialization.toLowerCase()} consultations with a patient-first OPD workflow.`,
          languages: ["Hindi", "English"],
        }
          : undefined,
      },
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

    const bedType = /Emergency/i.test(department.name) ? "emergency" : /Paediatrics/i.test(department.name) ? "pediatric" : /Cardiology|Neurology/i.test(department.name) ? "icu" : "general";
    await BedInventory.findOneAndUpdate(
      { hospitalId: hospital._id, departmentId: department._id, bedType },
      {
        // FIXED: Demo hospital had departments but no visible capacity data for forecast planning.
        totalBeds: bedType === "icu" ? 18 : bedType === "emergency" ? 14 : 28,
        occupiedBeds: bedType === "icu" ? 11 : bedType === "emergency" ? 7 : 16,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }

  await seedDepartmentMessages({ hospital, departmentByName });

  for (const [bloodGroup, availableUnits, minimumReserveUnits] of [
    ["O+", 34, 18],
    ["A+", 28, 16],
    ["B+", 22, 14],
    ["AB+", 10, 8],
    ["O-", 8, 8],
    ["A-", 6, 6],
    ["B-", 5, 6],
    ["AB-", 4, 5],
  ]) {
    await BloodBankInventory.findOneAndUpdate(
      { hospitalId: hospital._id, bloodGroup },
      { availableUnits, minimumReserveUnits, expiresSoonUnits: Math.max(0, Math.floor(availableUnits * 0.08)) },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
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
