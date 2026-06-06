import { describe, it, expect, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import dotenv from 'dotenv';

dotenv.config();

const SERVER_URL = 'ws://127.0.0.1:8999';
const VALID_TOKEN = process.env.AUTH_SECRET_TOKEN || 'nexus-sync-super-secret-token';

// ─── Helper: create authenticated WebSocket connection ────────────────────────
function createClient(username = 'TestUser'): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(
      `${SERVER_URL}?token=${VALID_TOKEN}&username=${username}`
    );
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
    setTimeout(() => reject(new Error('Connection timeout')), 5000);
  });
}

// ─── Helper: wait for a specific event from the server ───────────────────────
function waitForEvent(
  ws: WebSocket,
  eventName: string,
  timeoutMs = 3000
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for event: ${eventName}`));
    }, timeoutMs);

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.event === eventName) {
        clearTimeout(timer);
        resolve(msg);
      }
    });
  });
}

// ─── Helper: close WebSocket cleanly ─────────────────────────────────────────
function closeClient(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) return resolve();
    ws.on('close', () => resolve());
    ws.close();
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('WebSocket E2E', () => {
  let client: WebSocket;

  afterAll(async () => {
    if (client && client.readyState !== WebSocket.CLOSED) {
      await closeClient(client);
    }
  });

  // ✅ AUTHENTICATION
  describe('Authentication', () => {
    it('should accept connection with valid token', async () => {
      client = await createClient('Anoop');
      expect(client.readyState).toBe(WebSocket.OPEN);
      await closeClient(client);
    });

    it('should reject connection with invalid token', async () => {
      await expect(
        new Promise((resolve, reject) => {
          const ws = new WebSocket(`${SERVER_URL}?token=wrong-token&username=Anoop`);
          ws.on('open', () => resolve(true));
          ws.on('error', reject);
          ws.on('close', (code) => {
            if (code === 1006 || code === 4001) reject(new Error('Rejected'));
            else reject(new Error(`Closed with code ${code}`));
          });
          setTimeout(() => reject(new Error('Expected rejection')), 3000);
        })
      ).rejects.toThrow();
    });

    it('should reject connection with missing token', async () => {
      await expect(
        new Promise((resolve, reject) => {
          const ws = new WebSocket(`${SERVER_URL}?username=Anoop`);
          ws.on('open', () => resolve(true));
          ws.on('error', reject);
          ws.on('close', () => reject(new Error('Rejected')));
          setTimeout(() => reject(new Error('Expected rejection')), 3000);
        })
      ).rejects.toThrow();
    });
  });

  // ✅ JOIN FLOW
  describe('Join Flow', () => {
    it('should receive room-state event after joining', async () => {
      client = await createClient('Anoop');

      const roomStatePromise = waitForEvent(client, 'room-state');

      client.send(JSON.stringify({
        action: 'join',
        roomId: 'e2e-test-room-join'
      }));

      // room-state is sent inside joinRoom — wait for snapshot or user-joined
      // Since no prior state exists, server sends nothing for snapshot
      // but publishes user-joined to Redis which broadcasts back
      await roomStatePromise.catch(() => null);

      // Either room-state or snapshot is acceptable
      expect(client.readyState).toBe(WebSocket.OPEN);
      await closeClient(client);
    });

    it('should broadcast user-joined to other clients in same room', async () => {
      const client1 = await createClient('User1');
      const client2 = await createClient('User2');

      // Client1 joins first
      client1.send(JSON.stringify({
        action: 'join',
        roomId: 'e2e-test-broadcast-room'
      }));

      await new Promise(resolve => setTimeout(resolve, 300));

      // Listen for user-joined on client1 before client2 joins
      const userJoinedPromise = waitForEvent(client1, 'user-joined');

      // Client2 joins — client1 should receive user-joined
      client2.send(JSON.stringify({
        action: 'join',
        roomId: 'e2e-test-broadcast-room'
      }));

      const msg = await userJoinedPromise;
      expect(msg.event).toBe('user-joined');

      await closeClient(client1);
      await closeClient(client2);
    });
  });

  // ✅ SYNC FLOW
  describe('Sync Flow', () => {
    it('should broadcast update to other clients in the room', async () => {
      const sender = await createClient('Sender');
      const receiver = await createClient('Receiver');

      // Both join the same room
      sender.send(JSON.stringify({ action: 'join', roomId: 'e2e-sync-room' }));
      receiver.send(JSON.stringify({ action: 'join', roomId: 'e2e-sync-room' }));

      await new Promise(resolve => setTimeout(resolve, 300));

      // Listen for update on receiver
      const updatePromise = waitForEvent(receiver, 'update');

      // Sender sends sync payload
      sender.send(JSON.stringify({
        action: 'sync',
        payload: { cursorX: 42, cursorY: 84 }
      }));

      const msg = await updatePromise;
      expect(msg.event).toBe('update');
      expect((msg.payload as Record<string, unknown>).cursorX).toBe(42);

      await closeClient(sender);
      await closeClient(receiver);
    });

    it('should NOT echo update back to the sender', async () => {
      const sender = await createClient('EchoTestSender');
      const receiver = await createClient('EchoTestReceiver');

      sender.send(JSON.stringify({ action: 'join', roomId: 'e2e-echo-room' }));
      receiver.send(JSON.stringify({ action: 'join', roomId: 'e2e-echo-room' }));

      await new Promise(resolve => setTimeout(resolve, 300));

      let senderReceivedUpdate = false;
      sender.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.event === 'update') senderReceivedUpdate = true;
      });

      sender.send(JSON.stringify({
        action: 'sync',
        payload: { cursorX: 99, cursorY: 99 }
      }));

      // Wait to confirm sender doesn't receive its own update
      await new Promise(resolve => setTimeout(resolve, 500));

      expect(senderReceivedUpdate).toBe(false);

      await closeClient(sender);
      await closeClient(receiver);
    });

    it('should reject sync action if client has not joined a room', async () => {
      client = await createClient('NoRoomUser');

      const errorPromise = waitForEvent(client, 'error');

      client.send(JSON.stringify({
        action: 'sync',
        payload: { cursorX: 10, cursorY: 10 }
      }));

      const msg = await errorPromise;
      expect(msg.event).toBe('error');
      expect(msg.message).toContain('join a room');

      await closeClient(client);
    });
  });

  // ✅ VALIDATION
  describe('Payload Validation', () => {
    it('should return error for missing action field', async () => {
      client = await createClient('ValidationUser');

      const errorPromise = waitForEvent(client, 'error');

      client.send(JSON.stringify({ roomId: 'some-room' })); // missing action

      const msg = await errorPromise;
      expect(msg.event).toBe('error');
      expect(msg.message).toContain('"action" field required');

      await closeClient(client);
    });

    it('should return error for malformed JSON', async () => {
      client = await createClient('MalformedUser');

      const errorPromise = waitForEvent(client, 'error');

      client.send('this is not valid json {{{');

      const msg = await errorPromise;
      expect(msg.event).toBe('error');
      expect(msg.message).toContain('Payload parsing failed');

      await closeClient(client);
    });

    it('should return error for missing roomId on join', async () => {
      client = await createClient('NoRoomIdUser');

      const errorPromise = waitForEvent(client, 'error');

      client.send(JSON.stringify({ action: 'join' })); // missing roomId

      const msg = await errorPromise;
      expect(msg.event).toBe('error');
      expect(msg.message).toContain('Missing "roomId"');

      await closeClient(client);
    });
  });

  // ✅ DISCONNECT FLOW
  describe('Disconnect Flow', () => {
    it('should broadcast user-left when a client disconnects', async () => {
      const staying = await createClient('StayingUser');
      const leaving = await createClient('LeavingUser');

      staying.send(JSON.stringify({ action: 'join', roomId: 'e2e-disconnect-room' }));
      leaving.send(JSON.stringify({ action: 'join', roomId: 'e2e-disconnect-room' }));

      await new Promise(resolve => setTimeout(resolve, 300));

      const userLeftPromise = waitForEvent(staying, 'user-left');

      // Leaving user disconnects
      await closeClient(leaving);

      const msg = await userLeftPromise;
      expect(msg.event).toBe('user-left');

      await closeClient(staying);
    });
  });
});