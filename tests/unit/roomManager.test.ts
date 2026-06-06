import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSocket } from 'ws';

// ─── Mock Redis clients ───────────────────────────────────────────────────────
const mockHGet = vi.fn();
const mockHSet = vi.fn();
const mockExpire = vi.fn();
const mockDel = vi.fn();
const mockPublish = vi.fn();
const mockSubscribe = vi.fn();
const mockUnsubscribe = vi.fn();

vi.mock('../../redisClient.js', () => ({
  getRedisClients: () => ({
    pubClient: {
      hGet: mockHGet,
      hSet: mockHSet,
      expire: mockExpire,
      del: mockDel,
      publish: mockPublish,
    },
    subClient: {
      subscribe: mockSubscribe,
      unsubscribe: mockUnsubscribe,
    },
  }),
}));

// ─── Mock PostgreSQL ──────────────────────────────────────────────────────────
const mockDbQuery = vi.fn();

vi.mock('../../dbClient.js', () => ({
  db: { query: mockDbQuery },
}));

// ─── Mock Logger ──────────────────────────────────────────────────────────────
vi.mock('../../logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  },
}));

// ─── Mock Metrics ─────────────────────────────────────────────────────────────
const mockActiveRoomsInc = vi.fn();
const mockActiveRoomsDec = vi.fn();

vi.mock('../../metrics.js', () => ({
  activeRoomsGauge: {
    inc: mockActiveRoomsInc,
    dec: mockActiveRoomsDec,
  },
  activeConnectionsGauge: { inc: vi.fn(), dec: vi.fn() },
  messageCounter: { inc: vi.fn() },
  register: { metrics: vi.fn(), contentType: 'text/plain' },
}));

// ─── Helper: create a mock WebSocket ─────────────────────────────────────────
function createMockWs(): WebSocket {
  return {
    send: vi.fn(),
    readyState: WebSocket.OPEN,
  } as unknown as WebSocket;
}

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('RoomManager', () => {
  let roomManager: typeof import('../../roomManager.js').roomManager;

  beforeEach(async () => {
    vi.resetModules();

    // Reset all mocks
    mockHGet.mockReset();
    mockHSet.mockReset();
    mockExpire.mockReset();
    mockDel.mockReset();
    mockPublish.mockReset();
    mockSubscribe.mockReset();
    mockUnsubscribe.mockReset();
    mockDbQuery.mockReset();
    mockActiveRoomsInc.mockReset();
    mockActiveRoomsDec.mockReset();

    // Default mock resolutions
    mockHGet.mockResolvedValue(null);
    mockHSet.mockResolvedValue('OK');
    mockExpire.mockResolvedValue(1);
    mockDel.mockResolvedValue(1);
    mockPublish.mockResolvedValue(1);
    mockSubscribe.mockResolvedValue(undefined);
    mockUnsubscribe.mockResolvedValue(undefined);
    mockDbQuery.mockResolvedValue({ rows: [], rowCount: 0 });

    const module = await import('../../roomManager.js');
    roomManager = module.roomManager;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ✅ JOIN ROOM
  describe('joinRoom', () => {
    it('should create a new room and subscribe to Redis channel', async () => {
      const ws = createMockWs();
      await roomManager.joinRoom('room-1', 'user-1', ws, 'Anoop');

      expect(mockSubscribe).toHaveBeenCalledWith(
        'room:room-1',
        expect.any(Function)
      );
      expect(mockActiveRoomsInc).toHaveBeenCalledTimes(1);
    });

    it('should not subscribe again when joining existing room', async () => {
      const ws1 = createMockWs();
      const ws2 = createMockWs();

      await roomManager.joinRoom('room-1', 'user-1', ws1, 'Anoop');
      await roomManager.joinRoom('room-1', 'user-2', ws2, 'Gemini');

      // Subscribe should only be called once for the first join
      expect(mockSubscribe).toHaveBeenCalledTimes(1);
      expect(mockActiveRoomsInc).toHaveBeenCalledTimes(1);
    });

    it('should send snapshot to user if Redis has cached state', async () => {
      const cachedState = JSON.stringify({ text: 'Hello World' });
      mockHGet.mockResolvedValueOnce(cachedState);

      const ws = createMockWs();
      await roomManager.joinRoom('room-1', 'user-1', ws, 'Anoop');

      expect(ws.send).toHaveBeenCalledWith(
        expect.stringContaining('"event":"snapshot"')
      );
    });

    it('should hydrate Redis from PostgreSQL on cache miss', async () => {
      mockHGet.mockResolvedValueOnce(null);
      mockDbQuery.mockResolvedValueOnce({
        rows: [{ content: { text: 'Restored content' } }],
        rowCount: 1,
      });

      const ws = createMockWs();
      await roomManager.joinRoom('room-1', 'user-1', ws, 'Anoop');

      expect(mockHSet).toHaveBeenCalledWith(
        'room:state:room-1',
        'document',
        expect.any(String)
      );
      expect(mockExpire).toHaveBeenCalledWith('room:state:room-1', 86400);
      expect(ws.send).toHaveBeenCalledWith(
        expect.stringContaining('"event":"snapshot"')
      );
    });

    it('should not send snapshot if no state in Redis or PostgreSQL', async () => {
      mockHGet.mockResolvedValueOnce(null);
      mockDbQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const ws = createMockWs();
      await roomManager.joinRoom('room-1', 'user-1', ws, 'Anoop');

      // Only user-joined publish should happen, no snapshot
      expect(ws.send).not.toHaveBeenCalledWith(
        expect.stringContaining('"event":"snapshot"')
      );
    });

    it('should broadcast user-joined event to Redis', async () => {
      const ws = createMockWs();
      await roomManager.joinRoom('room-1', 'user-1', ws, 'Anoop');

      expect(mockPublish).toHaveBeenCalledWith(
        'room:room-1',
        expect.stringContaining('"event":"user-joined"')
      );
    });
  });

  // ✅ PUBLISH TO REDIS
  describe('publishToRedis', () => {
    it('should publish update event to Redis channel', async () => {
      await roomManager.publishToRedis('room-1', {
        event: 'update',
        sender: 'user-1',
        payload: { cursorX: 10, cursorY: 20 },
      });

      expect(mockPublish).toHaveBeenCalledWith(
        'room:room-1',
        expect.stringContaining('"event":"update"')
      );
    });

    it('should update Redis cache on sync event', async () => {
      await roomManager.publishToRedis('room-1', {
        event: 'update',
        sender: 'user-1',
        payload: { cursorX: 10, cursorY: 20 },
      });

      expect(mockHSet).toHaveBeenCalledWith(
        'room:state:room-1',
        'document',
        expect.any(String)
      );
      expect(mockExpire).toHaveBeenCalledWith('room:state:room-1', 86400);
    });

    it('should not update cache for non-update events', async () => {
      await roomManager.publishToRedis('room-1', {
        event: 'user-joined',
        sender: 'SYSTEM',
        payload: { participantId: 'user-1' },
      });

      expect(mockHSet).not.toHaveBeenCalled();
    });

    it('should drop invalid payload and not update cache', async () => {
      await roomManager.publishToRedis('room-1', {
        event: 'update',
        sender: 'user-1',
        payload: 'invalid-string-payload',
      });

      expect(mockHSet).not.toHaveBeenCalled();
    });
  });

  // ✅ LEAVE ROOM
  describe('leaveRoom', () => {
    it('should do nothing if room does not exist', async () => {
      await roomManager.leaveRoom('nonexistent-room', 'user-1');
      expect(mockUnsubscribe).not.toHaveBeenCalled();
    });

    it('should flush state to PostgreSQL when last user leaves', async () => {
      const ws = createMockWs();
      await roomManager.joinRoom('room-2', 'user-1', ws, 'Anoop');

      const cachedState = JSON.stringify({ text: 'Final state' });
      mockHGet.mockResolvedValueOnce(cachedState);

      await roomManager.leaveRoom('room-2', 'user-1');

      expect(mockDbQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO room_snapshots'),
        expect.arrayContaining(['room-2'])
      );
    });

    it('should delete Redis key after successful PostgreSQL write', async () => {
      const ws = createMockWs();
      await roomManager.joinRoom('room-3', 'user-1', ws, 'Anoop');

      mockHGet.mockResolvedValueOnce(JSON.stringify({ text: 'data' }));
      mockDbQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await roomManager.leaveRoom('room-3', 'user-1');

      expect(mockDel).toHaveBeenCalledWith('room:state:room-3');
    });

    it('should NOT delete Redis key if PostgreSQL write fails', async () => {
      const ws = createMockWs();
      await roomManager.joinRoom('room-4', 'user-1', ws, 'Anoop');

      mockHGet.mockResolvedValueOnce(JSON.stringify({ text: 'data' }));
      mockDbQuery.mockRejectedValueOnce(new Error('DB write failed'));

      await roomManager.leaveRoom('room-4', 'user-1');

      expect(mockDel).not.toHaveBeenCalled();
    });

    it('should unsubscribe from Redis channel when room is empty', async () => {
      const ws = createMockWs();
      await roomManager.joinRoom('room-5', 'user-1', ws, 'Anoop');
      await roomManager.leaveRoom('room-5', 'user-1');

      expect(mockUnsubscribe).toHaveBeenCalledWith('room:room-5');
      expect(mockActiveRoomsDec).toHaveBeenCalledTimes(1);
    });

    it('should broadcast user-left when other users remain', async () => {
      const ws1 = createMockWs();
      const ws2 = createMockWs();

      await roomManager.joinRoom('room-6', 'user-1', ws1, 'Anoop');
      await roomManager.joinRoom('room-6', 'user-2', ws2, 'Gemini');

      await roomManager.leaveRoom('room-6', 'user-1');

      expect(mockPublish).toHaveBeenCalledWith(
        'room:room-6',
        expect.stringContaining('"event":"user-left"')
      );
    });
  });
});