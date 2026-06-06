import path from 'node:path';

function parseJsonOrNull(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export class BDGateway {
  constructor({ runner, gtRoot, executable = 'bd' }) {
    if (!runner?.exec) throw new Error('BDGateway requires a runner with exec()');
    if (!gtRoot) throw new Error('BDGateway requires gtRoot');
    this._runner = runner;
    this._gtRoot = gtRoot;
    this._executable = executable;
    this._beadsDir = path.join(gtRoot, '.beads');
    this._supportsNoDaemon = null;
  }

  async exec(args, options = {}) {
    const env = { BEADS_DIR: this._beadsDir, ...(options.env ?? {}) };
    return this._runner.exec(this._executable, args, { cwd: this._gtRoot, ...options, env });
  }

  _resultText(result) {
    return `${result?.stdout || ''}\n${result?.stderr || ''}\n${result?.error || ''}`;
  }

  _isUnknownNoDaemon(result) {
    return /unknown flag:\s*--no-daemon/i.test(this._resultText(result));
  }

  async _supportsNoDaemonFlag() {
    if (this._supportsNoDaemon !== null) return this._supportsNoDaemon;

    const probe = await this.exec(['--no-daemon', 'version'], { timeoutMs: 5000, allowExitCodes: [0, 1] });
    this._supportsNoDaemon = !this._isUnknownNoDaemon(probe);
    return this._supportsNoDaemon;
  }

  async _execCompat(args, options = {}) {
    const supportsNoDaemon = await this._supportsNoDaemonFlag();
    if (!supportsNoDaemon) return this.exec(args, options);

    const noDaemonArgs = ['--no-daemon', ...args];
    const result = await this.exec(noDaemonArgs, options);
    if (!this._isUnknownNoDaemon(result)) return result;

    this._supportsNoDaemon = false;
    return this.exec(args, options);
  }

  async list({ status } = {}) {
    const args = ['list'];
    if (status) args.push(`--status=${status}`);
    args.push('--json');

    const result = await this._execCompat(args, { timeoutMs: 30000 });
    const raw = (result.stdout || '').trim();
    return { ...result, raw, data: parseJsonOrNull(raw) };
  }

  async listForDir(beadsDir, { status } = {}) {
    const args = ['list'];
    if (status) args.push(`--status=${status}`);
    args.push('--json');

    const result = await this._execCompat(args, { timeoutMs: 30000, env: { BEADS_DIR: beadsDir } });
    const raw = (result.stdout || '').trim();
    return { ...result, raw, data: parseJsonOrNull(raw) };
  }

  async listAcrossRigs({ rigNames = [], status } = {}) {
    const sources = [
      { rig: 'hq', beadsDir: path.join(this._gtRoot, '.beads') },
      ...rigNames.map((name) => ({ rig: name, beadsDir: path.join(this._gtRoot, name, '.beads') })),
    ];

    const results = await Promise.all(
      sources.map(async ({ rig, beadsDir }) => {
        try {
          const result = await this.listForDir(beadsDir, { status });
          if (!Array.isArray(result.data)) return [];
          return result.data.map((bead) => ({ ...bead, _rig: rig }));
        } catch {
          return [];
        }
      })
    );

    return results.flat();
  }

  async search(query) {
    const args = [query ? 'search' : 'list'];
    if (query) args.push(query);
    args.push('--json');

    const result = await this._execCompat(args, { timeoutMs: 30000 });
    const raw = (result.stdout || '').trim();
    return { ...result, raw, data: parseJsonOrNull(raw) };
  }

  async create({ title, description, priority, labels } = {}) {
    const args = ['new', title];
    if (description) args.push('--description', description);
    if (priority) args.push('--priority', priority);
    if (Array.isArray(labels)) {
      labels.forEach((label) => {
        args.push('--label', label);
      });
    }

    const result = await this._execCompat(args, { timeoutMs: 30000 });
    const raw = (result.stdout || '').trim();

    const match = raw.match(/(?:Created|created)\s*(?:bead|issue)?:?\s*(\S+)/i);
    const beadId = match ? match[1] : raw || null;

    return { ...result, raw, beadId };
  }

  async show(beadId) {
    const result = await this.exec(['show', beadId, '--json'], { timeoutMs: 30000 });
    const raw = (result.stdout || '').trim();
    return { ...result, raw, data: parseJsonOrNull(raw) };
  }

  async markDone({ beadId, summary } = {}) {
    const args = ['close', beadId];
    if (summary) args.push('-r', summary);
    const result = await this.exec(args, { timeoutMs: 30000 });
    return { ...result, raw: (result.stdout || '').trim() };
  }

  async park({ beadId, reason } = {}) {
    const args = ['defer', beadId];
    if (reason) args.push('-r', reason);
    const result = await this.exec(args, { timeoutMs: 30000 });
    return { ...result, raw: (result.stdout || '').trim() };
  }

  async release(beadId) {
    const result = await this.exec(['update', beadId, '--status', 'open'], { timeoutMs: 30000 });
    return { ...result, raw: (result.stdout || '').trim() };
  }

  async reassign({ beadId, target } = {}) {
    const result = await this.exec(['update', beadId, '--assignee', target], { timeoutMs: 30000 });
    return { ...result, raw: (result.stdout || '').trim() };
  }
}
