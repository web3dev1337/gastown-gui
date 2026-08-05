export function registerModelPolicyRoutes(app, { modelPolicyService } = {}) {
  if (!modelPolicyService) throw new Error('registerModelPolicyRoutes requires modelPolicyService');

  app.get('/api/model-policy', async (req, res) => {
    try {
      const policy = await modelPolicyService.getPolicy({ refresh: req.query.refresh === 'true' });
      res.json(policy);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}
