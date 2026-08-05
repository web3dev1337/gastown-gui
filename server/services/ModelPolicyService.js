import path from 'node:path';
import fsPromises from 'node:fs/promises';

/**
 * Reports which agent runtime — and therefore which LLM — Gas Town will actually
 * launch for each role.
 *
 * The GUI has no model setting of its own: it shells out to `gt`, and `gt` resolves the
 * runtime from the town's settings. That makes the model invisible from here, which is
 * how a town silently drifts onto a model nobody intended. This service reads the same
 * files `gt` reads and reports the answer, so drift shows up in the UI instead of on a
 * bill.
 *
 * Resolution order mirrors gastown's own (rig RoleAgents → town RoleAgents → rig Agent →
 * town default_agent → "claude"), with one exception documented in DOG_ROLE_NOTE.
 */

/** Roles that carry out work, in the order they are displayed. */
export const WORK_ROLES = ['mayor', 'deacon', 'witness', 'refinery', 'polecat', 'crew'];

/**
 * gastown hard-codes the dog role to Haiku (internal/config/loader.go, "Dogs default to
 * Haiku"). A `role_agents.dog` override is honoured only when it names a *non-Claude*
 * agent, so a Claude preset cannot change it. Dogs are lifecycle workers (reaper,
 * compactor, doctor, backup), not work assigned from this UI — reported, not enforced.
 */
export const DOG_ROLE_NOTE =
  'gastown pins the dog role to Haiku and ignores Claude-preset overrides for it. '
  + 'Dogs run lifecycle maintenance, not work slung from this UI.';

/** Pull the value of a --model/-m flag out of an argv array. */
export function extractModel(args) {
  if (!Array.isArray(args)) return null;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if ((arg === '--model' || arg === '-m') && args[i + 1]) return args[i + 1];
    if (typeof arg === 'string' && arg.startsWith('--model=')) return arg.slice('--model='.length);
  }
  return null;
}

async function readJsonOrNull(filePath) {
  try {
    return JSON.parse(await fsPromises.readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

export class ModelPolicyService {
  constructor({ gtRoot, cache, ttlMs = 30_000, expectedModel = null } = {}) {
    if (!gtRoot) throw new Error('ModelPolicyService requires gtRoot');
    this._gtRoot = gtRoot;
    this._cache = cache ?? null;
    this._ttlMs = ttlMs;
    // e.g. "sonnet" — a substring match against the resolved model, case-insensitive.
    this._expectedModel = expectedModel;
  }

  async _townSettings() {
    return readJsonOrNull(path.join(this._gtRoot, 'settings', 'config.json'));
  }

  async _rigNames() {
    const rigs = await readJsonOrNull(path.join(this._gtRoot, 'rigs.json'));
    return Object.keys(rigs?.rigs ?? {});
  }

  async _rigSettings(rigName) {
    return readJsonOrNull(path.join(this._gtRoot, rigName, 'settings', 'config.json'));
  }

  /**
   * Resolve one role against a town/rig settings pair.
   * Returns { agent, model, source } — source names the setting that decided it.
   */
  _resolveRole(role, townSettings, rigSettings) {
    if (role === 'dog') {
      return { agent: 'claude-haiku', model: 'haiku', source: 'gastown built-in (not overridable)' };
    }

    let agentName = null;
    let source = null;

    if (rigSettings?.role_agents?.[role]) {
      agentName = rigSettings.role_agents[role];
      source = `rig role_agents.${role}`;
    } else if (townSettings?.role_agents?.[role]) {
      agentName = townSettings.role_agents[role];
      source = `town role_agents.${role}`;
    } else if (rigSettings?.agent) {
      agentName = rigSettings.agent;
      source = 'rig agent';
    } else if (townSettings?.default_agent) {
      agentName = townSettings.default_agent;
      source = 'town default_agent';
    } else {
      agentName = 'claude';
      source = 'gastown default';
    }

    const runtime = rigSettings?.agents?.[agentName] ?? townSettings?.agents?.[agentName] ?? null;
    // No custom runtime means the built-in preset, which carries no --model flag —
    // the agent CLI picks the model itself.
    const model = runtime ? extractModel(runtime.args) : null;

    return { agent: agentName, model, source };
  }

  _isExpected(model) {
    if (!this._expectedModel) return null;
    if (!model) return false;
    return model.toLowerCase().includes(this._expectedModel.toLowerCase());
  }

  async getPolicy({ refresh = false } = {}) {
    if (!refresh && this._cache?.get) {
      const cached = this._cache.get('model_policy');
      if (cached) return cached;
    }

    const townSettings = await this._townSettings();
    const rigNames = await this._rigNames();

    const town = {};
    for (const role of WORK_ROLES) {
      town[role] = this._resolveRole(role, townSettings, null);
    }

    const rigs = {};
    for (const rigName of rigNames) {
      const rigSettings = await this._rigSettings(rigName);
      // Only report a rig when it actually overrides something; otherwise it is noise.
      if (!rigSettings?.role_agents && !rigSettings?.agent && !rigSettings?.agents) continue;
      rigs[rigName] = {};
      for (const role of WORK_ROLES) {
        const resolved = this._resolveRole(role, townSettings, rigSettings);
        if (resolved.source.startsWith('rig')) rigs[rigName][role] = resolved;
      }
      if (Object.keys(rigs[rigName]).length === 0) delete rigs[rigName];
    }

    const models = [...new Set(Object.values(town).map((r) => r.model))];
    const unresolved = models.some((m) => !m);
    const resolvedModel = models.length === 1 ? models[0] : null;

    const policy = {
      // The single model every work role resolves to, or null when they differ.
      model: resolvedModel,
      // true/false against expectedModel, or null when no expectation is configured.
      matchesExpected: resolvedModel ? this._isExpected(resolvedModel) : false,
      expectedModel: this._expectedModel,
      // No --model flag anywhere: the agent CLI chooses, so we cannot report a model.
      unresolved,
      settingsPath: path.join(this._gtRoot, 'settings', 'config.json'),
      roles: town,
      rigOverrides: rigs,
      dogNote: DOG_ROLE_NOTE,
    };

    this._cache?.set?.('model_policy', policy, this._ttlMs);
    return policy;
  }

  /**
   * One-line summary for the startup log. Returns { level, message }.
   */
  async describeForStartup() {
    const policy = await this.getPolicy({ refresh: true });

    if (policy.unresolved) {
      return {
        level: 'warn',
        message: `Model policy: no --model flag in ${policy.settingsPath} for every work role; `
          + 'the agent CLI will choose. Set an agent preset in town settings to pin one.',
      };
    }

    if (!policy.model) {
      const perRole = Object.entries(policy.roles)
        .map(([role, r]) => `${role}=${r.model}`)
        .join(' ');
      return { level: 'warn', message: `Model policy: work roles disagree — ${perRole}` };
    }

    if (this._expectedModel && !policy.matchesExpected) {
      return {
        level: 'warn',
        message: `Model policy: work roles resolve to "${policy.model}", expected `
          + `"${this._expectedModel}" (GASTOWN_EXPECTED_MODEL). Check ${policy.settingsPath}.`,
      };
    }

    return { level: 'info', message: `Model policy: all work roles resolve to "${policy.model}"` };
  }
}
