import { createClient, RedisClientType } from 'redis';
import dotenv from 'dotenv';
import { logger } from './logger.js'; // ⚡ Integrated centralized logger

dotenv.config();

// We need two distinct connections because a Redis client locked 
// in subscriber mode cannot execute regular commands like PUBLISH.
export let pubClient: RedisClientType;
export let subClient: RedisClientType;

let isInitialized = false;

/**
 * Initializes the Redis pub/sub connectivity layer.
 * This should be awaited at the absolute entry point of the application.
 */
export async function initRedis(): Promise<void> {
  if (isInitialized) return;

  const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

  logger.info({ component: 'RedisCluster', url: redisUrl }, 'Connecting to Redis cluster instance...');

  pubClient = createClient({ url: redisUrl });
  subClient = pubClient.duplicate(); // Clones the configuration mapping safely

  // Setup basic error logging boundaries
  pubClient.on('error', (error) => logger.error({ component: 'RedisPub', error }, 'Redis Publisher Client Error encountered'));
  subClient.on('error', (error) => logger.error({ component: 'RedisSub', error }, 'Redis Subscriber Client Error encountered'));

  // Connect both channels concurrently
  await Promise.all([
    pubClient.connect(),
    subClient.connect()
  ]);

  logger.info(
    { component: 'RedisCluster', status: 'ACTIVE', url: redisUrl }, 
    'Distributed Redis scaling and caching layers successfully established'
  );

  isInitialized = true;
}

export function getRedisClients() {
  if (!pubClient || !subClient) {
    logger.fatal({ component: 'RedisCluster' }, 'Infrastructure retrieval mapping failed. Cluster not initialized.');
    throw new Error('[Redis Infrastructure Failure]: Attempted to retrieve clients before bootstrap initialization.');
  }
  return { pubClient, subClient };
}