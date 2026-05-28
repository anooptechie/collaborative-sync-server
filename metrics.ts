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

const GRAPHITE_USER_ID = '3264995'; // 👈 Your Graphite Data Source Instance ID
const API_TOKEN = process.env.GRAFANA_API_TOKEN; // 👈 Your glc_... Access Policy Token

// Target the standard metrics API push endpoint for Graphite
const PUSH_URL = `https://graphite-prod-43-prod-ap-south-1.grafana.net/graphite/metrics`;

// Pre-compute basic authentication token safely
const authHeader = 'Basic ' + Buffer.from(`${GRAPHITE_USER_ID}:${API_TOKEN}`).toString('base64');

console.log('[Telemetry] Outbound Graphite text push engine initialized.');

setInterval(async () => {
  try {
    // 1. Fetch current active connection count
    const connectionsData = await activeConnectionsGauge.get();
    const activeConnections = connectionsData.values[0]?.value ?? 0;

    // 2. Fetch total messages handled across all action labels
    const messageData = await messageCounter.get();
    const totalMessages = messageData.values.reduce((sum, v) => sum + v.value, 0);
    
    const timestamp = Math.floor(Date.now() / 1000);

    // 🟢 FIXED: Grafana Cloud's HTTP API demands JSON matching this explicit schema
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

    // 3. Send it off securely using the exact authHeader and application/json Content-Type
    const res = await fetch(PUSH_URL, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      },
      body: payload,
    });

    // 4. Trace the results in your server terminal
    if (res.ok) {
      console.log(`[Telemetry Sync]: 🚀 Metrics accepted by Grafana Cloud! (Conns: ${activeConnections}, Msgs: ${totalMessages})`);
    } else {
      // Read the underlying error body to see exactly why it's complaining
      const errorText = await res.text();
      console.error(`[Telemetry Warning]: Grafana rejected payload. Status: ${res.status}, Reason: ${errorText}`);
    }

  } catch (error) {
    console.error('[Telemetry Sync Failure]: Outbound engine exception:', error);
  }
}, 10000); // Ships data every 10 seconds