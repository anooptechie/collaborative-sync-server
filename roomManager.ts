import { WebSocket } from 'ws';

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
  private rooms: Map<string, Room> = new Map();

  public joinRoom(roomId: string, participantId: string, ws: WebSocket, username: string): void {
    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, { id: roomId, participants: new Map() });
      console.log(`[RoomManager]: New room created -> ${roomId}`);
    }

    const room = this.rooms.get(roomId)!;
    room.participants.set(participantId, { id: participantId, ws, username });

    // 1. Get a list of all current users in the room to send to the newcomer
    const activeUsers = Array.from(room.participants.values()).map(p => ({
      id: p.id,
      username: p.username
    }));

    // 2. Tell the newcomer who is already here
    ws.send(JSON.stringify({
      event: 'room-state',
      roomId,
      assignedId: participantId,
      users: activeUsers
    }));

    // 3. Broadcast to everyone else that a new user stepped in
    this.broadcastToRoom(roomId, participantId, JSON.stringify({
      event: 'user-joined',
      id: participantId,
      username
    }));

    console.log(`[RoomManager]: ${username} (${participantId}) joined ${roomId}`);
  }

  public leaveRoom(roomId: string, participantId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    const participant = room.participants.get(participantId);
    const username = participant ? participant.username : 'Unknown User';

    room.participants.delete(participantId);
    console.log(`[RoomManager]: ${username} left room ${roomId}`);

    // Broadcast to remaining users that this individual disconnected
    if (room.participants.size > 0) {
      this.broadcastToRoom(roomId, participantId, JSON.stringify({
        event: 'user-left',
        id: participantId,
        username
      }));
    } else {
      this.rooms.delete(roomId);
      console.log(`[RoomManager]: Room ${roomId} disposed.`);
    }
  }

  public broadcastToRoom(roomId: string, senderId: string, messageStr: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    room.participants.forEach((participant, participantId) => {
      if (participantId !== senderId && participant.ws.readyState === WebSocket.OPEN) {
        participant.ws.send(messageStr);
      }
    });
  }
}

export const roomManager = new RoomManager();