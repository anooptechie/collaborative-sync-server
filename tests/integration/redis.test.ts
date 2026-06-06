import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createClient } from 'redis';

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

let client: ReturnType<typeof createClient>;

beforeAll(async () => {
  client = createClient({ url: REDIS_URL });
  await client.connect();
});

afterAll(async () => {
  await client.flushDb(); // Clean up all test keys
  await client.disconnect();
});

beforeEach(async () => {
  await client.flushDb(); // Fresh state before each test
});

describe('Redis Integration', () => {

  // ✅ BASIC CONNECTIVITY
  describe('Connectivity', () => {
    it('should connect and respond to ping', async () => {
      const result = await client.ping();
      expect(result).toBe('PONG');
    });
  });

  // ✅ HASH OPERATIONS (room state storage)
  describe('Hash Operations — room state cache', () => {
    it('should set and get a room state hash', async () => {
      const state = JSON.stringify({ text: 'Hello World', cursor: { x: 10, y: 20 } });

      await client.hSet('room:state:test-room', 'document', state);
      const result = await client.hGet('room:state:test-room', 'document');

      expect(result).toBe(state);
    });

    it('should return null for non-existent room state', async () => {
      const result = await client.hGet('room:state:nonexistent', 'document');
      expect(result).toBeNull();
    });

    it('should overwrite existing room state on update', async () => {
      const initialState = JSON.stringify({ text: 'Initial' });
      const updatedState = JSON.stringify({ text: 'Updated' });

      await client.hSet('room:state:test-room', 'document', initialState);
      await client.hSet('room:state:test-room', 'document', updatedState);

      const result = await client.hGet('room:state:test-room', 'document');
      expect(result).toBe(updatedState);
    });

    it('should delete room state key', async () => {
      await client.hSet('room:state:test-room', 'document', 'some-state');
      await client.del('room:state:test-room');

      const result = await client.hGet('room:state:test-room', 'document');
      expect(result).toBeNull();
    });
  });

  // ✅ TTL OPERATIONS (sliding 24hr expiry)
  describe('TTL Operations — sliding expiry window', () => {
    it('should set expiry on a key', async () => {
      await client.hSet('room:state:ttl-room', 'document', 'state');
      await client.expire('room:state:ttl-room', 86400);

      const ttl = await client.ttl('room:state:ttl-room');
      expect(ttl).toBeGreaterThan(86390); // Within 10 seconds of 24hrs
      expect(ttl).toBeLessThanOrEqual(86400);
    });

    it('should refresh TTL on each update', async () => {
      await client.hSet('room:state:ttl-room', 'document', 'state');
      await client.expire('room:state:ttl-room', 100); // Short TTL

      // Simulate state update refreshing the TTL
      await client.hSet('room:state:ttl-room', 'document', 'updated-state');
      await client.expire('room:state:ttl-room', 86400); // Reset to full TTL

      const ttl = await client.ttl('room:state:ttl-room');
      expect(ttl).toBeGreaterThan(86390);
    });

    it('should return -1 for key with no expiry', async () => {
      await client.hSet('room:state:no-ttl-room', 'document', 'state');
      const ttl = await client.ttl('room:state:no-ttl-room');
      expect(ttl).toBe(-1);
    });
  });

  // ✅ PUB/SUB OPERATIONS (cross-instance messaging)
  describe('Pub/Sub Operations — distributed message routing', () => {
    it('should publish and receive a message on a channel', async () => {
      const subClient = createClient({ url: REDIS_URL });
      await subClient.connect();

      const received: string[] = [];

      await subClient.subscribe('room:integration-test', (message) => {
        received.push(message);
      });

      // Small delay to ensure subscription is active
      await new Promise(resolve => setTimeout(resolve, 100));

      await client.publish('room:integration-test', JSON.stringify({
        event: 'update',
        sender: 'user-1',
        payload: { cursorX: 50, cursorY: 75 }
      }));

      // Wait for message to arrive
      await new Promise(resolve => setTimeout(resolve, 100));

      await subClient.unsubscribe('room:integration-test');
      await subClient.disconnect();

      expect(received).toHaveLength(1);
      const parsed = JSON.parse(received[0]);
      expect(parsed.event).toBe('update');
      expect(parsed.sender).toBe('user-1');
    });

    it('should not receive messages after unsubscribing', async () => {
      const subClient = createClient({ url: REDIS_URL });
      await subClient.connect();

      const received: string[] = [];

      await subClient.subscribe('room:unsub-test', (message) => {
        received.push(message);
      });

      await subClient.unsubscribe('room:unsub-test');

      await new Promise(resolve => setTimeout(resolve, 100));

      await client.publish('room:unsub-test', 'should-not-arrive');

      await new Promise(resolve => setTimeout(resolve, 100));
      await subClient.disconnect();

      expect(received).toHaveLength(0);
    });

    it('should handle multiple subscribers on the same channel', async () => {
      const sub1 = createClient({ url: REDIS_URL });
      const sub2 = createClient({ url: REDIS_URL });
      await sub1.connect();
      await sub2.connect();

      const received1: string[] = [];
      const received2: string[] = [];

      await sub1.subscribe('room:multi-test', (msg) => received1.push(msg));
      await sub2.subscribe('room:multi-test', (msg) => received2.push(msg));

      await new Promise(resolve => setTimeout(resolve, 100));

      await client.publish('room:multi-test', 'broadcast-message');

      await new Promise(resolve => setTimeout(resolve, 100));

      await sub1.unsubscribe('room:multi-test');
      await sub2.unsubscribe('room:multi-test');
      await sub1.disconnect();
      await sub2.disconnect();

      expect(received1).toHaveLength(1);
      expect(received2).toHaveLength(1);
      expect(received1[0]).toBe('broadcast-message');
      expect(received2[0]).toBe('broadcast-message');
    });
  });
});