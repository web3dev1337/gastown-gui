import { describe, it, expect } from 'vitest';

import { GTGateway } from '../../server/gateways/GTGateway.js';

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

describe('GTGateway', () => {
  it('execs gt in gtRoot', async () => {
    const runner = new FakeRunner();
    const gateway = new GTGateway({ runner, gtRoot: '/tmp/gt' });

    await gateway.exec(['status']);
    expect(runner.calls[0]).toEqual({
      command: 'gt',
      args: ['status'],
      options: { cwd: '/tmp/gt' },
    });
  });

  it('uses a custom gt executable when provided', async () => {
    const runner = new FakeRunner();
    const gateway = new GTGateway({
      runner,
      gtRoot: '/tmp/gt',
      executable: '/opt/homebrew/bin/gt',
    });

    await gateway.exec(['status']);
    expect(runner.calls[0].command).toBe('/opt/homebrew/bin/gt');
  });

  it('status() builds correct args and parses JSON', async () => {
    const runner = new FakeRunner();
    runner.queue({ ok: true, exitCode: 0, stdout: '{"rigs":[]}', stderr: '', error: null, signal: null });
    const gateway = new GTGateway({ runner, gtRoot: '/tmp/gt' });

    const result = await gateway.status();

    expect(runner.calls[0].args).toEqual(['status', '--json', '--fast']);
    expect(result.data).toEqual({ rigs: [] });
  });

  it('status() forwards allowExitCodes to runner', async () => {
    const runner = new FakeRunner();
    runner.queue({ ok: true, exitCode: 1, stdout: '{"rigs":[]}', stderr: '', error: null, signal: null });
    const gateway = new GTGateway({ runner, gtRoot: '/tmp/gt' });

    await gateway.status({ allowExitCodes: [0, 1] });
    expect(runner.calls[0].options.allowExitCodes).toEqual([0, 1]);
  });

  it('listConvoys() supports all + status options', async () => {
    const runner = new FakeRunner();
    runner.queue({ ok: true, exitCode: 0, stdout: '[]', stderr: '', error: null, signal: null });
    const gateway = new GTGateway({ runner, gtRoot: '/tmp/gt' });

    await gateway.listConvoys({ all: true, status: 'running' });
    expect(runner.calls[0].args).toEqual(['convoy', 'list', '--json', '--all', '--status=running']);
  });

  it('createConvoy() extracts convoyId from output', async () => {
    const runner = new FakeRunner();
    runner.queue({ ok: true, exitCode: 0, stdout: 'Created convoy: convoy-abc123\n', stderr: '', error: null, signal: null });
    const gateway = new GTGateway({ runner, gtRoot: '/tmp/gt' });

    const result = await gateway.createConvoy({ name: 'Test', issues: ['one'], notify: 'mayor' });
    expect(runner.calls[0].args).toEqual(['convoy', 'create', 'Test', 'one', '--notify', 'mayor']);
    expect(result.convoyId).toBe('convoy-abc123');
  });

  it('sling() builds args for target/formula/args', async () => {
    const runner = new FakeRunner();
    runner.queue({ ok: true, exitCode: 0, stdout: 'ok', stderr: 'warn', error: null, signal: null });
    const gateway = new GTGateway({ runner, gtRoot: '/tmp/gt' });

    const result = await gateway.sling({
      bead: 'bd-1',
      target: 'mayor',
      formula: 'mol-review',
      args: 'focus on security',
    });

    expect(runner.calls[0].args).toEqual(['sling', 'bd-1', 'mayor', '--formula', 'mol-review', '--args', 'focus on security']);
    expect(result.raw).toBe('okwarn');
  });

  it('sling() omits optional flags when not provided', async () => {
    const runner = new FakeRunner();
    runner.queue({ ok: true, exitCode: 0, stdout: 'ok', stderr: '', error: null, signal: null });
    const gateway = new GTGateway({ runner, gtRoot: '/tmp/gt' });

    await gateway.sling({ bead: 'bd-1', target: 'mayor' });

    expect(runner.calls[0].args).toEqual(['sling', 'bd-1', 'mayor']);
  });

  it('sling() maps the legacy molecule/quality aliases onto --args/--formula', async () => {
    const runner = new FakeRunner();
    runner.queue({ ok: true, exitCode: 0, stdout: 'ok', stderr: '', error: null, signal: null });
    const gateway = new GTGateway({ runner, gtRoot: '/tmp/gt' });

    await gateway.sling({ bead: 'bd-1', target: 'mayor', molecule: 'do the thing', quality: 'mol-review' });

    expect(runner.calls[0].args).toEqual(['sling', 'bd-1', 'mayor', '--formula', 'mol-review', '--args', 'do the thing']);
  });

  it('escalate() builds args and returns raw output', async () => {
    const runner = new FakeRunner();
    runner.queue({ ok: true, exitCode: 0, stdout: 'sent', stderr: '', error: null, signal: null });
    const gateway = new GTGateway({ runner, gtRoot: '/tmp/gt' });

    const result = await gateway.escalate({
      topic: 'Convoy abc needs attention',
      severity: 'HIGH',
      message: 'Blocked',
    });

    expect(runner.calls[0].args).toEqual(['escalate', 'Convoy abc needs attention', '-s', 'HIGH', '-r', 'Blocked']);
    expect(result.raw).toBe('sent');
  });
});
