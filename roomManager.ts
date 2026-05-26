import { WebSocket } from 'ws';
import { getRedisClients } from './redisClient.js';

interface RoomParticipant {
  id: string;
  ws: WebSocket;
  username: string;
}

class RoomManager {
  // Local tracking pool: Map<roomId, Map<participantId, RoomParticipant>>
  private rooms: Map<string, Map<string, RoomParticipant>> = new Map();

  /**
   * Orchestrates joining a room, managing subscriptions, and streaming
   * the historical room state to late-joiners.
   */
  public async joinRoom(roomId: string, participantId: string, ws: WebSocket, username: string): Promise<void> {
    const { pubClient, subClient } = getRedisClients();

    // 1. Initialize the room pool inside local node memory if it doesn't exist
    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, new Map());

      // Subscribe this cluster node to the global Redis channel for this room
      await subClient.subscribe(`room:${roomId}`, (message: string) => {
        this.broadcastToLocalRoom(roomId, message);
      });
      console.log(`[Distributed Architecture]: Subscribed to global Redis channel -> room:${roomId}`);
    }

    // 2. Add the participant to the local room loop
    const roomPool = this.rooms.get(roomId)!;
    roomPool.set(participantId, { id: participantId, ws, username });
    console.log(`[RoomManager]: ${username} (${participantId}) joined room: ${roomId}`);

    // 3. LATE-JOINER CATCH-UP: Fetch historical ground truth from Redis Cache
    try {
      const cachedState = await pubClient.hGet(`room:state:${roomId}`, 'document');
      
      if (cachedState) {
        console.log(`[Persistence Layer]: Cache hit for room: ${roomId}. Streaming snapshot to ${username}.`);
        // Stream the cached state directly to *only* this newly connected socket
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

    // 4. Notify everyone else in the room that a new presence arrived
    this.publishToRedis(roomId, {
      event: 'user-joined',
      sender: 'SYSTEM',
      payload: { participantId, username, totalConnected: roomPool.size }
    });
  }

/**
   * Publishes messages to the Redis Pub/Sub cluster AND updates the persistent cache hash.
   */
  public async publishToRedis(roomId: string, messageObject: { event: string; sender: string; payload: any }): Promise<void> {
    const { pubClient } = getRedisClients();
    const messageString = JSON.stringify(messageObject);

    try {
      // 1. If this is a live sync message, ensure it passes strict data validation criteria
      if (messageObject.event === 'update') {
        const incomingPayload = messageObject.payload;

        // HARDENED SCHEMA GUARD: Reject null, arrays, or primitive types from hijacking storage
        if (incomingPayload && typeof incomingPayload === 'object' && !Array.isArray(incomingPayload)) {
          await pubClient.hSet(`room:state:${roomId}`, 'document', JSON.stringify(incomingPayload));
        } else {
          console.warn(`[Data Boundary Warning]: Dropped invalid state cache write attempt for room ${roomId}. Payload type: ${typeof incomingPayload}`);
        }
      }

      // 2. Broadcast the message across the wire via Pub/Sub (keeps live communication fluid)
      await pubClient.publish(`room:${roomId}`, messageString);
    } catch (err) {
      console.error(`[Cluster Error]: Failed infrastructure broadcast/write for room ${roomId}:`, err);
    }
  }

  /**
   * Routes incoming cluster messages down to local socket connections.
   */
  private broadcastToLocalRoom(roomId: string, messageString: string): void {
    const roomPool = this.rooms.get(roomId);
    if (!roomPool) return;

    const message = JSON.parse(messageString);

    roomPool.forEach((participant) => {
      // Clean Optimization: Don't echo editing/sync data back to the person who typed it
      if (message.event === 'update' && participant.id === message.sender) {
        return;
      }

      if (participant.ws.readyState === WebSocket.OPEN) {
        participant.ws.send(messageString);
      }
    });
  }

  /**
   * Cleans up room infrastructure allocations when a client disconnects.
   */
  public async leaveRoom(roomId: string, participantId: string): Promise<void> {
    const roomPool = this.rooms.get(roomId);
    if (!roomPool) return;

    const participant = roomPool.get(participantId);
    roomPool.delete(participantId);

    console.log(`[RoomManager]: Participant ${participantId} left room: ${roomId}`);

    // If the room is completely vacant on this server instance, clean up channel subscription allocations
    if (roomPool.size === 0) {
      const { subClient } = getRedisClients();
      this.rooms.delete(roomId);
      await subClient.unsubscribe(`room:${roomId}`);
      console.log(`[Distributed Architecture]: Vacant room. Unsubscribed from channel -> room:${roomId}`);
    } else {
      // Notify remaining players of the exit footprint
      this.publishToRedis(roomId, {
        event: 'user-left',
        sender: 'SYSTEM',
        payload: { participantId, username: participant?.username || 'Anonymous', totalConnected: roomPool.size }
      });
    }
  }
}

export const roomManager = new RoomManager();