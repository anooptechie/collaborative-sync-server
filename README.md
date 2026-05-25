# Collaborative Sync Server 🚀

A real-time, high-performance state synchronization server built to handle low-latency collaborative features like shared document editing, live cursor tracking, and state broadcasting.

---

## 🛠️ The Tech Stack

* **Runtime:** Node.js (v24+)
* **Language:** TypeScript
* **Execution Engine:** `tsx` (TypeScript Execute) for instant native ESM compilation
* **Protocol:** Raw WebSockets via the `ws` engine

---

## 🏗️ Architecture & Features So Far

* **Native ES Modules:** Configured with `"type": "module"` and `NodeNext` resolution for modern, fast JS module loading.
* **Type-Safe Foundation:** Fully configured `tsconfig.json` ensuring strict boundaries before data flows into memory.
* **HTTP-to-WS Upgrade Pipeline:** Uses a native Node HTTP gateway to intercept incoming handshakes, extract raw connection streams, and upgrade them to permanent, bi-directional WebSocket pipes.
* **Stateful Room Management:** Uses an in-memory `Map` and `Set` architecture to dynamically group connection sockets into isolated collaboration rooms (`doc-session-abc`).
* **Selective Broadcasting:** Efficiently streams state changes (cursors, edits) to all room participants while intelligently skipping the sender to minimize client-side layout thrashing.
* **Memory Leak Safeguards:** Automatically disposes of room allocations from memory the exact millisecond the last participant disconnects.

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