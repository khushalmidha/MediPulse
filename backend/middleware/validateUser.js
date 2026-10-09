import { authenticateRequest } from "../services/authSessions.js";
const userValidation = async (req, res, next) => {
  try {
    const { principal, kind } = await authenticateRequest(req, "account");
    req.auth = { id: String(principal._id), role: kind, name: [principal.firstName, principal.lastName].filter(Boolean).join(" ") };
    next();
  } catch (error) { next(error); }
};
export default userValidation;
