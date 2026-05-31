import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import { createServer } from 'net';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close((closeErr) => {
        if (closeErr) {
          reject(closeErr);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function waitForHealth(baseUrl, timeoutMs = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // Keep retrying until timeout.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Server did not become healthy within ${timeoutMs}ms`);
}

async function startRealServerFixture({ gtScript, bdScript, ghScript }) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gastown-cli-compat-'));
  const binDir = path.join(tempDir, 'bin');
  const gtRoot = path.join(tempDir, 'gtroot');
  const gtCallLog = path.join(tempDir, 'gt-calls.log');
  const bdCallLog = path.join(tempDir, 'bd-calls.log');
  const ghCallLog = path.join(tempDir, 'gh-calls.log');

  await fs.mkdir(binDir, { recursive: true });
  await fs.mkdir(gtRoot, { recursive: true });
  await fs.writeFile(gtCallLog, '');
  await fs.writeFile(bdCallLog, '');
  await fs.writeFile(ghCallLog, '');

  await fs.writeFile(path.join(binDir, 'gt'), gtScript, { mode: 0o755 });
  await fs.writeFile(path.join(binDir, 'bd'), bdScript, { mode: 0o755 });
  await fs.writeFile(path.join(binDir, 'gh'), ghScript, { mode: 0o755 });

  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const serverProcess = spawn('node', ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      GASTOWN_PORT: String(port),
      GASTOWN_HOST: '127.0.0.1',
      GT_ROOT: gtRoot,
      PATH: `${binDir}:${process.env.PATH}`,
      GT_CALL_LOG: gtCallLog,
      BD_CALL_LOG: bdCallLog,
      GH_CALL_LOG: ghCallLog,
    },
    stdio: 'ignore',
  });

  await waitForHealth(baseUrl);

  return {
    tempDir,
    baseUrl,
    serverProcess,
    gtCallLog,
    bdCallLog,
    ghCallLog,
  };
}

async function stopRealServerFixture(fixture) {
  if (fixture?.serverProcess) {
    fixture.serverProcess.kill('SIGTERM');
    await new Promise((resolve) => fixture.serverProcess.once('exit', resolve));
  }
  if (fixture?.tempDir) {
    await fs.rm(fixture.tempDir, { recursive: true, force: true });
  }
}

async function postJson(baseUrl, endpoint, body = undefined) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json();
  return { status: response.status, ok: response.ok, data: payload };
}

describe('CLI compatibility fallbacks (real server)', () => {
  it('uses gt session start/restart for polecat lifecycle when available', async () => {
    let fixture;
    try {
      fixture = await startRealServerFixture({
        gtScript: `#!/usr/bin/env bash
set -euo pipefail
echo "$*" >> "$GT_CALL_LOG"
if [[ "\${1:-}" == "version" ]]; then
  echo "gt v0.test"
  exit 0
fi
if [[ "\${1:-}" == "session" && "\${2:-}" == "start" ]]; then
  echo "started"
  exit 0
fi
if [[ "\${1:-}" == "session" && "\${2:-}" == "restart" ]]; then
  echo "restarted"
  exit 0
fi
if [[ "\${1:-}" == "session" && "\${2:-}" == "stop" ]]; then
  echo "stopped"
  exit 0
fi
echo "Error: unsupported gt command: $*" >&2
exit 1
`,
        bdScript: `#!/usr/bin/env bash
set -euo pipefail
echo "$*" >> "$BD_CALL_LOG"
if [[ "\${1:-}" == "version" ]]; then
  echo "bd v0.test"
  exit 0
fi
echo "Error: unsupported bd command: $*" >&2
exit 1
`,
        ghScript: `#!/usr/bin/env bash
set -euo pipefail
echo "$*" >> "$GH_CALL_LOG"
echo "main"
`,
      });

      const start = await postJson(fixture.baseUrl, '/api/polecat/test-rig/new-polecat/start');
      expect(start.status).toBe(200);
      expect(start.data.success).toBe(true);

      const restart = await postJson(fixture.baseUrl, '/api/polecat/test-rig/new-polecat/restart');
      expect(restart.status).toBe(200);
      expect(restart.data.success).toBe(true);

      const gtLog = await fs.readFile(fixture.gtCallLog, 'utf8');
      expect(gtLog).toContain('session start test-rig/new-polecat');
      expect(gtLog).toContain('session restart test-rig/new-polecat');
      expect(gtLog).not.toContain('sling --rig');
    } finally {
      await stopRealServerFixture(fixture);
    }
  });

  it('falls back to legacy gt sling flags when session commands are unavailable', async () => {
    let fixture;
    try {
      fixture = await startRealServerFixture({
        gtScript: `#!/usr/bin/env bash
set -euo pipefail
echo "$*" >> "$GT_CALL_LOG"
if [[ "\${1:-}" == "version" ]]; then
  echo "gt v0.legacy"
  exit 0
fi
if [[ "\${1:-}" == "session" ]]; then
  echo "Error: unknown command \\"session\\" for \\"gt\\"" >&2
  exit 1
fi
if [[ "\${1:-}" == "polecat" && "\${2:-}" == "wake" ]]; then
  echo "Error: unknown command \\"wake\\" for \\"gt polecat\\"" >&2
  exit 1
fi
if [[ "\${1:-}" == "sling" && "\${2:-}" == "--rig" && "\${4:-}" == "--agent" ]]; then
  echo "started via legacy sling"
  exit 0
fi
echo "Error: unsupported gt command: $*" >&2
exit 1
`,
        bdScript: `#!/usr/bin/env bash
set -euo pipefail
echo "$*" >> "$BD_CALL_LOG"
if [[ "\${1:-}" == "version" ]]; then
  echo "bd v0.test"
  exit 0
fi
echo "Error: unsupported bd command: $*" >&2
exit 1
`,
        ghScript: `#!/usr/bin/env bash
set -euo pipefail
echo "$*" >> "$GH_CALL_LOG"
echo "main"
`,
      });

      const start = await postJson(fixture.baseUrl, '/api/polecat/test-rig/legacy-polecat/start');
      expect(start.status).toBe(200);
      expect(start.data.success).toBe(true);

      const gtLog = await fs.readFile(fixture.gtCallLog, 'utf8');
      expect(gtLog).toContain('session start test-rig/legacy-polecat');
      expect(gtLog).toContain('polecat wake test-rig/legacy-polecat');
      expect(gtLog).toContain('sling --rig test-rig --agent legacy-polecat');
    } finally {
      await stopRealServerFixture(fixture);
    }
  });

  it('falls back when bd create agent flags are unsupported during rig add', async () => {
    let fixture;
    try {
      fixture = await startRealServerFixture({
        gtScript: `#!/usr/bin/env bash
set -euo pipefail
echo "$*" >> "$GT_CALL_LOG"
if [[ "\${1:-}" == "version" ]]; then
  echo "gt v0.test"
  exit 0
fi
if [[ "\${1:-}" == "rig" && "\${2:-}" == "add" ]]; then
  echo "Rig added"
  exit 0
fi
echo "Error: unsupported gt command: $*" >&2
exit 1
`,
        bdScript: `#!/usr/bin/env bash
set -euo pipefail
echo "$*" >> "$BD_CALL_LOG"
if [[ "\${1:-}" == "version" ]]; then
  echo "bd v0.62.0"
  exit 0
fi
if [[ "\${1:-}" == "create" ]]; then
  if [[ "$*" == *"--agent-rig"* ]] || [[ "$*" == *"--role-type"* ]]; then
    echo "Error: unknown flag: --agent-rig" >&2
    exit 1
  fi
  echo "bd-test-123"
  exit 0
fi
echo "Error: unsupported bd command: $*" >&2
exit 1
`,
        ghScript: `#!/usr/bin/env bash
set -euo pipefail
echo "$*" >> "$GH_CALL_LOG"
if [[ "\${1:-}" == "api" ]]; then
  echo "main"
  exit 0
fi
echo "Error: unsupported gh command: $*" >&2
exit 1
`,
      });

      const response = await postJson(fixture.baseUrl, '/api/rigs', {
        name: 'compat-rig',
        url: 'https://github.com/example/compat-rig',
      });
      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);

      const bdLog = await fs.readFile(fixture.bdCallLog, 'utf8');
      const createLines = bdLog
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('create '));

      expect(createLines).toHaveLength(4);
      expect(bdLog).toContain('--agent-rig compat-rig --role-type witness');
      expect(bdLog).toContain('--agent-rig compat-rig --role-type refinery');
      expect(bdLog).toContain('--description Auto-created witness agent bead for rig compat-rig');
      expect(bdLog).toContain('--description Auto-created refinery agent bead for rig compat-rig');
      expect(bdLog).toContain('--label agent-role:witness --label agent-rig:compat-rig');
      expect(bdLog).toContain('--label agent-role:refinery --label agent-rig:compat-rig');
    } finally {
      await stopRealServerFixture(fixture);
    }
  });
});
