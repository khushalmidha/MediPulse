# MediPulse Walk-in Claim Delivery Contract

**Status:** Specification & Local Test Implementation (Production Activation Pending Approved SMS Provider)  
**Governing Task:** AG05 (P0)  
**Reference:** `docs/ANTIGRAVITY_COMPLETION_PLAN.md` Section 3

---

## 1. Scope & Objective

This contract specifies the security, identity-binding, channel delivery, and operational policies for claiming an unregistered hospital walk-in encounter ticket into an authenticated patient account (or a designated family member's profile under that account).

---

## 2. Core Identity & Phone-Matching Rules

1. **Trusted Recorded Phone (Source of Truth):**
   - The destination phone number for claim verification is derived exclusively from the trusted hospital walk-in record (`OpdToken.patientInfo.phone` recorded at hospital check-in).
   - An account email, caller-supplied alternative phone, or arbitrary request body field **never** establishes ownership of the recorded walk-in identity.
   - If an unregistered walk-in ticket was created without a recorded phone number, self-service automated claim is **strictly disallowed**. The patient must visit hospital reception with their physical token/government ID to link the visit.

2. **Caller Phone Verification:**
   - If the caller supplies a phone number during challenge request, its normalized digits must match the normalized digits (last 10 digits) of the recorded walk-in phone. Any mismatch fails closed with `403 Forbidden`.

3. **Correction Authority for Missing/Incorrect Phone:**
   - Only authorized hospital reception staff (role `RECEPTIONIST` or `ADMIN`) can update or correct a mistyped phone on a walk-in record, via the audited staff encounter update workflow.
   - Self-service online callers cannot overwrite or re-bind the recorded contact phone.

4. **Patient / Family Identity Binding:**
   - A claim challenge is bound at creation to an explicit target identity:
     - **Self:** Account owner (`familyMemberId = ""` or `null`).
     - **Family Member:** A designated family member (`familyMemberId`) proven to belong to the authenticated user's `user.familyMembers` list (and not archived).
   - The verified claim proof token is cryptographically bound to that exact identity. Attempting to link the encounter to another family member or redirecting proof from self to family (or vice-versa) fails closed with `403 Forbidden`.

---

## 3. Delivery Channel & Provider Contract

1. **Provider Abstraction (`backend/services/claimDelivery.js`):**
   - The claim delivery interface defines:
     ```typescript
     interface ClaimDeliveryResult {
       ok: boolean;
       status: "sent" | "failed" | "unconfigured";
       provider: string;
       dispatchedAt?: Date;
       error?: string;
     }
     
     async function sendClaimVerificationCode(options: {
       phone: string;
       otp: string;
       encounterId: string;
       hospitalId: string;
       maskedPhone: string;
     }): Promise<ClaimDeliveryResult>;
     ```
2. **Delivery Status Semantics:**
   - **`unconfigured`:** No approved external SMS provider is configured in the environment. In non-test runtimes without approved provider credentials, the service returns `503 Service Unavailable` before performing database writes.
   - **`sent`:** The delivery provider accepted the SMS payload for transmission to the telecommunications network.
   - **`failed`:** The delivery provider returned an error or the transmission timed out. The service records the failure status and returns `502 Bad Gateway`. A challenge cannot report success or allow verification if delivery failed.
   - **`pending`:** Initial state during challenge creation before dispatch acknowledgement.

3. **No Fake Delivery in Runtime Responses:**
   - The server response never reports "sent" if the delivery channel failed or was unconfigured.
   - `devOtp` is strictly excluded from responses outside isolated test runtimes (`process.env.NODE_ENV === "test"`).

---

## 4. Cryptographic Proof, Expiry & Rate Limits

1. **Server-Generated OTP:**
   - 6-digit random code generated using cryptographic PRNG (`crypto.randomInt(100000, 1000000)`).
   - Any client-supplied `otp` in the challenge request body is rejected or discarded.

2. **Challenge Expiry & Resend Cooldown:**
   - **Challenge Lifetime:** 10 minutes (600,000 ms).
   - **Resend Cooldown:** 60 seconds between requests for the same encounter and user. Attempting to request within 60 seconds returns `429 Too Many Requests`.
   - **Generation Rotation:** Each challenge request increments the challenge generation. An older OTP cannot be consumed against a newer challenge generation.

3. **Wrong Attempt Lockout:**
   - Verification attempts are bounded to a maximum of 5 attempts per challenge generation.
   - If 5 incorrect attempts occur, the challenge is permanently locked out with `429 Too Many Requests`. Subsequent verification attempts are rejected.

4. **Claim Proof Token:**
   - Upon successful OTP verification, the server generates a cryptographically secure 256-bit random proof token (`claimProof`).
   - The SHA-256 hash of the proof token is stored in `EncounterClaimChallenge` with `kind: "proof"`, bound to `encounterId`, `hospitalId`, `userId`, `familyMemberId`, and 10-minute expiry.
   - The plain token is returned once to the caller.

---

## 5. Transactional Consumption & Concurrency Safeguards

1. **Atomic Consumption (Single-Winner Ownership):**
   - Proof consumption and account linking occur inside a MongoDB multi-document transaction (`moneyTransaction`).
   - The proof is conditionally consumed with `{ consumedAt: null, expiresAt: { $gt: now } }`.
   - The walk-in encounter is verified to have `isWalkIn: true` and `linkedUserId: null`.
   - If two accounts attempt to claim the same walk-in ticket concurrently, exactly one succeeds; the competing claim is rejected with `409 Conflict`.

2. **Idempotent Replay Recovery:**
   - If a client experiences network response loss after a successful link, re-submitting the same claim request by the same user with the same proof succeeds idempotently and returns the linked encounter with `isReplay: true`.

3. **Historical Data Preservation:**
   - Linking preserves original walk-in flags (`isWalkIn: true`), original encounter/token timestamps, department, doctor, and counter cash/card payment records (`paymentStatus: "paid"`, `paymentMode`).
   - All related entities (`OpdToken`, `Appointment`, `LabOrder`, `Prescription`) are linked transactionally to the owner's account and designated family member profile.
   - An immutable stage audit entry is appended to `EncounterJourney.stageHistory` recording the linking actor, role (`patient`), and timestamp.

---

## 6. Audit & PII Sanitization

- Full phone numbers and OTP codes are never logged to console or persisted in unencrypted analytics.
- Masked phone display format: `******` followed by the last 4 digits (e.g. `******3210`).
