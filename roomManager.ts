import { WebSocket } from 'ws';
import { getRedisClients } from './redisClient.js';

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
      const cachedState = await pubClient.hGet(`room:state:${roomId}`, 'document');
      
      if (cachedState) {
        console.log(`[Persistence Layer]: Cache hit for room: ${roomId}. Streaming snapshot to ${username}.`);
        ws.send(JSON.stringify({
          event: 'snapshot',
          payload: JSON.parse(cachedState)
        }));
      } else {
        console.log(`[Persistence Layer]: Cache miss for room: ${roomId}. Starting clean canvas.`);
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
          
          // 1. Persist the current snapshot state delta
          await pubClient.hSet(cacheKey, 'document', JSON.stringify(incomingPayload));
          
          // 2. ⚡ DEFENSE LINE 1: Enforce a sliding 24-hour expiration window (86400 seconds)
          // Every active edit keeps the lease alive for another day.
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

    // If the room is completely vacant on this server instance, clean up allocations
    if (roomPool.size === 0) {
      const { pubClient, subClient } = getRedisClients();
      this.rooms.delete(roomId);
      
      // Unsubscribe from live pub/sub traffic
      await subClient.unsubscribe(`room:${roomId}`);
      console.log(`[Distributed Architecture]: Vacant room. Unsubscribed from channel -> room:${roomId}`);
      
      // 3. ⚡ DEFENSE LINE 2: Explicit Eviction on Vacancy
      // Clean up the static cache database completely when the room becomes dead space.
      try {
        await pubClient.del(`room:state:${roomId}`);
        console.log(`[Eviction Engine]: Room "${roomId}" is vacant. Static memory cleared from Redis.`);
      } catch (evictErr) {
        console.error(`[Eviction Error]: Failed to drop cache key for room ${roomId}:`, evictErr);
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