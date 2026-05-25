import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import dotenv from 'dotenv';
import { roomManager } from './roomManager.js';

dotenv.config();

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Nexus Sync Server HTTP Gateway Active.\n');
});

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

// Extend the WebSocket type inline to track live heartbeat states
interface ExtWebSocket extends WebSocket {
  isAlive: boolean;
}

wss.on('connection', (ws: ExtWebSocket) => {
  ws.isAlive = true;
  const participantId = `user_${Math.random().toString(36).substring(2, 9)}`;
  let currentRoomId: string | null = null;

  // Handle client responding to our heartbeat ping
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());

      // STRICT GATEWAY VALIDATION BOUNDARY
      if (!data || typeof data !== 'object' || !data.action) {
        ws.send(JSON.stringify({ event: 'error', message: 'Invalid payload signature. "action" field required.' }));
        return;
      }

      if (data.action === 'join') {
        const roomId = data.roomId?.trim();
        const username = data.username?.trim() || 'Anonymous';

        if (!roomId) {
          ws.send(JSON.stringify({ event: 'error', message: 'Missing "roomId" for join action.' }));
          return;
        }

        currentRoomId = roomId;
        roomManager.joinRoom(roomId, participantId, ws, username);
      } 
      
      else if (data.action === 'sync') {
        if (!currentRoomId) {
          ws.send(JSON.stringify({ event: 'error', message: 'You must join a room before broadcasting sync payloads.' }));
          return;
        }

        roomManager.broadcastToRoom(currentRoomId, participantId, JSON.stringify({
          event: 'update',
          sender: participantId,
          payload: data.payload || {}
        }));
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
    extClient.ping(); // Send a low-level ping frame across the socket wire
  });
}, 30000);

wss.on('close', () => {
  clearInterval(interval);
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`[Nexus Server Running]: Listening on port ${PORT}`);
});