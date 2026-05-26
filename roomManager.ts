import { WebSocket } from 'ws';
import { pubClient, subClient } from './redisClient.js';

interface Participant {
  id: string;
  ws: WebSocket;
  username: string;
}

interface Room {
  id: string;
  participants: Map<string, Participant>;
}

class RoomManager {
  // We still track local connections on this specific server instance
  private localRooms: Map<string, Room> = new Map();
  // Keep track of which Redis channels this server instance has already subscribed to
  private activeSubscriptions: Set<string> = new Set();

  /**
   * Adds a user connection to a room and ensures the server instance
   * is subscribed to the global Redis channel for that room.
   */
  public async joinRoom(roomId: string, participantId: string, ws: WebSocket, username: string): Promise<void> {
    // 1. Initialize local room tracking if it doesn't exist on this instance
    if (!this.localRooms.has(roomId)) {
      this.localRooms.set(roomId, { id: roomId, participants: new Map() });
    }

    const room = this.localRooms.get(roomId)!;
    room.participants.set(participantId, { id: participantId, ws, username });

    // 2. Dynamically bind this server instance to the Redis channel if it hasn't yet
    const redisChannel = `room:${roomId}`;
    if (!this.activeSubscriptions.has(redisChannel)) {
      this.activeSubscriptions.add(redisChannel);
      
      await subClient.subscribe(redisChannel, (messageStr) => {
        // This callback triggers whenever ANY node instance publishes to this channel!
        this.handleRedisInboundBroadcast(roomId, messageStr);
      });
      console.log(`[Distributed Architecture]: Subscribed to global Redis channel -> ${redisChannel}`);
    }

    // 3. Inform the local newcomer who is currently sitting on *this specific instance*
    // (Note: To get global room state across all servers, we will add persistence in a later phase!)
    const activeLocalUsers = Array.from(room.participants.values()).map(p => ({
      id: p.id,
      username: p.username
    }));

    ws.send(JSON.stringify({
      event: 'room-state',
      roomId,
      assignedId: participantId,
      users: activeLocalUsers
    }));

    // 4. Publish the 'user-joined' event globally so ALL instances know someone stepped in
    await this.publishToRedis(roomId, {
      event: 'user-joined',
      id: participantId,
      username
    });

    console.log(`[RoomManager]: ${username} connected to local memory for room ${roomId}`);
  }

  /**
   * Removes a user connection from a room and tears down global subscriptions
   * if this server instance no longer has anyone locally listening to that room.
   */
  public async leaveRoom(roomId: string, participantId: string): Promise<void> {
    const room = this.localRooms.get(roomId);
    if (!room) return;

    const participant = room.participants.get(participantId);
    const username = participant ? participant.username : 'Unknown User';

    room.participants.delete(participantId);
    console.log(`[RoomManager]: ${username} disconnected from local memory.`);

    // Publish the exit event globally across the nervous system
    await this.publishToRedis(roomId, {
      event: 'user-left',
      id: participantId,
      username
    });

    // Clean up infrastructure if this instance has zero local clients left in that room
    if (room.participants.size === 0) {
      this.localRooms.delete(roomId);
      const redisChannel = `room:${roomId}`;
      
      if (this.activeSubscriptions.has(redisChannel)) {
        await subClient.unsubscribe(redisChannel);
        this.activeSubscriptions.delete(redisChannel);
        console.log(`[Distributed Architecture]: Unsubscribed from empty global channel -> ${redisChannel}`);
      }
    }
  }

  /**
   * Publishes a data payload object into the global Redis cluster.
   */
  public async publishToRedis(roomId: string, payload: any): Promise<void> {
    const redisChannel = `room:${roomId}`;
    // Redis only transmits strings, so we serialize the object frame on the way out
    const serializedData = JSON.stringify(payload);
    await pubClient.publish(redisChannel, serializedData);
  }

  /**
   * Intercepts incoming messages fanned out by the Redis cluster and
   * streams them to every local socket connection active on this instance.
   */
  private handleRedisInboundBroadcast(roomId: string, messageStr: string): void {
    const room = this.localRooms.get(roomId);
    if (!room) return;

    try {
      const parsedData = JSON.parse(messageStr);
      const senderId = parsedData.id || parsedData.sender;

      // Fan out to every socket connection managed by this local instance
      room.participants.forEach((participant, participantId) => {
        // Intelligently skip sending the message back to the original browser client
        if (participantId !== senderId && participant.ws.readyState === WebSocket.OPEN) {
          participant.ws.send(messageStr);
        }
      });
    } catch (err) {
      console.error('[Distributed Router Error]: Failed to route frame stream.', err);
    }
  }
}

export const roomManager = new RoomManager();