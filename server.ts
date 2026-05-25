import http from 'http';
import dotenv from 'dotenv';

dotenv.config();

// Define a baseline HTTP loop that we can upgrade to WebSockets next
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Cloud Sync Server HTTP Gateway Active.\n');
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`[Cloud Server Running]: Listening on port ${PORT}`);
});