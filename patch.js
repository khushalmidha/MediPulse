const fs = require('fs');
let code = fs.readFileSync('backend/controller/appointment.js', 'utf8');

const helper = `
const getLinkedDoctorIds = async (doctorId) => {
  const ids = [doctorId.toString()];
  const [platformDoc, staffDoc] = await Promise.all([
    Doctor.findById(doctorId),
    HospitalStaff.findOne({ _id: doctorId, role: "DOCTOR" })
  ]);
  
  if (platformDoc) {
    const linkedStaff = await HospitalStaff.find({ doctorId: platformDoc._id, role: "DOCTOR" }, "_id");
    linkedStaff.forEach(s => ids.push(s._id.toString()));
  }
  
  if (staffDoc && staffDoc.doctorId) {
    ids.push(staffDoc.doctorId.toString());
    const linkedStaff = await HospitalStaff.find({ doctorId: staffDoc.doctorId, role: "DOCTOR" }, "_id");
    linkedStaff.forEach(s => ids.push(s._id.toString()));
  }
  
  return [...new Set(ids)];
};
`;

code = code.replace('const splitName', helper + '\nconst splitName');

// ensureBookableAppointment
code = code.replace(
  '    Appointment.findOne({\n      doctor: doctorId,\n      user: userId,\n      status: { $in: ["queued", "active"] },\n    }),',
  '    getLinkedDoctorIds(doctorId).then(ids => Appointment.findOne({\n      doctor: { $in: ids },\n      user: userId,\n      status: { $in: ["queued", "active"] },\n    })),'
);

code = code.replace(
  '    const pendingCount = await Appointment.countDocuments({\n      doctor: doctorId,\n      status: "queued",\n    });',
  '    const allIds = await getLinkedDoctorIds(doctorId);\n    const pendingCount = await Appointment.countDocuments({\n      doctor: { $in: allIds },\n      status: "queued",\n    });'
);

// buildDoctorQueuePayload
code = code.replace(
  'const buildDoctorQueuePayload = async (doctorId) => {\n  const redis = getRedis();',
  'const buildDoctorQueuePayload = async (doctorId) => {\n  const allIds = await getLinkedDoctorIds(doctorId);\n  const redis = getRedis();'
);
code = code.replace(
  'Appointment.find({ doctor: doctorId, status: "queued" })',
  'Appointment.find({ doctor: { $in: allIds }, status: "queued" })'
);
code = code.replace(
  'Appointment.findOne({ doctor: doctorId, status: "active" })',
  'Appointment.findOne({ doctor: { $in: allIds }, status: "active" })'
);

// queuePositionForAppointment
code = code.replace(
  'const queuePositionForAppointment = async (appointment) =>\n  (await Appointment.countDocuments({\n    doctor: appointment.doctor,\n    status: "queued",',
  'const queuePositionForAppointment = async (appointment) => {\n  const allIds = await getLinkedDoctorIds(appointment.doctor);\n  return (await Appointment.countDocuments({\n    doctor: { $in: allIds },\n    status: "queued",'
);
code = code.replace(
  '    createdAt: { $lte: appointment.createdAt },\n  })) || 1;',
  '    createdAt: { $lte: appointment.createdAt },\n  })) || 1;\n};'
);

// refundAppointmentPayment
code = code.replace(
  '  const isDoctor =\n    req.auth.role === "doctor" && appointment.doctor.toString() === req.auth.id.toString();',
  '  const allIds = await getLinkedDoctorIds(req.auth.id);\n  const isDoctor =\n    req.auth.role === "doctor" && allIds.includes(appointment.doctor.toString());'
);

// bookAppointment pendingCount
code = code.replace(
  '  const pendingCount = await Appointment.countDocuments({\n    doctor: doctorId,\n    status: "queued",\n    createdAt: { $lte: appointment.createdAt },\n  });',
  '  const allIds = await getLinkedDoctorIds(doctorId);\n  const pendingCount = await Appointment.countDocuments({\n    doctor: { $in: allIds },\n    status: "queued",\n    createdAt: { $lte: appointment.createdAt },\n  });'
);

// getDoctorPendingStatus
code = code.replace(
  '  const pendingCount = await Appointment.countDocuments({\n    doctor: doctorId,\n    status: "queued",\n  });',
  '  const allIds = await getLinkedDoctorIds(doctorId);\n  const pendingCount = await Appointment.countDocuments({\n    doctor: { $in: allIds },\n    status: "queued",\n  });'
);
code = code.replace(
  '    const myAppointment = await Appointment.findOne({\n      doctor: doctorId,\n      user: req.auth.id,\n      status: { $in: ["queued", "active"] },\n    })',
  '    const myAppointment = await Appointment.findOne({\n      doctor: { $in: allIds },\n      user: req.auth.id,\n      status: { $in: ["queued", "active"] },\n    })'
);
code = code.replace(
  '            ? await Appointment.countDocuments({\n                doctor: doctorId,\n                status: "queued",',
  '            ? await Appointment.countDocuments({\n                doctor: { $in: allIds },\n                status: "queued",'
);

// getUserAppointmentHistory
code = code.replace(
  '    query.doctor = doctorId;',
  '    query.doctor = { $in: await getLinkedDoctorIds(doctorId) };'
);

// updateDoctorNotes
code = code.replace(
  '  if (appointment.doctor.toString() !== req.auth.id.toString()) {\n    return res.status(403).json({ message: "You cannot update this appointment" });\n  }',
  '  const allIds = await getLinkedDoctorIds(req.auth.id);\n  if (!allIds.includes(appointment.doctor.toString())) {\n    return res.status(403).json({ message: "You cannot update this appointment" });\n  }'
);

// generateAppointmentReceipt
code = code.replace(
  '  if (appointment.doctor._id.toString() !== req.auth.id.toString()) {\n    return res.status(403).json({ message: "You cannot generate receipt for this appointment" });\n  }',
  '  const allIds = await getLinkedDoctorIds(req.auth.id);\n  if (!allIds.includes(appointment.doctor._id.toString())) {\n    return res.status(403).json({ message: "You cannot generate receipt for this appointment" });\n  }'
);

// getAppointmentById
code = code.replace(
  '    req.auth.role === "doctor" &&\n    appointment.doctor?._id?.toString() === req.auth.id.toString();',
  '    req.auth.role === "doctor" &&\n    (await getLinkedDoctorIds(req.auth.id)).includes(appointment.doctor?._id?.toString());'
);

// startAppointment
code = code.replace(
  '  if (appointment.doctor.toString() !== req.auth.id.toString()) {\n    return res.status(403).json({ message: "You cannot start this appointment" });\n  }',
  '  const allIds = await getLinkedDoctorIds(req.auth.id);\n  if (!allIds.includes(appointment.doctor.toString())) {\n    return res.status(403).json({ message: "You cannot start this appointment" });\n  }'
);
code = code.replace(
  '  const firstInQueue = await Appointment.findOne({\n    doctor: req.auth.id,\n    status: "queued",\n  })',
  '  const firstInQueue = await Appointment.findOne({\n    doctor: { $in: allIds },\n    status: "queued",\n  })'
);

// endAppointment
code = code.replace(
  '  if (appointment.doctor.toString() !== req.auth.id.toString()) {\n    return res.status(403).json({ message: "You cannot end this appointment" });\n  }',
  '  const allIds = await getLinkedDoctorIds(req.auth.id);\n  if (!allIds.includes(appointment.doctor.toString())) {\n    return res.status(403).json({ message: "You cannot end this appointment" });\n  }'
);

fs.writeFileSync('backend/controller/appointment.js', code);
console.log('Successfully patched appointment.js!');
