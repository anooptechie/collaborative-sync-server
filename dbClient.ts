import pg from 'pg';
import dotenv from 'dotenv';
import { logger } from './logger.js'; // ⚡ Integrated centralized logger

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
    logger.info(
      { component: 'PostgreSQL', table: 'room_snapshots' }, 
      'Database connection verified and relational baseline table schema is operational'
    );
  } catch (error) {
    logger.error(
      { component: 'PostgreSQL', error }, 
      'Database initialization sequence failed to verify or execute table checks'
    );

    // ⚡ SAFE ISOLATION: Fallback for headless environments or pipeline regression checks
    if (process.env.NODE_ENV === 'test') {
      logger.warn(
        { component: 'PostgreSQL' },
        'Bypassing strict database connection crash requirements due to active test runtime configuration.'
      );
      return; // Gracefully exit without crashing the server process
    }

    throw error;
  }
}