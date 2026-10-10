export const requireDatabaseUrl = (env = process.env, { defaultDatabaseName } = {}) => {
  let uri = env.DATABASE_URL || env.MONGODB_URI;
  if (typeof uri === "string") {
    uri = uri.trim().replace(/^["']|["']$/g, "");
    if (uri.startsWith("DATABASE_URL=")) uri = uri.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "");
    if (uri.startsWith("MONGODB_URI=")) uri = uri.slice("MONGODB_URI=".length).trim().replace(/^["']|["']$/g, "");
    const implicit = uri.match(/^(mongodb(?:\+srv)?:\/\/[^\s/#]+\/)(\?[^\s#]*)?$/);
    if (implicit && defaultDatabaseName && /^[a-zA-Z0-9_-]+$/.test(defaultDatabaseName)) {
      uri = implicit[1] + defaultDatabaseName + (implicit[2] || "");
      // A database-less standard URI authenticated against admin; keep that source.
      if (/^mongodb:\/\/[^/]*@/.test(uri) && !/[?&]authSource=/i.test(uri)) uri += (uri.includes("?") ? "&" : "?") + "authSource=admin";
    }
  }
  if (typeof uri !== "string" || !/^mongodb(?:\+srv)?:\/\/[^\s/#]+\/[^\s/?#]+(?:\?[^\s#]*)?$/.test(uri)) {
    throw new Error(typeof uri !== "string" || !uri ? "DATABASE_URL (or MONGODB_URI) is missing" : "DATABASE_URL must be a valid MongoDB URI with an explicit database name");
  }
  env.DATABASE_URL = uri;
  return uri;
};
