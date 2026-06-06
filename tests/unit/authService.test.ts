import { describe, it, expect, beforeEach } from 'vitest';
import { IncomingMessage } from 'http';
import { Socket } from 'net';

// Helper to create a mock IncomingMessage with custom headers and URL
function createMockRequest(url: string, headers: Record<string, string> = {}): IncomingMessage {
  const socket = new Socket();
  const req = new IncomingMessage(socket);
  req.url = url;
  req.headers = {
    host: 'localhost',
    ...headers,
  };
  return req;
}

describe('AuthService', () => {
  let authService: typeof import('../../authService.js').authService;

  beforeEach(async () => {
    // Fresh import for each test
    const module = await import('../../authService.js');
    authService = module.authService;
  });

  // ✅ VALID TOKEN TESTS
  describe('Valid token via URL query parameter', () => {
    it('should return isValid: true with correct token', () => {
      const req = createMockRequest(
        '/?token=nexus-sync-super-secret-token&username=Anoop'
      );
      const session = authService.authenticateRequest(req);

      expect(session.isValid).toBe(true);
      expect(session.username).toBe('Anoop');
      expect(session.error).toBeUndefined();
    });

    it('should use default username "Anoop" when username is missing', () => {
      const req = createMockRequest(
        '/?token=nexus-sync-super-secret-token'
      );
      const session = authService.authenticateRequest(req);

      expect(session.isValid).toBe(true);
      expect(session.username).toBe('Anoop');
    });

    it('should trim whitespace from username', () => {
      const req = createMockRequest(
        '/?token=nexus-sync-super-secret-token&username=  Anoop  '
      );
      const session = authService.authenticateRequest(req);

      expect(session.isValid).toBe(true);
      expect(session.username).toBe('Anoop');
    });
  });

  // ✅ FALLBACK HEADER TESTS
  describe('Valid token via Sec-WebSocket-Protocol header fallback', () => {
    it('should accept token from header when URL token is missing', () => {
      const req = createMockRequest('/?username=Anoop', {
        'sec-websocket-protocol': 'nexus-sync-super-secret-token',
      });
      const session = authService.authenticateRequest(req);

      expect(session.isValid).toBe(true);
      expect(session.username).toBe('Anoop');
    });

    it('should prefer URL token over header token', () => {
      const req = createMockRequest(
        '/?token=nexus-sync-super-secret-token&username=Anoop',
        { 'sec-websocket-protocol': 'wrong-token' }
      );
      const session = authService.authenticateRequest(req);

      // URL token is valid so should pass
      expect(session.isValid).toBe(true);
    });
  });

  // ❌ INVALID TOKEN TESTS
  describe('Invalid token rejection', () => {
    it('should return isValid: false with wrong token in URL', () => {
      const req = createMockRequest(
        '/?token=wrong-token&username=Anoop'
      );
      const session = authService.authenticateRequest(req);

      expect(session.isValid).toBe(false);
      expect(session.username).toBe('');
      expect(session.error).toBe('Access Denied. Invalid token value.');
    });

    it('should return isValid: false with wrong token in header', () => {
      const req = createMockRequest('/?username=Anoop', {
        'sec-websocket-protocol': 'wrong-token',
      });
      const session = authService.authenticateRequest(req);

      expect(session.isValid).toBe(false);
      expect(session.error).toBe('Access Denied. Invalid token value.');
    });
  });

  // ❌ MISSING TOKEN TESTS
  describe('Missing token rejection', () => {
    it('should return isValid: false when no token in URL or headers', () => {
      const req = createMockRequest('/?username=Anoop');
      const session = authService.authenticateRequest(req);

      expect(session.isValid).toBe(false);
      expect(session.username).toBe('');
      expect(session.error).toBe('Access Denied. No token found in URL or Protocol Headers.');
    });

    it('should return isValid: false with empty URL', () => {
      const req = createMockRequest('');
      const session = authService.authenticateRequest(req);

      expect(session.isValid).toBe(false);
    });

    it('should return isValid: false with no URL at all', () => {
      const socket = new Socket();
      const req = new IncomingMessage(socket);
      req.headers = { host: 'localhost' };
      // url is undefined by default

      const session = authService.authenticateRequest(req);
      expect(session.isValid).toBe(false);
    });
  });

  // ✅ EMPTY TOKEN STRING
  describe('Edge cases', () => {
    it('should reject empty string token', () => {
      const req = createMockRequest('/?token=&username=Anoop');
      const session = authService.authenticateRequest(req);

      expect(session.isValid).toBe(false);
    });

    it('should handle missing host header gracefully', () => {
      const socket = new Socket();
      const req = new IncomingMessage(socket);
      req.url = '/?token=nexus-sync-super-secret-token&username=Anoop';
      req.headers = {}; // no host header

      const session = authService.authenticateRequest(req);
      expect(session.isValid).toBe(true);
    });
  });
});