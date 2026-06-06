const PRIORITY_MAP = {
  urgent: 'P0',
  critical: 'P0',
  high: 'P1',
  normal: 'P2',
  low: 'P3',
  backlog: 'P4',
};

function normalizeLabels(labels) {
  if (!Array.isArray(labels)) return [];
  return labels.filter((label) => typeof label === 'string' && label.trim().length > 0);
}

export class BeadService {
  constructor({ bdGateway, gtGateway, emit } = {}) {
    if (!bdGateway) throw new Error('BeadService requires bdGateway');
    if (!bdGateway.list) throw new Error('BeadService requires bdGateway.list()');
    if (!bdGateway.search) throw new Error('BeadService requires bdGateway.search()');
    if (!bdGateway.show) throw new Error('BeadService requires bdGateway.show()');
    if (!bdGateway.create) throw new Error('BeadService requires bdGateway.create()');

    this._bd = bdGateway;
    this._gt = gtGateway ?? null;
    this._emit = emit ?? null;
  }

  async _getRigNames() {
    if (!this._gt?.exec) return [];
    try {
      const result = await this._gt.exec(['rig', 'list', '--json'], { timeoutMs: 10000 });
      const parsed = JSON.parse((result.stdout || '').trim());
      if (Array.isArray(parsed)) return parsed.map((r) => r.name).filter(Boolean);
    } catch {
      // ignore — fall back to single-rig mode
    }
    return [];
  }

  async list({ status } = {}) {
    const rigNames = await this._getRigNames();
    if (rigNames.length === 0) {
      const result = await this._bd.list({ status });
      if (!result.ok || !Array.isArray(result.data)) return [];
      return result.data;
    }
    return this._bd.listAcrossRigs({ rigNames, status });
  }

  async search(query) {
    const result = await this._bd.search(query ?? '');
    if (!result.ok || !Array.isArray(result.data)) return [];
    return result.data;
  }

  async get(beadId) {
    const result = await this._bd.show(beadId);
    if (!result.ok) return { ok: false };
    return { ok: true, bead: result.data || { id: beadId } };
  }

  async create({ title, description, priority, labels } = {}) {
    if (!title) return { ok: false, statusCode: 400, error: 'Title is required' };

    const normalizedPriority = priority ? PRIORITY_MAP[String(priority).toLowerCase()] || String(priority) : null;
    const normalizedLabels = normalizeLabels(labels);

    const result = await this._bd.create({
      title,
      description,
      priority: normalizedPriority && normalizedPriority !== 'P2' ? normalizedPriority : null,
      labels: normalizedLabels,
    });

    if (!result.ok) return { ok: false, statusCode: 500, error: result.error || 'Failed to create bead' };

    const beadId = result.beadId || null;
    if (beadId) {
      this._emit?.('bead_created', { bead_id: beadId, title });
    }

    return { ok: true, beadId, raw: result.raw };
  }
}

