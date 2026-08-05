/**
 * Gas Town GUI - Mock Server for Testing
 *
 * Provides mock API responses for E2E testing without the Go backend.
 */

import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Mock data
const mockData = {
  status: {
    name: 'Test Town',
    version: '0.1.0',
    uptime: 3600,
    hook: null,
    agents: [
      { id: 'agent-1', name: 'Mayor', role: 'mayor', status: 'idle', running: true },
      { id: 'agent-2', name: 'Deacon-1', role: 'deacon', status: 'working', current_task: 'Processing convoy', running: true },
      { id: 'agent-3', name: 'Polecat-1', role: 'polecat', status: 'idle', running: false },
      { id: 'agent-4', name: 'Witness-1', role: 'witness', status: 'idle', running: true, rig: 'my-rig' },
      { id: 'agent-5', name: 'Refinery-1', role: 'refinery', status: 'idle', running: false, rig: 'my-rig' },
    ],
    convoy_count: 2,
    active_agents: 1,
    pending_tasks: 3,
  },

  convoys: [
    {
      id: 'convoy-abc123',
      name: 'Feature Implementation',
      status: 'running',
      priority: 'high',
      issues: [{ title: 'Add user authentication' }, { title: 'Create API endpoints' }],
      progress: 0.45,
      created_at: new Date(Date.now() - 3600000).toISOString(),
      agent_count: 2,
      task_count: 5,
    },
    {
      id: 'convoy-def456',
      name: 'Bug Fixes',
      status: 'pending',
      priority: 'normal',
      issues: [{ title: 'Fix login redirect' }],
      progress: 0,
      created_at: new Date(Date.now() - 7200000).toISOString(),
      agent_count: 0,
      task_count: 1,
    },
  ],

  mail: [
    {
      id: 'mail-1',
      from: 'System',
      subject: 'Welcome to Gas Town',
      message: 'Welcome to your new Gas Town installation. Get started by creating a convoy.',
      timestamp: new Date(Date.now() - 86400000).toISOString(),
      read: true,
      priority: 'normal',
    },
    {
      id: 'mail-2',
      from: 'Deacon-1',
      subject: 'Task Complete',
      message: 'The authentication module has been implemented successfully.',
      timestamp: new Date(Date.now() - 3600000).toISOString(),
      read: false,
      priority: 'normal',
    },
  ],

  events: [],
};

// Create Express app
const app = express();
app.use(express.json());

// Serve static files from gui directory
app.use(express.static(path.join(__dirname, '..')));

// API endpoints
app.get('/api/status', (req, res) => {
  res.json(mockData.status);
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/model-policy', (req, res) => {
  const role = { agent: 'claude', model: 'sonnet[1m]', source: 'town default_agent' };
  res.json({
    model: 'sonnet[1m]',
    matchesExpected: true,
    expectedModel: 'sonnet',
    unresolved: false,
    settingsPath: '/home/mock/gt/settings/config.json',
    roles: {
      mayor: role, deacon: role, witness: role, refinery: role, polecat: role, crew: role,
    },
    rigOverrides: {},
    dogNote: 'gastown pins the dog role to Haiku and ignores Claude-preset overrides for it.',
  });
});

app.get('/api/convoys', (req, res) => {
  res.json(mockData.convoys);
});

app.get('/api/convoy/:id', (req, res) => {
  const convoy = mockData.convoys.find(c => c.id === req.params.id);
  if (convoy) {
    res.json(convoy);
  } else {
    res.status(404).json({ error: 'Convoy not found' });
  }
});

app.post('/api/convoy', (req, res) => {
  const { name, issues, notify } = req.body;
  const newConvoy = {
    id: `convoy-${Date.now()}`,
    name,
    issues: issues?.map(i => ({ title: i })) || [],
    status: 'pending',
    priority: 'normal',
    progress: 0,
    created_at: new Date().toISOString(),
    agent_count: 0,
    task_count: issues?.length || 0,
  };
  mockData.convoys.unshift(newConvoy);
  res.json(newConvoy);

  // Broadcast event via WebSocket
  broadcastEvent({
    type: 'convoy_created',
    data: newConvoy,
  });
});

app.post('/api/sling', (req, res) => {
  const { bead, target, molecule, quality } = req.body;
  const result = {
    id: `sling-${Date.now()}`,
    bead,
    target,
    molecule,
    quality,
    status: 'dispatched',
    timestamp: new Date().toISOString(),
  };
  res.json(result);

  // Broadcast event
  broadcastEvent({
    type: 'work_slung',
    data: result,
  });
});

app.get('/api/hook', (req, res) => {
  res.json(mockData.status.hook || { status: 'none' });
});

app.get('/api/mail', (req, res) => {
  res.json(mockData.mail);
});

app.post('/api/mail', (req, res) => {
  const { to, subject, message, priority } = req.body;
  const newMail = {
    id: `mail-${Date.now()}`,
    from: 'You',
    to,
    subject,
    message,
    priority: priority || 'normal',
    timestamp: new Date().toISOString(),
    read: true,
  };
  res.json({ success: true, mail: newMail });
});

app.get('/api/agents', (req, res) => {
  res.json(mockData.status.agents);
});

// Rig management endpoints
const mockRigs = [
  { name: 'zoo-game', path: '/home/user/gt/zoo-game', url: 'https://github.com/web3dev1337/zoo-game', status: 'active' },
  { name: 'gastown', path: '/home/user/gt/gastown', url: 'https://github.com/steveyegge/gastown', status: 'active' },
];

app.get('/api/rigs', (req, res) => {
  res.json(mockRigs);
});

app.post('/api/rigs', (req, res) => {
  const { name, url } = req.body;
  if (!name || !url) {
    return res.status(400).json({ error: 'Missing required fields: name, url' });
  }
  const newRig = { name, url, path: `/home/user/gt/${name}`, status: 'active' };
  mockRigs.push(newRig);
  res.status(201).json({ success: true, rig: newRig });
});

app.delete('/api/rigs/:name', (req, res) => {
  const { name } = req.params;
  const index = mockRigs.findIndex(r => r.name === name);
  if (index === -1) {
    return res.status(404).json({ error: 'Rig not found' });
  }
  mockRigs.splice(index, 1);
  res.json({ success: true, removed: name });
});

// Doctor/diagnostics endpoints
app.get('/api/doctor', (req, res) => {
  res.json({
    status: 'healthy',
    checks: [
      { name: 'git', status: 'ok', message: 'Git 2.43.0 installed' },
      { name: 'beads', status: 'ok', message: 'beads 0.44.0 installed' },
      { name: 'tmux', status: 'ok', message: 'tmux 3.4 installed' },
      { name: 'workspace', status: 'ok', message: 'Workspace configured at ~/gt' },
    ],
    timestamp: new Date().toISOString(),
  });
});

app.post('/api/doctor/fix', (req, res) => {
  res.json({
    success: true,
    fixed: ['tmux session cleanup', 'stale lock removal'],
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/setup/status', (req, res) => {
  res.json({
    installed: true,
    workspace: '~/gt',
    rigs: mockRigs.length,
    agents: mockData.status.agents.length,
    ready: true,
  });
});

app.get('/api/hook', (req, res) => {
  res.json({
    status: 'active',
    hooks: [
      { name: 'pre-commit', enabled: true },
      { name: 'post-merge', enabled: true },
    ],
  });
});

app.post('/api/nudge', (req, res) => {
  const { target, message } = req.body;
  res.json({ success: true, target, message });

  // Broadcast event
  broadcastEvent({
    type: 'activity',
    data: {
      type: 'system',
      message: `Nudged agent ${target}: ${message}`,
      timestamp: new Date().toISOString(),
    },
  });
});

// Search endpoints
app.get('/api/beads/search', (req, res) => {
  const query = (req.query.q || '').toLowerCase();
  const mockBeads = [
    { id: 'gt-123', title: 'Fix login redirect', status: 'open' },
    { id: 'gt-124', title: 'Add authentication module', status: 'in-progress' },
    { id: 'gt-125', title: 'Update user dashboard', status: 'done' },
    { id: 'bd-001', title: 'Database migration script', status: 'blocked' },
    { id: 'bd-002', title: 'API rate limiting', status: 'open' },
  ];
  const results = mockBeads.filter(b =>
    b.id.toLowerCase().includes(query) ||
    b.title.toLowerCase().includes(query)
  );
  res.json(results);
});

app.get('/api/formulas/search', (req, res) => {
  const query = (req.query.q || '').toLowerCase();
  const mockFormulas = [
    { name: 'shiny-feature', description: 'Create a polished feature implementation' },
    { name: 'quick-fix', description: 'Fast bug fix with minimal testing' },
    { name: 'deep-dive', description: 'Thorough investigation and analysis' },
    { name: 'refactor', description: 'Code cleanup and restructuring' },
  ];
  const results = mockFormulas.filter(f =>
    f.name.toLowerCase().includes(query) ||
    f.description.toLowerCase().includes(query)
  );
  res.json(results);
});

app.get('/api/targets', (req, res) => {
  // Match the format from server.js - grouped by type
  const targets = [
    // Global agents
    { id: 'mayor', name: 'Mayor', type: 'global', icon: 'account_balance', description: 'Global coordinator' },
    { id: 'deacon', name: 'Deacon', type: 'global', icon: 'health_and_safety', description: 'Health monitor' },
    { id: 'deacon/dogs', name: 'Deacon Dogs', type: 'global', icon: 'pets', description: 'Auto-dispatch to idle dog' },
    // Rigs (can spawn polecats)
    { id: 'greenplace', name: 'greenplace', type: 'rig', icon: 'folder_special', description: 'Auto-spawn polecat in greenplace' },
    { id: 'work1', name: 'work1', type: 'rig', icon: 'folder_special', description: 'Auto-spawn polecat in work1' },
    // Running agents
    { id: 'greenplace/Toast', name: 'greenplace/Toast', type: 'agent', role: 'polecat', icon: 'engineering', description: 'polecat in greenplace', running: true, has_work: false },
    { id: 'greenplace/Witness', name: 'greenplace/Witness', type: 'agent', role: 'witness', icon: 'visibility', description: 'witness in greenplace', running: true, has_work: true },
  ];
  res.json(targets);
});

app.post('/api/escalate', (req, res) => {
  const { convoy_id, reason, priority } = req.body;
  res.json({ success: true, convoy_id, reason, priority });

  // Broadcast event
  broadcastEvent({
    type: 'activity',
    data: {
      type: 'escalation',
      message: `Convoy ${convoy_id} escalated (${priority}): ${reason}`,
      timestamp: new Date().toISOString(),
    },
  });
});

app.get('/api/github/repos', (req, res) => {
  // Mock list of user's repos
  const repos = [
    { name: 'gastown', nameWithOwner: 'web3dev1337/gastown', description: 'Gas Town orchestration tool', url: 'https://github.com/web3dev1337/gastown', isPrivate: false, isFork: false, pushedAt: new Date().toISOString(), primaryLanguage: { name: 'Go' }, stargazerCount: 12 },
    { name: 'zoo-game', nameWithOwner: 'web3dev1337/zoo-game', description: 'HyTopia zoo game', url: 'https://github.com/web3dev1337/zoo-game', isPrivate: true, isFork: false, pushedAt: new Date(Date.now() - 86400000).toISOString(), primaryLanguage: { name: 'TypeScript' }, stargazerCount: 0 },
    { name: 'epic-survivors', nameWithOwner: 'web3dev1337/epic-survivors', description: 'Survivor game', url: 'https://github.com/web3dev1337/epic-survivors', isPrivate: true, isFork: false, pushedAt: new Date(Date.now() - 172800000).toISOString(), primaryLanguage: { name: 'C#' }, stargazerCount: 0 },
    { name: 'ai-claude-standards', nameWithOwner: 'web3dev1337/ai-claude-standards', description: 'Claude configuration', url: 'https://github.com/web3dev1337/ai-claude-standards', isPrivate: false, isFork: false, pushedAt: new Date(Date.now() - 259200000).toISOString(), primaryLanguage: { name: 'Markdown' }, stargazerCount: 5 },
  ];
  res.json(repos);
});

// GitHub PRs + Issues (used by PRs/Issues views)
const mockGitHubPRs = [
  {
    number: 101,
    repo: 'web3dev1337/gastown',
    rig: 'gastown',
    title: 'Refactor: extract gateways and service layer',
    url: 'https://github.com/web3dev1337/gastown/pull/101',
    state: 'OPEN',
    isDraft: false,
    reviewDecision: 'REVIEW_REQUIRED',
    headRefName: 'refactor/gateways',
    updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    author: { login: 'web3dev1337' },
  },
  {
    number: 88,
    repo: 'web3dev1337/zoo-game',
    rig: 'zoo-game',
    title: 'Fix: mobile navbar layout regression',
    url: 'https://github.com/web3dev1337/zoo-game/pull/88',
    state: 'MERGED',
    isDraft: false,
    reviewDecision: 'APPROVED',
    headRefName: 'fix/mobile-navbar',
    updatedAt: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(),
    author: { login: 'contributor-1' },
  },
  {
    number: 42,
    repo: 'web3dev1337/ai-claude-standards',
    rig: 'ai-claude-standards',
    title: 'Docs: clarify agent handoff process',
    url: 'https://github.com/web3dev1337/ai-claude-standards/pull/42',
    state: 'CLOSED',
    isDraft: true,
    reviewDecision: 'CHANGES_REQUESTED',
    headRefName: 'docs/handoff',
    updatedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    author: { login: 'contributor-2' },
  },
];

app.get('/api/github/prs', (req, res) => {
  const state = String(req.query.state || 'open').toLowerCase();
  const filtered = state === 'all'
    ? mockGitHubPRs
    : mockGitHubPRs.filter(pr => String(pr.state || '').toLowerCase() === state);
  res.json(filtered);
});

app.get('/api/github/pr/:repo/:number', (req, res) => {
  const repo = String(req.params.repo || '');
  const number = Number(req.params.number);
  const pr = mockGitHubPRs.find(p => p.repo === repo && p.number === number);
  if (!pr) return res.status(404).json({ error: 'PR not found' });
  res.json(pr);
});

const mockGitHubIssues = [
  {
    number: 17,
    repo: 'web3dev1337/gastown',
    rig: 'gastown',
    title: 'Investigate intermittent WebSocket disconnects',
    url: 'https://github.com/web3dev1337/gastown/issues/17',
    state: 'open',
    labels: [{ name: 'bug', color: 'd73a4a' }, { name: 'ws', color: '0366d6' }],
    assignees: [{ login: 'web3dev1337' }],
    author: { login: 'reporter-1' },
    updatedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
  },
  {
    number: 9,
    repo: 'web3dev1337/zoo-game',
    rig: 'zoo-game',
    title: 'Add “crews” panel to dashboard quick actions',
    url: 'https://github.com/web3dev1337/zoo-game/issues/9',
    state: 'open',
    labels: [{ name: 'enhancement', color: 'a2eeef' }],
    assignees: [],
    author: { login: 'reporter-2' },
    updatedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    number: 3,
    repo: 'web3dev1337/ai-claude-standards',
    rig: 'ai-claude-standards',
    title: 'Document enterprise refactor patterns (PoEAA)',
    url: 'https://github.com/web3dev1337/ai-claude-standards/issues/3',
    state: 'closed',
    labels: [{ name: 'docs', color: '0075ca' }],
    assignees: [{ login: 'contributor-2' }],
    author: { login: 'reporter-3' },
    updatedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
  },
];

app.get('/api/github/issues', (req, res) => {
  const state = String(req.query.state || 'open').toLowerCase();
  const filtered = state === 'all'
    ? mockGitHubIssues
    : mockGitHubIssues.filter(issue => String(issue.state || '').toLowerCase() === state);
  res.json(filtered);
});

app.get('/api/github/issue/:repo/:number', (req, res) => {
  const repo = String(req.params.repo || '');
  const number = Number(req.params.number);
  const issue = mockGitHubIssues.find(i => i.repo === repo && i.number === number);
  if (!issue) return res.status(404).json({ error: 'Issue not found' });
  res.json(issue);
});

// Polecat (worker) management
const mockPolecats = new Map([
  ['zoo-game/polecat-1', { rig: 'zoo-game', name: 'polecat-1', status: 'running', started: new Date().toISOString() }],
  ['gastown/worker-1', { rig: 'gastown', name: 'worker-1', status: 'idle', started: new Date(Date.now() - 3600000).toISOString() }],
]);

app.get('/api/polecat/:rig/:name/output', (req, res) => {
  const { rig, name } = req.params;
  const key = `${rig}/${name}`;
  if (!mockPolecats.has(key)) {
    return res.status(404).json({ error: 'Polecat not found' });
  }
  res.json({
    output: `[${new Date().toISOString()}] Polecat ${name} running in ${rig}\n[INFO] Processing tasks...\n[INFO] Ready for work.`,
    lines: 3,
  });
});

app.get('/api/polecat/:rig/:name/transcript', (req, res) => {
  const { rig, name } = req.params;
  const key = `${rig}/${name}`;
  if (!mockPolecats.has(key)) {
    return res.status(404).json({ error: 'Polecat not found' });
  }
  res.json({
    transcript: `Session started at ${new Date().toISOString()}\nUser: Start working on task\nAssistant: I'll begin working on that now...`,
    messages: 2,
  });
});

app.post('/api/polecat/:rig/:name/start', (req, res) => {
  const { rig, name } = req.params;
  const key = `${rig}/${name}`;
  const polecat = { rig, name, status: 'running', started: new Date().toISOString() };
  mockPolecats.set(key, polecat);
  res.json({ success: true, polecat });
});

app.post('/api/polecat/:rig/:name/stop', (req, res) => {
  const { rig, name } = req.params;
  const key = `${rig}/${name}`;
  if (!mockPolecats.has(key)) {
    return res.status(404).json({ error: 'Polecat not found' });
  }
  mockPolecats.delete(key);
  res.json({ success: true, stopped: key });
});

app.post('/api/polecat/:rig/:name/restart', (req, res) => {
  const { rig, name } = req.params;
  const key = `${rig}/${name}`;
  const polecat = { rig, name, status: 'running', started: new Date().toISOString(), restarted: true };
  mockPolecats.set(key, polecat);
  res.json({ success: true, polecat });
});

// Mayor management
let mayorMessages = [
  { id: 1, type: 'user', content: 'Build a new feature', timestamp: new Date(Date.now() - 60000).toISOString() },
  { id: 2, type: 'assistant', content: 'I will create a convoy for that task.', timestamp: new Date(Date.now() - 30000).toISOString() },
];

app.get('/api/mayor/output', (req, res) => {
  res.json({
    output: `[Mayor] Running since ${new Date(Date.now() - 3600000).toISOString()}\n[Mayor] Active convoys: 2\n[Mayor] Waiting for instructions...`,
    lines: 3,
  });
});

app.get('/api/mayor/messages', (req, res) => {
  res.json(mayorMessages);
});

// Service management
const mockServices = new Map([
  ['mayor', { name: 'mayor', status: 'running', pid: 12345 }],
  ['deacon', { name: 'deacon', status: 'running', pid: 12346 }],
  ['witness', { name: 'witness', status: 'stopped', pid: null }],
]);

app.get('/api/service/:name/status', (req, res) => {
  const { name } = req.params;
  const service = mockServices.get(name);
  if (!service) {
    return res.status(404).json({ error: 'Service not found' });
  }
  res.json(service);
});

app.post('/api/service/:name/up', (req, res) => {
  const { name } = req.params;
  const { rig } = req.body || {};
  const needsRig = ['witness', 'refinery'].includes(name.toLowerCase());
  if (needsRig && !rig) {
    return res.status(400).json({ error: `${name} requires a rig parameter` });
  }
  let service = mockServices.get(name);
  if (!service) {
    service = { name, status: 'running', pid: Math.floor(Math.random() * 10000) + 10000 };
  } else {
    service.status = 'running';
    service.pid = Math.floor(Math.random() * 10000) + 10000;
  }
  if (rig) service.rig = rig;
  mockServices.set(name, service);
  res.json({ success: true, service });
});

app.post('/api/service/:name/down', (req, res) => {
  const { name } = req.params;
  const { rig } = req.body || {};
  const needsRig = ['witness', 'refinery'].includes(name.toLowerCase());
  if (needsRig && !rig) {
    return res.status(400).json({ error: `${name} requires a rig parameter` });
  }
  const service = mockServices.get(name);
  if (!service) {
    return res.status(404).json({ error: 'Service not found' });
  }
  service.status = 'stopped';
  service.pid = null;
  res.json({ success: true, service });
});

app.post('/api/service/:name/restart', (req, res) => {
  const { name } = req.params;
  const { rig } = req.body || {};
  const needsRig = ['witness', 'refinery'].includes(name.toLowerCase());
  if (needsRig && !rig) {
    return res.status(400).json({ error: `${name} requires a rig parameter` });
  }
  let service = mockServices.get(name);
  if (!service) {
    service = { name, status: 'running', pid: Math.floor(Math.random() * 10000) + 10000 };
  } else {
    service.status = 'running';
    service.pid = Math.floor(Math.random() * 10000) + 10000;
  }
  if (rig) service.rig = rig;
  mockServices.set(name, service);
  res.json({ success: true, service, restarted: true });
});

// === Mail endpoints ===
app.get('/api/mail/all', (req, res) => {
  res.json(mockData.mail);
});

app.get('/api/mail/:id', (req, res) => {
  const { id } = req.params;
  const mail = mockData.mail.find(m => m.id === id);
  if (!mail) {
    return res.status(404).json({ error: 'Mail not found' });
  }
  res.json(mail);
});

app.post('/api/mail/:id/read', (req, res) => {
  const { id } = req.params;
  const mail = mockData.mail.find(m => m.id === id);
  if (!mail) {
    return res.status(404).json({ error: 'Mail not found' });
  }
  mail.read = true;
  res.json({ success: true, mail });
});

app.post('/api/mail/:id/unread', (req, res) => {
  const { id } = req.params;
  const mail = mockData.mail.find(m => m.id === id);
  if (!mail) {
    return res.status(404).json({ error: 'Mail not found' });
  }
  mail.read = false;
  res.json({ success: true, mail });
});

// === Beads endpoints ===
const mockBeads = [
  {
    id: 'bead-1',
    title: 'Implement user authentication',
    description: 'Add login/logout functionality',
    status: 'open',
    priority: 2,
    issue_type: 'feature',
    created_at: new Date(Date.now() - 86400000).toISOString(),
    assignee: null,
    labels: ['auth', 'security'],
  },
  {
    id: 'bead-2',
    title: 'Fix navbar bug',
    description: 'Navbar not displaying on mobile',
    status: 'closed',
    priority: 1,
    issue_type: 'bug',
    created_at: new Date(Date.now() - 172800000).toISOString(),
    closed_at: new Date(Date.now() - 3600000).toISOString(),
    close_reason: 'Fixed in commit abc1234, PR #42',
    assignee: 'polecat-1',
    labels: ['ui', 'mobile'],
  },
];

app.get('/api/beads', (req, res) => {
  res.json(mockBeads);
});

app.post('/api/beads', (req, res) => {
  const { title, description, priority, labels } = req.body;
  if (!title) {
    return res.status(400).json({ error: 'Title is required' });
  }
  const newBead = {
    id: `bead-${Date.now()}`,
    title,
    description: description || '',
    status: 'open',
    priority: priority || 2,
    issue_type: 'task',
    created_at: new Date().toISOString(),
    assignee: null,
    labels: labels || [],
  };
  mockBeads.push(newBead);
  res.status(201).json({ success: true, bead_id: newBead.id, bead: newBead });
});

app.get('/api/bead/:beadId', (req, res) => {
  const { beadId } = req.params;
  const bead = mockBeads.find(b => b.id === beadId);
  if (!bead) {
    return res.status(404).json({ error: 'Bead not found' });
  }
  res.json(bead);
});

app.get('/api/bead/:beadId/links', (req, res) => {
  const { beadId } = req.params;
  const bead = mockBeads.find(b => b.id === beadId);
  if (!bead) {
    return res.status(404).json({ error: 'Bead not found' });
  }
  // Return mock PR links
  res.json({
    prs: [
      {
        number: 42,
        title: 'Fix: ' + bead.title,
        repo: 'myorg/myrepo',
        url: 'https://github.com/myorg/myrepo/pull/42',
        state: bead.status === 'closed' ? 'MERGED' : 'OPEN',
      },
    ],
  });
});

app.post('/api/work/:beadId/done', (req, res) => {
  const { beadId } = req.params;
  const { summary } = req.body;
  const bead = mockBeads.find(b => b.id === beadId);
  if (!bead) {
    return res.status(404).json({ error: 'Bead not found' });
  }
  bead.status = 'closed';
  bead.closed_at = new Date().toISOString();
  bead.close_reason = summary || 'Completed';
  res.json({ success: true, bead });
});

app.post('/api/work/:beadId/park', (req, res) => {
  const { beadId } = req.params;
  const { reason } = req.body;
  const bead = mockBeads.find(b => b.id === beadId);
  if (!bead) {
    return res.status(404).json({ error: 'Bead not found' });
  }
  bead.status = 'parked';
  bead.park_reason = reason || 'Parked for later';
  res.json({ success: true, bead });
});

app.post('/api/work/:beadId/release', (req, res) => {
  const { beadId } = req.params;
  const bead = mockBeads.find(b => b.id === beadId);
  if (!bead) {
    return res.status(404).json({ error: 'Bead not found' });
  }
  bead.assignee = null;
  bead.status = 'open';
  res.json({ success: true, bead });
});

app.post('/api/work/:beadId/reassign', (req, res) => {
  const { beadId } = req.params;
  const { target } = req.body;
  const bead = mockBeads.find(b => b.id === beadId);
  if (!bead) {
    return res.status(404).json({ error: 'Bead not found' });
  }
  bead.assignee = target;
  res.json({ success: true, bead });
});

// === Formulas endpoints ===
const mockFormulas = [
  {
    name: 'fix-bug',
    description: 'Standard bug fix workflow',
    template: 'Investigate, fix, and verify the bug: ${issue}',
    created_at: new Date(Date.now() - 604800000).toISOString(),
  },
  {
    name: 'add-feature',
    description: 'Feature implementation workflow',
    template: 'Implement the feature: ${feature}\n\nRequirements:\n${requirements}',
    created_at: new Date(Date.now() - 1209600000).toISOString(),
  },
];

app.get('/api/formulas', (req, res) => {
  res.json(mockFormulas);
});

app.get('/api/formula/:name', (req, res) => {
  const { name } = req.params;
  const formula = mockFormulas.find(f => f.name === name);
  if (!formula) {
    return res.status(404).json({ error: 'Formula not found' });
  }
  res.json(formula);
});

app.post('/api/formulas', (req, res) => {
  const { name, description, template } = req.body;
  if (!name || !template) {
    return res.status(400).json({ error: 'Name and template are required' });
  }
  const newFormula = {
    name,
    description: description || '',
    template,
    created_at: new Date().toISOString(),
  };
  mockFormulas.push(newFormula);
  res.status(201).json({ success: true, formula: newFormula });
});

app.post('/api/formula/:name/use', (req, res) => {
  const { name } = req.params;
  const { target, args } = req.body;
  // Check formula exists first
  const formula = mockFormulas.find(f => f.name === name);
  if (!formula) {
    return res.status(404).json({ error: 'Formula not found' });
  }
  // Then check for required fields
  if (!target) {
    return res.status(400).json({ error: 'Target is required' });
  }
  res.json({
    success: true,
    formula: name,
    target,
    args: args || {},
    message: `Formula "${name}" executed on ${target}`,
  });
});

app.put('/api/formula/:name', (req, res) => {
  const { name } = req.params;
  const { description, template } = req.body;
  const formula = mockFormulas.find(f => f.name === name);
  if (!formula) {
    return res.status(404).json({ error: 'Formula not found' });
  }
  if (!template) {
    return res.status(400).json({ error: 'Template is required' });
  }
  formula.description = description || formula.description;
  formula.template = template;
  res.json({ success: true, formula });
});

app.delete('/api/formula/:name', (req, res) => {
  const { name } = req.params;
  const index = mockFormulas.findIndex(f => f.name === name);
  if (index === -1) {
    return res.status(404).json({ error: 'Formula not found' });
  }
  mockFormulas.splice(index, 1);
  res.json({ success: true, name });
});

// === Crew Management endpoints ===
const mockCrews = [
  {
    name: 'backend-team',
    rig: 'zoo-game',
    members: ['polecat-1', 'polecat-2'],
    status: 'active',
    created_at: new Date(Date.now() - 604800000).toISOString(),
  },
  {
    name: 'frontend-team',
    rig: 'gastown',
    members: ['polecat-3'],
    status: 'active',
    created_at: new Date(Date.now() - 172800000).toISOString(),
  },
];

app.get('/api/crews', (req, res) => {
  res.json(mockCrews);
});

app.get('/api/crew/:name/status', (req, res) => {
  const { name } = req.params;
  const crew = mockCrews.find(c => c.name === name);
  if (!crew) {
    return res.status(404).json({ error: 'Crew not found' });
  }
  res.json({
    ...crew,
    active_tasks: Math.floor(Math.random() * 5),
    completed_tasks: Math.floor(Math.random() * 20) + 5,
  });
});

app.post('/api/crews', (req, res) => {
  const { name, rig } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Crew name is required' });
  }
  const existingCrew = mockCrews.find(c => c.name === name);
  if (existingCrew) {
    return res.status(409).json({ error: 'Crew already exists' });
  }
  const newCrew = {
    name,
    rig: rig || null,
    members: [],
    status: 'active',
    created_at: new Date().toISOString(),
  };
  mockCrews.push(newCrew);
  res.status(201).json({ success: true, crew: newCrew });
});

app.delete('/api/crew/:name', (req, res) => {
  const { name } = req.params;
  const index = mockCrews.findIndex(c => c.name === name);
  if (index === -1) {
    return res.status(404).json({ error: 'Crew not found' });
  }
  mockCrews.splice(index, 1);
  res.json({ success: true, removed: name });
});

// Create HTTP server
const server = createServer(app);

// WebSocket server
const wss = new WebSocketServer({ server, path: '/ws' });

const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log('[WS] Client connected');

  // Send initial status
  ws.send(JSON.stringify({
    type: 'status',
    data: mockData.status,
  }));

  ws.on('close', () => {
    clients.delete(ws);
    console.log('[WS] Client disconnected');
  });
});

function broadcastEvent(event) {
  const message = JSON.stringify(event);
  clients.forEach(client => {
    if (client.readyState === 1) {
      client.send(message);
    }
  });

  // Also add to events
  mockData.events.unshift({
    id: `event-${Date.now()}`,
    ...event.data,
    timestamp: new Date().toISOString(),
  });
}

// Simulate periodic activity
let activityInterval;

function startActivitySimulation() {
  const activities = [
    { type: 'activity', message: 'Agent checking work queue' },
    { type: 'activity', message: 'Processing bead update' },
    { type: 'bead_updated', bead_id: 'bead-123', message: 'Status changed to in-progress' },
  ];

  activityInterval = setInterval(() => {
    const activity = activities[Math.floor(Math.random() * activities.length)];
    broadcastEvent({
      type: 'activity',
      data: {
        ...activity,
        id: `evt-${Date.now()}`,
        timestamp: new Date().toISOString(),
      },
    });
  }, 10000); // Every 10 seconds
}

function stopActivitySimulation() {
  if (activityInterval) {
    clearInterval(activityInterval);
  }
}

// Start server
const DEFAULT_PORT = 5678;

function normalizePort(value) {
  if (value === undefined || value === null || value === '') return DEFAULT_PORT;
  const port = Number(value);
  return Number.isFinite(port) && port >= 0 ? port : DEFAULT_PORT;
}

export function startMockServer({ port } = {}) {
  const requestedPort = normalizePort(port ?? process.env.PORT);
  return new Promise((resolve) => {
    console.log(`[Mock Server] Starting on port ${requestedPort || '(ephemeral)'}...`);
    server.listen(requestedPort, '127.0.0.1', () => {
      const actualPort = server.address()?.port ?? requestedPort;
      console.log(`[Mock Server] Running on http://127.0.0.1:${actualPort}`);
      startActivitySimulation();
      resolve(server);
    });
  });
}

export function stopMockServer() {
  return new Promise((resolve) => {
    stopActivitySimulation();
    wss.close();
    server.close(() => {
      console.log('[Mock Server] Stopped');
      resolve();
    });
  });
}

// Run directly if executed as main
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startMockServer();
}
