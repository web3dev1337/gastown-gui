import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ModelPolicyService, extractModel } from '../../server/services/ModelPolicyService.js';

let gtRoot;

async function writeJson(relPath, value) {
  const full = path.join(gtRoot, relPath);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, JSON.stringify(value), 'utf8');
}

const CLAUDE_SONNET = {
  provider: 'claude',
  command: 'claude',
  args: ['--dangerously-skip-permissions', '--model', 'sonnet[1m]'],
};

beforeEach(async () => {
  gtRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'gt-model-policy-'));
});

afterEach(async () => {
  await fs.rm(gtRoot, { recursive: true, force: true });
});

describe('extractModel', () => {
  it('reads --model <value>', () => {
    expect(extractModel(['--dangerously-skip-permissions', '--model', 'sonnet[1m]'])).toBe('sonnet[1m]');
  });

  it('reads --model=<value> and -m', () => {
    expect(extractModel(['--model=haiku'])).toBe('haiku');
    expect(extractModel(['-m', 'opus'])).toBe('opus');
  });

  it('returns null when absent or malformed', () => {
    expect(extractModel(['--dangerously-skip-permissions'])).toBeNull();
    expect(extractModel(['--model'])).toBeNull();
    expect(extractModel(undefined)).toBeNull();
  });
});

describe('ModelPolicyService', () => {
  it('resolves every work role through the town default agent', async () => {
    await writeJson('settings/config.json', {
      default_agent: 'claude',
      agents: { claude: CLAUDE_SONNET },
    });

    const service = new ModelPolicyService({ gtRoot, expectedModel: 'sonnet' });
    const policy = await service.getPolicy();

    expect(policy.model).toBe('sonnet[1m]');
    expect(policy.matchesExpected).toBe(true);
    expect(policy.unresolved).toBe(false);
    expect(policy.roles.polecat).toEqual({
      agent: 'claude',
      model: 'sonnet[1m]',
      source: 'town default_agent',
    });
  });

  it('flags a mismatch against the expected model', async () => {
    await writeJson('settings/config.json', {
      default_agent: 'claude',
      agents: { claude: { command: 'claude', args: ['--model', 'opus'] } },
    });

    const service = new ModelPolicyService({ gtRoot, expectedModel: 'sonnet' });
    const policy = await service.getPolicy();

    expect(policy.model).toBe('opus');
    expect(policy.matchesExpected).toBe(false);

    const { level, message } = await service.describeForStartup();
    expect(level).toBe('warn');
    expect(message).toContain('opus');
  });

  it('reports model=null when roles disagree', async () => {
    await writeJson('settings/config.json', {
      default_agent: 'claude',
      role_agents: { witness: 'claude-haiku' },
      agents: {
        claude: CLAUDE_SONNET,
        'claude-haiku': { command: 'claude', args: ['--model', 'haiku'] },
      },
    });

    const service = new ModelPolicyService({ gtRoot, expectedModel: 'sonnet' });
    const policy = await service.getPolicy();

    expect(policy.model).toBeNull();
    expect(policy.roles.witness.model).toBe('haiku');
    expect(policy.roles.witness.source).toBe('town role_agents.witness');
    expect(policy.roles.mayor.model).toBe('sonnet[1m]');

    const { level, message } = await service.describeForStartup();
    expect(level).toBe('warn');
    expect(message).toContain('witness=haiku');
  });

  it('marks the policy unresolved when no preset carries a --model flag', async () => {
    await writeJson('settings/config.json', { default_agent: 'claude' });

    const service = new ModelPolicyService({ gtRoot, expectedModel: 'sonnet' });
    const policy = await service.getPolicy();

    expect(policy.unresolved).toBe(true);
    expect(policy.model).toBeNull();
    expect((await service.describeForStartup()).level).toBe('warn');
  });

  it('reports rig-level overrides separately from town defaults', async () => {
    await writeJson('settings/config.json', {
      default_agent: 'claude',
      agents: { claude: CLAUDE_SONNET, 'claude-haiku': { command: 'claude', args: ['--model', 'haiku'] } },
    });
    await writeJson('rigs.json', { rigs: { panel: {}, plancheck: {} } });
    await writeJson('panel/settings/config.json', { role_agents: { polecat: 'claude-haiku' } });
    await writeJson('plancheck/settings/config.json', { namepool: { style: 'wasteland' } });

    const policy = await new ModelPolicyService({ gtRoot }).getPolicy();

    expect(policy.rigOverrides.panel.polecat).toEqual({
      agent: 'claude-haiku',
      model: 'haiku',
      source: 'rig role_agents.polecat',
    });
    // A rig that overrides nothing must not appear at all.
    expect(policy.rigOverrides.plancheck).toBeUndefined();
  });

  it('always reports the dog role as Haiku and not overridable', async () => {
    await writeJson('settings/config.json', {
      default_agent: 'claude',
      role_agents: { dog: 'claude' },
      agents: { claude: CLAUDE_SONNET },
    });

    const policy = await new ModelPolicyService({ gtRoot }).getPolicy();

    // Dogs are excluded from the work roles that determine the headline model...
    expect(policy.model).toBe('sonnet[1m]');
    expect(policy.roles.dog).toBeUndefined();
    // ...but the caveat is still reported.
    expect(policy.dogNote).toContain('Haiku');
  });

  it('survives a missing town settings file', async () => {
    const policy = await new ModelPolicyService({ gtRoot }).getPolicy();

    expect(policy.unresolved).toBe(true);
    expect(policy.roles.mayor.agent).toBe('claude');
    expect(policy.roles.mayor.source).toBe('gastown default');
  });
});
