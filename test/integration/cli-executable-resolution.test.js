import { spawn } from 'child_process';
import { createServer } from 'net';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { WebSocket } from 'ws';
import { describe, expect, it } from 'vitest';

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

async function waitForWsOpen(url, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error(`WebSocket did not open within ${timeoutMs}ms`));
    }, timeoutMs);

    ws.on('open', () => {
      clearTimeout(timeout);
      resolve(ws);
    });
    ws.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

async function createExecutable(filePath, script) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, script, { mode: 0o755 });
}

async function startFixture({ gtScript, bdScript, ghScript, env = {} }) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gastown-cli-path-'));
  const binDir = path.join(tempDir, 'bin');
  const gtRoot = path.join(tempDir, 'gtroot');

  await fs.mkdir(binDir, { recursive: true });
  await fs.mkdir(gtRoot, { recursive: true });

  if (gtScript) {
    await createExecutable(path.join(binDir, 'gt'), gtScript);
  }
  await createExecutable(
    path.join(binDir, 'bd'),
    bdScript ?? '#!/bin/bash\nif [[ "${1:-}" == "version" ]]; then echo "bd vtest"; exit 0; fi\nexit 0\n',
  );
  await createExecutable(
    path.join(binDir, 'gh'),
    ghScript ?? '#!/bin/bash\necho "main"\n',
  );

  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const serverProcess = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      GASTOWN_PORT: String(port),
      GASTOWN_HOST: '127.0.0.1',
      GT_ROOT: gtRoot,
      PATH: binDir,
      ...env,
    },
    stdio: 'ignore',
  });

  await waitForHealth(baseUrl);
  return { tempDir, baseUrl, wsUrl: `ws://127.0.0.1:${port}/ws`, serverProcess, binDir };
}

async function stopFixture(fixture) {
  if (fixture?.serverProcess && fixture.serverProcess.exitCode === null) {
    fixture.serverProcess.kill('SIGTERM');
    await new Promise((resolve) => fixture.serverProcess.once('exit', resolve));
  }
  if (fixture?.tempDir) {
    await fs.rm(fixture.tempDir, { recursive: true, force: true });
  }
}

describe('CLI executable resolution (real server)', () => {
  it('uses GT_BIN when gt is not present in PATH', async () => {
    let fixture;
    let gtOverrideDir;
    let ws;
    try {
      gtOverrideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gastown-gt-override-'));
      const gtBin = path.join(gtOverrideDir, 'bin', 'gt');
      await createExecutable(gtBin, `#!/bin/bash
set -euo pipefail
if [[ "\${1:-}" == "version" ]]; then
  echo "gt vhomebrew-test"
  exit 0
fi
if [[ "\${1:-}" == "feed" ]]; then
  echo "[12:00:00] + test-rig created · test event"
  /bin/sleep 30
  exit 0
fi
exit 0
`);

      fixture = await startFixture({
        gtScript: null,
        env: { GT_BIN: gtBin },
      });

      const setupStatus = await fetch(`${fixture.baseUrl}/api/setup/status`).then((r) => r.json());
      expect(setupStatus.gt_installed).toBe(true);
      expect(setupStatus.gt_version).toContain('gt vhomebrew-test');

      ws = await waitForWsOpen(fixture.wsUrl);
      await new Promise((resolve) => setTimeout(resolve, 500));

      const health = await fetch(`${fixture.baseUrl}/api/health`);
      expect(health.status).toBe(200);
      expect(fixture.serverProcess.exitCode).toBeNull();
    } finally {
      ws?.close();
      await stopFixture(fixture);
      if (gtOverrideDir) {
        await fs.rm(gtOverrideDir, { recursive: true, force: true });
      }
    }
  });

  it('does not crash when gt is missing from PATH and no fallback is available', async () => {
    let fixture;
    let ws;
    try {
      fixture = await startFixture({ gtScript: null });

      ws = await waitForWsOpen(fixture.wsUrl);
      await new Promise((resolve) => setTimeout(resolve, 500));

      const health = await fetch(`${fixture.baseUrl}/api/health`);
      expect(health.status).toBe(200);
      expect(fixture.serverProcess.exitCode).toBeNull();
    } finally {
      ws?.close();
      await stopFixture(fixture);
    }
  });
});
