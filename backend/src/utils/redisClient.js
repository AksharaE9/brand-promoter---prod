const Redis = require("ioredis");
const redisClient = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: null
});

let redisErrorLogged = false;

redisClient.on("error", (err) => {
  if (err.code === "ECONNREFUSED") {
    if (!redisErrorLogged) {
      console.warn(`⚠️ [REDIS CLIENT] Redis is offline (Connection refused at ${process.env.REDIS_URL || "localhost:6379"}). Gracefully falling back to direct database queries.`);
      redisErrorLogged = true;
    }
  } else {
    console.error("Redis Client Error:", err);
  }
});

redisClient.on("connect", () => {
  console.log("Connected to Redis successfully");
  redisErrorLogged = false;
});

// Warm up the connection immediately
redisClient.ping()
  .then(() => console.log("⚡ Redis connection warmed up successfully (ping response received)"))
  .catch((err) => console.warn("⚠️ Redis warmup failed (ping failed):", err.message));

module.exports = redisClient;
