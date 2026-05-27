import { IncomingMessage } from 'http';
import { URL } from 'url';
import { logger } from './logger.js'; // ⚡ Integrated centralized logger

interface AuthSession {
  isValid: boolean;
  username: string;
  error?: string;
}

class AuthService {
  private readonly SECRET_TOKEN = 'nexus-sync-super-secret-token';

  public authenticateRequest(req: IncomingMessage): AuthSession {
    try {
      const fakeHost = `http://${req.headers.host || 'localhost'}`;
      const parsedUrl = new URL(req.url || '', fakeHost);
      
      // 1. Try to get token from URL first
      let token = parsedUrl.searchParams.get('token');
      const username = parsedUrl.searchParams.get('username')?.trim() || 'Anoop';

      // 2. FALLBACK: If URL query is stripped by Codespaces, check the Sec-WebSocket-Protocol header
      if (!token && req.headers['sec-websocket-protocol']) {
        token = req.headers['sec-websocket-protocol'].toString().trim();
        logger.info(
          { component: 'SecurityLayer', username }, 
          'Extracted fallback authorization token from Sec-WebSocket-Protocol header'
        );
      }

      logger.debug(
        { component: 'SecurityBarrier', username, hasToken: !!token }, 
        'Evaluating handshake session credentials'
      );

      if (!token) {
        return { isValid: false, username: '', error: 'Access Denied. No token found in URL or Protocol Headers.' };
      }

      if (token !== this.SECRET_TOKEN) {
        return { isValid: false, username: '', error: 'Access Denied. Invalid token value.' };
      }

      return { isValid: true, username };
    } catch (error) {
      logger.error({ component: 'SecurityBarrier', error }, 'Authentication subsystem runtime processing failure');
      return { isValid: false, username: '', error: 'Authentication processing failure.' };
    }
  }
}

export const authService = new AuthService();