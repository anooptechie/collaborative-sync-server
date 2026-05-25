import { WebSocket } from 'ws';

// Define what a Participant looks like in our memory space
interface Participant {
  id: string;
  ws: WebSocket;
  username?: string;
}

// Define the structure of a Collaborative Room
interface Room {
  id: string;
  participants: Map<string, Participant>; // Key: participantId, Value: Participant details
}

class RoomManager {
  // Global memory store: Key is roomId, Value is the Room object
  private rooms: Map<string, Room> = new Map();

  /**
   * Adds a user connection to a specific room. 
   * If the room doesn't exist yet, it creates it on the fly.
   */
  public joinRoom(roomId: string, participantId: string, ws: WebSocket, username?: string): void {
    // 1. Get or create the room
    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, {
        id: roomId,
        participants: new Map()
      });
      console.log(`[RoomManager]: New room created -> ${roomId}`);
    }

    const room = this.rooms.get(roomId)!;

    // 2. Add the participant to the room
    room.participants.set(participantId, { id: participantId, ws, username });
    console.log(`[RoomManager]: Participant ${participantId} joined room ${roomId} (Total: ${room.participants.size})`);
  }

  /**
   * Removes a user connection from a room, and cleanly tears down 
   * the room entirely if it becomes empty to prevent memory leaks.
   */
  public leaveRoom(roomId: string, participantId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    room.participants.delete(participantId);
    console.log(`[RoomManager]: Participant ${participantId} left room ${roomId}`);

    // Clean up empty rooms to save memory
    if (room.participants.size === 0) {
      this.rooms.delete(roomId);
      console.log(`[RoomManager]: Room ${roomId} is empty. Disposing room memory allocation.`);
    }
  }

  /**
   * Broadcasts a message string to every single connection inside a room 
   * *except* the client who originally sent it (the sender).
   */
  public broadcastToRoom(roomId: string, senderId: string, messageStr: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    room.participants.forEach((participant, participantId) => {
      // Don't send the message back to the person who broadcasted it!
      if (participantId !== senderId && participant.ws.readyState === WebSocket.OPEN) {
        participant.ws.send(messageStr);
      }
    });
  }
}

// Export a single global instance for our server to use
export const roomManager = new RoomManager();