import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

// Neon requires SSL connections, so we enforce it for production/cloud environments
const isProduction = process.env.NODE_ENV === 'production' || process.env.DATABASE_URL?.includes('neon.tech');

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : false,
});

// Helper to execute queries safely with automatic client management
export const db = {
  query: (text: string, params?: any[]) => pool.query(text, params),
};

// Initialize and verify database connectivity
export async function initDatabase() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS room_snapshots (
        room_id VARCHAR(255) PRIMARY KEY,
        content JSONB NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('[PostgreSQL]: Connection verified and room_snapshots table is ready.');
  } catch (error) {
    console.error('[PostgreSQL]: Database initialization failed:', error);
    throw error;
  }
}