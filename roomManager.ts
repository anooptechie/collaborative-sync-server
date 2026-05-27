import { WebSocket } from 'ws';
import { getRedisClients } from './redisClient.js';
import { db } from './dbClient.js'; 
import { logger } from './logger.js'; // ⚡ Integrated centralized logger

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
      
      logger.info(
        { component: 'DistributedArchitecture', roomId }, 
        'Subscribed to global Redis channel'
      );
    }

    const roomPool = this.rooms.get(roomId)!;
    roomPool.set(participantId, { id: participantId, ws, username });
    
    logger.info(
      { component: 'RoomManager', roomId, participantId, username }, 
      'User joined collaboration room'
    );

    try {
      // 1. First line of defense: Read from hot memory cache
      let cachedState = await pubClient.hGet(`room:state:${roomId}`, 'document');
      
      // 🔄 2. COLD STORAGE HYDRATION TRIPPED
      if (!cachedState) {
        logger.info(
          { component: 'HydrationLayer', roomId }, 
          'Cache miss in hot memory. Inspecting PostgreSQL...'
        );
        
        const dbResult = await db.query(
          'SELECT content FROM room_snapshots WHERE room_id = $1',
          [roomId]
        );

        if (dbResult.rows.length > 0) {
          logger.info(
            { component: 'HydrationLayer', roomId }, 
            'Archival snapshot discovered in Neon. Warming up Redis...'
          );
          const documentData = dbResult.rows[0].content;
          cachedState = JSON.stringify(documentData);

          // Restore hot memory baseline state & fire the sliding 24hr TTL insurance policy
          await pubClient.hSet(`room:state:${roomId}`, 'document', cachedState);
          await pubClient.expire(`room:state:${roomId}`, 86400);
        }
      }

      if (cachedState) {
        logger.debug(
          { component: 'PersistenceLayer', roomId, username }, 
          'Streaming current snapshot to client'
        );
        ws.send(JSON.stringify({
          event: 'snapshot',
          payload: JSON.parse(cachedState)
        }));
      } else {
        logger.info(
          { component: 'PersistenceLayer', roomId }, 
          'No active or archival state found. Instantiating clean canvas.'
        );
      }
    } catch (error) {
      logger.error(
        { component: 'PersistenceLayer', roomId, error }, 
        'Failed to recover state during room hydration sequence'
      );
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
          logger.warn(
            { component: 'DataBoundary', roomId, event: messageObject.event }, 
            'Dropped invalid state cache write attempt'
          );
        }
      }

      await pubClient.publish(`room:${roomId}`, messageString);
    } catch (error) {
      logger.error(
        { component: 'ClusterInfrastructure', roomId, error }, 
        'Failed infrastructure broadcast or state write to Redis hash'
      );
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

    logger.info(
      { component: 'RoomManager', roomId, participantId }, 
      'Participant left room'
    );

    if (roomPool.size === 0) {
      const { pubClient, subClient } = getRedisClients();
      this.rooms.delete(roomId);
      
      await subClient.unsubscribe(`room:${roomId}`);
      logger.info(
        { component: 'DistributedArchitecture', roomId }, 
        'Vacant room on instance. Unsubscribed from channel'
      );
      
      try {
        // 📥 1. Read latest hot snapshot before dropping it
        const currentCachedState = await pubClient.hGet(`room:state:${roomId}`, 'document');

        if (currentCachedState) {
          logger.info(
            { component: 'ColdStorageHandoff', roomId }, 
            'Executing atomic archive flush to Neon PostgreSQL'
          );
          
          // 🗄️ 2. Safe upsert: Insert snapshot or update content if it already existed historically
          await db.query(`
            INSERT INTO room_snapshots (room_id, content, updated_at)
            VALUES ($1, $2, CURRENT_TIMESTAMP)
            ON CONFLICT (room_id)
            DO UPDATE SET content = EXCLUDED.content, updated_at = CURRENT_TIMESTAMP;
          `, [roomId, JSON.parse(currentCachedState)]);
          
          logger.info(
            { component: 'ColdStorageHandoff', roomId }, 
            'Secure write acknowledged by Postgres'
          );
        }

        // 🧹 3. DEFENSE LINE 2: Explicit Eviction on Vacancy
        await pubClient.del(`room:state:${roomId}`);
        logger.info(
          { component: 'EvictionEngine', roomId }, 
          'Room is vacant. Static memory cleared from Redis RAM.'
        );
      } catch (error) {
        // High alert boundary guard: Log the failure but don't wipe Redis if the database flush failed!
        logger.error(
          { component: 'CriticalPersistence', roomId, error }, 
          'Aborting memory clearing. Failed to commit cold snapshot to database'
        );
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