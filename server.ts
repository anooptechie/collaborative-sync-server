import http from 'http';
import { WebSocketServer } from 'ws';
import dotenv from 'dotenv';
import { roomManager } from './roomManager.js'; // Note the .js extension for ESM resolution

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

wss.on('connection', (ws) => {
  console.log('[Pipeline]: Connection active.');
  
  // For this local phase, we generate a quick random ID for each connection socket
  const participantId = `user_${Math.random().toString(36).substring(2, 9)}`;
  let currentRoomId: string | null = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());
      console.log(`[Incoming Action]:`, data);

      // ACTION 1: Client wants to subscribe to a room
      if (data.action === 'join') {
        const { roomId, username } = data;
        currentRoomId = roomId;
        roomManager.joinRoom(roomId, participantId, ws, username);
        
        ws.send(JSON.stringify({ event: 'joined', assignedId: participantId, roomId }));
      } 
      
      // ACTION 2: Client is broadcasting live operational edits or updates
      else if (data.action === 'sync' && currentRoomId) {
        // Broadcast the data payload to everyone else in the room
        const broadcastPayload = JSON.stringify({
          event: 'update',
          sender: participantId,
          payload: data.payload
        });
        roomManager.broadcastToRoom(currentRoomId, participantId, broadcastPayload);
      }
    } catch (error) {
      console.error('[Error Parsing Frame]: Expected JSON structure.', error);
    }
  });

  // Handle sudden dropouts or tab closes
  ws.on('close', () => {
    if (currentRoomId) {
      roomManager.leaveRoom(currentRoomId, participantId);
    }
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`[Nexus Server Running]: Listening on port ${PORT}`);
});