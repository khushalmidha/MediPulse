import jwt from "jsonwebtoken";
import HospitalStaff from "../model/hospitalStaff.js";

const validateStaff = async (req, res, next) => {
  const token = req.cookies.staffToken || req.cookies.token || req.headers.authorization?.replace(/^Bearer\s+/i, "");

  if (!token) {
    return res.status(401).json({ message: "Staff token is required" });
  }

  jwt.verify(token, process.env.TOKEN_KEY, async (err, data) => {
    if (err) {
      return res.status(401).json({ message: err.message || "Expired or invalid staff token" });
    }

    if (data.type !== "staff" || !data.hospitalId) {
      return res.status(401).json({ message: "Invalid staff session" });
    }

    const staff = await HospitalStaff.findOne({
      _id: data.id,
      hospitalId: data.hospitalId,
      isActive: true,
    });

    if (!staff) {
      return res.status(401).json({ message: "Staff account is inactive or missing" });
    }

    req.staff = {
      id: staff._id.toString(),
      hospitalId: staff.hospitalId.toString(),
      role: staff.role,
      adminAccess: Boolean(staff.adminAccess),
      name: staff.name,
      departmentIds: staff.departmentIds.map((departmentId) => departmentId.toString()),
    };

    next();
  });
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
