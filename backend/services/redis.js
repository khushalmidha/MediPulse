import Redis from "ioredis";

let redisClient;

const memoryValues = new Map();
const memoryExpiries = new Map();
const memorySortedSets = new Map();

const now = () => Date.now();

const isExpired = (key) => {
  const expiresAt = memoryExpiries.get(key);
  return typeof expiresAt === "number" && expiresAt <= now();
};

const clearExpiredKey = (key) => {
  if (isExpired(key)) {
    memoryValues.delete(key);
    memoryExpiries.delete(key);
    memorySortedSets.delete(key);
    return true;
  }

  return false;
};

const parseSetOptions = (args) => {
  const options = {
    expiryMs: null,
    nx: false,
    xx: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const mode = String(args[index]).toUpperCase();
    if (mode === "NX") {
      options.nx = true;
      continue;
    }
    if (mode === "XX") {
      options.xx = true;
      continue;
    }
    if (mode === "PX" && index + 1 < args.length) {
      const value = Number(args[index + 1]);
      if (Number.isFinite(value)) {
        options.expiryMs = value;
      }
      index += 1;
      continue;
    }
    if (mode === "EX" && index + 1 < args.length) {
      const value = Number(args[index + 1]);
      if (Number.isFinite(value)) {
        options.expiryMs = value * 1000;
      }
      index += 1;
    }
  }

  return options;
};

const memorySet = async (key, value, ...args) => {
  clearExpiredKey(key);
  const options = parseSetOptions(args);

  if (options.nx && memoryValues.has(key)) {
    return null;
  }

  if (options.xx && !memoryValues.has(key)) {
    return null;
  }

  memoryValues.set(key, value);
  memorySortedSets.delete(key);

  if (options.expiryMs) {
    memoryExpiries.set(key, now() + options.expiryMs);
  } else {
    memoryExpiries.delete(key);
  }

  return "OK";
};

const memoryGet = async (key) => {
  if (clearExpiredKey(key)) {
    return null;
  }

  return memoryValues.has(key) ? memoryValues.get(key) : null;
};

const memoryIncr = async (key) => {
  clearExpiredKey(key);
  const current = Number(memoryValues.get(key) || 0);
  const next = current + 1;
  memoryValues.set(key, String(next));
  return next;
};

const memoryExpire = async (key, seconds) => {
  clearExpiredKey(key);
  if (!memoryValues.has(key)) return 0;
  memoryExpiries.set(key, now() + Number(seconds) * 1000);
  return 1;
};

const memoryTtl = async (key) => {
  clearExpiredKey(key);
  if (!memoryValues.has(key)) return -2;
  const expiresAt = memoryExpiries.get(key);
  if (!expiresAt) return -1;
  return Math.max(0, Math.ceil((expiresAt - now()) / 1000));
};

const memoryDel = async (...keys) => {
  let removed = 0;
  for (const key of keys) {
    if (memoryValues.delete(key)) removed += 1;
    if (memoryExpiries.delete(key)) removed += 1;
    if (memorySortedSets.delete(key)) removed += 1;
  }

  return removed;
};

const memoryZAdd = async (key, ...args) => {
  let set = memorySortedSets.get(key);
  if (!set) {
    set = new Map();
    memorySortedSets.set(key, set);
  }

  let added = 0;
  for (let index = 0; index < args.length - 1; index += 2) {
    const score = Number(args[index]);
    const member = String(args[index + 1]);
    if (!set.has(member)) {
      added += 1;
    }
    set.set(member, score);
  }

  return added;
};

const memoryZRem = async (key, ...members) => {
  const set = memorySortedSets.get(key);
  if (!set) return 0;

  let removed = 0;
  for (const member of members) {
    if (set.delete(String(member))) {
      removed += 1;
    }
  }

  if (!set.size) {
    memorySortedSets.delete(key);
  }

  return removed;
};

const parseBoundary = (value, fallback) => {
  if (value === "-inf") return Number.NEGATIVE_INFINITY;
  if (value === "+inf") return Number.POSITIVE_INFINITY;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const memoryZRangeByScore = async (key, min, max, ...args) => {
  const set = memorySortedSets.get(key);
  if (!set) return [];

  if (isExpired(key)) {
    memorySortedSets.delete(key);
    return [];
  }

  const lower = parseBoundary(min, Number.NEGATIVE_INFINITY);
  const upper = parseBoundary(max, Number.POSITIVE_INFINITY);
  let offset = 0;
  let count = Infinity;

  for (let index = 0; index < args.length - 2; index += 1) {
    const option = String(args[index]).toUpperCase();
    if (option === "LIMIT") {
      offset = Math.max(0, Number(args[index + 1]) || 0);
      count = Math.max(0, Number(args[index + 2]) || 0);
      break;
    }
  }

  const members = [...set.entries()]
    .filter(([, score]) => score >= lower && score <= upper)
    .sort((left, right) => left[1] - right[1] || left[0].localeCompare(right[0]))
    .map(([member]) => member);

  return members.slice(offset, offset + count);
};

const createMemoryMulti = () => {
  const queue = [];
  const multi = {
    del: (...keys) => {
      queue.push(() => memoryDel(...keys));
      return multi;
    },
    set: (key, value, ...args) => {
      queue.push(() => memorySet(key, value, ...args));
      return multi;
    },
    zrem: (key, ...members) => {
      queue.push(() => memoryZRem(key, ...members));
      return multi;
    },
    exec: async () => {
      const results = [];
      for (const operation of queue) {
        results.push([null, await operation()]);
      }
      return results;
    },
  };

  return multi;
};

const createMemoryRedis = () => ({
  get: memoryGet,
  set: memorySet,
  del: memoryDel,
  eval: async (_script, keyCount, ...args) => {
    if (Number(keyCount) !== 1) return 0;
    const [key, expectedValue] = args;
    const currentValue = await memoryGet(key);
    if (currentValue !== expectedValue) return 0;
    return memoryDel(key);
  },
  incr: memoryIncr,
  expire: memoryExpire,
  ttl: memoryTtl,
  zadd: memoryZAdd,
  zrem: memoryZRem,
  zrangebyscore: memoryZRangeByScore,
  multi: createMemoryMulti,
  on() {
    return this;
  },
});

const getRedis = () => {
  const useRealRedis =
    process.env.NODE_ENV === "production" || process.env.USE_REAL_REDIS === "true";

  if (!useRealRedis) {
    return createMemoryRedis();
  }

  if (!redisClient) {
    redisClient = new Redis(process.env.REDIS_URL || "redis://127.0.0.1:6379", {
      connectTimeout: 5000,
      commandTimeout: 5000,
      lazyConnect: false,
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
    });

    redisClient.on("error", (error) => {
      console.error("Redis error:", error.message);
    });
  }

  return redisClient;
};

const otpKey = (userId, doctorId) => `appointment:otp:${userId}:${doctorId}`;
const passwordResetOtpKey = (role, email) => `password-reset:otp:${role}:${email}`;
const bookingTokenKey = (token) => `appointment:booking-token:${token}`;
const queueCacheKey = (doctorId) => `appointment:queue:${doctorId}`;
const autoRefundSetKey = "appointment:auto-refunds";

export {
  autoRefundSetKey,
  bookingTokenKey,
  getRedis,
  otpKey,
  passwordResetOtpKey,
  queueCacheKey,
};
