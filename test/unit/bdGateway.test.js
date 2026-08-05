import { describe, it, expect } from 'vitest';

import { BDGateway } from '../../server/gateways/BDGateway.js';

class FakeRunner {
  constructor() {
    this.calls = [];
    this._queue = [];
  }

  queue(result) {
    this._queue.push(result);
  }

  async exec(command, args, options) {
    this.calls.push({ command, args, options });
    return this._queue.shift() ?? { ok: true, exitCode: 0, stdout: '', stderr: '', error: null, signal: null };
  }
}

function okResult(stdout = '') {
  return { ok: true, exitCode: 0, stdout, stderr: '', error: null, signal: null };
}

function unknownNoDaemonResult() {
  return {
    ok: false,
    exitCode: 1,
    stdout: '',
    stderr: 'Error: unknown flag: --no-daemon',
    error: 'Command failed',
    signal: null,
  };
}

describe('BDGateway', () => {
  it('sets BEADS_DIR and cwd for exec', async () => {
    const runner = new FakeRunner();
    const gateway = new BDGateway({ runner, gtRoot: '/tmp/gt' });

    await gateway.exec(['version']);

    expect(runner.calls[0].command).toBe('bd');
    expect(runner.calls[0].options.cwd).toBe('/tmp/gt');
    expect(runner.calls[0].options.env).toEqual({ BEADS_DIR: '/tmp/gt/.beads' });
  });

  it('uses a custom bd executable when provided', async () => {
    const runner = new FakeRunner();
    const gateway = new BDGateway({
      runner,
      gtRoot: '/tmp/gt',
      executable: '/opt/homebrew/bin/bd',
    });

    await gateway.exec(['version']);
    expect(runner.calls[0].command).toBe('/opt/homebrew/bin/bd');
  });

  it('list() probes no-daemon support once and reuses cached support', async () => {
    const runner = new FakeRunner();
    runner.queue(okResult('bd v0.44.0'));
    runner.queue(okResult('[]'));
    runner.queue(okResult('[]'));
    const gateway = new BDGateway({ runner, gtRoot: '/tmp/gt' });

    const result = await gateway.list({ status: 'open' });
    const second = await gateway.list({ status: 'open' });

    expect(runner.calls[0].args).toEqual(['--no-daemon', 'version']);
    expect(runner.calls[1].args).toEqual(['--no-daemon', 'list', '--status=open', '--json']);
    expect(runner.calls[2].args).toEqual(['--no-daemon', 'list', '--status=open', '--json']);
    expect(result.data).toEqual([]);
    expect(second.data).toEqual([]);
  });

  it('search() omits no-daemon when probe reports unsupported', async () => {
    const runner = new FakeRunner();
    runner.queue(unknownNoDaemonResult());
    runner.queue(okResult('[]'));
    const gateway = new BDGateway({ runner, gtRoot: '/tmp/gt' });

    await gateway.search('');
    expect(runner.calls[0].args).toEqual(['--no-daemon', 'version']);
    expect(runner.calls[1].args).toEqual(['list', '--json']);
  });

  it('retries without no-daemon when command fails with unknown flag', async () => {
    const runner = new FakeRunner();
    runner.queue(okResult('bd v0.44.0'));
    runner.queue(unknownNoDaemonResult());
    runner.queue(okResult('[]'));
    const gateway = new BDGateway({ runner, gtRoot: '/tmp/gt' });

    const result = await gateway.search('foo');
    expect(result.data).toEqual([]);
    expect(runner.calls[0].args).toEqual(['--no-daemon', 'version']);
    expect(runner.calls[1].args).toEqual(['--no-daemon', 'search', 'foo', '--json']);
    expect(runner.calls[2].args).toEqual(['search', 'foo', '--json']);
  });

  it('create() builds args and extracts beadId', async () => {
    const runner = new FakeRunner();
    runner.queue(okResult('bd v0.44.0'));
    runner.queue(okResult('Created bead: gt-abc123\n'));
    const gateway = new BDGateway({ runner, gtRoot: '/tmp/gt' });

    const result = await gateway.create({
      title: 'Fix login bug',
      description: 'Steps to repro…',
      priority: 'P1',
      labels: ['bug', 'ui'],
    });

    expect(runner.calls[0].args).toEqual(['--no-daemon', 'version']);
    expect(runner.calls[1].args).toEqual([
      '--no-daemon',
      'new',
      'Fix login bug',
      '--description',
      'Steps to repro…',
      '--priority',
      'P1',
      '--labels',
      'bug',
      '--labels',
      'ui',
    ]);
    expect(result.beadId).toBe('gt-abc123');
  });

  it('markDone() uses bd close with -r flag', async () => {
    const runner = new FakeRunner();
    runner.queue(okResult('closed'));
    const gateway = new BDGateway({ runner, gtRoot: '/tmp/gt' });

    await gateway.markDone({ beadId: 'bd-1', summary: 'ok' });
    expect(runner.calls[0].args).toEqual(['close', 'bd-1', '-r', 'ok']);
  });

  it('park() uses bd defer with -r flag', async () => {
    const runner = new FakeRunner();
    runner.queue(okResult('deferred'));
    const gateway = new BDGateway({ runner, gtRoot: '/tmp/gt' });

    await gateway.park({ beadId: 'bd-2', reason: 'waiting on upstream' });
    expect(runner.calls[0].args).toEqual(['defer', 'bd-2', '-r', 'waiting on upstream']);
  });

  it('release() uses bd update --status open', async () => {
    const runner = new FakeRunner();
    runner.queue(okResult('updated'));
    const gateway = new BDGateway({ runner, gtRoot: '/tmp/gt' });

    await gateway.release('bd-3');
    expect(runner.calls[0].args).toEqual(['update', 'bd-3', '--status', 'open']);
  });

  it('reassign() uses bd update --assignee', async () => {
    const runner = new FakeRunner();
    runner.queue(okResult('updated'));
    const gateway = new BDGateway({ runner, gtRoot: '/tmp/gt' });

    await gateway.reassign({ beadId: 'bd-4', target: 'mayor' });
    expect(runner.calls[0].args).toEqual(['update', 'bd-4', '--assignee', 'mayor']);
  });
});
