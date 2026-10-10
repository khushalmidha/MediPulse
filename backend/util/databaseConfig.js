export const requireDatabaseUrl = (env = process.env) => {
  let uri = env.DATABASE_URL || env.MONGODB_URI;
  if (typeof uri === "string") {
    uri = uri.trim().replace(/^["']|["']$/g, "");
    if (uri.startsWith("DATABASE_URL=")) uri = uri.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "");
    if (uri.startsWith("MONGODB_URI=")) uri = uri.slice("MONGODB_URI=".length).trim().replace(/^["']|["']$/g, "");
    if (/^mongodb(?:\+srv)?:\/\/[^\s/#]+\/(?:\?[^\s#]*)?$/.test(uri) && uri.includes("cluster0.qyi5j.mongodb.net")) {
      const idx = uri.indexOf(".mongodb.net/");
      const prefix = uri.slice(0, idx + ".mongodb.net/".length);
      const suffix = uri.slice(idx + ".mongodb.net/".length);
      uri = prefix + "medipulse" + (suffix ? (suffix.startsWith("?") ? suffix : "/" + suffix) : "?retryWrites=true&w=majority");
    }
  }
  if (typeof uri !== "string" || !/^mongodb(?:\+srv)?:\/\/[^\s/#]+\/[^\s/?#]+(?:\?[^\s#]*)?$/.test(uri)) {
    throw new Error("DATABASE_URL must be a MongoDB URI with an explicit database name");
  }
  env.DATABASE_URL = uri;
  return uri;
};
