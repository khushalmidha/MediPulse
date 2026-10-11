import { authenticateRequest } from "../services/authSessions.js";

const isPlatformAdmin = (principalId) => {
  const allowedIds = (process.env.PLATFORM_ADMIN_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  return allowedIds.includes(String(principalId));
};

/**
 * Requires authenticated platform administrator.
 * Used for cross-tenant operations (listing all tenants, global suspension, global plan edits).
 */
export const requirePlatformOperator = async (req, res, next) => {
  try {
    const { principal } = await authenticateRequest(req, "user");
    req.auth = { id: String(principal._id), name: principal.name, role: "user" };

    if (!isPlatformAdmin(principal._id)) {
      return res.status(403).json({ message: "Platform operator access is required" });
    }

    next();
  } catch (error) {
    return res.status(error.status || 401).json({ message: error.message || "Authentication required" });
  }
};

/**
 * Requires either:
 * 1. Platform operator, OR
 * 2. Authenticated hospital staff belonging to this exact tenant (req.params.id) with HOSPITAL_ADMIN role or adminAccess.
 */
export const requireTenantAdminOrPlatformOperator = async (req, res, next) => {
  const targetHospitalId = req.params.id;

  // 1. Try staff session first
  const staffToken = req.cookies?.staffToken || req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (staffToken) {
    try {
      const { principal: staff } = await authenticateRequest(req, "staff");
      req.staff = {
        id: String(staff._id),
        hospitalId: String(staff.hospitalId),
        role: staff.role,
        adminAccess: Boolean(staff.adminAccess),
        name: staff.name,
      };

      if (String(staff.hospitalId) !== String(targetHospitalId)) {
        return res.status(403).json({ message: "Access denied to foreign hospital workspace" });
      }

      if (staff.role !== "HOSPITAL_ADMIN" && !staff.adminAccess) {
        return res.status(403).json({ message: "Hospital admin privileges required for this action" });
      }

      return next();
    } catch (staffError) {
      // If staff token failed or was expired, fall through to check user/platform operator
    }
  }

  // 2. Try user session (for platform operator)
  try {
    const { principal: user } = await authenticateRequest(req, "user");
    req.auth = { id: String(user._id), name: user.name, role: "user" };

    if (isPlatformAdmin(user._id)) {
      return next();
    }

    return res.status(403).json({ message: "Hospital admin or platform operator privileges required" });
  } catch (userError) {
    return res.status(401).json({ message: "Authentication required for tenant operations" });
  }
};
