import { idOf } from "./hospitalAccess.js";

export function labReviewDepartments(staff) {
  const grant = staff?.labReviewApproval;
  if (!["DOCTOR", "LAB_TECH"].includes(staff?.role) || !grant?.enabled || !grant.approvedBy || !grant.approvedAt || !grant.qualificationReference
    || idOf(grant.approvedBy) === idOf(staff._id || staff.id)) return [];
  return (grant.departmentIds || []).map(idOf).filter(id => (staff.departmentIds || []).some(dept => idOf(dept) === id));
}

export const canReviewLab = (staff, order) => labReviewDepartments(staff).includes(idOf(order.serviceDepartmentId));
