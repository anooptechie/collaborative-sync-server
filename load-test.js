import ws from 'k6/ws';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '20s', target: 20 },  // Ramp up from 0 to 20 concurrent users over 20s
    { duration: '30s', target: 20 },  // Hold 20 users steady for 30 seconds
    { duration: '10s', target: 0 },   // Clean ramp down to 0 users
  ],
};

export default function () {
  // ⚡ FIXED: Appending the exact SECRET_TOKEN expected by your authService structure
  const url = 'ws://127.0.0.1:8999?token=nexus-sync-super-secret-token&username=Anoop_LoadBot';
  const params = { tags: { test_type: 'nexus_stress_run' } };

  const res = ws.connect(url, params, function (socket) {
    socket.on('open', () => {
      console.log('Virtual User Connected');

      // Instantly hit the join action route
      socket.send(JSON.stringify({ action: 'join', roomId: 'performance_test_room' }));

      // Periodically stream sync actions every 2 seconds to rack up the message count
      socket.setInterval(() => {
        socket.send(JSON.stringify({ 
          action: 'sync', 
          payload: { cursorX: Math.random() * 100, cursorY: Math.random() * 100 } 
        }));
      }, 2000);
    });

    // Automatically disconnect each virtual user after 15 seconds
    socket.setTimeout(() => {
      socket.close();
    }, 15000);
  });

  check(res, { 'Handshake 101 Success': (r) => r && r.status === 101 });
}