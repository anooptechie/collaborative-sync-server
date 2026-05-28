# Collaborative Sync Server 🚀

A real-time, high-performance state synchronization server built to handle low-latency collaborative features like shared document editing, live cursor tracking, multi-user presence, and horizontally scalable state broadcasting.

---

## 🛠️ The Tech Stack

* **Runtime:** Node.js (v24+)
* **Language:** TypeScript
* **Execution Engine:** `tsx` (TypeScript Execute) for instant native ESM compilation
* **Protocol:** Raw WebSockets via the `ws` engine
* **Telemetry & Observability:** Structured JSON Logging via **Pino**, Metrics via **prom-client**, Dashboarding via **Grafana Cloud**
* **Hot Storage & Message Broker:** Redis (Pub/Sub distributed scaling & transient caching tier)
* **Cold Storage Database:** PostgreSQL via **Neon Pool (`pg`)** (ACID-compliant durable persistence tier)

---

## 🏗️ Architecture & Core Components

### 🛡️ 1. Secure Connection Authentication & Upgrade Gateway
* **HTTP Handshake Interception:** Intercepts incoming requests at the native HTTP level before upgrading the TCP stream to the WebSocket protocol.
* **Proxy-Resilient Token Validation:** Processes credentials via URL query parameters or falls back to the `Sec-WebSocket-Protocol` header to seamlessly bypass aggressive cloud proxies (like GitHub Codespaces).
* **Deterministic Identity Isolation:** Binds socket lifetimes directly to verified session metadata extracted by the authentication layer, generating stable, immutable participant IDs to guarantee state footprint consistency across hardware reconnects.
* **Early Circuit Rejection:** Instantly terminates unauthenticated or malicious connections with a `401 Unauthorized` response, safeguarding downstream system memory and loops from resource abuse.

### 💾 2. Stateful Cache & Late-Joiner Reconciler
* **In-Memory Caching (Hot Tier):** Implements high-performance Redis Hashes (`HSET`/`HGET`) to cache cumulative document and canvas states at the cluster perimeter for sub-millisecond propagation times.
* **Late-Joiner Synchronization:** Intercepts room connection events and automatically pulls down the active cached state snapshot, streaming it directly to the newly connected user before joining them to the live feed.
* **Defensive Schema Guards:** Evaluates incoming `sync` payloads in real time, dropping malformed, null, or primitive type structures to enforce storage invariants and prevent client-side runtime crashes.

### 🧹 3. Two-Tier Cache Eviction & Relational Cold Storage Hydration
* **Durable Postgres Handoff:** Executes an atomic SQL upsert (`ON CONFLICT DO UPDATE`) to a Neon PostgreSQL database the absolute millisecond a collaboration room pool drops to zero active participants, archiving the unstructured runtime snapshot into a structured relational tier.
* **Crash-Safe Memory Eviction:** Safely recycles high-cost RAM by executing a Redis `DEL` command *only* after a successful, verified write acknowledgment is received from the PostgreSQL persistent drive.
* **On-Demand Cache Hydration:** Intercepts room connection requests, catching Redis cache misses and querying Neon PostgreSQL to automatically re-hydrate the hot storage cache tier before streaming the snapshot to returning clients.
* **Sliding 24-Hour TTL Guard:** Attaches an active `EXPIRE` window to cache records on every state modification to provide automated infrastructure insurance against dirty sockets, sudden power loss, or network timeouts that bypass standard socket close frames.

### 📡 4. Horizontally Scalable Pub/Sub Layer
* **Decoupled Client Pools:** Implements a dual-client Redis configuration (`pubClient` and `subClient`) to execute publishing commands while concurrently maintaining persistent subscription channels.
* **Cross-Instance Fan-Out:** Shifts message routing from local server memory to a distributed Redis backend, enabling horizontal scaling across multi-server clusters.

### 👥 5. Multi-Tenant Room Isolation
* **In-Memory Space Managers:** Uses a decoupled `RoomManager` structure driven by efficient map lookups to isolate users into dedicated collaboration scopes.
* **Selective Broadcasting:** Streams cursor changes and text inputs to all active room members while omitting the original sender to eliminate layout thrashing.

### 🫀 6. Active Presence & Heartbeat Keep-Alive
* **State Footprints:** Automatically tracks and broadcasts when a user steps into a room (`user-joined`) or disconnects (`user-left`).
* **Ghost Socket Termination:** Runs an automated multi-client `Ping/Pong` verification sequence every 30 seconds to immediately clean up dead lines or dropped client connections.

### 📈 7. Dual-Engine Observability & Telemetry Push Pipeline
* **Machine-Readable JSON Logging:** Replaces all legacy console logging with highly optimized JSON streams via **Pino** to enable effortless parsing by distributed log aggregators (e.g., Grafana Loki).
* **Prometheus Primitives Tracking:** Instruments internal server states using memory-efficient gauges and categorized counters (`prom-client`) exposed via an internal `/metrics` scraping endpoint.
* **Outbound Graphite Ingestion Sync:** Spawns an isolated background thread that aggregates internal Prometheus registries every 10 seconds, packing system statistics into a strict JSON-to-Graphite matrix payload transmitted directly to Grafana Cloud over secure Basic Authentication headers.

---

## 🗄️ Database Schema Design

The cold storage tier leverages PostgreSQL's binary JSON capabilities (`JSONB`) to blend relational structural integrity with unstructured snapshot flexibility, avoiding complex object-relational mapping overhead.

```sql
CREATE TABLE IF NOT EXISTS room_snapshots (
    room_id VARCHAR(255) PRIMARY KEY,
    content JSONB NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index optimization for ultra-fast lookup during cache miss hydration
CREATE UNIQUE INDEX IF NOT EXISTS idx_room_snapshots_room_id ON room_snapshots(room_id);

🚦 Getting Started

1. Install Dependencies

npm install

2. Configure Environment Variables

Create a .env file in the root directory:

Code snippet
PORT=8999
REDIS_URL=redis://127.0.0.1:6379
DATABASE_URL=postgresql://your_user:your_password@your_neon_host.neon.tech/neondb?sslmode=require
NODE_ENV=development

# Telemetry Integrations
GRAFANA_API_TOKEN=glc_your_secure_access_policy_token

3. Run the Development Server (Single Instance Mode)

npm run dev


🌐 Running as a Horizontally Scalable Cluster
To simulate a distributed production deployment locally or within GitHub Codespaces, you can scale the system horizontally across multiple isolated node processes orchestrated by a reverse proxy.

1. Spin Up the Node.js Instance Cluster
Open three separate terminal sessions to initialize independent server runtimes sharing the same Redis backplane:

# Terminal 1 (Instance 1)
PORT=8999 npm run dev

# Terminal 2 (Instance 2)
PORT=9000 npm run dev

# Terminal 3 (Instance 3)
PORT=9001 npm run dev

2. Launch the Caddy Gateway Load Balancer
Create a Caddyfile in your project root to handle stateful round-robin reverse proxy routing and automatic TCP WebSocket upgrades:

Plaintext
:8080 {
    reverse_proxy {
        to 127.0.0.1:8999 127.0.0.1:9000 127.0.0.1:9001
        lb_policy round_robin
        header_up Host {host}
        header_up X-Real-IP {remote_host}
    }
}
Run the gateway in a fourth terminal session:


caddy run --config Caddyfile
The unified proxy gateway is now accessible at ws://localhost:8080.

🧪 Performance Validation & Stress Testing
The infrastructure includes a dedicated performance verification suite using k6 to stress test system boundaries, concurrency ramps, and cross-instance Pub/Sub message propagation speeds.

1. Execute the Target Load Test Profile
Ensure your environment token configuration inside load-test.js targets the unified Caddy gateway entry node (port 8080), then trigger the runner:

k6 run load-test.js

2. Telemetry Verification & Dashboards
Real-time traffic patterns, connection runtimes, protocol performance metrics, and active room populations are aggregated concurrently across all running nodes and visualized in your Grafana Cloud Dashboard.