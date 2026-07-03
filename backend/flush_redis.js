require('dotenv').config();
const redis = require('./src/utils/redisClient');

async function flush() {
  if (redis.status !== 'ready') {
    await new Promise((resolve) => {
      redis.once('ready', resolve);
    });
  }
  try {
    console.log('Flushing Redis cache...');
    const result = await redis.flushall();
    console.log('Redis flushall result:', result);
  } catch (err) {
    console.error('Error flushing Redis:', err);
  } finally {
    redis.disconnect();
    redis.subscriber.disconnect();
  }
}

flush();
