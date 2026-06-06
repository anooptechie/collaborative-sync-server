import ws from 'k6/ws';
import { check } from 'k6';

export const options = {
  stages: [
    { duration: '20s', target: 50 },  // Ramp up to 50 concurrent users over 20s
    { duration: '30s', target: 100 }, // Hold 100 users steady for 30 seconds
    { duration: '10s', target: 0 },   // Clean ramp down to 0 users
  ],
  thresholds: {
    // ✅ Fail the pipeline if WebSocket connection time exceeds 10ms on average
    'ws_connecting': ['avg<10'],
    // ✅ Fail the pipeline if more than 1% of checks fail
    'checks': ['rate>0.99'],
  },
};

export default function () {
  const url = 'ws://127.0.0.1:8080?token=nexus-sync-super-secret-token&username=Anoop_LoadBot';
  const params = { tags: { test_type: 'nexus_stress_run' } };

  const res = ws.connect(url, params, function (socket) {
    socket.on('open', () => {
      console.log('Virtual User Connected');

      // Instantly hit the join action route
      socket.send(JSON.stringify({ action: 'join', roomId: 'performance_test_room' }));

      // Periodically stream sync actions every 2 seconds
      socket.setInterval(() => {
        socket.send(JSON.stringify({
          action: 'sync',
          payload: { cursorX: Math.random() * 100, cursorY: Math.random() * 100 }
        }));
      }, 2000);
    });

    // ✅ Validate every message the server sends back
    socket.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        check(msg, {
          'response has valid event field': (m) => m.event !== undefined,
          'response is not an error event': (m) => m.event !== 'error',
        });
      } catch {
        check(null, { 'response is valid JSON': () => false });
      }
    });

    socket.on('error', (e) => {
      check(null, { 'no socket errors': () => false });
      console.error('Socket error:', e);
    });

    // Automatically disconnect each virtual user after 15 seconds
    socket.setTimeout(() => {
      socket.close();
    }, 15000);
  });

  // ✅ Verify the WebSocket handshake returned 101 Switching Protocols
  check(res, { 'Handshake 101 Success': (r) => r && r.status === 101 });
}