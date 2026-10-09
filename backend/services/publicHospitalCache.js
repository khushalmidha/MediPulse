import { getRedis } from "./redis.js";

export const invalidatePublicHospitalCache = async (hospital) => {
  const hosts = [hospital.slug, hospital.websiteConfig?.customDomain].filter(Boolean);
  const keys = hosts.flatMap((host) => [`hospital:public:${host}`, `hospital:public:v2:${host}`]);
  if (keys.length) await getRedis().del(...keys);
};
