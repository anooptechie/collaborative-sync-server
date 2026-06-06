import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Create a shared mockQuery at module level
const mockQuery = vi.fn();

// Mock pg at the top level with a proper class constructor
vi.mock('pg', () => {
  return {
    default: {
      Pool: class MockPool {
        query = mockQuery;
      },
    },
  };
});

// Mock logger at top level
vi.mock('../../logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  },
}));

describe('dbClient', () => {
  let db: typeof import('../../dbClient.js').db;
  let initDatabase: typeof import('../../dbClient.js').initDatabase;

  beforeEach(async () => {
    vi.resetModules();
    mockQuery.mockReset();

    const module = await import('../../dbClient.js');
    db = module.db;
    initDatabase = module.initDatabase;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ✅ DB QUERY HELPER
  describe('db.query helper', () => {
    it('should execute a query and return results', async () => {
      const mockResult = { rows: [{ id: 1 }], rowCount: 1 };
      mockQuery.mockResolvedValueOnce(mockResult);

      const result = await db.query('SELECT * FROM room_snapshots');
      expect(result).toEqual(mockResult);
      expect(mockQuery).toHaveBeenCalledWith(
        'SELECT * FROM room_snapshots',
        undefined
      );
    });

    it('should pass parameters to the query', async () => {
      const mockResult = { rows: [{ room_id: 'room-1' }], rowCount: 1 };
      mockQuery.mockResolvedValueOnce(mockResult);

      const result = await db.query(
        'SELECT * FROM room_snapshots WHERE room_id = $1',
        ['room-1']
      );

      expect(result).toEqual(mockResult);
      expect(mockQuery).toHaveBeenCalledWith(
        'SELECT * FROM room_snapshots WHERE room_id = $1',
        ['room-1']
      );
    });

    it('should propagate query errors', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Connection refused'));

      await expect(
        db.query('SELECT * FROM room_snapshots')
      ).rejects.toThrow('Connection refused');
    });
  });

  // ✅ INIT DATABASE
  describe('initDatabase', () => {
    it('should create room_snapshots table on init', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await initDatabase();

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS room_snapshots'),
        undefined
      );
    });

    it('should log success after table creation', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const { logger } = await import('../../logger.js');
      await initDatabase();

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ component: 'PostgreSQL' }),
        expect.any(String)
      );
    });

    it('should bypass crash in test environment on DB failure', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB connection failed'));
      process.env.NODE_ENV = 'test';

      await expect(initDatabase()).resolves.toBeUndefined();
    });

    it('should throw in non-test environment on DB failure', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB connection failed'));
      process.env.NODE_ENV = 'production';

      await expect(initDatabase()).rejects.toThrow('DB connection failed');

      process.env.NODE_ENV = 'test';
    });
  });
});