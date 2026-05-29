import pino from 'pino';

// Explicitly check for local development mode
const isDevelopment = process.env.NODE_ENV === 'development';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  // ONLY run pino-pretty if we are explicitly running locally in development mode
  transport: isDevelopment
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          ignore: 'pid,hostname',
          translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l',
        },
      }
    : undefined, // Falls back to standard, ultra-fast JSON lines for production, staging, and test environments
});