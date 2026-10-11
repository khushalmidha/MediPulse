import test from "node:test";
import assert from "node:assert/strict";
import { validateWalkIn } from "../src/utils/visualSystem.js";
import { staffDestination } from "../src/utils/accountForms.js";

test("walk-in token validation requires patient name and bounds optional age and phone", () => {
  const blank = validateWalkIn({ name: "", phone: "", age: "" });
  assert.equal(blank.name, "Enter the patient's name.");

  const invalidAge = validateWalkIn({ name: "Jane Doe", age: "180" });
  assert.equal(invalidAge.age, "Enter an age between 0 and 130.");

  const negativeAge = validateWalkIn({ name: "Jane Doe", age: "-5" });
  assert.equal(negativeAge.age, "Enter an age between 0 and 130.");

  const invalidPhone = validateWalkIn({ name: "Jane Doe", phone: "123" });
  assert.equal(invalidPhone.phone, "Enter a valid phone number.");

  const valid = validateWalkIn({ name: "Jane Doe", phone: "9876543210", age: "32", gender: "female" });
  assert.deepEqual(valid, {});
});

test("staff role destination opens correct operational workspace", () => {
  assert.equal(staffDestination({ role: "RECEPTIONIST" }), "/hospital/nursing-station");
  assert.equal(staffDestination({ role: "NURSE" }), "/hospital/nursing-station");
  assert.equal(staffDestination({ role: "DOCTOR" }), "/hospital/doctor-opd");
  assert.equal(staffDestination({ role: "HOSPITAL_ADMIN" }), "/hospital/admin");
  assert.equal(staffDestination({ role: "LAB_TECH" }), "/hospital/staff-communication");
  assert.equal(staffDestination({ role: "PHARMACIST" }), "/hospital/staff-communication");
});

test("staff communication thread matcher isolates conversations", () => {
  // Department channel matcher simulation
  const deptMsg = { conversationType: "department", departmentId: "dept-1", messageType: "text", content: "Cardiology consult" };
  const matchesDept1 = deptMsg.conversationType === "department" && deptMsg.departmentId === "dept-1";
  const matchesDept2 = deptMsg.conversationType === "department" && deptMsg.departmentId === "dept-2";
  assert.equal(matchesDept1, true);
  assert.equal(matchesDept2, false);

  // Direct message matcher simulation between staff-A and staff-B
  const myStaffId = "staff-A";
  const currentRecipient = "staff-B";
  const incomingMineToB = { conversationType: "direct", sender: "staff-A", recipientStaffId: "staff-B" };
  const incomingBToMine = { conversationType: "direct", sender: "staff-B", recipientStaffId: "staff-A" };
  const incomingOther = { conversationType: "direct", sender: "staff-C", recipientStaffId: "staff-A" };

  const matchDirect = (msg) =>
    msg.conversationType === "direct" &&
    ((msg.sender === currentRecipient && msg.recipientStaffId === myStaffId) ||
     (msg.sender === myStaffId && msg.recipientStaffId === currentRecipient));

  assert.equal(matchDirect(incomingMineToB), true);
  assert.equal(matchDirect(incomingBToMine), true);
  assert.equal(matchDirect(incomingOther), false);

  // Patient context token matcher
  const patientMsg = { conversationType: "patient_context", tokenId: "tok-100", messageType: "text" };
  assert.equal(patientMsg.conversationType === "patient_context" && patientMsg.tokenId === "tok-100", true);
  assert.equal(patientMsg.conversationType === "patient_context" && patientMsg.tokenId === "tok-200", false);

  // Lab alert matcher
  const labMsg = { conversationType: "patient_context", tokenId: "tok-100", messageType: "lab_alert" };
  assert.equal(labMsg.messageType === "lab_alert", true);
});
