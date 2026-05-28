import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import dotenv from 'dotenv';
import { roomManager } from './roomManager.js';
import { initRedis } from './redisClient.js';
import { authService } from './authService.js';
import { initDatabase } from './dbClient.js';
import { logger } from './logger.js'; 
import { register, activeConnectionsGauge, messageCounter } from './metrics.js'; // ⚡ Metrics Registry Imports

dotenv.config();

// 📈 Expose both metrics scraping and standard gateway services safely
const server = http.createServer((req, res) => {
  if (req.url === '/metrics') {
    register.metrics()
      .then((metricsOutput) => {
        res.writeHead(200, { 'Content-Type': register.contentType, 'Access-Control-Allow-Origin': '*' });
        res.end(metricsOutput);
      })
      .catch((error) => {
        logger.error({ component: 'MetricsEngine', error }, 'Failed to expose metrics registry payload');
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Metrics collection failure\n');
      });
    return;
  }

  // Your standard fallback HTTP path
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
  
  // 📈 Track active connection additions across telemetry layers
  activeConnectionsGauge.inc();

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
        messageCounter.inc({ action: 'invalid' }); // 📈 Record malformed hits
        logger.warn({ component: 'Pipeline', participantId }, 'Received malformed socket message signature missing action');
        ws.send(JSON.stringify({ event: 'error', message: 'Invalid payload signature. "action" field required.' }));
        return;
      }

      // 📈 Log categorized valid action event instances
      messageCounter.inc({ action: data.action });

      if (data.action === 'join') {
        const roomId = data.roomId?.trim();

        if (!roomId) {
          logger.warn({ component: 'Pipeline', participantId }, 'Join action rejected due to missing roomId');
          ws.send(JSON.stringify({ event: 'error', message: 'Missing "roomId" for join action.' }));
          return;
        }

        currentRoomId = roomId;
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
      messageCounter.inc({ action: 'malformed_json' });
      logger.error({ component: 'Pipeline', participantId, error }, 'Failed to process incoming payload parse sequence');
      ws.send(JSON.stringify({ event: 'error', message: 'Payload parsing failed. Expected valid JSON format.' }));
    }
  });

  ws.on('close', () => {
    // 📈 Safely evict connection footprint counters
    activeConnectionsGauge.dec();

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

const PORT = process.env.PORT || 8999;

async function bootstrap() {
  try {
    await initRedis();
    await initDatabase(); // Boot and run migrations for Postgres table
    
    // ⚡ Explicitly bind to '0.0.0.0' to open up network routing interfaces
    server.listen(Number(PORT), '0.0.0.0', () => {
      logger.info(
        { component: 'Bootstrap', host: '0.0.0.0', port: PORT }, 
        'Nexus Sync Server is fully operational with Prometheus metrics exposure'
      );
    });
  } catch (error) {
    logger.fatal({ component: 'Bootstrap', error }, 'Core dependency failure during application initialization sequence');
    process.exit(1);
  }
}

bootstrap();