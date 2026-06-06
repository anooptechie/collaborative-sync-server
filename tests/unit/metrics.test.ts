import { describe, it, expect, beforeEach } from 'vitest';

describe('Metrics', () => {
  let activeConnectionsGauge: typeof import('../../metrics.js').activeConnectionsGauge;
  let messageCounter: typeof import('../../metrics.js').messageCounter;
  let activeRoomsGauge: typeof import('../../metrics.js').activeRoomsGauge;
  let register: typeof import('../../metrics.js').register;

  beforeEach(async () => {
    const module = await import('../../metrics.js');
    activeConnectionsGauge = module.activeConnectionsGauge;
    messageCounter = module.messageCounter;
    activeRoomsGauge = module.activeRoomsGauge;
    register = module.register;

    // Reset all metrics before each test
    activeConnectionsGauge.reset();
    activeRoomsGauge.reset();
    messageCounter.reset();
  });

  // ✅ ACTIVE CONNECTIONS GAUGE
  describe('activeConnectionsGauge', () => {
    it('should start at 0', async () => {
      const data = await activeConnectionsGauge.get();
      const value = data.values[0]?.value ?? 0;
      expect(value).toBe(0);
    });

    it('should increment by 1', async () => {
      activeConnectionsGauge.inc();
      const data = await activeConnectionsGauge.get();
      expect(data.values[0].value).toBe(1);
    });

    it('should increment multiple times', async () => {
      activeConnectionsGauge.inc();
      activeConnectionsGauge.inc();
      activeConnectionsGauge.inc();
      const data = await activeConnectionsGauge.get();
      expect(data.values[0].value).toBe(3);
    });

    it('should decrement correctly', async () => {
      activeConnectionsGauge.inc();
      activeConnectionsGauge.inc();
      activeConnectionsGauge.dec();
      const data = await activeConnectionsGauge.get();
      expect(data.values[0].value).toBe(1);
    });

    it('should set to a specific value', async () => {
      activeConnectionsGauge.set(42);
      const data = await activeConnectionsGauge.get();
      expect(data.values[0].value).toBe(42);
    });
  });

  // ✅ ACTIVE ROOMS GAUGE
  describe('activeRoomsGauge', () => {
    it('should start at 0', async () => {
      const data = await activeRoomsGauge.get();
      const value = data.values[0]?.value ?? 0;
      expect(value).toBe(0);
    });

    it('should increment when room is created', async () => {
      activeRoomsGauge.inc();
      const data = await activeRoomsGauge.get();
      expect(data.values[0].value).toBe(1);
    });

    it('should decrement when room is disposed', async () => {
      activeRoomsGauge.inc();
      activeRoomsGauge.inc();
      activeRoomsGauge.dec();
      const data = await activeRoomsGauge.get();
      expect(data.values[0].value).toBe(1);
    });
  });

  // ✅ MESSAGE COUNTER
  describe('messageCounter', () => {
    it('should start at 0 for all labels', async () => {
      const data = await messageCounter.get();
      const total = data.values.reduce((sum, v) => sum + v.value, 0);
      expect(total).toBe(0);
    });

    it('should increment with join action label', async () => {
      messageCounter.inc({ action: 'join' });
      const data = await messageCounter.get();
      const joinEntry = data.values.find(v => v.labels.action === 'join');
      expect(joinEntry?.value).toBe(1);
    });

    it('should increment with sync action label', async () => {
      messageCounter.inc({ action: 'sync' });
      const data = await messageCounter.get();
      const syncEntry = data.values.find(v => v.labels.action === 'sync');
      expect(syncEntry?.value).toBe(1);
    });

    it('should track multiple action types independently', async () => {
      messageCounter.inc({ action: 'join' });
      messageCounter.inc({ action: 'join' });
      messageCounter.inc({ action: 'sync' });
      messageCounter.inc({ action: 'invalid' });

      const data = await messageCounter.get();
      const joinEntry = data.values.find(v => v.labels.action === 'join');
      const syncEntry = data.values.find(v => v.labels.action === 'sync');
      const invalidEntry = data.values.find(v => v.labels.action === 'invalid');

      expect(joinEntry?.value).toBe(2);
      expect(syncEntry?.value).toBe(1);
      expect(invalidEntry?.value).toBe(1);
    });

    it('should track malformed_json label', async () => {
      messageCounter.inc({ action: 'malformed_json' });
      const data = await messageCounter.get();
      const entry = data.values.find(v => v.labels.action === 'malformed_json');
      expect(entry?.value).toBe(1);
    });
  });

  // ✅ REGISTRY
  describe('Prometheus Registry', () => {
    it('should expose metrics in Prometheus text format', async () => {
      const output = await register.metrics();
      expect(typeof output).toBe('string');
      expect(output).toContain('nexus_sync_active_connections');
      expect(output).toContain('nexus_sync_messages_total');
      expect(output).toContain('nexus_sync_active_rooms');
    });

    it('should include default Node.js metrics', async () => {
      const output = await register.metrics();
      expect(output).toContain('process_cpu_seconds_total');
    });

    it('should return correct content type', () => {
      expect(register.contentType).toContain('text/plain');
    });
  });
});