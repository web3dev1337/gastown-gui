import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // Retry until timeout
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Server did not become healthy within ${timeoutMs}ms`);
}

describe('Rig list fallback and emoji parsing (real server)', () => {
  let tempDir;
  let serverProcess;
  let baseUrl;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gastown-rig-parse-'));
    const binDir = path.join(tempDir, 'bin');
    const gtRoot = path.join(tempDir, 'gtroot');
    const rigRepoPath = path.join(gtRoot, 'alpha', 'mayor', 'rig');

    await fs.mkdir(binDir, { recursive: true });
    await fs.mkdir(rigRepoPath, { recursive: true });

    await fs.writeFile(path.join(binDir, 'gt'), `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "version" ]]; then
  echo "gt v0.test"
  exit 0
fi
if [[ "\${1:-}" == "rig" && "\${2:-}" == "list" && "\${3:-}" == "--json" ]]; then
  echo "Error: unknown flag: --json" >&2
  exit 1
fi
if [[ "\${1:-}" == "rig" && "\${2:-}" == "list" ]]; then
  printf '\\360\\237\\237\\242 alpha\\n'
  exit 0
fi
echo "Error: unsupported gt command: $*" >&2
exit 1
`, { mode: 0o755 });

    await fs.writeFile(path.join(binDir, 'bd'), `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "version" ]]; then
  echo "bd v0.test"
  exit 0
fi
if [[ "\${1:-}" == "show" ]]; then
  echo '{"id":"bead-1","closed_at":"2026-03-20T00:00:00Z"}'
  exit 0
fi
echo "Error: unsupported bd command: $*" >&2
exit 1
`, { mode: 0o755 });

    await fs.writeFile(path.join(binDir, 'gh'), `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "pr" && "\${2:-}" == "list" ]]; then
  cat <<'JSON'
[{"number":17,"title":"fix bead-1 parsing","url":"https://github.com/owner/repo/pull/17","state":"OPEN","headRefName":"feature/bead-1","body":"References bead-1","createdAt":"2026-03-20T00:00:00Z","updatedAt":"2026-03-20T00:00:00Z"}]
JSON
  exit 0
fi
echo "Error: unsupported gh command: $*" >&2
exit 1
`, { mode: 0o755 });

    const { execFileSync } = await import('child_process');
    execFileSync('git', ['-C', rigRepoPath, 'init', '-q']);
    execFileSync('git', ['-C', rigRepoPath, 'remote', 'add', 'origin', 'https://github.com/owner/repo.git']);

    const port = await getFreePort();
    baseUrl = `http://127.0.0.1:${port}`;

    serverProcess = spawn('node', ['server.js'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        GASTOWN_PORT: String(port),
        GASTOWN_HOST: '127.0.0.1',
        GT_ROOT: gtRoot,
        PATH: `${binDir}:${process.env.PATH}`,
      },
      stdio: 'ignore',
    });

    await waitForHealth(baseUrl);
  });

  afterAll(async () => {
    if (serverProcess) {
      serverProcess.kill('SIGTERM');
      await new Promise((resolve) => serverProcess.once('exit', resolve));
    }
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('falls back to text parsing for /api/setup/status when --json fails', async () => {
    const response = await fetch(`${baseUrl}/api/setup/status`);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.rigs).toEqual([{ name: 'alpha' }]);
  });

  it('parses emoji-prefixed rig names for /api/rigs when --json fails', async () => {
    const response = await fetch(`${baseUrl}/api/rigs`);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual([{ name: 'alpha' }]);
  });

  it('parses emoji-prefixed rig names for /api/bead/:id/links', async () => {
    const response = await fetch(`${baseUrl}/api/bead/bead-1/links`);
    expect(response.status).toBe(200);
    const data = await response.json();

    expect(data.prs).toHaveLength(1);
    expect(data.prs[0]).toMatchObject({
      repo: 'owner/repo',
      number: 17,
      title: 'fix bead-1 parsing',
    });
  });
});
