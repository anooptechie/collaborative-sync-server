import client from 'prom-client';

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

const GRAPHITE_USER_ID = '3264995'; // 👈 Use the ID from your Graphite Data Source
const API_TOKEN = process.env.GRAFANA_API_TOKEN;    // 👈 Your existing Access Policy Token (glc_...)

// Target the standard metrics API push endpoint for Graphite
const PUSH_URL = `https://graphite-prod-43-prod-ap-south-1.grafana.net/graphite/metrics`;

const authHeader = 'Basic ' + Buffer.from(`${GRAPHITE_USER_ID}:${API_TOKEN}`).toString('base64');

console.log('[Telemetry] Outbound Graphite text push engine initialized.');

setInterval(async () => {
  try {
    // 1. Extract the current metric value from your active connection gauge
    const gaugeMetrics = await activeConnectionsGauge.get();
    const activeConnections = gaugeMetrics.values[0]?.value ?? 0;
    
    // 2. Format the payload as standard Graphite plaintext line protocol
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify([
      {
        name: "nexus_sync.active_connections",
        value: activeConnections,
        time: timestamp,
        interval: 10
      }
    ]);

    // 3. Post the plain text JSON payload out to Grafana
    const response = await fetch(PUSH_URL, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      },
      body: payload,
    });

    if (response.ok) {
      console.log(`[Telemetry] Metrics pushed to Graphite! Status: ${response.status}`);
    } else {
      const errorText = await response.text();
      console.error(`[Telemetry Failure] Graphite rejected metrics. Code: ${response.status} - ${errorText}`);
    }
  } catch (error) {
    console.error('[Telemetry Network Error]:', error);
  }
}, 10000); // Streams every 10 seconds


