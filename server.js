/**
 * Gas Town GUI Bridge Server
 *
 * Node.js server that bridges the browser UI to the Gas Town CLI.
 * - Executes gt/bd commands via child_process
 * - Streams real-time events via WebSocket
 * - Serves static files
 */

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import fsPromises from 'fs/promises';
import os from 'os';
import readline from 'readline';
import { fileURLToPath } from 'url';

import { createApp } from './server/app/createApp.js';
import { normalizeRigAgents } from './server/domain/agents/normalizeRigAgents.js';
import {
  buildSessionRegistryFromTown,
  clearSessionRegistryCache,
  mayorSessionName,
  parseTmuxSessions,
  runningAddressesFromTmux,
  sessionNameForAgentAddress,
  sessionNameForService,
} from './server/domain/session/SessionNames.js';
import { AgentPath } from './server/domain/values/AgentPath.js';
import { CommandRunner } from './server/infrastructure/CommandRunner.js';
import { CacheRegistry } from './server/infrastructure/CacheRegistry.js';
import {
  DEFAULT_BD_FALLBACK_PATHS,
  DEFAULT_GT_FALLBACK_PATHS,
  resolveExecutable,
} from './server/infrastructure/ExecutableResolver.js';
import { BDGateway } from './server/gateways/BDGateway.js';
import { GTGateway } from './server/gateways/GTGateway.js';
import { GitHubGateway } from './server/gateways/GitHubGateway.js';
import { TmuxGateway } from './server/gateways/TmuxGateway.js';
import { BeadService } from './server/services/BeadService.js';
import { ConvoyService } from './server/services/ConvoyService.js';
import { FormulaService } from './server/services/FormulaService.js';
import { GitHubService } from './server/services/GitHubService.js';
import { StatusService } from './server/services/StatusService.js';
import { TargetService } from './server/services/TargetService.js';
import { WorkService } from './server/services/WorkService.js';
import { createCLICompatibilityService } from './server/services/CLICompatibilityService.js';
import { registerBeadRoutes } from './server/routes/beads.js';
import { registerConvoyRoutes } from './server/routes/convoys.js';
import { registerFormulaRoutes } from './server/routes/formulas.js';
import { registerGitHubRoutes } from './server/routes/github.js';
import { registerStatusRoutes } from './server/routes/status.js';
import { registerTargetRoutes } from './server/routes/targets.js';
import { registerWorkRoutes } from './server/routes/work.js';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.GASTOWN_PORT || 7667;
// Use GASTOWN_HOST (not the bare HOST env var, which collides with the
// compiler-toolchain convention, e.g. HOST=arm64-apple-darwin* set by
// conda/clang cross-compile shells — that would make the server try to bind
// to an unresolvable hostname and crash with getaddrinfo ENOTFOUND).
const HOST = process.env.GASTOWN_HOST || '127.0.0.1';
const HOME = process.env.HOME || os.homedir();
const GT_ROOT = process.env.GT_ROOT || path.join(HOME, 'gt');
const GT_EXECUTABLE = resolveExecutable({
  command: 'gt',
  envVarName: 'GT_BIN',
  fallbackPaths: DEFAULT_GT_FALLBACK_PATHS,
});
const BD_EXECUTABLE = resolveExecutable({
  command: 'bd',
  envVarName: 'BD_BIN',
  fallbackPaths: DEFAULT_BD_FALLBACK_PATHS,
});

const commandRunner = new CommandRunner();
const gtGateway = new GTGateway({ runner: commandRunner, gtRoot: GT_ROOT, executable: GT_EXECUTABLE });
const bdGateway = new BDGateway({ runner: commandRunner, gtRoot: GT_ROOT, executable: BD_EXECUTABLE });
const tmuxGateway = new TmuxGateway({ runner: commandRunner });
const backendCache = new CacheRegistry();
const convoyService = new ConvoyService({
  gtGateway,
  cache: backendCache,
  emit: (type, data) => emitMutationEvent(type, data),
});
const statusService = new StatusService({ gtGateway, tmuxGateway, cache: backendCache, gtRoot: GT_ROOT });
const targetService = new TargetService({ statusService });
const beadService = new BeadService({
  bdGateway,
  emit: (type, data) => emitMutationEvent(type, data),
});
const workService = new WorkService({
  gtGateway,
  bdGateway,
  emit: (type, data) => emitMutationEvent(type, data),
});
const gitHubGateway = new GitHubGateway({ runner: commandRunner });
const gitHubService = new GitHubService({ gitHubGateway, statusService, cache: backendCache });

const defaultOrigins = [
  `http://localhost:${PORT}`,
  `http://127.0.0.1:${PORT}`,
];
const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(origin => origin.trim()).filter(Boolean)
  : defaultOrigins;
const allowNullOrigin = process.env.ALLOW_NULL_ORIGIN === 'true';

const app = createApp({ allowedOrigins, allowNullOrigin });
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Simple in-memory cache with TTL
const cache = new Map();
const CACHE_TTL = {
  status: 5000,       // 5 seconds for status (frequently changing)
  convoys: 10000,     // 10 seconds for convoys
  mail: 15000,        // 15 seconds for mail list
  agents: 5000,       // 5 seconds for agents
  rigs: 5000,         // 5 seconds for rigs
  formulas: 60000,    // 1 minute for formulas (rarely changes)
  github_prs: 30000,  // 30 seconds for GitHub PRs
  github_issues: 30000, // 30 seconds for GitHub issues
  doctor: 30000,      // 30 seconds for doctor
};

const mailFeedCache = {
  mtimeMs: 0,
  size: 0,
  events: null,
};

function getCached(key) {
  const entry = cache.get(key);
  if (entry && Date.now() < entry.expires) {
    return entry.data;
  }
  cache.delete(key);
  return null;
}

function setCache(key, data, ttl) {
  cache.set(key, { data, expires: Date.now() + ttl });
}

const CACHE_INVALIDATION_BY_EVENT = {
  rig_added: {
    localKeys: ['rigs', 'agents', 'crews'],
    localPrefixes: ['rig-config:'],
    backendKeys: ['status'],
    backendPrefixes: ['convoys_'],
  },
  rig_removed: {
    localKeys: ['rigs', 'agents', 'crews'],
    localPrefixes: ['rig-config:'],
    backendKeys: ['status'],
    backendPrefixes: ['convoys_'],
  },
  crew_added: {
    localKeys: ['crews'],
    backendKeys: ['status'],
  },
  crew_removed: {
    localKeys: ['crews'],
    backendKeys: ['status'],
  },
  agent_started: {
    localKeys: ['agents'],
    backendKeys: ['status'],
  },
  agent_stopped: {
    localKeys: ['agents'],
    backendKeys: ['status'],
  },
  agent_restarted: {
    localKeys: ['agents'],
    backendKeys: ['status'],
  },
  service_started: {
    localKeys: ['agents'],
    backendKeys: ['status'],
  },
  service_stopped: {
    localKeys: ['agents'],
    backendKeys: ['status'],
  },
  service_restarted: {
    localKeys: ['agents'],
    backendKeys: ['status'],
  },
  convoy_created: {
    localKeys: ['agents'],
    backendKeys: ['status'],
    backendPrefixes: ['convoys_'],
  },
  convoy_updated: {
    localKeys: ['agents'],
    backendKeys: ['status'],
    backendPrefixes: ['convoys_'],
  },
  work_slung: {
    localKeys: ['agents'],
    backendKeys: ['status'],
    backendPrefixes: ['convoys_'],
  },
  work_done: {
    backendKeys: ['status'],
    backendPrefixes: ['convoys_'],
  },
  work_parked: {
    backendKeys: ['status'],
    backendPrefixes: ['convoys_'],
  },
  work_released: {
    backendKeys: ['status'],
    backendPrefixes: ['convoys_'],
  },
  work_reassigned: {
    backendKeys: ['status'],
    backendPrefixes: ['convoys_'],
  },
  bead_created: {
    backendKeys: ['status'],
    backendPrefixes: ['convoys_'],
  },
  escalation: {
    backendKeys: ['status'],
    backendPrefixes: ['convoys_'],
  },
};

function deleteLocalCacheByPrefix(prefix) {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
    }
  }
}

function invalidateCaches(plan = {}) {
  const {
    localKeys = [],
    localPrefixes = [],
    backendKeys = [],
    backendPrefixes = [],
  } = plan;

  for (const key of localKeys) {
    cache.delete(key);
  }
  for (const prefix of localPrefixes) {
    deleteLocalCacheByPrefix(prefix);
  }
  for (const key of backendKeys) {
    backendCache.delete(key);
  }
  for (const prefix of backendPrefixes) {
    backendCache.deleteByPrefix(prefix);
  }
}

function emitMutationEvent(type, data) {
  invalidateCaches(CACHE_INVALIDATION_BY_EVENT[type]);
  broadcast({ type, data });
}

/**
 * Parse rig names from `gt rig list` text output.
 * Handles both legacy "  rigname" and current "🟢 rigname" / "🛑 rigname" formats.
 */
function parseRigNames(text) {
  const rigs = [];
  for (const line of text.split('\n')) {
    // Match "  rigname" (2-space indent) or "emoji rigname" (status indicator prefix)
    const match = line.match(/^(?:\s{1,2}|\S+\s+)([a-zA-Z0-9_-]+)$/);
    if (match) {
      rigs.push({ name: match[1] });
    }
  }
  return rigs;
}

// Rig config cache TTL (5 minutes - rig configs rarely change)
const RIG_CONFIG_TTL = 300000;

/**
 * Get rig configuration with caching
 * @param {string} rigName - Name of the rig
 * @returns {Promise<Object|null>} - Rig config or null if not found
 */
async function getRigConfig(rigName) {
  const cacheKey = `rig-config:${rigName}`;
  const cached = getCached(cacheKey);
  if (cached !== null) return cached;

  try {
    const rigConfigPath = path.join(GT_ROOT, rigName, 'config.json');
    const rigConfigContent = await fsPromises.readFile(rigConfigPath, 'utf8');
    const config = JSON.parse(rigConfigContent);
    setCache(cacheKey, config, RIG_CONFIG_TTL);
    return config;
  } catch (e) {
    // Config not found or invalid - cache null to avoid repeated reads
    setCache(cacheKey, null, 60000); // Cache null for 1 minute
    return null;
  }
}

// Cache cleanup interval - removes expired entries to prevent memory leaks
const CACHE_CLEANUP_INTERVAL = 60000; // 1 minute
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const [key, entry] of cache.entries()) {
    if (now >= entry.expires) {
      cache.delete(key);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    console.log(`[Cache] Cleaned ${cleaned} expired entries, ${cache.size} remaining`);
  }
}, CACHE_CLEANUP_INTERVAL);

// Middleware
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use('/css', express.static(path.join(__dirname, 'css'), {
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store, must-revalidate');
  }
}));
app.use('/js', express.static(path.join(__dirname, 'js'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.js')) {
      res.setHeader('Cache-Control', 'no-store, must-revalidate');
    }
  }
}));
app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, must-revalidate');
  res.sendFile(path.join(__dirname, 'index.html'));
});
app.get('/favicon.ico', (req, res) => {
  res.sendFile(path.join(__dirname, 'assets', 'favicon.ico'));
});

// Store connected WebSocket clients
const clients = new Set();

// Broadcast to all connected clients
function broadcast(data) {
  const message = JSON.stringify(data);
  clients.forEach(client => {
    if (client.readyState === 1) { // OPEN
      client.send(message);
    }
  });
}

// Safely quote shell arguments to prevent command injection
// Escapes all shell metacharacters and wraps in single quotes
function quoteArg(arg) {
  if (arg === null || arg === undefined) return "''";
  const str = String(arg);
  // Single quotes are the safest - only need to escape single quotes themselves
  // Replace each ' with '\'' (end quote, escaped quote, start quote)
  return "'" + str.replace(/'/g, "'\\''") + "'";
}

function requireAgentPath(req, res) {
  try {
    return new AgentPath(req.params.rig, req.params.name);
  } catch {
    res.status(400).json({ error: 'Invalid rig or agent name' });
    return null;
  }
}

// Check if a specific tmux session is running
async function isSessionRunning(sessionName) {
  try {
    const { stdout } = await execFileAsync('tmux', ['has-session', '-t', sessionName]);
    return true;
  } catch {
    return false;
  }
}

// Mayor message history (in-memory, last 100 messages)
const mayorMessageHistory = [];
const MAX_MESSAGE_HISTORY = 100;

function addMayorMessage(target, message, status, response = null) {
  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
    timestamp: new Date().toISOString(),
    target,
    message,
    status, // 'sent', 'failed', 'auto-started'
    response
  };
  mayorMessageHistory.unshift(entry);
  if (mayorMessageHistory.length > MAX_MESSAGE_HISTORY) {
    mayorMessageHistory.pop();
  }
  // Broadcast to connected clients
  broadcast({ type: 'mayor_message', data: entry });
  return entry;
}

async function getSessionRegistry() {
  return buildSessionRegistryFromTown(GT_ROOT);
}

async function getRunningAgentAddresses() {
  try {
    const registry = await getSessionRegistry();
    const { stdout } = await execFileAsync('tmux', ['ls']);
    return runningAddressesFromTmux(stdout, registry);
  } catch {
    return new Set();
  }
}

// Parse GitHub URL to extract owner/repo
function parseGitHubUrl(url) {
  if (!url) return null;

  // Handle various GitHub URL formats:
  // https://github.com/owner/repo
  // https://github.com/owner/repo.git
  // git@github.com:owner/repo.git
  // ssh://git@github.com/owner/repo.git

  let match = url.match(/github\.com[/:]([^/]+)\/([^/.\s]+)/);
  if (match) {
    return { owner: match[1], repo: match[2].replace(/\.git$/, '') };
  }
  return null;
}

// Get default branch for a GitHub repo
async function getDefaultBranch(url) {
  const parsed = parseGitHubUrl(url);
  if (!parsed) {
    console.log(`[GitHub] Could not parse URL: ${url}`);
    return null;
  }

  try {
    // Use gh api to get repo info including default branch
    const { stdout } = await execFileAsync('gh', [
      'api', `repos/${parsed.owner}/${parsed.repo}`, '--jq', '.default_branch'
    ], { timeout: 10000 });

    const branch = String(stdout || '').trim();
    if (branch) {
      console.log(`[GitHub] Detected default branch for ${parsed.owner}/${parsed.repo}: ${branch}`);
      return branch;
    }
  } catch (err) {
    console.warn(`[GitHub] Could not detect default branch for ${url}:`, err.message);
  }

  return null;
}

// Get polecat output from tmux (last N lines)
async function getPolecatOutput(sessionName, lines = 50) {
  try {
    const safeLines = Math.max(1, Math.min(10000, parseInt(lines, 10) || 50));
    const { stdout } = await execFileAsync('tmux', ['capture-pane', '-t', sessionName, '-p']);
    const output = String(stdout || '');
    if (!output) return '';
    const outputLines = output.split('\n');
    return outputLines.slice(-safeLines).join('\n').trim();
  } catch {
    return null;
  }
}

// Execute a Gas Town command
async function executeGT(args, options = {}) {
  const cmd = `${GT_EXECUTABLE} ${args.join(' ')}`;
  console.log(`[GT] Executing: ${cmd}`);

  try {
    const { stdout, stderr } = await execFileAsync(GT_EXECUTABLE, args, {
      cwd: options.cwd || GT_ROOT,
      timeout: options.timeout || 30000,
      env: { ...process.env, ...options.env }
    });

    if (stderr && !options.ignoreStderr) {
      console.warn(`[GT] stderr: ${stderr}`);
    }

    return { success: true, data: String(stdout || '').trim() };
  } catch (error) {
    // Combine stdout and stderr for error output
    const output = String(error.stdout || '') + '\n' + String(error.stderr || '');
    const trimmedOutput = output.trim();

    // Check if this looks like a real error (contains "Error:" or "error:")
    const looksLikeError = /\bError:/i.test(trimmedOutput) || error.code !== 0;

    // Commands like 'gt doctor' or 'gt status' exit with code 1 when issues found, but still have useful output
    // However, if output contains "Error:" it's a real error, not just informational
    if (trimmedOutput && !looksLikeError) {
      console.warn(`[GT] Command exited with non-zero but has output: ${error.message}`);
      console.warn(`[GT] Output:\n${trimmedOutput}`);
      return { success: true, data: trimmedOutput, exitCode: error.code };
    }

    console.error(`[GT] Error: ${error.message}`);
    if (trimmedOutput) console.error(`[GT] Output:\n${trimmedOutput}`);
    return { success: false, error: trimmedOutput || error.message, exitCode: error.code };
  }
}

// Execute a Beads command
async function executeBD(args, options = {}) {
  const cmd = `${BD_EXECUTABLE} ${args.join(' ')}`;
  console.log(`[BD] Executing: ${cmd}`);

  // Set BEADS_DIR to ensure bd finds the database
  const beadsDir = path.join(GT_ROOT, '.beads');

  try {
    const { stdout } = await execFileAsync(BD_EXECUTABLE, args, {
      cwd: options.cwd || GT_ROOT,
      timeout: options.timeout || 30000,
      env: { ...process.env, BEADS_DIR: beadsDir }
    });

    return { success: true, data: String(stdout || '').trim() };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

const cliCompatibilityService = createCLICompatibilityService({
  executeGT: (args, options) => executeGT(args, options),
  executeBD: (args, options) => executeBD(args, options),
  killTmuxSession: async (sessionName) => {
    try {
      await execFileAsync('tmux', ['kill-session', '-t', sessionName]);
    } catch {
      // Session may not exist; safe to ignore.
    }
  },
});

// Parse JSON output from commands
function parseJSON(output) {
  try {
    return JSON.parse(output);
  } catch {
    return null;
  }
}

async function loadMailFeedEvents(feedPath) {
  const stats = await fsPromises.stat(feedPath);
  if (mailFeedCache.events &&
      mailFeedCache.mtimeMs === stats.mtimeMs &&
      mailFeedCache.size === stats.size) {
    return mailFeedCache.events;
  }

  const fileStream = fs.createReadStream(feedPath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  const mailEvents = [];
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event.type === 'mail') {
        // Transform feed event to mail-like object
        mailEvents.push({
          id: `feed-${event.ts}-${mailEvents.length}`,
          from: event.actor || 'unknown',
          to: event.payload?.to || 'unknown',
          subject: event.payload?.subject || event.summary || '(No Subject)',
          body: event.payload?.body || event.payload?.message || '',
          timestamp: event.ts,
          read: true, // Feed mail is historical
          priority: event.payload?.priority || 'normal',
          feedEvent: true, // Mark as feed-sourced
        });
      }
    } catch {
      // Skip malformed lines
    }
  }

  // Sort newest first
  mailEvents.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  mailFeedCache.events = mailEvents;
  mailFeedCache.mtimeMs = stats.mtimeMs;
  mailFeedCache.size = stats.size;

  return mailEvents;
}

// ============= REST API Endpoints =============

// Town status overview
registerStatusRoutes(app, { statusService });

// List convoys
registerConvoyRoutes(app, { convoyService });

// Work dispatch, escalation, and bead/work actions
registerWorkRoutes(app, { workService });

// Beads
registerBeadRoutes(app, { beadService });

// Get available sling targets
registerTargetRoutes(app, { targetService });

// Get mail inbox
app.get('/api/mail', async (req, res) => {
  // Check cache
  if (req.query.refresh !== 'true') {
    const cached = getCached('mail');
    if (cached) return res.json(cached);
  }

  const result = await executeGT(['mail', 'inbox', '--json']);
  if (result.success) {
    const data = parseJSON(result.data) || [];
    setCache('mail', data, CACHE_TTL.mail);
    res.json(data);
  } else {
    res.status(500).json({ error: result.error });
  }
});

// Send mail
app.post('/api/mail', async (req, res) => {
  const { to, subject, message, priority } = req.body;
  const args = ['mail', 'send', to, '-s', subject, '-m', message];
  if (priority) args.push('--priority', priority);

  const result = await executeGT(args);
  if (result.success) {
    res.json({ success: true });
  } else {
    res.status(500).json({ error: result.error });
  }
});

// Get all mail from feed (for observability) with pagination
app.get('/api/mail/all', async (req, res) => {
  try {
    // Pagination params (default: page 1, 50 items per page)
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset = (page - 1) * limit;

    const feedPath = path.join(GT_ROOT, '.events.jsonl');
    try {
      await fsPromises.access(feedPath);
    } catch {
      mailFeedCache.events = null;
      return res.json({ items: [], total: 0, page, limit, hasMore: false });
    }

    const mailEvents = await loadMailFeedEvents(feedPath);

    // Apply pagination
    const total = mailEvents.length;
    const paginatedItems = mailEvents.slice(offset, offset + limit);
    const hasMore = offset + limit < total;

    res.json({
      items: paginatedItems,
      total,
      page,
      limit,
      hasMore
    });
  } catch (err) {
    console.error('[API] Failed to read feed for mail:', err);
    res.status(500).json({ error: 'Failed to read mail feed' });
  }
});

// Get single mail message
app.get('/api/mail/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await executeGT(['mail', 'read', id, '--json']);
    if (result.success) {
      const mail = parseJSON(result.data);
      res.json(mail || { id, error: 'Not found' });
    } else {
      res.status(404).json({ error: 'Mail not found' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Mark mail as read
app.post('/api/mail/:id/read', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await executeGT(['mail', 'mark-read', id]);
    if (result.success) {
      res.json({ success: true, id, read: true });
    } else {
      res.status(500).json({ error: result.error || 'Failed to mark as read' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Mark mail as unread
app.post('/api/mail/:id/unread', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await executeGT(['mail', 'mark-unread', id]);
    if (result.success) {
      res.json({ success: true, id, read: false });
    } else {
      res.status(500).json({ error: result.error || 'Failed to mark as unread' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============= Nudge API =============

// Send a message to Mayor (or other agent)
app.post('/api/nudge', async (req, res) => {
  const { target, message, autoStart = true } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  // Default to mayor if no target specified
  const nudgeTarget = target || 'mayor';
  const registry = await getSessionRegistry();
  const sessionName = sessionNameForAgentAddress(nudgeTarget, registry) || `gt-${nudgeTarget}`;

  try {
    // Check if target session is running
    const isRunning = await isSessionRunning(sessionName);
    let wasAutoStarted = false;

    if (!isRunning) {
      console.log(`[Nudge] Session ${sessionName} not running`);

      // Auto-start Mayor if requested
      if (nudgeTarget === 'mayor' && autoStart) {
        console.log(`[Nudge] Auto-starting Mayor...`);
        const startResult = await executeGT(['mayor', 'start'], { timeout: 30000 });

        if (!startResult.success) {
          const entry = addMayorMessage(nudgeTarget, message, 'failed', 'Failed to auto-start Mayor');
          return res.status(500).json({
            error: 'Mayor not running and failed to auto-start',
            details: startResult.error,
            messageId: entry.id
          });
        }

        wasAutoStarted = true;
        console.log(`[Nudge] Mayor auto-started successfully`);

        // Wait a moment for Mayor to initialize
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Broadcast that Mayor was started
        emitMutationEvent('service_started', { service: 'mayor', autoStarted: true });
      } else if (!isRunning) {
        const entry = addMayorMessage(nudgeTarget, message, 'failed', `Session ${sessionName} not running`);
        return res.status(400).json({
          error: `${nudgeTarget} is not running`,
          hint: nudgeTarget === 'mayor' ? 'Set autoStart: true to start Mayor automatically' : `Start the ${nudgeTarget} service first`,
          messageId: entry.id
        });
      }
    }

    // Send the nudge
    const result = await executeGT(['nudge', nudgeTarget, message], { timeout: 10000 });

    if (result.success) {
      const status = wasAutoStarted ? 'auto-started' : 'sent';
      const entry = addMayorMessage(nudgeTarget, message, status);
      res.json({
        success: true,
        target: nudgeTarget,
        message,
        wasAutoStarted,
        messageId: entry.id
      });
    } else {
      const entry = addMayorMessage(nudgeTarget, message, 'failed', result.error);
      res.status(500).json({
        error: result.error || 'Failed to send message',
        messageId: entry.id
      });
    }
  } catch (err) {
    const entry = addMayorMessage(nudgeTarget, message, 'failed', err.message);
    res.status(500).json({ error: err.message, messageId: entry.id });
  }
});

// Get Mayor message history
app.get('/api/mayor/messages', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, MAX_MESSAGE_HISTORY);
  res.json(mayorMessageHistory.slice(0, limit));
});

// Get related PRs/commits for a bead
app.get('/api/bead/:beadId/links', async (req, res) => {
  const { beadId } = req.params;
  const links = { prs: [], commits: [] };

  try {
    // Get bead details to check close time for matching
    const beadResult = await executeBD(['show', beadId, '--json']);
    let beadClosedAt = null;
    if (beadResult.success) {
      const beadData = parseJSON(beadResult.data);
      const bead = Array.isArray(beadData) ? beadData[0] : beadData;
      if (bead && bead.closed_at) {
        beadClosedAt = new Date(bead.closed_at);
      }
    }

    // Get list of rig names
    const rigsResult = await executeGT(['rig', 'list']);
    if (!rigsResult.success) {
      return res.json(links);
    }

    // Parse rig names from both legacy and emoji-prefixed formats
    const rigNames = parseRigNames(rigsResult.data).map((rig) => rig.name);

    console.log(`[Links] Found rigs: ${rigNames.join(', ')}`);

    // Get repo URL for each rig by checking git remote
    for (const rigName of rigNames) {
      const rigPath = path.join(GT_ROOT, rigName, 'mayor', 'rig');

      try {
        const { stdout } = await execFileAsync('git', ['-C', rigPath, 'remote', 'get-url', 'origin'], { timeout: 5000 });
        const repoUrl = String(stdout || '').trim();

        // Extract owner/repo from GitHub URL
        const repoMatch = repoUrl.match(/github\.com[/:]([^/]+\/[^/.\s]+)/);
        if (!repoMatch) continue;
        const repo = repoMatch[1].replace(/\.git$/, '');

        // Search for PRs (title, body, branch containing bead ID, or polecat PRs near close time)
        try {
          const { stdout: prOutput } = await execFileAsync(
            'gh',
            ['pr', 'list', '--repo', repo, '--state', 'all', '--limit', '20', '--json', 'number,title,url,state,headRefName,body,createdAt,updatedAt'],
            { timeout: 10000 }
          );
          const prs = JSON.parse(String(prOutput || '') || '[]');

          for (const pr of prs) {
            // Check if PR is related to this bead
            let isRelated =
              (pr.title && pr.title.includes(beadId)) ||
              (pr.headRefName && pr.headRefName.includes(beadId)) ||
              (pr.body && pr.body.includes(beadId));

            // Also match polecat PRs created/updated within 1 hour of bead close time
            if (!isRelated && beadClosedAt && pr.headRefName && pr.headRefName.startsWith('polecat/')) {
              const prUpdated = new Date(pr.updatedAt || pr.createdAt);
              const timeDiff = Math.abs(beadClosedAt - prUpdated);
              const oneHour = 60 * 60 * 1000;
              if (timeDiff < oneHour) {
                isRelated = true;
              }
            }

            if (isRelated) {
              links.prs.push({
                repo,
                number: pr.number,
                title: pr.title,
                url: pr.url,
                state: pr.state,
                branch: pr.headRefName,
              });
            }
          }
        } catch (ghErr) {
          console.log(`[Links] Could not search ${repo}: ${ghErr.message}`);
        }
      } catch (gitErr) {
        // Skip rigs without git repos
        console.log(`[Links] Could not get repo for ${rigName}: ${gitErr.message}`);
      }
    }

    res.json(links);
  } catch (err) {
    console.error('[Links] Error:', err);
    res.json(links);
  }
});

// Get agent list
app.get('/api/agents', async (req, res) => {
  // Check cache
  if (req.query.refresh !== 'true') {
    const cached = getCached('agents');
    if (cached) return res.json(cached);
  }

  const [result, runningAddresses] = await Promise.all([
    executeGT(['status', '--json', '--fast'], { timeout: 30000 }),
    getRunningAgentAddresses()
  ]);

  if (result.success) {
    const data = parseJSON(result.data);
    const agents = (data?.agents || []).map((agent) => {
      const normalizedAddress = String(agent.address || '').replace(/\/$/, '');
      return {
        ...agent,
        id: agent.address || agent.name,
        running: runningAddresses.has(normalizedAddress) || Boolean(agent.running),
      };
    });

    const rigAgents = [];
    const polecats = [];
    for (const rig of data?.rigs || []) {
      for (const agent of normalizeRigAgents(rig)) {
        const address = agent.address || `${rig.name}/${agent.name}`;
        const normalizedAddress = String(address).replace(/\/$/, '');
        const legacyPolecatPath = normalizedAddress.replace(/\//, '/polecats/');
        const isRunning = runningAddresses.has(normalizedAddress) ||
          runningAddresses.has(legacyPolecatPath) ||
          Boolean(agent.running);
        const enhanced = {
          ...agent,
          id: address,
          address,
          rig: rig.name,
          running: isRunning,
        };
        rigAgents.push(enhanced);
        if (String(agent.role || '').toLowerCase() === 'polecat') {
          polecats.push(enhanced);
        }
      }
    }

    const response = {
      agents,
      rigAgents,
      polecats,
      runningPolecats: Array.from(runningAddresses),
    };
    setCache('agents', response, CACHE_TTL.agents);
    res.json(response);
  } else {
    res.status(500).json({ error: result.error });
  }
});

// Get Mayor output (tmux buffer)
app.get('/api/mayor/output', async (req, res) => {
  const lines = parseInt(req.query.lines) || 100;
  const sessionName = mayorSessionName();

  try {
    const output = await getPolecatOutput(sessionName, lines);
    const isRunning = await isSessionRunning(sessionName);

    if (output !== null) {
      res.json({
        session: sessionName,
        output,
        running: isRunning,
        // Include recent messages sent to Mayor for context
        recentMessages: mayorMessageHistory.slice(0, 10)
      });
    } else {
      res.json({ session: sessionName, output: null, running: isRunning, recentMessages: [] });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get polecat output (what they're working on)
app.get('/api/polecat/:rig/:name/output', async (req, res) => {
  const agent = requireAgentPath(req, res);
  if (!agent) return;
  const lines = parseInt(req.query.lines) || 50;
  const registry = await getSessionRegistry();
  const sessionName = agent.toSessionName(registry.prefixForRig(agent.rig.value));

  const output = await getPolecatOutput(sessionName, lines);
  if (output !== null) {
    res.json({ session: sessionName, output, running: true });
  } else {
    res.json({ session: sessionName, output: null, running: false });
  }
});

// Get full agent transcript (Claude session log)
app.get('/api/polecat/:rig/:name/transcript', async (req, res) => {
  const agent = requireAgentPath(req, res);
  if (!agent) return;
  const rig = agent.rig.value;
  const name = agent.name.value;
  const registry = await getSessionRegistry();
  const sessionName = agent.toSessionName(registry.prefixForRig(rig));

  try {
    // First try to get tmux output (full history)
    const output = await getPolecatOutput(sessionName, 2000);

    // Also try to find Claude session transcript files
    // Claude Code typically stores transcripts in ~/.claude/projects/ or .claude/ directories
    let transcriptContent = null;
    const transcriptPaths = [
      path.join(GT_ROOT, rig, '.claude', 'sessions'),
      path.join(GT_ROOT, rig, '.claude', 'transcripts'),
      path.join(os.homedir(), '.claude', 'projects', rig, 'sessions'),
    ];

    for (const transcriptPath of transcriptPaths) {
      try {
        await fsPromises.access(transcriptPath);
        // Find most recent transcript file
        const dirFiles = await fsPromises.readdir(transcriptPath);
        const filteredFiles = dirFiles.filter(f =>
          f.endsWith('.json') || f.endsWith('.md') || f.endsWith('.jsonl')
        );

        const filesWithTime = await Promise.all(
          filteredFiles.map(async f => {
            const stat = await fsPromises.stat(path.join(transcriptPath, f));
            return { name: f, time: stat.mtime.getTime() };
          })
        );
        filesWithTime.sort((a, b) => b.time - a.time);

        if (filesWithTime.length > 0) {
          transcriptContent = await fsPromises.readFile(
            path.join(transcriptPath, filesWithTime[0].name),
            'utf-8'
          );
          break;
        }
      } catch (e) {
        // Ignore errors, try next path
      }
    }

    res.json({
      session: sessionName,
      rig,
      name,
      running: output !== null,
      output: output || '(No tmux output available)',
      transcript: transcriptContent,
      hasTranscript: !!transcriptContent,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start a polecat/agent
app.post('/api/polecat/:rig/:name/start', async (req, res) => {
  const agent = requireAgentPath(req, res);
  if (!agent) return;
  const rig = agent.rig.value;
  const name = agent.name.value;
  const agentPath = agent.toString();

  console.log(`[Agent] Starting ${agentPath}...`);

  try {
    const result = await cliCompatibilityService.startPolecat({ rig, name });

    if (result.success) {
      emitMutationEvent('agent_started', { rig, name, agentPath });
      res.json({ success: true, message: `Started ${agentPath}`, raw: result.data });
    } else {
      res.status(500).json({ success: false, error: result.error });
    }
  } catch (err) {
    console.error(`[Agent] Failed to start ${agentPath}:`, err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Stop a polecat/agent
app.post('/api/polecat/:rig/:name/stop', async (req, res) => {
  const agent = requireAgentPath(req, res);
  if (!agent) return;
  const rig = agent.rig.value;
  const name = agent.name.value;
  const registry = await getSessionRegistry();
  const sessionName = agent.toSessionName(registry.prefixForRig(rig));

  console.log(`[Agent] Stopping ${rig}/${name}...`);

  try {
    // Kill the tmux session
    await execFileAsync('tmux', ['kill-session', '-t', sessionName]);
    emitMutationEvent('agent_stopped', { rig, name, session: sessionName });
    res.json({ success: true, message: `Stopped ${rig}/${name}` });
  } catch (err) {
    // Session might not exist, which is fine
    const errText = `${err.stderr || ''} ${err.message || ''}`;
    if (errText.includes("can't find session")) {
      res.json({ success: true, message: `${rig}/${name} was not running` });
    } else {
      console.error(`[Agent] Failed to stop ${rig}/${name}:`, err);
      res.status(500).json({ success: false, error: err.message });
    }
  }
});

// Restart a polecat/agent (stop then start)
app.post('/api/polecat/:rig/:name/restart', async (req, res) => {
  const agent = requireAgentPath(req, res);
  if (!agent) return;
  const rig = agent.rig.value;
  const name = agent.name.value;
  const agentPath = agent.toString();
  const registry = await getSessionRegistry();
  const sessionName = agent.toSessionName(registry.prefixForRig(rig));

  console.log(`[Agent] Restarting ${agentPath}...`);

  try {
    const result = await cliCompatibilityService.restartPolecat({ rig, name, sessionName });

    if (result.success) {
      emitMutationEvent('agent_restarted', { rig, name, agentPath });
      res.json({ success: true, message: `Restarted ${agentPath}`, raw: result.data });
    } else {
      res.status(500).json({ success: false, error: result.error });
    }
  } catch (err) {
    console.error(`[Agent] Failed to restart ${agentPath}:`, err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get hook status
app.get('/api/hook', async (req, res) => {
  const result = await executeGT(['hook', 'status', '--json']);
  if (result.success) {
    const data = parseJSON(result.data);
    res.json(data || { hooked: null });
  } else {
    res.status(500).json({ error: result.error });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============= Setup & Onboarding API =============

// Get setup status (for onboarding wizard)
app.get('/api/setup/status', async (req, res) => {
  const status = {
    gt_installed: false,
    gt_version: null,
    bd_installed: false,
    bd_version: null,
    workspace_initialized: false,
    workspace_path: GT_ROOT,
    rigs: [],
  };

  // Check gt
  try {
    const gtResult = await execFileAsync(GT_EXECUTABLE, ['version'], { timeout: 5000 });
    status.gt_installed = true;
    status.gt_version = String(gtResult.stdout || '').trim().split('\n')[0];
  } catch {
    status.gt_installed = false;
  }

  // Check bd
  try {
    const bdResult = await execFileAsync(BD_EXECUTABLE, ['version'], { timeout: 5000 });
    status.bd_installed = true;
    status.bd_version = String(bdResult.stdout || '').trim().split('\n')[0];
  } catch {
    status.bd_installed = false;
  }

  // Check workspace
  try {
    const mayorPath = path.join(GT_ROOT, 'mayor');
    await fsPromises.access(mayorPath);
    status.workspace_initialized = true;
  } catch {
    status.workspace_initialized = false;
  }

  // Get rigs — prefer --json output, fall back to text parsing
  try {
    const rigResult = await executeGT(['rig', 'list', '--json']);
    if (rigResult.success) {
      try {
        const parsed = JSON.parse(rigResult.data || '[]');
        status.rigs = Array.isArray(parsed)
          ? parsed
              .filter(rig => rig && rig.name)
              .map(rig => ({ name: rig.name, ...rig }))
          : [];
      } catch {
        const rigs = [];
        const lines = String(rigResult.data || '').split('\n');
        for (const line of lines) {
          const match = line.match(/^\s*([a-zA-Z0-9_-]+)\s*$/);
          if (match) {
            rigs.push({ name: match[1] });
          }
        }
        status.rigs = rigs;
      }
    } else {
      const textResult = await executeGT(['rig', 'list']);
      if (textResult.success) {
        status.rigs = parseRigNames(textResult.data);
      } else {
        status.rigs = [];
      }
    }
  } catch {
    status.rigs = [];
  }

  res.json(status);
});

// Add a rig (project)
app.post('/api/rigs', async (req, res) => {
  const { name, url } = req.body;

  if (!name || !url) {
    return res.status(400).json({ error: 'Name and URL are required' });
  }

  // Detect default branch from GitHub API (handles main vs master)
  // NOTE: --branch flag requires gt to be rebuilt from source (not in current binary)
  const defaultBranch = await getDefaultBranch(url);
  if (defaultBranch) {
    console.log(`[Rig] Detected default branch: ${defaultBranch} (gt --branch flag pending rebuild)`);
  }

  // Rig operations can take 90+ seconds for large repos
  // TODO: Pass --branch when gt is rebuilt: ['rig', 'add', name, url, '--branch', defaultBranch]
  const result = await executeGT(['rig', 'add', name, url], { timeout: 120000 });

  // Check if rig add actually succeeded (not just "has output")
  // If the output contains "Error:", it's a real failure even if success=true
  const hasError = result.data && (result.data.includes('Error:') || result.data.includes('error:'));

  if (result.success && !hasError) {
    clearSessionRegistryCache(GT_ROOT);

    // Create agent beads for witness and refinery (targeted, not gt doctor --fix)
    const agentRoles = ['witness', 'refinery'];
    for (const role of agentRoles) {
      const beadResult = await cliCompatibilityService.createAgentBeadForRig({ rigName: name, role });
      if (!beadResult.success) {
        console.warn(`[BD] Failed to create ${role} bead for ${name}:`, beadResult.error);
      } else {
        console.log(`[BD] Created ${role} agent bead for ${name}`);
      }
    }

    emitMutationEvent('rig_added', { name, url });
    res.json({ success: true, name, raw: result.data });
  } else {
    const errorMsg = hasError ? result.data : (result.error || 'Failed to add rig');
    res.status(500).json({ success: false, error: errorMsg });
  }
});

// List rigs — prefer --json output, fall back to text parsing
app.get('/api/rigs', async (req, res) => {
  // Check cache
  if (req.query.refresh !== 'true') {
    const cached = getCached('rigs');
    if (cached) return res.json(cached);
  }

  const result = await executeGT(['rig', 'list', '--json']);

  if (result.success) {
    try {
      const parsed = JSON.parse(result.data);
      const rigs = parsed.map(r => ({ name: r.name }));
      setCache('rigs', rigs, CACHE_TTL.rigs);
      res.json(rigs);
      return;
    } catch {
      // JSON parse failed — fall through to text parsing
    }
  }

  // Fallback: text parsing
  const textResult = await executeGT(['rig', 'list']);
  if (textResult.success) {
    const rigs = parseRigNames(textResult.data);
    setCache('rigs', rigs, CACHE_TTL.rigs);
    res.json(rigs);
  } else {
    res.json([]);
  }
});

// Remove a rig
app.delete('/api/rigs/:name', async (req, res) => {
  const { name } = req.params;

  if (!name) {
    return res.status(400).json({ error: 'Rig name is required' });
  }

  const result = await executeGT(['rig', 'remove', name]);

  if (result.success) {
    clearSessionRegistryCache(GT_ROOT);
    emitMutationEvent('rig_removed', { name });
    res.json({ success: true, name, raw: result.data });
  } else {
    res.status(500).json({ success: false, error: result.error });
  }
});

// === Crew Management ===

// List all crews
app.get('/api/crews', async (req, res) => {
  // Check cache first
  if (req.query.refresh !== 'true') {
    const cached = getCached('crews');
    if (cached) {
      return res.json(cached);
    }
  }

  const result = await executeGT(['crew', 'list', '--json']);

  if (result.success) {
    const data = parseJSON(result.data);
    if (data) {
      setCache('crews', data, CACHE_TTL.status);
      return res.json(data);
    }
    // Parse non-JSON output
    const crews = [];
    const lines = result.data.split('\n').filter(Boolean);
    for (const line of lines) {
      const match = line.match(/^(\S+)\s+/);
      if (match) {
        crews.push({ name: match[1] });
      }
    }
    setCache('crews', crews, CACHE_TTL.status);
    res.json(crews);
  } else {
    res.status(500).json({ error: result.error });
  }
});

// Get crew status
app.get('/api/crew/:name/status', async (req, res) => {
  const { name } = req.params;

  const result = await executeGT(['crew', 'status', name, '--json']);

  if (result.success) {
    const data = parseJSON(result.data);
    if (data) {
      return res.json(data);
    }
    res.json({ name, raw: result.data });
  } else {
    res.status(404).json({ error: result.error || 'Crew not found' });
  }
});

// Add a crew member
app.post('/api/crews', async (req, res) => {
  const { name, rig } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Crew name is required' });
  }

  const args = ['crew', 'add', name];
  if (rig) {
    args.push('--rig', rig);
  }

  const result = await executeGT(args);

  if (result.success) {
    emitMutationEvent('crew_added', { name, rig });
    res.status(201).json({ success: true, name, rig, raw: result.data });
  } else {
    res.status(500).json({ success: false, error: result.error });
  }
});

// Remove a crew member
app.delete('/api/crew/:name', async (req, res) => {
  const { name } = req.params;

  if (!name) {
    return res.status(400).json({ error: 'Crew name is required' });
  }

  const result = await executeGT(['crew', 'remove', name]);

  if (result.success) {
    emitMutationEvent('crew_removed', { name });
    res.json({ success: true, name, raw: result.data });
  } else {
    res.status(500).json({ success: false, error: result.error });
  }
});

// Run gt doctor
app.get('/api/doctor', async (req, res) => {
  // Check cache first (skip if ?refresh=true)
  if (req.query.refresh !== 'true') {
    const cached = getCached('doctor');
    if (cached) {
      return res.json(cached);
    }
  }

  // First try with --json flag (gt doctor can take 15-20s)
  let result = await executeGT(['doctor', '--json'], { timeout: 25000 });

  if (result.success) {
    const data = parseJSON(result.data);
    if (data) {
      setCache('doctor', data, 30000); // 30s cache
      return res.json(data);
    }
    // If JSON parse failed, return raw output
    const response = { raw: result.data, checks: [] };
    setCache('doctor', response, 30000);
    return res.json(response);
  }

  // Fallback: try without --json flag (gt doctor can take 15-20s)
  result = await executeGT(['doctor'], { timeout: 25000 });

  if (result.success) {
    // Parse text output into structured format with details
    const lines = result.data.split('\n');
    const checks = [];
    let currentCheck = null;

    for (const line of lines) {
      // Parse status lines: "✓ check-name: description" or "✗ check-name: description"
      const checkMatch = line.match(/^([✓✔✗✘×⚠!])\s*([^:]+):\s*(.+)$/);

      if (checkMatch) {
        // Save previous check
        if (currentCheck) checks.push(currentCheck);

        const [, symbol, checkName, description] = checkMatch;
        const status = '✓✔'.includes(symbol) ? 'pass' : '✗✘×'.includes(symbol) ? 'fail' : 'warn';

        currentCheck = {
          id: checkName.trim(),
          name: checkName.trim(),
          description: description.trim(),
          status,
          details: [],
          fix: null
        };
      } else if (currentCheck) {
        // Capture detail lines (indented)
        const detailMatch = line.match(/^\s{4}(.+)$/);
        if (detailMatch) {
          const detail = detailMatch[1].trim();
          // Check if it's a fix command
          if (detail.startsWith('→')) {
            currentCheck.fix = detail.substring(1).trim();
          } else {
            currentCheck.details.push(detail);
          }
        }
      }
    }

    // Don't forget last check
    if (currentCheck) checks.push(currentCheck);

    // Parse summary line
    const summaryMatch = result.data.match(/(\d+)\s*checks?,\s*(\d+)\s*passed?,\s*(\d+)\s*warnings?,\s*(\d+)\s*errors?/);
    const summary = summaryMatch ? {
      total: parseInt(summaryMatch[1]),
      passed: parseInt(summaryMatch[2]),
      warnings: parseInt(summaryMatch[3]),
      errors: parseInt(summaryMatch[4])
    } : null;

    const response = { checks, summary, raw: result.data };
    setCache('doctor', response, 30000);
    return res.json(response);
  }

  // Both failed - return error but with 200 to avoid breaking the UI
  const response = {
    checks: [],
    raw: result.error || 'gt doctor command not available',
    error: result.error
  };
  setCache('doctor', response, 10000); // Short cache for errors
  res.json(response);
});

// Run gt doctor --fix
app.post('/api/doctor/fix', async (req, res) => {
  try {
    const result = await executeGT(['doctor', '--fix'], { timeout: 60000 });
    // Clear doctor cache so next check shows fresh results
    cache.delete('doctor');
    if (result.success) {
      res.json({ success: true, output: result.data });
    } else {
      res.json({ success: false, error: result.error, output: result.data || '' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============= Service Controls (Mayor, Witness, Refinery) =============

// Start a service
app.post('/api/service/:name/up', async (req, res) => {
  const { name } = req.params;
  const validServices = ['mayor', 'witness', 'refinery', 'deacon'];

  if (!validServices.includes(name.toLowerCase())) {
    return res.status(400).json({ error: `Invalid service: ${name}. Valid services: ${validServices.join(', ')}` });
  }

  const { rig } = req.body || {};
  const needsRig = ['witness', 'refinery'].includes(name.toLowerCase());
  if (needsRig && !rig) {
    return res.status(400).json({ error: `${name} requires a rig parameter` });
  }

  console.log(`[Service] Starting ${name}...`);

  try {
    const args = [name, 'start'];
    if (rig) args.push(rig);
    const result = await executeGT(args, { timeout: 30000 });

    if (result.success) {
      emitMutationEvent('service_started', { service: name });
      res.json({ success: true, service: name, message: `${name} started`, raw: result.data });
    } else {
      res.status(500).json({ success: false, error: result.error });
    }
  } catch (err) {
    console.error(`[Service] Failed to start ${name}:`, err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Stop a service
app.post('/api/service/:name/down', async (req, res) => {
  const { name } = req.params;
  const { rig } = req.body || {};
  const validServices = ['mayor', 'witness', 'refinery', 'deacon'];
  const needsRig = ['witness', 'refinery'].includes(name.toLowerCase());

  if (!validServices.includes(name.toLowerCase())) {
    return res.status(400).json({ error: `Invalid service: ${name}. Valid services: ${validServices.join(', ')}` });
  }

  if (needsRig && !rig) {
    return res.status(400).json({ error: `${name} requires a rig parameter` });
  }

  console.log(`[Service] Stopping ${name}...`);

  try {
    const registry = await getSessionRegistry();
    const args = [name, 'stop'];
    if (rig) args.push(rig);
    const result = await executeGT(args, { timeout: 10000 });

    if (result.success) {
      emitMutationEvent('service_stopped', { service: name });
      res.json({ success: true, service: name, message: `${name} stopped`, raw: result.data });
    } else {
      // Try killing tmux session directly
      const sessionName = sessionNameForService({ name, rig, registry });
      try {
        if (!sessionName) throw new Error('No direct tmux session fallback available');
        await execFileAsync('tmux', ['kill-session', '-t', sessionName]);
        emitMutationEvent('service_stopped', { service: name });
        res.json({ success: true, service: name, message: `${name} stopped via tmux` });
      } catch {
        res.status(500).json({ success: false, error: result.error });
      }
    }
  } catch (err) {
    console.error(`[Service] Failed to stop ${name}:`, err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Restart a service
app.post('/api/service/:name/restart', async (req, res) => {
  const { name } = req.params;
  const { rig } = req.body || {};
  const validServices = ['mayor', 'witness', 'refinery', 'deacon'];
  const needsRig = ['witness', 'refinery'].includes(name.toLowerCase());

  if (!validServices.includes(name.toLowerCase())) {
    return res.status(400).json({ error: `Invalid service: ${name}. Valid services: ${validServices.join(', ')}` });
  }

  if (needsRig && !rig) {
    return res.status(400).json({ error: `${name} requires a rig parameter` });
  }

  console.log(`[Service] Restarting ${name}...`);

  try {
    // Stop first
    try {
      const stopArgs = [name, 'stop'];
      if (rig) stopArgs.push(rig);
      await executeGT(stopArgs, { timeout: 10000 });
    } catch {
      // Ignore stop errors
    }

    // Wait a moment
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Start
    const startArgs = [name, 'start'];
    if (rig) startArgs.push(rig);
    const result = await executeGT(startArgs, { timeout: 30000 });

    if (result.success) {
      emitMutationEvent('service_restarted', { service: name });
      res.json({ success: true, service: name, message: `${name} restarted`, raw: result.data });
    } else {
      res.status(500).json({ success: false, error: result.error });
    }
  } catch (err) {
    console.error(`[Service] Failed to restart ${name}:`, err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get service status
app.get('/api/service/:name/status', async (req, res) => {
  const { name } = req.params;
  const rig = req.query.rig;

  try {
    const registry = await getSessionRegistry();
    const sessionName = sessionNameForService({ name, rig, registry });

    let running = false;
    let resolvedSession = sessionName;
    const { stdout } = await execFileAsync('tmux', ['ls']);

    if (sessionName) {
      running = await isSessionRunning(sessionName);
    } else {
      const identities = parseTmuxSessions(stdout, registry);
      const match = identities.find((identity) => {
        if (identity.role !== String(name || '').toLowerCase()) return false;
        if (!rig) return true;
        return identity.rig === rig;
      });
      running = !!match;
      resolvedSession = match?.session || null;
    }

    res.json({ service: name, running, session: running ? resolvedSession : null });
  } catch (err) {
    res.json({ service: name, running: false, error: err.message });
  }
});

// ============= Formula Management =============

const formulaCache = {
  get: (key) => getCached(key),
  set: (key, value, ttlMs) => setCache(key, value, ttlMs),
  delete: (key) => cache.delete(key),
};

const formulaService = new FormulaService({
  gtGateway,
  bdGateway,
  cache: formulaCache,
  emit: (type, data) => emitMutationEvent(type, data),
});

registerFormulaRoutes(app, { formulaService });

// ============= GitHub Integration =============
registerGitHubRoutes(app, { gitHubService });

// ============= WebSocket for Real-time Events =============

// Start activity stream
let activityProcess = null;
let activityRestartTimer = null;

function scheduleActivityRestart() {
  if (clients.size === 0) return;
  if (activityRestartTimer) return;
  activityRestartTimer = setTimeout(() => {
    activityRestartTimer = null;
    if (clients.size > 0) {
      startActivityStream();
    }
  }, 5000);
}

function startActivityStream() {
  if (activityProcess) return;

  console.log('[WS] Starting activity stream...');

  // Use gt feed for comprehensive activity (beads + gt events + convoys)
  activityProcess = spawn(GT_EXECUTABLE, ['feed', '--plain', '--follow'], {
    cwd: GT_ROOT
  });

  activityProcess.stdout.on('data', (data) => {
    const lines = data.toString().split('\n').filter(Boolean);
    lines.forEach(line => {
      const event = parseActivityLine(line);
      if (event) {
        broadcast({ type: 'activity', data: event });
      }
    });
  });

  activityProcess.stderr.on('data', (data) => {
    console.error(`[BD Activity] stderr: ${data}`);
  });

  activityProcess.on('error', (error) => {
    console.error(`[BD Activity] Process error: ${error.message}`);
    activityProcess = null;
    scheduleActivityRestart();
  });

  activityProcess.on('close', (code) => {
    console.log(`[BD Activity] Process exited with code ${code}`);
    activityProcess = null;
    scheduleActivityRestart();
  });
}

// Parse activity line from gt feed output
// Format: [HH:MM:SS] SYMBOL TARGET action · description
function parseActivityLine(line) {
  // Match various unicode symbols used by gt feed
  const match = line.match(/^\[(\d{2}:\d{2}:\d{2})\]\s+(.+?)\s+(\S+)\s+(.+)$/u);
  if (!match) return null;

  const [, time, symbol, target, rest] = match;
  const [action, ...descParts] = rest.split(' · ');

  // Map symbols to event types (beads + gt events)
  const typeMap = {
    '+': 'bead_created',
    '→': 'bead_updated',
    '✓': 'work_complete',
    '✗': 'work_failed',
    '⊘': 'bead_deleted',
    '📌': 'bead_pinned',
    '🦉': 'patrol_started',
    '⚡': 'agent_nudged',
    '🎯': 'work_slung',
    '🤝': 'handoff',
    '⚙': 'merge_started',
    '🚀': 'convoy_created',
    '📦': 'convoy_updated',
  };

  const eventType = typeMap[symbol.trim()] || 'system';

  return {
    id: `${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
    time,
    type: eventType,
    target,
    action: action.trim(),
    message: descParts.join(' · ').trim(),
    summary: `${action.trim()}${descParts.length ? ': ' + descParts.join(' · ').trim() : ''}`,
    timestamp: new Date().toISOString()
  };
}

// WebSocket connection handler
wss.on('connection', (ws) => {
  console.log('[WS] Client connected');
  clients.add(ws);

  // Start activity stream if first client
  if (clients.size === 1) {
    startActivityStream();
  }

  // Send initial status
  statusService
    .getStatus({ refresh: false })
    .then((data) => {
      if (data && ws.readyState === 1) { // OPEN
        ws.send(JSON.stringify({ type: 'status', data }));
      }
    })
    .catch((err) => {
      console.error('[WS] Error getting initial status:', err.message);
    });

  ws.on('close', () => {
    console.log('[WS] Client disconnected');
    clients.delete(ws);

    // Stop activity stream if no clients
    if (clients.size === 0) {
      if (activityRestartTimer) {
        clearTimeout(activityRestartTimer);
        activityRestartTimer = null;
      }
      if (activityProcess) {
        activityProcess.kill();
        activityProcess = null;
      }
    }
  });

  ws.on('error', (error) => {
    console.error('[WS] Error:', error);
  });
});

// ============= Start Server =============

server.listen(PORT, HOST, () => {
  const displayHost = HOST === '0.0.0.0' || HOST === '::' ? 'localhost' : HOST;
  console.log(`
╔══════════════════════════════════════════════════════════╗
║              GAS TOWN GUI SERVER                         ║
╠══════════════════════════════════════════════════════════╣
║  URL:        http://${displayHost}:${PORT}                       ║
║  GT_ROOT:    ${GT_ROOT.padEnd(40)}║
║  WebSocket:  ws://${displayHost}:${PORT}/ws                      ║
╚══════════════════════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Server] Shutting down...');
  if (activityProcess) {
    activityProcess.kill();
  }
  wss.close();
  server.close(() => {
    process.exit(0);
  });
});
