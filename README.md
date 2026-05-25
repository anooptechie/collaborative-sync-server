# Collaborative Sync Server 🚀

A real-time, high-performance state synchronization server built to handle low-latency collaborative features like shared document editing, live cursor tracking, multi-user presence, and state broadcasting.

---

## 🛠️ The Tech Stack

* **Runtime:** Node.js (v24+)
* **Language:** TypeScript
* **Execution Engine:** `tsx` (TypeScript Execute) for instant native ESM compilation
* **Protocol:** Raw WebSockets via the `ws` engine

---

## 🏗️ Architecture & Features

### 📡 1. Core Networking Gateway
* **Native ES Modules:** Configured with `"type": "module"` and `NodeNext` resolution for ultra-fast JS module loading boundaries.
* **HTTP-to-WS Upgrade Pipeline:** Intercepts incoming web requests via a native HTTP gateway, extracts raw connection streams, and elevates them into permanent, persistent TCP pipes.

### 👥 2. Multi-Tenant Room Isolation
* **In-Memory Space Managers:** Uses an decoupled `RoomManager` structure driven by efficient map lookups to isolate users into dedicated collaboration scopes.
* **Selective Broadcasting:** Streams cursor positional changes and text inputs to all active room members while omitting the original sender to eliminate layout thrashing.

### 🛡️ 3. Resilience, Security & Presence
* **Harden Validation Boundaries:** Protects memory state by intercepting corrupted payloads and throwing out non-conforming frame objects with expressive real-time error callbacks.
* **Active Presence Tracking:** Automatically generates state footprints when a user steps in (`user-joined`) or disconnects (`user-left`).
* **Heartbeat Keep-Alive Loop:** Runs an automated multi-client `Ping/Pong` verification sequence every 30 seconds to immediately terminate ghost sockets or dropped client lines.

---

## 🚦 Getting Started

### 1. Install Dependencies

npm install

2. Configure Environment Variables
Create a .env file in the root directory:

PORT=8080

3. Run the Development Server (with hot reloading)

npm run dev

---