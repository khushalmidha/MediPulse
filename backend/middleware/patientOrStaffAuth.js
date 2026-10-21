import { authenticateRequest } from "../services/authSessions.js";

export const patientOrStaffAuth = async (req, res, next) => {
  try {
    // Attempt staff authentication first
    try {
      const { principal: staff } = await authenticateRequest(req, "staff");
      if (staff) {
        req.staff = {
          id: String(staff._id),
          hospitalId: String(staff.hospitalId),
          role: staff.role,
          adminAccess: Boolean(staff.adminAccess),
          name: staff.name,
          departmentIds: (staff.departmentIds || []).map(String),
        };
        return next();
      }
    } catch {}

    // Fallback to patient account authentication
    const { principal, kind } = await authenticateRequest(req, "account");
    if (principal) {
      req.auth = {
        id: String(principal._id),
        role: principal.role || kind,
        email: principal.email,
        name: principal.name || `${principal.firstName || ""} ${principal.lastName || ""}`.trim(),
      };
      return next();
    }

    return res.status(401).json({ message: "Authentication required" });
  } catch {
    return res.status(401).json({ message: "Authentication required" });
  }
};

export const optionalPatientOrStaffAuth = async (req, res, next) => {
  const hasToken = req.headers.authorization || req.cookies?.token || req.cookies?.staffToken;
  if (!hasToken) {
    return next();
  }
  // Try staff first
  try {
    const { principal: staff } = await authenticateRequest(req, "staff");
    if (staff) {
      req.staff = {
        id: String(staff._id),
        hospitalId: String(staff.hospitalId),
        role: staff.role,
        adminAccess: Boolean(staff.adminAccess),
        name: staff.name,
        departmentIds: (staff.departmentIds || []).map(String),
      };
      return next();
    }
  } catch {}

  // Fallback to patient account
  try {
    const { principal, kind } = await authenticateRequest(req, "account");
    if (principal) {
      req.auth = {
        id: String(principal._id),
        role: principal.role || kind,
        email: principal.email,
        name: principal.name || `${principal.firstName || ""} ${principal.lastName || ""}`.trim(),
      };
      return next();
    }
  } catch {}

  next();
};

export default patientOrStaffAuth;
