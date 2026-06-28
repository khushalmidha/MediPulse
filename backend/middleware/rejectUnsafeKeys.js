const rejectUnsafeKeys = (value, path = "body") => {
  if (!value || typeof value !== "object") return;

  for (const [key, nested] of Object.entries(value)) {
    if (key.startsWith("$") || key.includes(".")) {
      throw new Error(`Invalid input key at ${path}.${key}`);
    }
    rejectUnsafeKeys(nested, `${path}.${key}`);
  }
};

const rejectUnsafeBodyKeys = (req, res, next) => {
  try {
    rejectUnsafeKeys(req.body);
    next();
  } catch (error) {
    res.status(400).json({ message: error.message || "Invalid request body" });
  }
};

export { rejectUnsafeBodyKeys, rejectUnsafeKeys };
