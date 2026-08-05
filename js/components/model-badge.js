/**
 * Gas Town GUI - Model Badge
 *
 * Shows which model gt will actually launch agents with. The GUI cannot set the model
 * — it lives in the town's settings — so without this the only way to find out is to
 * read `ps`. A badge makes drift onto an unintended model visible immediately.
 */

import { api } from '../api.js';
import { escapeHtml } from '../utils/html.js';

let badge = null;

function describe(policy) {
  if (policy.unresolved) {
    return {
      state: 'unknown',
      label: 'model: agent default',
      title: `No --model flag in ${policy.settingsPath}; the agent CLI chooses the model.`,
    };
  }

  if (!policy.model) {
    const perRole = Object.entries(policy.roles || {})
      .map(([role, r]) => `${role}: ${r.model || 'agent default'}`)
      .join('\n');
    return {
      state: 'warn',
      label: 'model: mixed',
      title: `Work roles resolve to different models:\n${perRole}`,
    };
  }

  const overrides = Object.entries(policy.rigOverrides || {})
    .flatMap(([rig, roles]) => Object.entries(roles).map(([role, r]) => `${rig}/${role}: ${r.model || r.agent}`));

  const lines = [`All work roles resolve to ${policy.model}.`, `Source: ${policy.settingsPath}`];
  if (overrides.length) lines.push(`Rig overrides:\n${overrides.join('\n')}`);
  if (policy.dogNote) lines.push(policy.dogNote);

  const mismatched = policy.expectedModel && !policy.matchesExpected;
  if (mismatched) lines.unshift(`Expected ${policy.expectedModel}.`);

  return {
    state: mismatched ? 'warn' : 'ok',
    label: `model: ${policy.model}`,
    title: lines.join('\n\n'),
  };
}

export async function loadModelBadge() {
  badge = badge || document.getElementById('model-badge');
  if (!badge) return;

  try {
    const policy = await api.getModelPolicy();
    const { state, label, title } = describe(policy);

    badge.className = `model-badge model-badge-${state}`;
    badge.title = title;
    badge.innerHTML = `<span class="material-icons">psychology</span><span>${escapeHtml(label)}</span>`;
  } catch (err) {
    // Older servers have no /api/model-policy; stay out of the way rather than
    // showing a broken badge.
    console.warn('[ModelBadge] could not load model policy:', err.message);
    badge.className = 'model-badge hidden';
  }
}

export function initModelBadge() {
  badge = document.getElementById('model-badge');
  loadModelBadge();
}
