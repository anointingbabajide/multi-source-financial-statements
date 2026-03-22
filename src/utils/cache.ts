import Redis from "ioredis";
import "dotenv/config";

const redis = new Redis(process.env.REDIS_URL as string);
redis.on("connect", () => {
  console.log("Redis connected");
});

redis.on("error", (error) => {
  console.error("Redis error:", error);
});

const getCache = async (key: string): Promise<any | null> => {
  try {
    const cached = await redis.get(key);
    if (!cached) return null;
    return JSON.parse(cached);
  } catch (error) {
    console.error("Cache get error:", error);
    return null;
  }
};

const setCache = async (
  key: string,
  value: any,
  ttlSeconds: number = 86400,
): Promise<void> => {
  try {
    await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
  } catch (error) {
    console.error("Cache set error:", error);
  }
};

const deleteCache = async (key: string): Promise<void> => {
  try {
    await redis.del(key);
  } catch (error) {
    console.error("Cache delete error:", error);
  }
};

export { redis, getCache, setCache, deleteCache };
