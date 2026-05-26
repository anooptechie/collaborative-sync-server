import { createClient, RedisClientType } from 'redis';
import dotenv from 'dotenv';

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

  console.log(`[Redis]: Connecting to instance at ${redisUrl}...`);

  pubClient = createClient({ url: redisUrl });
  subClient = pubClient.duplicate(); // Clones the configuration mapping safely

  // Setup basic error logging boundaries
  pubClient.on('error', (err) => console.error('[Redis Pub Client Error]:', err));
  subClient.on('error', (err) => console.error('[Redis Sub Client Error]:', err));

  // Connect both channels concurrently
  await Promise.all([
    pubClient.connect(),
    subClient.connect()
  ]);

  console.log('============= REDIS LAYER ACTIVE =============');
  console.log('[Redis]: PubClient successfully connected.');
  console.log('[Redis]: SubClient successfully connected and ready.');
  console.log('==============================================');

  isInitialized = true;
}

export function getRedisClients() {
  if (!pubClient || !subClient) {
    throw new Error('[Redis Infrastructure Failure]: Attempted to retrieve clients before bootstrap initialization.');
  }
  return { pubClient, subClient };
}