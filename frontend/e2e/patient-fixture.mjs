// Synthetic patient contracts only; no providers, database, medical users or real records.
export async function handlePatient({ req, state, reply, hospitalId }) {
  if (!state.patientCare) return false;
  const url = new URL(req.url, "http://127.0.0.1:19080"), path = url.pathname, respond = (body, status = 200) => { reply(body, status); return true; };
  const familyId = "000000000000000000000009", hospital = { _id: hospitalId, slug: "fixture", name: "Fixture Hospital", address: { city: "Fixture City", state: "Fixture State" }, medicineSystem: "allopathic", branding: { tagline: "Synthetic hospital profile" }, stats: { avgRating: 0, totalReviews: 0 } };
  if (path === "/api/hospitals") {
    state.hospitalSearches ||= []; state.hospitalSearches.push(Object.fromEntries(url.searchParams));
    if (state.failHospitalSearch) return respond({ message: "Synthetic hospital search outage" }, 503);
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1), city = url.searchParams.get("city"), name = url.searchParams.get("name"), system = url.searchParams.get("medicineSystem");
    const match = (!city || city === "Fixture City") && (!name || /fixture/i.test(name)) && (!system || system === "allopathic");
    const rows = state.manyHospitals ? Array.from({ length: 13 }, (_, index) => ({ ...hospital, _id: hospitalId + "-" + index, name: "Fixture Hospital " + (index + 1) })) : [hospital];
    return respond({ items: match ? rows.slice((page - 1) * 12, page * 12) : [], total: match ? rows.length : 0, page, limit: 12 });
  }
  const family = () => state.patientFamily ?? [{ _id: familyId, name: "Synthetic Child", relation: "Child", bloodGroup: "O+" }];
  if (path.startsWith("/api/patients/me/")) {
    if (state.denyPatientRecords) return respond({ message: "Synthetic patient access revoked" }, Number(state.denyPatientRecords));
    if (state.failPatientRecords) return respond({ message: "Synthetic private records outage" }, 503);
    if (req.method === "GET") {
      if (path.endsWith("family")) return respond({ items: family() });
      if (path.endsWith("hospitals")) return state.failVisitedHospitals ? respond({ message: "Synthetic visited hospitals outage" }, 503) : respond({ items: state.emptyPatient ? [] : [hospital] });
      if (path.endsWith("health-timeline")) {
        const rows = [{ id: "000000000000000000000011", type: "opd_token", title: state.patientTitle || "Synthetic hospital record", subtitle: "Fixture OPD · T001", familyMemberId: familyId, status: "completed", visitMode: "in_person", date: "2026-10-10T09:00:00Z", chiefComplaint: "Synthetic recorded concern", vitals: { pulse: 0 }, patientBrief: { agentSummary: "Synthetic assistant draft", predictedDisease: "Synthetic unconfirmed suggestion" } },
          { id: "000000000000000000000012", type: "appointment", title: "Synthetic online record", subtitle: "Online consultation", familyMemberId: null, status: "completed", date: "not-a-date", doctorNotes: "Synthetic saved consultation note", receiptText: "Synthetic draft consultation text" }];
        const items = state.emptyPatient ? [] : state.manyRecords ? Array.from({ length: 10 }, (_, index) => ({ ...rows[1], id: String(index), title: "Synthetic record " + index })) : rows;
        if (state.patientReadDelay) await new Promise(resolve => setTimeout(resolve, state.patientReadDelay));
        return respond({ items });
      }
    }
    if (req.headers["x-csrf-token"] !== "fixture-account-csrf") return respond({ message: "Invalid synthetic patient CSRF" }, 403);
    if (req.method === "POST" && path.endsWith("family")) {
      let raw = ""; for await (const chunk of req) raw += chunk; const body = JSON.parse(raw || "{}");
      state.familySaves = (state.familySaves || 0) + 1; state.familyPayload = body;
      if (state.patientMutationDelay) await new Promise(resolve => setTimeout(resolve, state.patientMutationDelay));
      if (state.failFamilySave) return respond({ message: "Synthetic family save outage" }, 503);
      state.patientFamily = [...family(), { ...body, _id: "000000000000000000000010" }];
      return respond({ message: "Family profile saved", items: state.patientFamily }, 201);
    }
    if (req.method === "DELETE") {
      state.familyRemovals = (state.familyRemovals || 0) + 1;
      if (state.failFamilyRemove) return respond({ message: "Synthetic profile removal outage" }, 503);
      state.patientFamily = family().filter(row => row._id !== path.split("/").at(-1));
      return respond({ message: "Family profile removed", items: state.patientFamily });
    }
  }
  if (path.startsWith("/api/triage/")) {
    if (state.denyTriage) return respond({ message: "Synthetic visit access revoked" }, Number(state.denyTriage));
    if (path.includes("/start/")) {
      if (state.failTriageStart) return respond({ message: "Synthetic questions unavailable" }, 503);
      state.triageLanguage = url.searchParams.get("lang"); return respond({ message: "Synthetic first question", isBriefReady: false });
    }
    let raw = ""; for await (const chunk of req) raw += chunk; const body = JSON.parse(raw || "{}");
    if (req.headers["x-csrf-token"] !== "fixture-account-csrf") return respond({ message: "Invalid synthetic triage CSRF" }, 403);
    if (path.endsWith("smart-booking")) {
      state.smartRequests = (state.smartRequests || 0) + 1; state.smartSymptoms = body.symptoms;
      if (state.failSmart) return respond({ message: "Synthetic routing unavailable" }, 503);
      return respond({ disease: "Synthetic draft suggestion", specialty: "Synthetic Specialty", severity: state.urgentRouting ? "HIGH" : "MEDIUM", esi_level: state.urgentRouting ? 2 : 4, disclaimer: "Synthetic provider disclaimer", ranked_doctors: state.noRoutingProfiles ? [] : [{ _id: "000000000000000000000001", name: "Fixture Doctor", specialty: "General Medicine", experience: 0, fee: 500 }] });
    }
    if (path.includes("/message/")) {
      state.triageMessages = (state.triageMessages || 0) + 1; state.lastTriageAnswer = body;
      if (state.patientMutationDelay) await new Promise(resolve => setTimeout(resolve, state.patientMutationDelay));
      if (state.failTriageSend) return respond({ message: "Synthetic reply unavailable" }, 503);
      return respond({ message: "Synthetic draft is ready", isBriefReady: true });
    }
    if (path.includes("/complete/")) {
      state.triageCompletions = (state.triageCompletions || 0) + 1;
      if (state.failTriageComplete) return respond({ message: "Synthetic draft save unavailable" }, 503);
      return respond({ patientBrief: { agentSummary: "Synthetic saved assistant draft", predictedDisease: "Synthetic unconfirmed suggestion" } });
    }
  }
  if (path === "/api/reviews" && req.method === "POST") {
    if (req.headers["x-csrf-token"] !== "fixture-account-csrf") return respond({ message: "Invalid synthetic review CSRF" }, 403);
    let raw = ""; for await (const chunk of req) raw += chunk; const body = JSON.parse(raw || "{}");
    state.reviewRequests = (state.reviewRequests || 0) + 1; state.reviewPayload = { ...body, sig: "[synthetic-redacted]" };
    if (state.patientMutationDelay) await new Promise(resolve => setTimeout(resolve, state.patientMutationDelay));
    if (state.failPatientReview) return respond({ message: "Synthetic review submission outage" }, 503);
    if (state.existingPatientReview) return respond({ message: "You already reviewed this visit" }, 409);
    if (state.invalidPatientReview) return respond({ message: "Review link is invalid or expired" }, 403);
    return respond({ message: "Review submitted", review: { status: "published" } }, 201);
  }
  return false;
}
