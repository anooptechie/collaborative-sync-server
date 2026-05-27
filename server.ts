import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import dotenv from 'dotenv';
import { roomManager } from './roomManager.js';
import { initRedis } from './redisClient.js' // Note: Ensure this file match paths exactly (e.g. ./redisClient.js or ./initRedis.js)
import { authService } from './authService.js';
import { initDatabase } from './dbClient.js';
import { logger } from './logger.js'; // ⚡ Integrated centralized logger

dotenv.config();

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Nexus Sync Server HTTP Gateway Active.\n');
});

const wss = new WebSocketServer({ noServer: true });

// 🛡️ HARDENED UPGRADE PIPELINE WITH SECURITY GATE
server.on('upgrade', (request, socket, head) => {
  logger.debug({ component: 'Gateway' }, 'Intercepting incoming connection handshake...');

  // Run the upgrade request through our security boundary
  const session = authService.authenticateRequest(request);

  if (!session.isValid) {
    logger.warn(
      { component: 'SecurityBarrier', error: session.error }, 
      'Connection rejected by security rules'
    );
    
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
  
  // Extract the verified session metadata appended during the upgrade phase
  const session = (request as any).sessionData;
  const username = session?.username || 'Anoop';
  
  const participantId = `user_${username.toLowerCase().trim()}`;
  let currentRoomId: string | null = null;

  logger.info(
    { component: 'Pipeline', participantId, username }, 
    'Handshake authorized for client session'
  );

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());

      if (!data || typeof data !== 'object' || !data.action) {
        logger.warn({ component: 'Pipeline', participantId }, 'Received malformed socket message signature missing action');
        ws.send(JSON.stringify({ event: 'error', message: 'Invalid payload signature. "action" field required.' }));
        return;
      }

      if (data.action === 'join') {
        const roomId = data.roomId?.trim();

        if (!roomId) {
          logger.warn({ component: 'Pipeline', participantId }, 'Join action rejected due to missing roomId');
          ws.send(JSON.stringify({ event: 'error', message: 'Missing "roomId" for join action.' }));
          return;
        }

        currentRoomId = roomId;
        // Use server-verified username here instead of client input fields
        roomManager.joinRoom(roomId, participantId, ws, username);
      } 
      
      else if (data.action === 'sync') {
        if (!currentRoomId) {
          logger.warn({ component: 'Pipeline', participantId }, 'Sync message rejected; client has not joined a room context');
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
      logger.error({ component: 'Pipeline', participantId, error }, 'Failed to process incoming payload parse sequence');
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
      logger.info({ component: 'Heartbeat' }, 'Dead connection detected. Terminating socket connection footprint.');
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
    await initDatabase(); // Boot and run migrations for Postgres table
    
    server.listen(PORT, () => {
      logger.info({ component: 'Bootstrap', port: PORT }, 'Nexus Sync Server is fully operational');
    });
  } catch (error) {
    logger.fatal({ component: 'Bootstrap', error }, 'Core dependency failure during application initialization sequence');
    process.exit(1);
  }
}

bootstrap();