export const downloadAppointmentReceipt = async appointment => {
  if (!appointment.receiptText) throw new Error("Consultation summary is not available");
  const { default: jsPDF } = await import("jspdf");
  const doc = new jsPDF(), width = doc.internal.pageSize.getWidth(), height = doc.internal.pageSize.getHeight();
  doc.setFont("helvetica", "bold"); doc.setFontSize(17); doc.text("MediPulse", 16, 20);
  doc.setFontSize(12); doc.text(appointment.receiptReviewedAt ? "Consultation summary" : "Draft consultation summary", 16, 30);
  doc.setFont("helvetica", "normal"); doc.setFontSize(10);
  const metadata = ["Visit: " + appointment._id, "Status: " + appointment.status, appointment.createdAt ? "Booked: " + new Date(appointment.createdAt).toLocaleString() : "", appointment.receiptReviewedAt ? "Clinician review recorded" : "Confirm this draft with your clinician before following its advice."].filter(Boolean);
  let y = 40;
  for (const line of [...metadata, "", ...doc.splitTextToSize(appointment.receiptText, width - 32)]) { if (y > height - 18) { doc.addPage(); y = 20; } doc.text(line, 16, y); y += 6; }
  doc.save("MediPulse_Summary_" + appointment._id.slice(-6) + ".pdf");
};
