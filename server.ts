import http from 'http';
import { WebSocketServer } from 'ws';
import dotenv from 'dotenv';

dotenv.config();

// 1. Foundation HTTP Server
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Nexus Sync Server HTTP Gateway Active.\n');
});

// 2. Initialize Raw WebSocket Server instance
// We use 'noServer: true' because we want to manually intercept and upgrade the HTTP connection
const wss = new WebSocketServer({ noServer: true });

// 3. Intercept incoming HTTP requests and check for the 'Upgrade' header
server.on('upgrade', (request, socket, head) => {
  console.log('[Gateway]: Incoming connection upgrade request detected...');

  // This is where we will inject authentication logic later!
  wss.handleUpgrade(request, socket, head, (ws) => {
    // Handshake successful! Emit a connection event to the WebSocket server
    wss.emit('connection', ws, request);
  });
});

// 4. Handle Active Live Stateful WebSocket Connections
wss.on('connection', (ws) => {
  console.log('[Pipeline]: Connection successfully upgraded to Raw WebSocket. Pipe is active.');

  // Listen for raw text strings sent over the wire from clients
  ws.on('message', (message) => {
    try {
      const rawData = message.toString();
      console.log(`[Data Received]: ${rawData}`);

      // Echo chamber test: Send the exact message back to confirm two-way communication
      ws.send(`Echo from server: ${rawData}`);
    } catch (error) {
      console.error('[Error]: Failed to process incoming stream frame:', error);
    }
  });

  // Handle client abrupt disconnections
  ws.on('close', () => {
    console.log('[Pipeline]: Client connection closed or dropped.');
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`[Nexus Server Running]: Listening on port ${PORT}`);
});