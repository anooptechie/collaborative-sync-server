import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const db = {
  query: (text: string, params?: any[]) => pool.query(text, params),
};

beforeAll(async () => {
  // Create test table
  await db.query(`
    CREATE TABLE IF NOT EXISTS room_snapshots (
      room_id VARCHAR(255) PRIMARY KEY,
      content JSONB NOT NULL,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `);
});

afterAll(async () => {
  // Clean up test data and close pool
  await db.query(`DELETE FROM room_snapshots WHERE room_id LIKE 'test-%'`);
  await pool.end();
});

beforeEach(async () => {
  // Clean test rows before each test
  await db.query(`DELETE FROM room_snapshots WHERE room_id LIKE 'test-%'`);
});

describe('PostgreSQL Integration', () => {

  // ✅ CONNECTIVITY
  describe('Connectivity', () => {
    it('should connect and execute a basic query', async () => {
      const result = await db.query('SELECT 1 + 1 AS sum');
      expect(result.rows[0].sum).toBe(2);
    });

    it('should confirm room_snapshots table exists', async () => {
      const result = await db.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_name = 'room_snapshots'
      `);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].table_name).toBe('room_snapshots');
    });
  });

  // ✅ INSERT OPERATIONS
  describe('INSERT Operations', () => {
    it('should insert a room snapshot', async () => {
      const content = { text: 'Hello World', cursor: { x: 10, y: 20 } };

      await db.query(
        `INSERT INTO room_snapshots (room_id, content) VALUES ($1, $2)`,
        ['test-room-1', content]
      );

      const result = await db.query(
        `SELECT * FROM room_snapshots WHERE room_id = $1`,
        ['test-room-1']
      );

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].room_id).toBe('test-room-1');
      expect(result.rows[0].content).toEqual(content);
    });

    it('should store complex nested JSONB content', async () => {
      const content = {
        text: 'Complex document',
        cursors: [
          { userId: 'user-1', x: 10, y: 20 },
          { userId: 'user-2', x: 30, y: 40 },
        ],
        metadata: { version: 3, lastEditor: 'Anoop' },
      };

      await db.query(
        `INSERT INTO room_snapshots (room_id, content) VALUES ($1, $2)`,
        ['test-room-complex', content]
      );

      const result = await db.query(
        `SELECT content FROM room_snapshots WHERE room_id = $1`,
        ['test-room-complex']
      );

      expect(result.rows[0].content).toEqual(content);
    });
  });

  // ✅ UPSERT OPERATIONS (ON CONFLICT DO UPDATE)
  describe('UPSERT Operations — atomic snapshot archival', () => {
    it('should insert on first save', async () => {
      const content = { text: 'First save' };

      await db.query(`
        INSERT INTO room_snapshots (room_id, content, updated_at)
        VALUES ($1, $2, CURRENT_TIMESTAMP)
        ON CONFLICT (room_id)
        DO UPDATE SET content = EXCLUDED.content, updated_at = CURRENT_TIMESTAMP
      `, ['test-upsert-room', content]);

      const result = await db.query(
        `SELECT content FROM room_snapshots WHERE room_id = $1`,
        ['test-upsert-room']
      );

      expect(result.rows[0].content).toEqual(content);
    });

    it('should update on conflict without duplicate rows', async () => {
      const initial = { text: 'Initial content' };
      const updated = { text: 'Updated content' };

      // First insert
      await db.query(`
        INSERT INTO room_snapshots (room_id, content, updated_at)
        VALUES ($1, $2, CURRENT_TIMESTAMP)
        ON CONFLICT (room_id)
        DO UPDATE SET content = EXCLUDED.content, updated_at = CURRENT_TIMESTAMP
      `, ['test-conflict-room', initial]);

      // Second upsert — should update not duplicate
      await db.query(`
        INSERT INTO room_snapshots (room_id, content, updated_at)
        VALUES ($1, $2, CURRENT_TIMESTAMP)
        ON CONFLICT (room_id)
        DO UPDATE SET content = EXCLUDED.content, updated_at = CURRENT_TIMESTAMP
      `, ['test-conflict-room', updated]);

      const result = await db.query(
        `SELECT * FROM room_snapshots WHERE room_id = $1`,
        ['test-conflict-room']
      );

      // Should be exactly one row
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].content).toEqual(updated);
    });

    it('should update updated_at timestamp on upsert', async () => {
      const content = { text: 'Timestamped content' };

      await db.query(`
        INSERT INTO room_snapshots (room_id, content, updated_at)
        VALUES ($1, $2, CURRENT_TIMESTAMP)
        ON CONFLICT (room_id)
        DO UPDATE SET content = EXCLUDED.content, updated_at = CURRENT_TIMESTAMP
      `, ['test-timestamp-room', content]);

      const result = await db.query(
        `SELECT updated_at FROM room_snapshots WHERE room_id = $1`,
        ['test-timestamp-room']
      );

      const updatedAt = new Date(result.rows[0].updated_at);
      const now = new Date();

      // Should be within last 5 seconds
      expect(now.getTime() - updatedAt.getTime()).toBeLessThan(5000);
    });
  });

  // ✅ SELECT OPERATIONS
  describe('SELECT Operations — cache hydration queries', () => {
    it('should return content for existing room', async () => {
      const content = { text: 'Hydration test' };

      await db.query(
        `INSERT INTO room_snapshots (room_id, content) VALUES ($1, $2)`,
        ['test-hydration-room', content]
      );

      const result = await db.query(
        `SELECT content FROM room_snapshots WHERE room_id = $1`,
        ['test-hydration-room']
      );

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].content).toEqual(content);
    });

    it('should return empty rows for non-existent room', async () => {
      const result = await db.query(
        `SELECT content FROM room_snapshots WHERE room_id = $1`,
        ['test-nonexistent-room']
      );

      expect(result.rows).toHaveLength(0);
    });
  });

  // ✅ DELETE OPERATIONS
  describe('DELETE Operations', () => {
    it('should delete a specific room snapshot', async () => {
      await db.query(
        `INSERT INTO room_snapshots (room_id, content) VALUES ($1, $2)`,
        ['test-delete-room', { text: 'to be deleted' }]
      );

      await db.query(
        `DELETE FROM room_snapshots WHERE room_id = $1`,
        ['test-delete-room']
      );

      const result = await db.query(
        `SELECT * FROM room_snapshots WHERE room_id = $1`,
        ['test-delete-room']
      );

      expect(result.rows).toHaveLength(0);
    });
  });
});