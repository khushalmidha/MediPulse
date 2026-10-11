// Clinical and ledger records reference these identities. A profile route cannot
// safely erase them; P17 supplies the reviewed account lifecycle/retention flow.
export function requireReviewedAccountRemoval(req, res, role) {
  if (!req.auth) return res.status(401).json({ message: "Sign in is required" });
  if (req.auth.role !== role) return res.status(403).json({ message: "This account role cannot remove this profile" });
  const target = req.params.id;
  if (typeof target !== "string" || !/^[a-f\d]{24}$/i.test(target)) return res.status(400).json({ message: "Valid account id is required" });
  if (target.toLowerCase() !== String(req.auth.id).toLowerCase()) return res.status(403).json({ message: "You can only request removal of your own account" });
  return res.status(409).json({ code: "ACCOUNT_RETENTION_REVIEW_REQUIRED", message: "Account removal requires a reviewed retention plan to preserve visit and payment history." });
}
