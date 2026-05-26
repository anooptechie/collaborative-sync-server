import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import dotenv from 'dotenv';
import { roomManager } from './roomManager.js';
import { initRedis } from './redisClient.js';
import { authService } from './authService.js'; // ⚡ 1. Added Import

dotenv.config();

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Nexus Sync Server HTTP Gateway Active.\n');
});

const wss = new WebSocketServer({ noServer: true });

// ⚡ 2. HARDENED UPGRADE PIPELINE WITH SECURITY GATE
server.on('upgrade', (request, socket, head) => {
  console.log('[Gateway]: Intercepting incoming connection handshake...');

  // Run the upgrade request through our security boundary
  const session = authService.authenticateRequest(request);

  if (!session.isValid) {
    console.warn(`[Security Barrier]: Connection rejected -> ${session.error}`);
    
    // Write a raw HTTP error response back onto the TCP socket stream and drop it
    socket.write('HTTP/1.1 401 Unauthorized\r\nContent-Type: text/plain\r\n\r\n');
    socket.destroy();
    return;
  }

  // Session is authentic! Attach metadata back onto the request object for the next stage
  (request as any).sessionData = session;

  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

interface ExtWebSocket extends WebSocket {
  isAlive: boolean;
}

wss.on('connection', (ws: ExtWebSocket, request: http.IncomingMessage) => {
  ws.isAlive = true;
  
  // ⚡ 3. Extract the verified session metadata we appended during the upgrade phase
  const session = (request as any).sessionData;
  const username = session?.username || 'Anoop';
  
  const participantId = `user_${Math.random().toString(36).substring(2, 9)}`;
  let currentRoomId: string | null = null;

  console.log(`[Pipeline]: Handshake authorized for user: ${username} (${participantId})`);

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());

      if (!data || typeof data !== 'object' || !data.action) {
        ws.send(JSON.stringify({ event: 'error', message: 'Invalid payload signature. "action" field required.' }));
        return;
      }

      if (data.action === 'join') {
        const roomId = data.roomId?.trim();

        if (!roomId) {
          ws.send(JSON.stringify({ event: 'error', message: 'Missing "roomId" for join action.' }));
          return;
        }

        currentRoomId = roomId;
        // Use our server-verified username here instead of client input fields
        roomManager.joinRoom(roomId, participantId, ws, username);
      } 
      
      else if (data.action === 'sync') {
        if (!currentRoomId) {
          ws.send(JSON.stringify({ event: 'error', message: 'You must join a room before broadcasting sync payloads.' }));
          return;
        }

        roomManager.publishToRedis(currentRoomId, {
          event: 'update',
          sender: participantId,
          payload: data.payload || {}
        });
      }
    } catch (error) {
      ws.send(JSON.stringify({ event: 'error', message: 'Payload parsing failed. Expected valid JSON format.' }));
    }
  });

  ws.on('close', () => {
    if (currentRoomId) {
      roomManager.leaveRoom(currentRoomId, participantId);
    }
  });
});

// HEARTBEAT MONITORING LOOP (Runs every 30 seconds)
const interval = setInterval(() => {
  wss.clients.forEach((client) => {
    const extClient = client as ExtWebSocket;
    if (extClient.isAlive === false) {
      console.log('[Heartbeat]: Dead connection detected. Terminating socket connection.');
      return extClient.terminate();
    }
    
    extClient.isAlive = false;
    extClient.ping();
  });
}, 30000);

wss.on('close', () => {
  clearInterval(interval);
});

const PORT = process.env.PORT || 8080;

async function bootstrap() {
  try {
    await initRedis();
    server.listen(PORT, () => {
      console.log(`[Nexus Server Running]: Listening on port ${PORT}`);
    });
  } catch (error) {
    console.error('[Bootstrap Failure]: Could not spin up core dependencies:', error);
    process.exit(1);
  }
}

bootstrap();