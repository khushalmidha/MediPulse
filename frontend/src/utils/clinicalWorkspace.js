export const textValue = value => typeof value === "string" ? value : "";
export const clinicalPatientName = row => textValue(row?.patientDisplayName) || textValue(row?.patientInfo?.name) || (row?.familyMemberId ? "Family patient — name not recorded" : [textValue(row?.user?.firstName), textValue(row?.user?.lastName)].filter(Boolean).join(" ")) || "Patient name not recorded";
export const recordedWait = value => typeof value === "number" && Number.isFinite(value) && value >= 0 ? `Recorded estimate: ${value} min` : "Wait estimate unavailable";
export const queueTitle = queue => `${queue.visitMode === "in_person" ? queue.hospitalName || "Hospital OPD" : "Independent online"} · ${queue.serviceDate || "Date not recorded"} · ${queue.sessionId || "Session not recorded"}`;
export const notesOf = (row, hospital) => textValue(hospital ? row?.consultationNotes : row?.doctorNotes);
export const clinicalMatches = (row, query) => [clinicalPatientName(row), textValue(row?.displayToken), textValue(row?.chiefComplaint)].join(" ").toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
