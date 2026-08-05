export function registerWorkRoutes(app, { workService } = {}) {
  if (!workService) throw new Error('registerWorkRoutes requires workService');

  app.post('/api/sling', async (req, res) => {
    try {
      const { bead, target, formula, molecule, quality, args } = req.body;
      const result = await workService.sling({ bead, target, formula, molecule, quality, args });

      if (!result.ok) {
        return res.status(result.statusCode || 500).json(result.body || { error: 'Sling failed' });
      }

      return res.json({ success: true, data: result.data, raw: result.raw });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/escalate', async (req, res) => {
    try {
      const { convoy_id, reason, priority } = req.body;
      const result = await workService.escalate({ convoy_id, reason, priority });

      if (!result.ok) {
        return res.status(result.statusCode || 500).json(result.body || { error: result.error || 'Escalation failed' });
      }

      return res.json({ success: true, data: result.raw });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/work/:beadId/done', async (req, res) => {
    const { beadId } = req.params;
    const { summary } = req.body;

    const result = await workService.markDone({ beadId, summary });
    if (!result.ok) return res.status(500).json({ success: false, error: result.error });

    return res.json({
      success: true,
      beadId,
      message: `${beadId} marked as done`,
      raw: result.raw,
    });
  });

  app.post('/api/work/:beadId/park', async (req, res) => {
    const { beadId } = req.params;
    const { reason } = req.body;

    const result = await workService.park({ beadId, reason });
    if (!result.ok) return res.status(500).json({ success: false, error: result.error });

    return res.json({
      success: true,
      beadId,
      message: `${beadId} parked`,
      raw: result.raw,
    });
  });

  app.post('/api/work/:beadId/release', async (req, res) => {
    const { beadId } = req.params;

    const result = await workService.release(beadId);
    if (!result.ok) return res.status(500).json({ success: false, error: result.error });

    return res.json({
      success: true,
      beadId,
      message: `${beadId} released`,
      raw: result.raw,
    });
  });

  app.post('/api/work/:beadId/reassign', async (req, res) => {
    const { beadId } = req.params;
    const { target } = req.body;

    const result = await workService.reassign({ beadId, target });
    if (!result.ok) {
      const statusCode = result.statusCode || (result.error === 'Target is required' ? 400 : 500);
      return res.status(statusCode).json({ success: false, error: result.error });
    }

    return res.json({
      success: true,
      beadId,
      target,
      message: `${beadId} reassigned to ${target}`,
      raw: result.raw,
    });
  });
}

