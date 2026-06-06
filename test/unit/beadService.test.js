import { describe, it, expect } from 'vitest';

import { BeadService } from '../../server/services/BeadService.js';

function makeBdGateway(overrides = {}) {
  return {
    list: async () => ({ ok: true, data: [] }),
    listAcrossRigs: async () => [],
    search: async () => ({ ok: true, data: [] }),
    show: async () => ({ ok: false }),
    create: async () => ({ ok: true, beadId: 'bead-1', raw: '' }),
    ...overrides,
  };
}

describe('BeadService', () => {
  it('maps UI priorities and emits bead_created', async () => {
    const calls = [];
    const emitted = [];

    const bdGateway = makeBdGateway({
      create: async (opts) => {
        calls.push(opts);
        return { ok: true, beadId: 'gt-abc123', raw: 'Created bead: gt-abc123' };
      },
    });

    const service = new BeadService({
      bdGateway,
      emit: (type, data) => emitted.push([type, data]),
    });

    const result = await service.create({
      title: 'Fix login',
      description: 'Steps…',
      priority: 'high',
      labels: ['bug', '', ' ui '],
    });

    expect(result.ok).toBe(true);
    expect(calls[0]).toEqual({
      title: 'Fix login',
      description: 'Steps…',
      priority: 'P1',
      labels: ['bug', ' ui '],
    });
    expect(emitted).toEqual([['bead_created', { bead_id: 'gt-abc123', title: 'Fix login' }]]);
  });

  it('omits default/normal priority', async () => {
    const calls = [];
    const bdGateway = makeBdGateway({
      create: async (opts) => {
        calls.push(opts);
        return { ok: true, beadId: 'bead-1', raw: 'Created bead: bead-1' };
      },
    });

    const service = new BeadService({ bdGateway });
    await service.create({ title: 'T', priority: 'normal' });

    expect(calls[0].priority).toBe(null);
  });

  it('returns ok=false for missing beads', async () => {
    const bdGateway = makeBdGateway({
      show: async () => ({ ok: false, error: 'not found' }),
    });

    const service = new BeadService({ bdGateway });
    await expect(service.get('missing')).resolves.toEqual({ ok: false });
  });

  it('falls back to single-rig list when no gtGateway provided', async () => {
    const beads = [{ id: 'gg-1', title: 'one' }];
    const bdGateway = makeBdGateway({
      list: async () => ({ ok: true, data: beads }),
    });

    const service = new BeadService({ bdGateway });
    const result = await service.list({ status: 'open' });
    expect(result).toEqual(beads);
  });

  it('aggregates beads across rigs when gtGateway is provided', async () => {
    const ggBead = { id: 'gg-1', title: 'gui bead', _rig: 'gastown_gui' };
    const igBead = { id: 'ig-1', title: 'igor bead', _rig: 'igor' };
    const hqBead = { id: 'hq-1', title: 'hq bead', _rig: 'hq' };
    const aggregated = [ggBead, igBead, hqBead];

    const bdGateway = makeBdGateway({
      listAcrossRigs: async () => aggregated,
    });

    const gtGateway = {
      exec: async () => ({ stdout: JSON.stringify([{ name: 'gastown_gui' }, { name: 'igor' }]) }),
    };

    const service = new BeadService({ bdGateway, gtGateway });
    const result = await service.list({ status: 'open' });
    expect(result).toEqual(aggregated);
  });

  it('falls back to single-rig list when gtGateway rig list fails', async () => {
    const beads = [{ id: 'gg-2', title: 'fallback' }];
    const bdGateway = makeBdGateway({
      list: async () => ({ ok: true, data: beads }),
    });

    const gtGateway = {
      exec: async () => { throw new Error('network error'); },
    };

    const service = new BeadService({ bdGateway, gtGateway });
    const result = await service.list({ status: 'open' });
    expect(result).toEqual(beads);
  });
});

