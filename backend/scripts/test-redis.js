/**
 * scripts/test-redis.js
 * Inspects the live Upstash/Redis instance statistics and configs.
 */
require('dotenv').config();
const redis = require('../src/utils/redisClient');

async function main() {
  console.log('\n🔌 Connecting to Redis...');
  
  if (redis.status !== 'ready') {
    await new Promise((resolve, reject) => {
      redis.once('ready', resolve);
      redis.once('error', reject);
      // set a timeout just in case
      setTimeout(() => reject(new Error('Connection timeout')), 5000);
    });
  }

  try {
    const ping = await redis.ping();
    console.log(`✅  Ping: ${ping}`);

    // Get memory info
    const infoMemory = await redis.info('memory');
    console.log('\n📊  Redis Memory Info:');
    console.log(infoMemory);

    // Get stats info
    const infoStats = await redis.info('stats');
    console.log('\n📈  Redis Stats:');
    console.log(infoStats);

    // Eviction Policy
    try {
      const policy = await redis.config('GET', 'maxmemory-policy');
      console.log('\n🔒  Eviction Policy:', policy);
    } catch (e) {
      console.warn('\n⚠️  CONFIG GET not supported (typical on Upstash/managed Redis):', e.message);
    }

  } catch (err) {
    console.error('✖ Redis test failed:', err.message);
  } finally {
    redis.disconnect();
    redis.subscriber.disconnect();
    process.exit(0);
  }
}

main();
