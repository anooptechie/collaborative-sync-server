import ws from 'k6/ws';
import { check } from 'k6';

const BASE_URL = __ENV.K6_WS_URL || 'ws://127.0.0.1:8080';
const VALID_TOKEN = __ENV.AUTH_SECRET_TOKEN || 'nexus-sync-super-secret-token';

export const options = {
  stages: [
    { duration: '20s', target: 50 },
    { duration: '30s', target: 100 },
    { duration: '10s', target: 0 },
  ],
  thresholds: {
    'ws_connecting': ['avg<10'],
    'checks': ['rate>0.99'],
  },
};

export default function () {
  const url = `${BASE_URL}?token=${VALID_TOKEN}&username=Anoop_LoadBot`;
  const params = { tags: { test_type: 'nexus_stress_run' } };

  const res = ws.connect(url, params, function (socket) {
    socket.on('open', () => {
      console.log('Virtual User Connected');

      socket.send(JSON.stringify({ action: 'join', roomId: 'performance_test_room' }));

      socket.setInterval(() => {
        socket.send(JSON.stringify({
          action: 'sync',
          payload: { cursorX: Math.random() * 100, cursorY: Math.random() * 100 }
        }));
      }, 2000);
    });

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

    socket.setTimeout(() => {
      socket.close();
    }, 15000);
  });

  check(res, { 'Handshake 101 Success': (r) => r && r.status === 101 });
}