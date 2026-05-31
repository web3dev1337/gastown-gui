#!/usr/bin/env node

/**
 * Gas Town GUI CLI
 *
 * Command-line interface for starting the Gas Town GUI server.
 *
 * Usage:
 *   gastown-gui [command] [options]
 *
 * Commands:
 *   start         Start the GUI server (default)
 *   version       Show version
 *   help          Show help
 *
 * Options:
 *   --port, -p    Port to run on (default: 7667)
 *   --host, -h    Host to bind to (default: 127.0.0.1, or GASTOWN_HOST env var)
 *   --open, -o    Open browser after starting
 *   --dev         Enable development mode (auto-reload)
 */

import { spawn, execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, '..');

// Parse arguments
const args = process.argv.slice(2);

// Check for help/version flags first (before command parsing)
if (args.includes('--help') || args.includes('-h')) {
  showHelp();
  process.exit(0);
}
if (args.includes('--version') || args.includes('-v')) {
  showVersion();
  process.exit(0);
}

const command = args.find(a => !a.startsWith('-')) || 'start';
const options = {
  port: getOption(['--port', '-p']) || process.env.GASTOWN_PORT || '7667',
  host: getOption(['--host', '-h']) || process.env.GASTOWN_HOST || '127.0.0.1',
  open: hasFlag(['--open', '-o']),
  dev: hasFlag(['--dev']),
};

function getOption(flags) {
  for (const flag of flags) {
    const idx = args.indexOf(flag);
    if (idx !== -1 && args[idx + 1]) {
      return args[idx + 1];
    }
  }
  return null;
}

function hasFlag(flags) {
  return flags.some(f => args.includes(f));
}

function showHelp() {
  console.log(`
Gas Town GUI - Web interface for Gas Town multi-agent orchestrator

Usage:
  gastown-gui [command] [options]

Commands:
  start         Start the GUI server (default)
  version       Show version information
  doctor        Check Gas Town installation
  help          Show this help message

Options:
  --port, -p <port>   Port to run on (default: 7667, or GASTOWN_PORT env var)
  --host, -h <host>   Host to bind to (default: 127.0.0.1, or GASTOWN_HOST env var)
  --open, -o          Open browser after starting
  --dev               Enable development mode

Environment Variables:
  GASTOWN_PORT Server port (default: 7667)
  GASTOWN_HOST Server host (default: 127.0.0.1)
  GT_ROOT      Gas Town root directory (default: ~/gt)

Examples:
  gastown-gui                    # Start on default port
  gastown-gui start --port 9234  # Start on custom port
  gastown-gui start --open       # Start and open browser
  gastown-gui doctor             # Check gt installation

Prerequisites:
  - Gas Town CLI (gt) must be installed and in PATH
  - GitHub CLI (gh) for PR/issue tracking (optional)

More info: https://github.com/web3dev1337/gastown-gui
`);
}

function showVersion() {
  const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
  console.log(`gastown-gui v${packageJson.version}`);

  // Check gt version
  try {
    const gtVersion = execSync('gt version 2>/dev/null || echo "not installed"', { encoding: 'utf8' }).trim();
    console.log(`gt: ${gtVersion}`);
  } catch {
    console.log('gt: not found in PATH');
  }

  // Check gh version
  try {
    const ghVersion = execSync('gh --version 2>/dev/null | head -1 || echo "not installed"', { encoding: 'utf8' }).trim();
    console.log(`gh: ${ghVersion}`);
  } catch {
    console.log('gh: not found in PATH');
  }
}

function runDoctor() {
  console.log('Gas Town GUI Doctor\n');
  console.log('Checking prerequisites...\n');

  let allGood = true;

  // Check Node.js version
  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.slice(1).split('.')[0], 10);
  if (major >= 18) {
    console.log(`✅ Node.js ${nodeVersion} (>= 18 required)`);
  } else {
    console.log(`❌ Node.js ${nodeVersion} (>= 18 required)`);
    allGood = false;
  }

  // Check gt
  try {
    const gtPath = execSync('which gt 2>/dev/null', { encoding: 'utf8' }).trim();
    const gtVersion = execSync('gt version 2>/dev/null', { encoding: 'utf8' }).trim();
    console.log(`✅ gt installed at ${gtPath}`);
    console.log(`   Version: ${gtVersion}`);
  } catch {
    console.log('❌ gt not found in PATH');
    console.log('   Install: npm install -g @gastown/gt');
    console.log('   Or visit: https://github.com/steveyegge/gastown');
    allGood = false;
  }

  // Check bd
  try {
    execSync('which bd 2>/dev/null', { encoding: 'utf8' });
    console.log('✅ bd (beads) installed');
  } catch {
    console.log('⚠️  bd (beads) not found - some features may not work');
  }

  // Check gh
  try {
    const ghVersion = execSync('gh --version 2>/dev/null | head -1', { encoding: 'utf8' }).trim();
    console.log(`✅ GitHub CLI: ${ghVersion}`);

    // Check auth
    try {
      execSync('gh auth status 2>&1', { encoding: 'utf8' });
      console.log('   ✅ Authenticated');
    } catch {
      console.log('   ⚠️  Not authenticated - run: gh auth login');
    }
  } catch {
    console.log('⚠️  GitHub CLI (gh) not found - PR/issue tracking disabled');
  }

  // Check GT_ROOT
  const gtRoot = process.env.GT_ROOT || path.join(process.env.HOME || '', 'gt');
  if (fs.existsSync(gtRoot)) {
    console.log(`✅ GT_ROOT exists: ${gtRoot}`);
    try {
      const rigs = fs.readdirSync(gtRoot).filter(f => {
        const fullPath = path.join(gtRoot, f);
        return fs.statSync(fullPath).isDirectory() && fs.existsSync(path.join(fullPath, 'config.json'));
      });
      console.log(`   Found ${rigs.length} rig(s): ${rigs.join(', ') || '(none)'}`);
    } catch {
      // Ignore
    }
  } else {
    console.log(`⚠️  GT_ROOT not found: ${gtRoot}`);
    console.log('   Run: gt install ~/gt');
  }

  console.log('');
  if (allGood) {
    console.log('✅ All prerequisites met! Run: gastown-gui start');
  } else {
    console.log('❌ Some prerequisites missing. Fix issues above and try again.');
    process.exit(1);
  }
}

function startServer() {
  console.log(`Starting Gas Town GUI on http://${options.host}:${options.port}...`);

  const env = {
    ...process.env,
    GASTOWN_PORT: options.port,
    GASTOWN_HOST: options.host,
  };

  const serverPath = path.join(packageRoot, 'server.js');
  const serverArgs = options.dev ? ['--dev'] : [];

  const child = spawn('node', [serverPath, ...serverArgs], {
    env,
    stdio: 'inherit',
    cwd: packageRoot,
  });

  // Open browser if requested
  if (options.open) {
    setTimeout(() => {
      const url = `http://${options.host}:${options.port}`;
      const openCmd = process.platform === 'darwin' ? 'open' :
                      process.platform === 'win32' ? 'start' : 'xdg-open';
      try {
        execSync(`${openCmd} ${url}`, { stdio: 'ignore' });
      } catch {
        console.log(`Open browser manually: ${url}`);
      }
    }, 1500);
  }

  child.on('error', (err) => {
    console.error('Failed to start server:', err.message);
    process.exit(1);
  });

  child.on('exit', (code) => {
    process.exit(code || 0);
  });

  // Handle signals
  process.on('SIGINT', () => {
    child.kill('SIGINT');
  });

  process.on('SIGTERM', () => {
    child.kill('SIGTERM');
  });
}

// Main
switch (command) {
  case 'start':
    startServer();
    break;
  case 'version':
  case '-v':
  case '--version':
    showVersion();
    break;
  case 'doctor':
    runDoctor();
    break;
  case 'help':
  case '-h':
  case '--help':
    showHelp();
    break;
  default:
    console.error(`Unknown command: ${command}`);
    console.error('Run: gastown-gui help');
    process.exit(1);
}
