export const requireDatabaseUrl = (env = process.env) => {
  const uri = env.DATABASE_URL;
  if (typeof uri !== "string" || !/^mongodb(?:\+srv)?:\/\/[^\s/#]+\/[^\s/?#]+(?:\?[^\s#]*)?$/.test(uri)) {
    throw new Error("DATABASE_URL must be a MongoDB URI with an explicit database name");
  }
  return uri;
};
