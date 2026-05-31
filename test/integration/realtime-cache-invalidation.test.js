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

describe('Realtime cache invalidation (real server)', () => {
  let tempDir;
  let serverProcess;
  let baseUrl;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gastown-realtime-cache-'));
    const binDir = path.join(tempDir, 'bin');
    const gtRoot = path.join(tempDir, 'gtroot');
    const mayorDir = path.join(gtRoot, 'mayor');

    await fs.mkdir(binDir, { recursive: true });
    await fs.mkdir(mayorDir, { recursive: true });

    const stateDir = path.join(tempDir, 'state');
    await fs.mkdir(stateDir, { recursive: true });
    await fs.writeFile(path.join(stateDir, 'rigs.txt'), 'alpha\n');
    await fs.writeFile(path.join(stateDir, 'witness-running.txt'), '0\n');

    await fs.writeFile(path.join(mayorDir, 'rigs.json'), JSON.stringify({
      rigs: {
        alpha: {
          beads: { prefix: 'alpha' },
        },
      },
    }), 'utf8');

    await fs.writeFile(path.join(binDir, 'gt'), `#!/usr/bin/env bash
set -euo pipefail
STATE_DIR="${stateDir}"
RIGS_FILE="$STATE_DIR/rigs.txt"
WITNESS_FILE="$STATE_DIR/witness-running.txt"

if [[ "\${1:-}" == "version" ]]; then
  echo "gt v0.test"
  exit 0
fi

if [[ "\${1:-}" == "status" && "\${2:-}" == "--json" ]]; then
  cat <<JSON
{
  "name": "Test Town",
  "agents": [
    { "name": "witness", "role": "witness", "address": "alpha/witness" }
  ],
  "rigs": [
    {
      "name": "alpha",
      "hooks": [
        { "agent": "alpha/witness", "role": "witness" }
      ]
    }
  ]
}
JSON
  exit 0
fi

if [[ "\${1:-}" == "rig" && "\${2:-}" == "list" && "\${3:-}" == "--json" ]]; then
  if grep -qx 'beta' "$RIGS_FILE"; then
    echo '[{"name":"alpha"},{"name":"beta"}]'
  else
    echo '[{"name":"alpha"}]'
  fi
  exit 0
fi

if [[ "\${1:-}" == "rig" && "\${2:-}" == "add" ]]; then
  name="\${3:-}"
  if ! grep -qx "$name" "$RIGS_FILE"; then
    echo "$name" >> "$RIGS_FILE"
  fi
  echo "added $name"
  exit 0
fi

if [[ "\${1:-}" == "witness" && "\${2:-}" == "start" ]]; then
  echo '1' > "$WITNESS_FILE"
  echo "witness started"
  exit 0
fi

if [[ "\${1:-}" == "witness" && "\${2:-}" == "stop" ]]; then
  echo '0' > "$WITNESS_FILE"
  echo "witness stopped"
  exit 0
fi

echo "unsupported gt command: $*" >&2
exit 1
`, { mode: 0o755 });

    await fs.writeFile(path.join(binDir, 'bd'), `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "version" ]]; then
  echo "bd v0.test"
  exit 0
fi
if [[ "\${1:-}" == "create" ]]; then
  echo "created"
  exit 0
fi
echo "unsupported bd command: $*" >&2
exit 1
`, { mode: 0o755 });

    await fs.writeFile(path.join(binDir, 'gh'), `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "api" ]]; then
  echo "master"
  exit 0
fi
echo "unsupported gh command: $*" >&2
exit 1
`, { mode: 0o755 });

    await fs.writeFile(path.join(binDir, 'tmux'), `#!/usr/bin/env bash
set -euo pipefail
STATE_DIR="${stateDir}"
WITNESS_FILE="$STATE_DIR/witness-running.txt"
running="$(cat "$WITNESS_FILE" 2>/dev/null || echo 0)"

if [[ "\${1:-}" == "ls" ]]; then
  if [[ "$running" == "1" ]]; then
    echo "alpha-witness: 1 windows (created Thu Jan 1 00:00:00 1970)"
    exit 0
  fi
  exit 1
fi

if [[ "\${1:-}" == "has-session" ]]; then
  if [[ "$running" == "1" ]]; then
    exit 0
  fi
  exit 1
fi

echo "unsupported tmux command: $*" >&2
exit 1
`, { mode: 0o755 });

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

  it('invalidates rig cache after /api/rigs mutations', async () => {
    const before = await fetch(`${baseUrl}/api/rigs`);
    expect(before.status).toBe(200);
    expect(await before.json()).toEqual([{ name: 'alpha' }]);

    const add = await fetch(`${baseUrl}/api/rigs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'beta', url: 'https://github.com/owner/repo' }),
    });
    expect(add.status).toBe(200);

    const after = await fetch(`${baseUrl}/api/rigs`);
    expect(after.status).toBe(200);
    expect(await after.json()).toEqual([{ name: 'alpha' }, { name: 'beta' }]);
  });

  it('invalidates status cache after service mutations', async () => {
    const first = await fetch(`${baseUrl}/api/status`);
    expect(first.status).toBe(200);
    const firstData = await first.json();
    expect(firstData.rigs[0].hooks[0].running).toBe(false);

    const up = await fetch(`${baseUrl}/api/service/witness/up`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rig: 'alpha' }),
    });
    expect(up.status).toBe(200);

    const second = await fetch(`${baseUrl}/api/status`);
    expect(second.status).toBe(200);
    const secondData = await second.json();
    expect(secondData.rigs[0].hooks[0].running).toBe(true);
  });
});
