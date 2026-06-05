import client from 'prom-client';
import { logger } from './logger.js';

// Create a Registry to register the metrics
export const register = new client.Registry();

// Enable the collection of default Node.js metrics (CPU, Memory, Event loop Lag)
client.collectDefaultMetrics({ register });

/**
 * 🎛️ Metric 1: Active WebSocket Connections Gauge
 */
export const activeConnectionsGauge = new client.Gauge({
  name: 'nexus_sync_active_connections',
  help: 'Total number of concurrently active WebSocket connections on this instance',
});

/**
 * 🎛️ Metric 2: Message Throughput Counter (Enriched with action type labels)
 */
export const messageCounter = new client.Counter({
  name: 'nexus_sync_messages_total',
  help: 'Total number of processed incoming WebSocket messages',
  labelNames: ['action'],
});

/**
 * 🎛️ Metric 3: Active Collaboration Rooms Gauge
 */
export const activeRoomsGauge = new client.Gauge({
  name: 'nexus_sync_active_rooms',
  help: 'Total number of active distributed rooms running in server memory',
});

// Register custom infrastructure metrics
register.registerMetric(activeConnectionsGauge);
register.registerMetric(messageCounter);
register.registerMetric(activeRoomsGauge);

// --- TELEMETRY PUSH ENGINE (GRAPHITE TEXT INGESTION) ---

const GRAPHITE_USER_ID = process.env.GRAPHITE_USER_ID_ENV;
const API_TOKEN = process.env.GRAFANA_API_TOKEN;

const PUSH_URL = `https://graphite-prod-43-prod-ap-south-1.grafana.net/graphite/metrics`;

const authHeader = 'Basic ' + Buffer.from(`${GRAPHITE_USER_ID}:${API_TOKEN}`).toString('base64');

logger.info({ component: 'TelemetryEngine' }, 'Outbound Graphite text push engine initialized.');

setInterval(async () => {
  try {
    // 1. Fetch current active connection count
    const connectionsData = await activeConnectionsGauge.get();
    const activeConnections = connectionsData.values[0]?.value ?? 0;

    // 2. Fetch total messages handled across all action labels
    const messageData = await messageCounter.get();
    const totalMessages = messageData.values.reduce((sum, v) => sum + v.value, 0);

    const timestamp = Math.floor(Date.now() / 1000);

    const payload = JSON.stringify([
      {
        name: "nexus_sync.active_connections",
        value: activeConnections,
        time: timestamp,
        interval: 10
      },
      {
        name: "nexus_sync.total_messages",
        value: totalMessages,
        time: timestamp,
        interval: 10
      }
    ]);

    const res = await fetch(PUSH_URL, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      },
      body: payload,
    });

    if (res.ok) {
      logger.info(
        { component: 'TelemetryEngine', activeConnections, totalMessages },
        'Metrics accepted by Grafana Cloud'
      );
    } else {
      const errorText = await res.text();
      logger.warn(
        { component: 'TelemetryEngine', status: res.status, reason: errorText },
        'Grafana rejected telemetry payload'
      );
    }

  } catch (error) {
    logger.error(
      { component: 'TelemetryEngine', error },
      'Outbound telemetry push engine exception'
    );
  }
}, 10000);