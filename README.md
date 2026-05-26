# Collaborative Sync Server 🚀

A real-time, high-performance state synchronization server built to handle low-latency collaborative features like shared document editing, live cursor tracking, multi-user presence, and horizontally scalable state broadcasting.

---

## 🛠️ The Tech Stack

* **Runtime:** Node.js (v24+)
* **Language:** TypeScript
* **Execution Engine:** `tsx` (TypeScript Execute) for instant native ESM compilation
* **Protocol:** Raw WebSockets via the `ws` engine
* **Message Broker:** Redis (Pub/Sub distributed scaling layer)

---

## 🏗️ Architecture & Features

### 🛡️ 1. Hardened Perimeter & Gateway Authentication
* **HTTP Handshake Interception:** Intercepts incoming connection requests at the native HTTP level before upgrading the TCP stream to the WebSocket protocol.
* **Dual-Channel Token Validation:** Processes credentials securely via URL query string parameters or falls back to the `Sec-WebSocket-Protocol` header to bypass aggressive cloud proxy/reverse-proxy stripping (e.g., GitHub Codespaces).
* **Early Circuit Rejection:** Instantly executes unauthenticated or malicious connections with a `401 Unauthorized` status line, safeguarding downstream system memory and thread loops from unauthorized resource allocation.

### 📡 2. Core Networking Gateway
* **Native ES Modules:** Configured with `"type": "module"` and `NodeNext` resolution for ultra-fast JS module loading boundaries.
* **HTTP-to-WS Upgrade Pipeline:** Elevates authenticated incoming web requests into permanent, persistent TCP pipes.

### 🌐 3. Horizontally Scalable Pub/Sub Layer
* **Decoupled Client Pools:** Implements a dual-client Redis configuration (`pubClient` and `subClient`) to execute publishing commands while concurrently maintaining persistent subscription channels.
* **Cross-Instance Fan-Out:** Shifts message routing from local server memory to a distributed Redis backend, enabling infinite horizontal scaling across multi-server clusters.

### 👥 4. Multi-Tenant Room Isolation
* **In-Memory Space Managers:** Uses a decoupled `RoomManager` structure driven by efficient map lookups to isolate users into dedicated collaboration scopes.
* **Selective Broadcasting:** Streams cursor positional changes and text inputs to all active room members while omitting the original sender to eliminate layout thrashing.

### 🫀 5. Active Presence & Heartbeat Keep-Alive
* **State Footprints:** Automatically generates state footprints when a user steps in (`user-joined`) or disconnects (`user-left`).
* **Ghost Socket Termination:** Runs an automated multi-client `Ping/Pong` verification sequence every 30 seconds to immediately terminate ghost sockets or dropped client lines.

---

## 🚦 Getting Started

### 1. Install Dependencies

npm install

2. Configure Environment Variables
Create a .env file in the root directory:

PORT=8080
REDIS_URL=redis://127.0.0.1:6379

3. Run the Development Server (with hot reloading)

npm run dev

---