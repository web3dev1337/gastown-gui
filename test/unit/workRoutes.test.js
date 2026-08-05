import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { createServer } from 'node:http';

import { createApp } from '../../server/app/createApp.js';
import { registerWorkRoutes } from '../../server/routes/work.js';

describe('Work routes (real Express app)', () => {
  let server;
  let baseUrl;
  let calls;

  beforeAll(async () => {
    calls = [];
    const workService = {
      sling: async (opts) => {
        calls.push(['sling', opts]);
        return { ok: true, data: { bead: opts.bead, target: opts.target }, raw: 'ok' };
      },
      escalate: async (opts) => {
        calls.push(['escalate', opts]);
        return { ok: true, raw: 'sent', severity: 'HIGH' };
      },
      markDone: async (opts) => {
        calls.push(['markDone', opts]);
        return { ok: true, raw: 'done' };
      },
      park: async (opts) => {
        calls.push(['park', opts]);
        return { ok: true, raw: 'parked' };
      },
      release: async (beadId) => {
        calls.push(['release', beadId]);
        return { ok: true, raw: 'released' };
      },
      reassign: async (opts) => {
        calls.push(['reassign', opts]);
        if (!opts.target) return { ok: false, statusCode: 400, error: 'Target is required' };
        return { ok: true, raw: 'reassigned' };
      },
    };

    const app = createApp({ allowedOrigins: ['*'] });
    registerWorkRoutes(app, { workService });

    server = createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const { port } = server.address();
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('POST /api/sling forwards body and returns success', async () => {
    const res = await fetch(`${baseUrl}/api/sling`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bead: 'bead-1', target: 'mayor', formula: 'mol-review', args: 'do it' }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: true, data: { bead: 'bead-1', target: 'mayor' }, raw: 'ok' });
    expect(calls[0]).toEqual(['sling', {
      bead: 'bead-1',
      target: 'mayor',
      formula: 'mol-review',
      molecule: undefined,
      quality: undefined,
      args: 'do it',
    }]);
  });

  it('POST /api/escalate returns success', async () => {
    const res = await fetch(`${baseUrl}/api/escalate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ convoy_id: 'convoy-1', reason: 'Blocked', priority: 'high' }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: true, data: 'sent' });
    expect(calls[1]).toEqual(['escalate', { convoy_id: 'convoy-1', reason: 'Blocked', priority: 'high' }]);
  });

  it('POST /api/work/:beadId/done calls service and returns message', async () => {
    const res = await fetch(`${baseUrl}/api/work/bead-1/done`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ summary: 'done' }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ success: true, beadId: 'bead-1' });
    expect(calls[2]).toEqual(['markDone', { beadId: 'bead-1', summary: 'done' }]);
  });

  it('POST /api/work/:beadId/reassign returns 400 when target missing', async () => {
    const res = await fetch(`${baseUrl}/api/work/bead-1/reassign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });
});

