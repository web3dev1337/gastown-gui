function parseJsonOrNull(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function analyzeSlingOutput(output) {
  const raw = String(output || '');
  return {
    raw,
    workAttached: raw.includes('Work attached to hook') || raw.includes('✓ Work attached'),
    promptSent: raw.includes('Start prompt sent') || raw.includes('▶ Start prompt sent'),
    polecatSpawned: raw.includes('Polecat') && raw.includes('spawned'),
  };
}

function slingErrorResponse({ errorMsg }) {
  const text = String(errorMsg || '');

  const formulaMatch = text.match(/formula '([^']+)' not found/);
  if (formulaMatch) {
    const formula = formulaMatch[1];
    return {
      statusCode: 400,
      body: {
        error: `Formula '${formula}' not found`,
        errorType: 'formula_missing',
        formula,
        hint: `Create the formula at ~/.beads/formulas/${formula}.toml or try a different quality level`,
        fix: {
          action: 'create_formula',
          formula,
          command: `mkdir -p ~/.beads/formulas && cat > ~/.beads/formulas/${formula}.toml`,
        },
      },
    };
  }

  if (text.includes('bead') && text.includes('not found')) {
    return {
      statusCode: 400,
      body: {
        error: 'Bead not found',
        errorType: 'bead_missing',
        hint: 'The issue/bead ID does not exist. Check the ID or create a new bead.',
        fix: {
          action: 'search_beads',
          command: 'bd list',
        },
      },
    };
  }

  return {
    statusCode: 500,
    body: { error: text || 'Sling failed - no work attached' },
  };
}

export class WorkService {
  constructor({ gtGateway, bdGateway, emit } = {}) {
    if (!gtGateway) throw new Error('WorkService requires gtGateway');
    if (!gtGateway.sling) throw new Error('WorkService requires gtGateway.sling()');
    if (!gtGateway.escalate) throw new Error('WorkService requires gtGateway.escalate()');
    if (!bdGateway) throw new Error('WorkService requires bdGateway');
    if (!bdGateway.markDone) throw new Error('WorkService requires bdGateway.markDone()');
    if (!bdGateway.park) throw new Error('WorkService requires bdGateway.park()');
    if (!bdGateway.release) throw new Error('WorkService requires bdGateway.release()');
    if (!bdGateway.reassign) throw new Error('WorkService requires bdGateway.reassign()');

    this._gt = gtGateway;
    this._bd = bdGateway;
    this._emit = emit ?? null;
  }

  async sling({ bead, target, formula, molecule, quality, args } = {}) {
    const result = await this._gt.sling({ bead, target, formula, molecule, quality, args });
    const { raw, workAttached, promptSent, polecatSpawned } = analyzeSlingOutput(result.raw);

    const ok = Boolean(result.ok || workAttached || promptSent);
    if (!ok) {
      const { statusCode, body } = slingErrorResponse({ errorMsg: raw || result.error });
      return { ok: false, statusCode, body };
    }

    const jsonData = parseJsonOrNull(String(result.stdout || '').trim());
    const responseData = jsonData || {
      bead,
      target,
      workAttached,
      promptSent,
      polecatSpawned,
      raw,
    };

    this._emit?.('work_slung', responseData);
    return { ok: true, data: responseData, raw };
  }

  async escalate({ convoy_id, reason, priority } = {}) {
    if (!reason) return { ok: false, statusCode: 400, body: { error: 'Reason is required' } };

    const severityMap = {
      normal: 'MEDIUM',
      high: 'HIGH',
      critical: 'CRITICAL',
    };
    const severity = severityMap[String(priority || '').toLowerCase()] || 'MEDIUM';

    const topic = convoy_id
      ? `Convoy ${String(convoy_id).slice(0, 8)} needs attention`
      : 'Issue needs attention';

    const result = await this._gt.escalate({ topic, severity, message: reason });
    if (!result.ok) {
      return { ok: false, statusCode: 500, body: { error: result.error || result.raw } };
    }

    this._emit?.('escalation', { convoy_id, reason, priority, severity });
    return { ok: true, raw: result.raw, severity };
  }

  async markDone({ beadId, summary } = {}) {
    const result = await this._bd.markDone({ beadId, summary });
    if (!result.ok) return { ok: false, error: result.error || 'Failed to mark as done' };

    this._emit?.('work_done', { beadId, summary });
    return { ok: true, raw: result.raw };
  }

  async park({ beadId, reason } = {}) {
    const result = await this._bd.park({ beadId, reason });
    if (!result.ok) return { ok: false, error: result.error || 'Failed to park work' };

    this._emit?.('work_parked', { beadId, reason });
    return { ok: true, raw: result.raw };
  }

  async release(beadId) {
    const result = await this._bd.release(beadId);
    if (!result.ok) return { ok: false, error: result.error || 'Failed to release work' };

    this._emit?.('work_released', { beadId });
    return { ok: true, raw: result.raw };
  }

  async reassign({ beadId, target } = {}) {
    if (!target) return { ok: false, statusCode: 400, error: 'Target is required' };

    const result = await this._bd.reassign({ beadId, target });
    if (!result.ok) return { ok: false, statusCode: 500, error: result.error || 'Failed to reassign work' };

    this._emit?.('work_reassigned', { beadId, target });
    return { ok: true, raw: result.raw };
  }
}
