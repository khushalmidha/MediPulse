# FOXO interview demo — 15 October 2026

## Confirmed account mapping

Use **khushalmidha24@gmail.com as Patient** and **khushalmidha18@gmail.com as Hospital staff / Doctor**. The first email also has separate doctor/staff accounts: choose Patient explicitly. Use different browser profiles for the two sessions. Existing login credentials are preserved.

The second email has an accepted active hospital DOCTOR membership linked to its platform doctor and a paediatric department. Its independent publication/credential state is not changed for this recording. Use the existing hospital page from `/hospitals`, select this doctor and book for the synthetic child. No additional domain is needed.

## Prepared fixture (production execution pending)

- One family profile: **Aarav — Synthetic Demo Child**, born 15 June 2018.
- Three historical hospital visits: routine wellness, fictional mild cough intake, and a follow-up. Dates are 24 September, 5 October and 12 October 2026, relative to the explicit recording date.
- Each visit has a mutually linked completed OPD token and appointment plus a completed encounter. The patient timeline should show three visits, not six duplicate cards. Each note and concern is clearly synthetic; no actual examination, prescription, laboratory result, clinician approval or AI generation is asserted.
- Historical fees are waived with zero amounts. No wallet, transfer, refund, password, existing medical history, doctor publication or verification changes. Today's queue, counters and bookable slots are left available for the recording.

This graph prepares navigation/history. It does **not** feed a hidden response into AI or prove cross-visit retrieval. Live intake/copilot output must come from the actual implemented flow; seeded notes are not AI output. Existing provider availability, consent boundaries, SOAP review and recording/network conditions remain separate checks.

## Short screen sequence

1. Patient profile: open `/health-records`, show the synthetic child's three connected records and select that family profile for booking.
2. Hospital page: choose the confirmed paediatric doctor, review the actual fee and current availability, then book once. This new booking uses the existing demo-credit flow; it is not prepaid by this fixture. If funds/availability are insufficient, resolve them through the normal UI before recording.
3. Open the confirmed visit and demonstrate the available intake. Example fictional answers: “This is a synthetic demonstration. My 8-year-old child has had a mild cough and blocked nose for two days; severity 2/10. No breathing difficulty is reported. No medicines, allergies or long-term conditions are reported in this fictional scenario.” Answer further questions honestly within the scenario. Describe the output as a draft for clinician review.
4. In the separate staff profile, open `/hospital/doctor-opd`, select the new booking and demonstrate only the currently available review/copilot controls. Do not claim a prewritten fixture was generated live. Never mark fictional clinical material as a real reviewed medical record.

For the interview, explain your actual contributions and what you learned. This repository uses React/Vite, Express/Mongoose, MongoDB, Redis and provider clients; do not claim a locally trained ranking model or measured diagnostic accuracy from the demo. Personal introduction and “why FOXO” should use your own verified background and interests.

## Execution / recovery

`backend/scripts/prepareFoxoDemo.js` defaults to a read-only plan, requires an explicit target/date and writes a private EJSON file outside the checkout. It never loads deployment `.env` automatically. The reviewed plan is guarded by its hash and current account/family/staff/hospital/department snapshots. One Mongo transaction appends the family, inserts nine documents and records the run; failure rolls all changes back. Replays verify the inserted documents and family without duplicating or overwriting them. Changed/archived identities, later clinical edits and occupied token numbers require a new review.

Dry run (set `DATABASE_URL` privately to the explicit target first):

```powershell
node backend/scripts/prepareFoxoDemo.js --explicit-target --date 2026-10-15 --plan C:\private\foxo-plan.ejson
```

Production apply requires **separate approval of this exact graph and paused writers**, as required by the prompt pack's Common instructions. Then set `FOXO_DEMO_APPROVED=true` privately and supply the same plan with `--apply --writers-paused --backup C:\private\foxo-patient-backup.ejson`. Paths must be absolute and outside the checkout; existing files are not overwritten. Keep the backup private: it contains the pre-change patient record. No credentials or private source records go in Git or command output.

After recording, retain the synthetic visits and archive the synthetic family through the normal patient UI when no live bookings remain. This keeps all history connected. No automatic production deletion, generic rollback over newer records, financial edits or mail/provider jobs are included.
