function resultText(result) {
  return `${result?.error || ''}\n${result?.data || ''}`;
}

function matchesAnyPattern(text, patterns = []) {
  return patterns.some((pattern) => pattern.test(text));
}

async function executeWithFallback(executor, attempts, options = {}) {
  let lastResult = { success: false, error: 'No command attempts configured' };
  for (const attempt of attempts) {
    const result = await executor(attempt.args, options);
    if (result.success) return result;
    lastResult = result;
    if (matchesAnyPattern(resultText(result), attempt.retryOn || [])) continue;
    return result;
  }
  return lastResult;
}

const GT_UNKNOWN_SESSION_COMMAND_PATTERNS = [
  /unknown command\s+"?session"?/i,
  /unknown command:\s*session/i,
];

const GT_UNKNOWN_SESSION_SUBCOMMAND_PATTERNS = [
  /unknown command\s+"?start"?\s+for\s+"?gt session"?/i,
  /unknown command\s+"?stop"?\s+for\s+"?gt session"?/i,
  /unknown command\s+"?restart"?\s+for\s+"?gt session"?/i,
];

const GT_UNKNOWN_POLECAT_WAKE_PATTERNS = [
  /unknown command\s+"?wake"?\s+for\s+"?gt polecat"?/i,
];

const BD_UNKNOWN_AGENT_FLAG_PATTERNS = [
  /unknown flag:\s*--agent-rig/i,
  /unknown flag:\s*--role-type/i,
];

export function createCLICompatibilityService({ executeGT, executeBD, killTmuxSession }) {
  if (typeof executeGT !== 'function') {
    throw new Error('createCLICompatibilityService requires executeGT');
  }
  if (typeof executeBD !== 'function') {
    throw new Error('createCLICompatibilityService requires executeBD');
  }
  if (typeof killTmuxSession !== 'function') {
    throw new Error('createCLICompatibilityService requires killTmuxSession');
  }

  async function startPolecat({ rig, name, timeoutMs = 30000 } = {}) {
    const address = `${rig}/${name}`;
    return executeWithFallback(executeGT, [
      {
        args: ['session', 'start', address],
        retryOn: [
          ...GT_UNKNOWN_SESSION_COMMAND_PATTERNS,
          ...GT_UNKNOWN_SESSION_SUBCOMMAND_PATTERNS,
        ],
      },
      {
        // Last resort: `gt sling` has no --rig flag, and its --agent flag selects a
        // runtime (claude/gemini/codex), not a polecat — so there is no sling-based
        // fallback for waking a named polecat.
        args: ['polecat', 'wake', address],
        retryOn: GT_UNKNOWN_POLECAT_WAKE_PATTERNS,
      },
    ], { timeout: timeoutMs });
  }

  async function restartPolecat({ rig, name, sessionName, timeoutMs = 30000 } = {}) {
    const address = `${rig}/${name}`;
    const restartResult = await executeGT(['session', 'restart', address], { timeout: timeoutMs });
    if (restartResult.success) return restartResult;

    const shouldFallback = matchesAnyPattern(resultText(restartResult), [
      ...GT_UNKNOWN_SESSION_COMMAND_PATTERNS,
      ...GT_UNKNOWN_SESSION_SUBCOMMAND_PATTERNS,
    ]);
    if (!shouldFallback) return restartResult;

    if (sessionName) {
      await killTmuxSession(sessionName);
    }

    return startPolecat({ rig, name, timeoutMs });
  }

  async function createAgentBeadForRig({ rigName, role, timeoutMs = 30000 } = {}) {
    const title = `Setup ${role} for ${rigName}`;
    return executeWithFallback(executeBD, [
      {
        args: [
          'create',
          title,
          '--type', 'agent',
          '--agent-rig', rigName,
          '--role-type', role,
          '--silent',
        ],
        retryOn: BD_UNKNOWN_AGENT_FLAG_PATTERNS,
      },
      {
        args: [
          'create',
          title,
          '--type', 'agent',
          '--description', `Auto-created ${role} agent bead for rig ${rigName}`,
          '--labels', `agent-role:${role}`,
          '--labels', `agent-rig:${rigName}`,
          '--silent',
        ],
      },
    ], { timeout: timeoutMs });
  }

  return {
    startPolecat,
    restartPolecat,
    createAgentBeadForRig,
  };
}
