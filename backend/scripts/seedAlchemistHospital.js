import { configDotenv } from "dotenv";
import mongoose from "mongoose";
import connectMongo from "../connection.js";
import Department from "../model/department.js";
import Hospital from "../model/hospital.js";
import HospitalStaff from "../model/hospitalStaff.js";

configDotenv({ path: [".env", "../.env", "../../.env"] });

const password = process.env.DEMO_STAFF_PASSWORD || "Demo@12345";

const alchemistHospital = {
  name: "Alchemist Hospital",
  slug: "alchemist-hospital-001",
  registrationNumber: "ALCH-PKL-2008",
  type: "private",
  email: "admin@alchemisthospital.demo",
  phone: "+91 172 450 0000",
  website: "https://www.alchemisthospital.com",
  address: {
    line1: "Sector 21, Panchkula",
    city: "Panchkula",
    state: "Haryana",
    pincode: "134112",
    coordinates: { lat: 30.6942, lng: 76.8606 },
  },
  branding: {
    logo: "https://images.unsplash.com/photo-1586773860418-d37222d8fce3?auto=format&fit=crop&w=240&q=80",
    coverImage: "https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d?auto=format&fit=crop&w=1600&q=80",
    primaryColor: "#0f766e",
    tagline: "Advanced multi-speciality care with smart OPD visibility.",
    about:
      "Alchemist Hospital brings cardiology, orthopaedics, neurology, paediatrics, diagnostics and emergency care into a digital-first patient experience powered by MediPulse.",
    establishedYear: 2008,
    specializations: ["Cardiac Care", "Orthopaedics", "Neurology", "Paediatrics", "Diagnostics"],
    accreditations: ["NABH", "ISO 9001"],
  },
  websiteConfig: {
    seoTitle: "Alchemist Hospital | MediPulse Smart OPD",
    seoDescription: "Book OPD visits, view departments, doctors, fees and live queue updates for Alchemist Hospital.",
    showRatings: true,
    showDoctorList: true,
    showFees: true,
    theme: "modern",
  },
  status: "active",
  verifiedAt: new Date(),
  subscription: {
    plan: "growth",
    status: "trial",
    trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  },
  settings: {
    appointmentConfirmationRequired: false,
    allowWalkIns: true,
    tokenPrefix: "A",
    workingDays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    emergencyContact: "+91 172 450 0000",
  },
};

const departments = [
  {
    name: "Cardiology",
    code: "CARD",
    icon: "HeartPulse",
    color: "#dc2626",
    description: "Heart health, preventive cardiac checks, hypertension and post-procedure follow-ups.",
    opd: { consultationFee: 750, followUpFee: 450, slotDurationMinutes: 15, maxPatientsPerSlot: 1, isActive: true },
  },
  {
    name: "Orthopaedics",
    code: "ORTH",
    icon: "Bone",
    color: "#2563eb",
    description: "Joint pain, sports injuries, spine care, fracture follow-ups and mobility rehabilitation.",
    opd: { consultationFee: 650, followUpFee: 400, slotDurationMinutes: 15, maxPatientsPerSlot: 1, isActive: true },
  },
  {
    name: "Neurology",
    code: "NEUR",
    icon: "Brain",
    color: "#7c3aed",
    description: "Headache, seizure, stroke follow-up, nerve pain and cognitive health consultations.",
    opd: { consultationFee: 900, followUpFee: 550, slotDurationMinutes: 20, maxPatientsPerSlot: 1, isActive: true },
  },
  {
    name: "Paediatrics",
    code: "PAED",
    icon: "Baby",
    color: "#0891b2",
    description: "Child health, vaccination guidance, fever clinics and growth milestone reviews.",
    opd: { consultationFee: 550, followUpFee: 350, slotDurationMinutes: 12, maxPatientsPerSlot: 1, isActive: true },
  },
];

const doctors = [
  {
    name: "Dr. Aditi Sharma",
    email: "aditi.sharma@alchemisthospital.demo",
    department: "Cardiology",
    profilePhoto: "https://images.unsplash.com/photo-1559839734-2b71ea197ec2?auto=format&fit=crop&w=400&q=80",
    doctorProfile: {
      qualification: "DM Cardiology, MD Medicine",
      specialization: "Interventional Cardiology",
      experience: 14,
      registrationNumber: "HNMC-45291",
      consultationFee: 750,
      bio: "Focused on preventive cardiology, hypertension care and post-angioplasty recovery plans.",
      languages: ["Hindi", "English", "Punjabi"],
      rating: 4.8,
      totalReviews: 126,
    },
  },
  {
    name: "Dr. Kabir Mehta",
    email: "kabir.mehta@alchemisthospital.demo",
    department: "Orthopaedics",
    profilePhoto: "https://images.unsplash.com/photo-1622253692010-333f2da6031d?auto=format&fit=crop&w=400&q=80",
    doctorProfile: {
      qualification: "MS Orthopaedics",
      specialization: "Joint Replacement and Sports Injury",
      experience: 11,
      registrationNumber: "HNMC-39210",
      consultationFee: 650,
      bio: "Treats knee, shoulder and spine concerns with a practical rehabilitation-first approach.",
      languages: ["Hindi", "English"],
      rating: 4.7,
      totalReviews: 98,
    },
  },
  {
    name: "Dr. Naina Kapoor",
    email: "naina.kapoor@alchemisthospital.demo",
    department: "Neurology",
    profilePhoto: "https://images.unsplash.com/photo-1594824476967-48c8b964273f?auto=format&fit=crop&w=400&q=80",
    doctorProfile: {
      qualification: "DM Neurology",
      specialization: "Stroke and Headache Medicine",
      experience: 13,
      registrationNumber: "HNMC-50177",
      consultationFee: 900,
      bio: "Special interest in migraine, stroke prevention and long-term neurological rehabilitation.",
      languages: ["Hindi", "English"],
      rating: 4.9,
      totalReviews: 142,
    },
  },
  {
    name: "Dr. Rohan Batra",
    email: "rohan.batra@alchemisthospital.demo",
    department: "Paediatrics",
    profilePhoto: "https://images.unsplash.com/photo-1537368910025-700350fe46c7?auto=format&fit=crop&w=400&q=80",
    doctorProfile: {
      qualification: "MD Paediatrics",
      specialization: "Child Health and Vaccination",
      experience: 9,
      registrationNumber: "HNMC-41882",
      consultationFee: 550,
      bio: "Warm paediatric care for fever, allergies, nutrition, vaccination and child development concerns.",
      languages: ["Hindi", "English", "Punjabi"],
      rating: 4.8,
      totalReviews: 111,
    },
  },
];

const upsertAcceptedStaff = async ({ hospital, department, staff }) => {
  let member = await HospitalStaff.findOne({ hospitalId: hospital._id, email: staff.email });

  if (!member) {
    member = new HospitalStaff({
      hospitalId: hospital._id,
      departmentIds: department ? [department._id] : [],
      name: staff.name,
      email: staff.email,
      phone: staff.phone,
      profilePhoto: staff.profilePhoto,
      role: staff.role || "DOCTOR",
      doctorProfile: staff.doctorProfile,
      password,
      inviteStatus: "accepted",
      joinedAt: new Date(),
      isActive: true,
    });
  } else {
    member.departmentIds = department ? [department._id] : member.departmentIds;
    member.name = staff.name;
    member.profilePhoto = staff.profilePhoto;
    member.role = staff.role || member.role;
    member.doctorProfile = staff.doctorProfile || member.doctorProfile;
    member.inviteStatus = "accepted";
    member.joinedAt = member.joinedAt || new Date();
    member.isActive = true;
  }

  await member.save();
  return member;
};

const main = async () => {
  await connectMongo(process.env.DATABASE_URL);

  const hospital = await Hospital.findOneAndUpdate(
    { email: alchemistHospital.email },
    { $set: alchemistHospital },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );

  const departmentByName = new Map();
  for (const departmentInput of departments) {
    const department = await Department.findOneAndUpdate(
      { hospitalId: hospital._id, name: departmentInput.name },
      { $set: { ...departmentInput, hospitalId: hospital._id, status: "active" } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
    departmentByName.set(department.name, department);
  }

  const doctorMembers = [];
  for (const doctor of doctors) {
    const department = departmentByName.get(doctor.department);
    const member = await upsertAcceptedStaff({ hospital, department, staff: doctor });
    doctorMembers.push({ member, department });
  }

  const admin = await upsertAcceptedStaff({
    hospital,
    staff: {
      name: "Alchemist Hospital Admin",
      email: alchemistHospital.email,
      phone: alchemistHospital.phone,
      profilePhoto: alchemistHospital.branding.logo,
      role: "HOSPITAL_ADMIN",
    },
  });

  for (const { member, department } of doctorMembers) {
    department.opd.timings = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => ({
      day,
      startTime: "09:00",
      endTime: "14:00",
      doctorIds: [member._id],
    }));
    department.headDoctorId = member._id;
    await department.save();
  }

  await Hospital.findByIdAndUpdate(hospital._id, {
    "stats.totalDoctors": doctorMembers.length,
    "stats.totalDepartments": departments.length,
    "stats.avgRating": 4.8,
    "stats.totalReviews": 477,
  });

  console.log("Alchemist Hospital demo data ready");
  console.log(`Hospital ID: ${hospital._id}`);
  console.log(`Hospital Admin: ${admin.email}`);
  console.log(`Demo Staff Password: ${password}`);
  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error("Alchemist seed failed:", error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
