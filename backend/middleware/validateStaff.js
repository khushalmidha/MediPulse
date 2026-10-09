import { authenticateRequest } from "../services/authSessions.js";
const validateStaff = async (req, res, next) => {
  try {
    const { principal: staff } = await authenticateRequest(req, "staff");
    req.staff = { id: String(staff._id), hospitalId: String(staff.hospitalId), role: staff.role,
      adminAccess: Boolean(staff.adminAccess), name: staff.name, departmentIds: (staff.departmentIds || []).map(String) };
    next();
  } catch (error) { next(error); }
};

const requireRole = (...roles) => (req, res, next) => {
  if (!req.staff) {
    return res.status(401).json({ message: "Staff authentication is required" });
  }

  if (!roles.includes(req.staff.role) && !(roles.includes("HOSPITAL_ADMIN") && req.staff.adminAccess)) {
    return res.status(403).json({ message: "You do not have permission for this action" });
  }

  next();
};

export { requireRole };
export default validateStaff;
