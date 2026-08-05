function parseJsonOrNull(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export class GTGateway {
  constructor({ runner, gtRoot, executable = 'gt' }) {
    if (!runner?.exec) throw new Error('GTGateway requires a runner with exec()');
    if (!gtRoot) throw new Error('GTGateway requires gtRoot');
    this._runner = runner;
    this._gtRoot = gtRoot;
    this._executable = executable;
  }

  async exec(args, options = {}) {
    return this._runner.exec(this._executable, args, { cwd: this._gtRoot, ...options });
  }

  async status({ fast = true, allowExitCodes } = {}) {
    const args = ['status', '--json'];
    if (fast) args.push('--fast');
    const result = await this.exec(args, { timeoutMs: 30000, allowExitCodes });
    const raw = (result.stdout || '').trim();
    return { ...result, raw, data: parseJsonOrNull(raw) };
  }

  async listConvoys({ all = false, status } = {}) {
    const args = ['convoy', 'list', '--json'];
    if (all) args.push('--all');
    if (status) args.push(`--status=${status}`);
    const result = await this.exec(args, { timeoutMs: 30000 });
    const raw = (result.stdout || '').trim();
    return { ...result, raw, data: parseJsonOrNull(raw) };
  }

  async convoyStatus(convoyId) {
    const result = await this.exec(['convoy', 'status', convoyId, '--json'], { timeoutMs: 30000 });
    const raw = (result.stdout || '').trim();
    return { ...result, raw, data: parseJsonOrNull(raw) };
  }

  async createConvoy({ name, issues = [], notify } = {}) {
    const args = ['convoy', 'create', name, ...(issues || [])];
    if (notify) args.push('--notify', notify);

    const result = await this.exec(args, { timeoutMs: 30000 });
    const raw = (result.stdout || '').trim();

    const match = raw.match(/(?:Created|created)\s*(?:convoy)?:?\s*(\S+)/i);
    const convoyId = match ? match[1] : null;

    return { ...result, raw, convoyId };
  }

  // `molecule` and `quality` are legacy aliases kept for one release: the GUI used to
  // send them as `--molecule` / `--quality`, neither of which exists in `gt sling`.
  // `molecule` carried free-text instructions (-> --args) and `quality` named a formula
  // (-> --formula).
  async sling({ bead, target, formula, molecule, quality, args: slingArgs } = {}) {
    const effectiveFormula = formula || quality;
    const effectiveArgs = slingArgs || molecule;

    const cmdArgs = ['sling', bead];
    if (target) cmdArgs.push(target);
    if (effectiveFormula) cmdArgs.push('--formula', effectiveFormula);
    if (effectiveArgs) cmdArgs.push('--args', effectiveArgs);

    const result = await this.exec(cmdArgs, { timeoutMs: 90000 });
    const raw = `${result.stdout || ''}${result.stderr || ''}`.trim();
    return { ...result, raw };
  }

  async escalate({ topic, severity, message } = {}) {
    if (!topic) throw new Error('GTGateway.escalate requires topic');
    if (!message) throw new Error('GTGateway.escalate requires message');

    const args = ['escalate', topic, '-s', severity || 'MEDIUM', '-r', message];
    const result = await this.exec(args, { timeoutMs: 30000 });
    const raw = `${result.stdout || ''}${result.stderr || ''}`.trim();
    return { ...result, raw };
  }
}
