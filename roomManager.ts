import { WebSocket } from 'ws';
import { getRedisClients } from './redisClient.js';
import { db } from './dbClient.js'; // ⚡ Hooking up Neon PostgreSQL Client

interface RoomParticipant {
  id: string;
  ws: WebSocket;
  username: string;
}

class RoomManager {
  private rooms: Map<string, Map<string, RoomParticipant>> = new Map();

  public async joinRoom(roomId: string, participantId: string, ws: WebSocket, username: string): Promise<void> {
    const { pubClient, subClient } = getRedisClients();

    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, new Map());

      await subClient.subscribe(`room:${roomId}`, (message: string) => {
        this.broadcastToLocalRoom(roomId, message);
      });
      console.log(`[Distributed Architecture]: Subscribed to global Redis channel -> room:${roomId}`);
    }

    const roomPool = this.rooms.get(roomId)!;
    roomPool.set(participantId, { id: participantId, ws, username });
    console.log(`[RoomManager]: ${username} (${participantId}) joined room: ${roomId}`);

    try {
      // 1. First line of defense: Read from hot memory cache
      let cachedState = await pubClient.hGet(`room:state:${roomId}`, 'document');
      
      // 🔄 2. COLD STORAGE HYDRATION TRIPPED
      if (!cachedState) {
        console.log(`[Hydration Layer]: Cache miss for room: ${roomId}. Inspecting PostgreSQL (Neon)...`);
        
        const dbResult = await db.query(
          'SELECT content FROM room_snapshots WHERE room_id = $1',
          [roomId]
        );

        if (dbResult.rows.length > 0) {
          console.log(`[Hydration Layer]: Archival blueprint discovered in Neon. Warming up Redis...`);
          const documentData = dbResult.rows[0].content;
          cachedState = JSON.stringify(documentData);

          // Restore hot memory baseline state & fire the sliding 24hr TTL insurance policy
          await pubClient.hSet(`room:state:${roomId}`, 'document', cachedState);
          await pubClient.expire(`room:state:${roomId}`, 86400);
        }
      }

      if (cachedState) {
        console.log(`[Persistence Layer]: State ready for room: ${roomId}. Streaming snapshot to ${username}.`);
        ws.send(JSON.stringify({
          event: 'snapshot',
          payload: JSON.parse(cachedState)
        }));
      } else {
        console.log(`[Persistence Layer]: No active or archival state found for room: ${roomId}. Starting clean canvas.`);
      }
    } catch (err) {
      console.error(`[Persistence Error]: Failed to recover state for room ${roomId}:`, err);
    }

    this.publishToRedis(roomId, {
      event: 'user-joined',
      sender: 'SYSTEM',
      payload: { participantId, username, totalConnected: roomPool.size }
    });
  }

  public async publishToRedis(roomId: string, messageObject: { event: string; sender: string; payload: any }): Promise<void> {
    const { pubClient } = getRedisClients();
    const messageString = JSON.stringify(messageObject);

    try {
      if (messageObject.event === 'update') {
        const incomingPayload = messageObject.payload;

        if (incomingPayload && typeof incomingPayload === 'object' && !Array.isArray(incomingPayload)) {
          const cacheKey = `room:state:${roomId}`;
          
          // Persist the current snapshot state delta
          await pubClient.hSet(cacheKey, 'document', JSON.stringify(incomingPayload));
          
          // DEFENSE LINE 1: Enforce a sliding 24-hour expiration window (86400 seconds)
          await pubClient.expire(cacheKey, 86400);
        } else {
          console.warn(`[Data Boundary Warning]: Dropped invalid state cache write attempt for room ${roomId}.`);
        }
      }

      await pubClient.publish(`room:${roomId}`, messageString);
    } catch (err) {
      console.error(`[Cluster Error]: Failed infrastructure broadcast/write for room ${roomId}:`, err);
    }
  }

  private broadcastToLocalRoom(roomId: string, messageString: string): void {
    const roomPool = this.rooms.get(roomId);
    if (!roomPool) return;

    const message = JSON.parse(messageString);

    roomPool.forEach((participant) => {
      if (message.event === 'update' && participant.id === message.sender) {
        return;
      }

      if (participant.ws.readyState === WebSocket.OPEN) {
        participant.ws.send(messageString);
      }
    });
  }

  public async leaveRoom(roomId: string, participantId: string): Promise<void> {
    const roomPool = this.rooms.get(roomId);
    if (!roomPool) return;

    const participant = roomPool.get(participantId);
    roomPool.delete(participantId);

    console.log(`[RoomManager]: Participant ${participantId} left room: ${roomId}`);

    if (roomPool.size === 0) {
      const { pubClient, subClient } = getRedisClients();
      this.rooms.delete(roomId);
      
      await subClient.unsubscribe(`room:${roomId}`);
      console.log(`[Distributed Architecture]: Vacant room on instance. Unsubscribed from channel -> room:${roomId}`);
      
      try {
        // 📥 1. Read latest hot snapshot before dropping it
        const currentCachedState = await pubClient.hGet(`room:state:${roomId}`, 'document');

        if (currentCachedState) {
          console.log(`[Cold Storage Handoff]: Executing atomic archive flush to Neon PostgreSQL for room: ${roomId}`);
          
          // 🗄️ 2. Safe upsert: Insert snapshot or update content if it already existed historically
          await db.query(`
            INSERT INTO room_snapshots (room_id, content, updated_at)
            VALUES ($1, $2, CURRENT_TIMESTAMP)
            ON CONFLICT (room_id)
            DO UPDATE SET content = EXCLUDED.content, updated_at = CURRENT_TIMESTAMP;
          `, [roomId, JSON.parse(currentCachedState)]);
          
          console.log(`[Cold Storage Handoff]: Secure write acknowledged by Postgres for room: ${roomId}`);
        }

        // 🧹 3. DEFENSE LINE 2: Explicit Eviction on Vacancy
        await pubClient.del(`room:state:${roomId}`);
        console.log(`[Eviction Engine]: Room "${roomId}" is vacant. Static memory cleared from Redis RAM.`);
      } catch (err) {
        // High alert boundary guard: Log the failure but don't wipe Redis if the database flush failed!
        console.error(`[Critical Persistence Failure]: Aborting memory clearing. Failed to commit cold snapshot for room ${roomId}:`, err);
      }
    } else {
      this.publishToRedis(roomId, {
        event: 'user-left',
        sender: 'SYSTEM',
        payload: { participantId, username: participant?.username || 'Anonymous', totalConnected: roomPool.size }
      });
    }
  }
}

export const roomManager = new RoomManager();