# Collaborative Sync Server 🚀

A real-time, high-performance state synchronization server built to handle low-latency collaborative features like shared document editing, live cursor tracking, multi-user presence, and horizontally scalable state broadcasting.

---

## 🛠️ The Tech Stack

* **Runtime:** Node.js (v24+)
* **Language:** TypeScript
* **Execution Engine:** `tsx` (TypeScript Execute) for instant native ESM compilation
* **Protocol:** Raw WebSockets via the `ws` engine
* **Message Broker:** Redis (Pub/Sub distributed scaling & state storage layer)

---

## 🏗️ Architecture & Core Components

### 🛡️ 1. Secure Connection Authentication & Upgrade Gateway
* **HTTP Handshake Interception:** Intercepts incoming requests at the native HTTP level before upgrading the TCP stream to the WebSocket protocol.
* **Proxy-Resilient Token Validation:** Processes credentials via URL query parameters or falls back to the `Sec-WebSocket-Protocol` header to seamlessly bypass aggressive cloud proxies (like GitHub Codespaces).
* **Early Circuit Rejection:** Instantly terminates unauthenticated or malicious connections with a `401 Unauthorized` response, safeguarding downstream system memory and loops from resource abuse.

### 💾 2. Stateful Cache & Late-Joiner Reconciler
* **In-Memory Caching (Ground Truth):** Implements high-performance Redis Hashes (`HSET`/`HGET`) to cache cumulative document and canvas states at the cluster perimeter.
* **Late-Joiner Synchronization:** Intercepts room connection events and automatically pulls down the active cached state snapshot, streaming it directly to the newly connected user before joining them to the live feed.
* **Defensive Schema Guards:** Evaluates incoming `sync` payloads in real time, dropping malformed, null, or primitive type structures to enforce storage invariants and prevent client-side runtime crashes.

### 📡 3. Horizontally Scalable Pub/Sub Layer
* **Decoupled Client Pools:** Implements a dual-client Redis configuration (`pubClient` and `subClient`) to execute publishing commands while concurrently maintaining persistent subscription channels.
* **Cross-Instance Fan-Out:** Shifts message routing from local server memory to a distributed Redis backend, enabling horizontal scaling across multi-server clusters.

### 👥 4. Multi-Tenant Room Isolation
* **In-Memory Space Managers:** Uses a decoupled `RoomManager` structure driven by efficient map lookups to isolate users into dedicated collaboration scopes.
* **Selective Broadcasting:** Streams cursor changes and text inputs to all active room members while omitting the original sender to eliminate layout thrashing.

### 🫀 5. Active Presence & Heartbeat Keep-Alive
* **State Footprints:** Automatically tracks and broadcasts when a user steps into a room (`user-joined`) or disconnects (`user-left`).
* **Ghost Socket Termination:** Runs an automated multi-client `Ping/Pong` verification sequence every 30 seconds to immediately clean up dead lines or dropped client connections.

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