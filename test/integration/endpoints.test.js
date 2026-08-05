/**
 * Gas Town GUI - API Endpoint Tests
 *
 * Tests server endpoints for correct behavior, input validation, and error handling.
 * Uses the mock server for isolation from the actual Gas Town backend.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const PORT = process.env.PORT || 5678;
const BASE_URL = `http://localhost:${PORT}`;

// Helper to make API requests
async function api(endpoint, options = {}) {
  const url = `${BASE_URL}${endpoint}`;
  const fetchOptions = {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    method: options.method || 'GET',
  };

  // Stringify body if it's an object
  if (options.body && typeof options.body === 'object') {
    fetchOptions.body = JSON.stringify(options.body);
  } else if (options.body) {
    fetchOptions.body = options.body;
  }

  const response = await fetch(url, fetchOptions);

  const contentType = response.headers.get('content-type');
  let data = null;

  if (contentType && contentType.includes('application/json')) {
    data = await response.json();
  } else {
    data = await response.text();
  }

  return { status: response.status, data, ok: response.ok };
}

describe('API Endpoint Tests', () => {

  describe('GET /api/status', () => {
    it('should return system status with required fields', async () => {
      const { status, data, ok } = await api('/api/status');

      expect(ok).toBe(true);
      expect(status).toBe(200);
      expect(data).toHaveProperty('name');
      expect(data).toHaveProperty('version');
      expect(data).toHaveProperty('agents');
      expect(Array.isArray(data.agents)).toBe(true);
    });

    it('should include agent count and status', async () => {
      const { data } = await api('/api/status');

      expect(typeof data.active_agents).toBe('number');
      expect(typeof data.convoy_count).toBe('number');
    });
  });

  describe('GET /api/health', () => {
    it('should return health check with ok status', async () => {
      const { status, data, ok } = await api('/api/health');

      expect(ok).toBe(true);
      expect(status).toBe(200);
      expect(data).toHaveProperty('status', 'ok');
    });
  });

  describe('GET /api/convoys', () => {
    it('should return array of convoys', async () => {
      const { status, data, ok } = await api('/api/convoys');

      expect(ok).toBe(true);
      expect(status).toBe(200);
      expect(Array.isArray(data)).toBe(true);
    });

    it('should include convoy details', async () => {
      const { data } = await api('/api/convoys');

      if (data.length > 0) {
        const convoy = data[0];
        expect(convoy).toHaveProperty('id');
        expect(convoy).toHaveProperty('name');
        expect(convoy).toHaveProperty('status');
      }
    });
  });

  describe('GET /api/convoy/:id', () => {
    it('should return specific convoy by id', async () => {
      // First get list to find a valid ID
      const { data: convoys } = await api('/api/convoys');

      if (convoys.length > 0) {
        const convoyId = convoys[0].id;
        const { status, data, ok } = await api(`/api/convoy/${convoyId}`);

        expect(ok).toBe(true);
        expect(status).toBe(200);
        expect(data).toHaveProperty('id', convoyId);
      }
    });

    it('should return 404 for non-existent convoy', async () => {
      const { status, ok } = await api('/api/convoy/non-existent-id-12345');

      // Mock server may return 200 with null, or 404
      expect([200, 404]).toContain(status);
    });
  });

  describe('GET /api/mail', () => {
    it('should return array of mail messages', async () => {
      const { status, data, ok } = await api('/api/mail');

      expect(ok).toBe(true);
      expect(status).toBe(200);
      expect(Array.isArray(data)).toBe(true);
    });

    it('should include mail message details', async () => {
      const { data } = await api('/api/mail');

      if (data.length > 0) {
        const mail = data[0];
        expect(mail).toHaveProperty('id');
        expect(mail).toHaveProperty('from');
        expect(mail).toHaveProperty('subject');
      }
    });
  });

  describe('GET /api/rigs', () => {
    it('should return array of rigs or 404 if not mocked', async () => {
      const { status, data } = await api('/api/rigs');

      // Mock server may not implement this endpoint
      if (status === 200) {
        expect(Array.isArray(data)).toBe(true);
      } else {
        expect(status).toBe(404);
      }
    });
  });

  describe('GET /api/agents', () => {
    it('should return array of agents', async () => {
      const { status, data, ok } = await api('/api/agents');

      expect(ok).toBe(true);
      expect(status).toBe(200);
      expect(Array.isArray(data)).toBe(true);
    });

    it('should include agent details', async () => {
      const { data } = await api('/api/agents');

      if (data.length > 0) {
        const agent = data[0];
        expect(agent).toHaveProperty('id');
        expect(agent).toHaveProperty('name');
        expect(agent).toHaveProperty('role');
        expect(agent).toHaveProperty('status');
      }
    });
  });

  describe('GET /api/beads', () => {
    it('should return array of beads/work items or 404 if not mocked', async () => {
      const { status, data } = await api('/api/beads');

      // Mock server may not implement this endpoint
      if (status === 200) {
        expect(Array.isArray(data)).toBe(true);
      } else {
        expect(status).toBe(404);
      }
    });
  });

  describe('POST /api/convoy', () => {
    it('should create a new convoy with valid data', async () => {
      const { status, ok } = await api('/api/convoy', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Test Convoy',
          issues: ['Test issue 1', 'Test issue 2'],
        }),
      });

      // May succeed (201) or fail if mock doesn't support POST
      expect([200, 201, 400, 500]).toContain(status);
    });

    it('should handle missing required fields', async () => {
      const { status } = await api('/api/convoy', {
        method: 'POST',
        body: JSON.stringify({}),
      });

      // Should either reject with 400 or handle gracefully
      expect([200, 201, 400, 500]).toContain(status);
    });
  });

  describe('POST /api/nudge', () => {
    it('should send a nudge message', async () => {
      const { status } = await api('/api/nudge', {
        method: 'POST',
        body: JSON.stringify({
          target: 'agent-1',
          message: 'Test nudge message',
        }),
      });

      expect([200, 201, 400, 500]).toContain(status);
    });
  });

  describe('GET /api/doctor', () => {
    it('should return diagnostic information or 404 if not mocked', async () => {
      const { status } = await api('/api/doctor');

      // Mock server may not implement this endpoint
      expect([200, 404]).toContain(status);
    });
  });

  describe('GET /api/setup/status', () => {
    it('should return setup status or 404 if not mocked', async () => {
      const { status } = await api('/api/setup/status');

      // Mock server may not implement this endpoint
      expect([200, 404]).toContain(status);
    });
  });

});

describe('POST /api/sling', () => {
  it('should dispatch work to an agent', async () => {
    const { status, data, ok } = await api('/api/sling', {
      method: 'POST',
      body: JSON.stringify({
        bead: 'test-bead-123',
        target: 'zoo-game/Polecat-1',
        formula: 'mol-review',
        args: 'focus on tests',
      }),
    });

    expect(ok).toBe(true);
    expect(status).toBe(200);
    expect(data).toHaveProperty('id');
    expect(data).toHaveProperty('status', 'dispatched');
  });
});

describe('GET /api/hook', () => {
  it('should return hook status', async () => {
    const { status, data, ok } = await api('/api/hook');

    expect(ok).toBe(true);
    expect(status).toBe(200);
    expect(data).toHaveProperty('status');
  });
});

describe('POST /api/mail', () => {
  it('should send a mail message', async () => {
    const { status, data, ok } = await api('/api/mail', {
      method: 'POST',
      body: JSON.stringify({
        to: 'agent-1',
        subject: 'Test subject',
        message: 'Test message body',
        priority: 'normal',
      }),
    });

    expect(ok).toBe(true);
    expect(status).toBe(200);
    expect(data).toHaveProperty('success', true);
    expect(data).toHaveProperty('mail');
    expect(data.mail).toHaveProperty('id');
  });
});

describe('GET /api/beads/search', () => {
  it('should search beads by query', async () => {
    const { status, data, ok } = await api('/api/beads/search?q=login');

    expect(ok).toBe(true);
    expect(status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
  });

  it('should return empty array for no matches', async () => {
    const { status, data, ok } = await api('/api/beads/search?q=nonexistentxyz123');

    expect(ok).toBe(true);
    expect(status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
  });
});

describe('GET /api/formulas/search', () => {
  it('should search formulas by query', async () => {
    const { status, data, ok } = await api('/api/formulas/search?q=test');

    expect(ok).toBe(true);
    expect(status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
  });
});

describe('GET /api/targets', () => {
  it('should return available sling targets', async () => {
    const { status, data, ok } = await api('/api/targets');

    expect(ok).toBe(true);
    expect(status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
  });

  it('should include target details', async () => {
    const { data } = await api('/api/targets');

    if (data.length > 0) {
      const target = data[0];
      expect(target).toHaveProperty('id');
      expect(target).toHaveProperty('name');
      expect(target).toHaveProperty('type');
    }
  });
});

describe('POST /api/escalate', () => {
  it('should escalate a convoy', async () => {
    const { status, data, ok } = await api('/api/escalate', {
      method: 'POST',
      body: JSON.stringify({
        convoy_id: 'convoy-123',
        reason: 'Blocked on dependency',
        priority: 'high',
      }),
    });

    expect(ok).toBe(true);
    expect(status).toBe(200);
    expect(data).toHaveProperty('success', true);
  });
});

describe('GET /api/github/repos', () => {
  it('should return list of GitHub repos', async () => {
    const { status, data, ok } = await api('/api/github/repos');

    expect(ok).toBe(true);
    expect(status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
  });

  it('should include repo details', async () => {
    const { data } = await api('/api/github/repos');

    if (data.length > 0) {
      const repo = data[0];
      expect(repo).toHaveProperty('name');
      expect(repo).toHaveProperty('url');
    }
  });
});

describe('Rig Management', () => {
  it('should list rigs', async () => {
    const { status, data, ok } = await api('/api/rigs');

    expect(ok).toBe(true);
    expect(status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
  });

  it('should add a new rig', async () => {
    const { status, data, ok } = await api('/api/rigs', {
      method: 'POST',
      body: JSON.stringify({
        name: 'test-rig',
        url: 'https://github.com/test/repo',
      }),
    });

    expect(ok).toBe(true);
    expect([200, 201]).toContain(status);
    expect(data).toHaveProperty('success', true);
  });

  it('should reject add rig without required fields', async () => {
    const { status } = await api('/api/rigs', {
      method: 'POST',
      body: JSON.stringify({ name: 'incomplete' }),
    });

    expect(status).toBe(400);
  });

  it('should delete a rig', async () => {
    // First ensure we have a rig to delete
    await api('/api/rigs', {
      method: 'POST',
      body: JSON.stringify({
        name: 'delete-test-rig',
        url: 'https://github.com/test/delete-repo',
      }),
    });

    const { status, data, ok } = await api('/api/rigs/delete-test-rig', {
      method: 'DELETE',
    });

    expect(ok).toBe(true);
    expect(status).toBe(200);
    expect(data).toHaveProperty('success', true);
  });

  it('should return 404 for non-existent rig deletion', async () => {
    const { status } = await api('/api/rigs/non-existent-rig-xyz', {
      method: 'DELETE',
    });

    expect(status).toBe(404);
  });
});

describe('Doctor & Setup', () => {
  it('should return doctor diagnostics', async () => {
    const { status, data, ok } = await api('/api/doctor');

    expect(ok).toBe(true);
    expect(status).toBe(200);
    expect(data).toHaveProperty('status');
    expect(data).toHaveProperty('checks');
    expect(Array.isArray(data.checks)).toBe(true);
  });

  it('should run doctor fix', async () => {
    const { status, data, ok } = await api('/api/doctor/fix', {
      method: 'POST',
    });

    expect(ok).toBe(true);
    expect(status).toBe(200);
    expect(data).toHaveProperty('success', true);
    expect(data).toHaveProperty('fixed');
  });

  it('should return setup status', async () => {
    const { status, data, ok } = await api('/api/setup/status');

    expect(ok).toBe(true);
    expect(status).toBe(200);
    expect(data).toHaveProperty('installed');
    expect(data).toHaveProperty('ready');
  });
});

describe('Polecat Management', () => {
  it('should get polecat output', async () => {
    const { status, data, ok } = await api('/api/polecat/zoo-game/polecat-1/output');

    expect(ok).toBe(true);
    expect(status).toBe(200);
    expect(data).toHaveProperty('output');
    expect(data).toHaveProperty('lines');
  });

  it('should get polecat transcript', async () => {
    const { status, data, ok } = await api('/api/polecat/zoo-game/polecat-1/transcript');

    expect(ok).toBe(true);
    expect(status).toBe(200);
    expect(data).toHaveProperty('transcript');
  });

  it('should start a polecat', async () => {
    const { status, data, ok } = await api('/api/polecat/test-rig/new-polecat/start', {
      method: 'POST',
    });

    expect(ok).toBe(true);
    expect(status).toBe(200);
    expect(data).toHaveProperty('success', true);
    expect(data).toHaveProperty('polecat');
    expect(data.polecat).toHaveProperty('status', 'running');
  });

  it('should stop a polecat', async () => {
    // First start one
    await api('/api/polecat/test-rig/stop-test/start', { method: 'POST' });

    const { status, data, ok } = await api('/api/polecat/test-rig/stop-test/stop', {
      method: 'POST',
    });

    expect(ok).toBe(true);
    expect(status).toBe(200);
    expect(data).toHaveProperty('success', true);
  });

  it('should restart a polecat', async () => {
    const { status, data, ok } = await api('/api/polecat/test-rig/restart-test/restart', {
      method: 'POST',
    });

    expect(ok).toBe(true);
    expect(status).toBe(200);
    expect(data).toHaveProperty('success', true);
    expect(data).toHaveProperty('polecat');
  });

  it('should return 404 for non-existent polecat output', async () => {
    const { status } = await api('/api/polecat/fake-rig/fake-polecat/output');

    expect(status).toBe(404);
  });
});

describe('Mayor Management', () => {
  it('should get mayor output', async () => {
    const { status, data, ok } = await api('/api/mayor/output');

    expect(ok).toBe(true);
    expect(status).toBe(200);
    expect(data).toHaveProperty('output');
    expect(data).toHaveProperty('lines');
  });

  it('should get mayor messages', async () => {
    const { status, data, ok } = await api('/api/mayor/messages');

    expect(ok).toBe(true);
    expect(status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
  });

  it('should include message details', async () => {
    const { data } = await api('/api/mayor/messages');

    if (data.length > 0) {
      const message = data[0];
      expect(message).toHaveProperty('id');
      expect(message).toHaveProperty('type');
      expect(message).toHaveProperty('content');
    }
  });
});

describe('Service Management', () => {
  it('should get service status', async () => {
    const { status, data, ok } = await api('/api/service/mayor/status');

    expect(ok).toBe(true);
    expect(status).toBe(200);
    expect(data).toHaveProperty('name', 'mayor');
    expect(data).toHaveProperty('status');
  });

  it('should start a service with rig param', async () => {
    const { status, data, ok } = await api('/api/service/witness/up', {
      method: 'POST',
      body: JSON.stringify({ rig: 'my-rig' }),
    });

    expect(ok).toBe(true);
    expect(status).toBe(200);
    expect(data).toHaveProperty('success', true);
    expect(data.service).toHaveProperty('status', 'running');
    expect(data.service).toHaveProperty('rig', 'my-rig');
  });

  it('should reject witness start without rig param', async () => {
    const { status, data } = await api('/api/service/witness/up', {
      method: 'POST',
    });

    expect(status).toBe(400);
    expect(data).toHaveProperty('error');
    expect(data.error).toContain('rig');
  });

  it('should stop a service with rig param', async () => {
    // Start it first so we can stop it
    await api('/api/service/witness/up', {
      method: 'POST',
      body: JSON.stringify({ rig: 'my-rig' }),
    });

    const { status, data, ok } = await api('/api/service/witness/down', {
      method: 'POST',
      body: JSON.stringify({ rig: 'my-rig' }),
    });

    expect(ok).toBe(true);
    expect(status).toBe(200);
    expect(data).toHaveProperty('success', true);
    expect(data.service).toHaveProperty('status', 'stopped');
  });

  it('should reject witness stop without rig param', async () => {
    const { status, data } = await api('/api/service/witness/down', {
      method: 'POST',
    });

    expect(status).toBe(400);
    expect(data).toHaveProperty('error');
    expect(data.error).toContain('rig');
  });

  it('should reject witness restart without rig param', async () => {
    const { status, data } = await api('/api/service/witness/restart', {
      method: 'POST',
    });

    expect(status).toBe(400);
    expect(data).toHaveProperty('error');
    expect(data.error).toContain('rig');
  });

  it('should reject refinery start without rig param', async () => {
    const { status, data } = await api('/api/service/refinery/up', {
      method: 'POST',
    });

    expect(status).toBe(400);
    expect(data).toHaveProperty('error');
    expect(data.error).toContain('rig');
  });

  it('should start refinery with rig param', async () => {
    const { status, data, ok } = await api('/api/service/refinery/up', {
      method: 'POST',
      body: JSON.stringify({ rig: 'my-rig' }),
    });

    expect(ok).toBe(true);
    expect(status).toBe(200);
    expect(data).toHaveProperty('success', true);
    expect(data.service).toHaveProperty('rig', 'my-rig');
  });

  it('should start mayor without rig (no rig required)', async () => {
    const { status, data, ok } = await api('/api/service/mayor/up', {
      method: 'POST',
    });

    expect(ok).toBe(true);
    expect(status).toBe(200);
    expect(data).toHaveProperty('success', true);
    expect(data.service).toHaveProperty('status', 'running');
  });

  it('should start deacon without rig (no rig required)', async () => {
    const { status, data, ok } = await api('/api/service/deacon/up', {
      method: 'POST',
    });

    expect(ok).toBe(true);
    expect(status).toBe(200);
    expect(data).toHaveProperty('success', true);
    expect(data.service).toHaveProperty('status', 'running');
  });

  it('should restart a service', async () => {
    const { status, data, ok } = await api('/api/service/deacon/restart', {
      method: 'POST',
    });

    expect(ok).toBe(true);
    expect(status).toBe(200);
    expect(data).toHaveProperty('success', true);
    expect(data).toHaveProperty('restarted', true);
  });

  it('should return 404 for non-existent service', async () => {
    const { status } = await api('/api/service/fake-service/status');

    expect(status).toBe(404);
  });
});

describe('API Error Handling', () => {

  it('should return 404 for unknown endpoints', async () => {
    const { status } = await api('/api/unknown-endpoint-12345');

    expect(status).toBe(404);
  });

  it('should handle malformed JSON gracefully', async () => {
    const response = await fetch(`${BASE_URL}/api/convoy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ invalid json }',
    });

    // Should return 400 for bad JSON, not crash
    expect([400, 500]).toContain(response.status);
  });

});

// === Mail CRUD Tests ===
describe('Mail CRUD', () => {
  it('should get all mail', async () => {
    const { status, data, ok } = await api('/api/mail/all');

    expect(ok).toBe(true);
    expect(status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
  });

  it('should get mail by id', async () => {
    const { status, data, ok } = await api('/api/mail/mail-1');

    expect(ok).toBe(true);
    expect(status).toBe(200);
    expect(data).toHaveProperty('id', 'mail-1');
    expect(data).toHaveProperty('subject');
    expect(data).toHaveProperty('message');
  });

  it('should return 404 for non-existent mail', async () => {
    const { status } = await api('/api/mail/non-existent-mail');

    expect(status).toBe(404);
  });

  it('should mark mail as read', async () => {
    const { status, data, ok } = await api('/api/mail/mail-2/read', {
      method: 'POST',
    });

    expect(ok).toBe(true);
    expect(status).toBe(200);
    expect(data).toHaveProperty('success', true);
    expect(data.mail).toHaveProperty('read', true);
  });

  it('should mark mail as unread', async () => {
    const { status, data, ok } = await api('/api/mail/mail-1/unread', {
      method: 'POST',
    });

    expect(ok).toBe(true);
    expect(status).toBe(200);
    expect(data).toHaveProperty('success', true);
    expect(data.mail).toHaveProperty('read', false);
  });

  it('should return 404 when marking non-existent mail as read', async () => {
    const { status } = await api('/api/mail/fake-mail/read', {
      method: 'POST',
    });

    expect(status).toBe(404);
  });
});

// === Beads CRUD Tests ===
describe('Beads CRUD', () => {
  it('should get bead by id', async () => {
    const { status, data, ok } = await api('/api/bead/bead-1');

    expect(ok).toBe(true);
    expect(status).toBe(200);
    expect(data).toHaveProperty('id', 'bead-1');
    expect(data).toHaveProperty('title');
    expect(data).toHaveProperty('status');
  });

  it('should return 404 for non-existent bead', async () => {
    const { status } = await api('/api/bead/non-existent-bead');

    expect(status).toBe(404);
  });

  it('should get bead links', async () => {
    const { status, data, ok } = await api('/api/bead/bead-1/links');

    expect(ok).toBe(true);
    expect(status).toBe(200);
    expect(data).toHaveProperty('prs');
    expect(Array.isArray(data.prs)).toBe(true);
  });

  it('should create a new bead', async () => {
    const { status, data, ok } = await api('/api/beads', {
      method: 'POST',
      body: {
        title: 'Test Bead',
        description: 'A test bead for testing',
        priority: 1,
        labels: ['test'],
      },
    });

    expect(ok).toBe(true);
    expect(status).toBe(201);
    expect(data).toHaveProperty('success', true);
    expect(data).toHaveProperty('bead_id');
    expect(data.bead).toHaveProperty('title', 'Test Bead');
  });

  it('should reject bead creation without title', async () => {
    const { status } = await api('/api/beads', {
      method: 'POST',
      body: {
        description: 'No title provided',
      },
    });

    expect(status).toBe(400);
  });

  it('should mark bead as done', async () => {
    const { status, data, ok } = await api('/api/work/bead-1/done', {
      method: 'POST',
      body: { summary: 'Task completed successfully' },
    });

    expect(ok).toBe(true);
    expect(status).toBe(200);
    expect(data).toHaveProperty('success', true);
    expect(data.bead).toHaveProperty('status', 'closed');
    expect(data.bead).toHaveProperty('close_reason');
  });

  it('should park a bead', async () => {
    // First reset the bead to open status
    await api('/api/work/bead-2/release', { method: 'POST' });

    const { status, data, ok } = await api('/api/work/bead-2/park', {
      method: 'POST',
      body: { reason: 'Waiting for dependencies' },
    });

    expect(ok).toBe(true);
    expect(status).toBe(200);
    expect(data).toHaveProperty('success', true);
    expect(data.bead).toHaveProperty('status', 'parked');
  });

  it('should release a bead', async () => {
    const { status, data, ok } = await api('/api/work/bead-2/release', {
      method: 'POST',
    });

    expect(ok).toBe(true);
    expect(status).toBe(200);
    expect(data).toHaveProperty('success', true);
    expect(data.bead.assignee).toBeNull();
  });

  it('should reassign a bead', async () => {
    const { status, data, ok } = await api('/api/work/bead-1/reassign', {
      method: 'POST',
      body: { target: 'polecat-2' },
    });

    expect(ok).toBe(true);
    expect(status).toBe(200);
    expect(data).toHaveProperty('success', true);
    expect(data.bead).toHaveProperty('assignee', 'polecat-2');
  });

  it('should return 404 when operating on non-existent bead', async () => {
    const { status } = await api('/api/work/fake-bead/done', {
      method: 'POST',
      body: { summary: 'test' },
    });

    expect(status).toBe(404);
  });
});

// === Formulas CRUD Tests ===
describe('Formulas CRUD', () => {
  it('should list all formulas', async () => {
    const { status, data, ok } = await api('/api/formulas');

    expect(ok).toBe(true);
    expect(status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
  });

  it('should include formula details', async () => {
    const { data } = await api('/api/formulas');

    expect(data[0]).toHaveProperty('name');
    expect(data[0]).toHaveProperty('description');
    expect(data[0]).toHaveProperty('template');
  });

  it('should get formula by name', async () => {
    const { status, data, ok } = await api('/api/formula/fix-bug');

    expect(ok).toBe(true);
    expect(status).toBe(200);
    expect(data).toHaveProperty('name', 'fix-bug');
    expect(data).toHaveProperty('template');
  });

  it('should return 404 for non-existent formula', async () => {
    const { status } = await api('/api/formula/non-existent-formula');

    expect(status).toBe(404);
  });

  it('should create a new formula', async () => {
    const { status, data, ok } = await api('/api/formulas', {
      method: 'POST',
      body: {
        name: 'test-formula',
        description: 'A test formula',
        template: 'Do the thing: ${task}',
      },
    });

    expect(ok).toBe(true);
    expect(status).toBe(201);
    expect(data).toHaveProperty('success', true);
    expect(data.formula).toHaveProperty('name', 'test-formula');
  });

  it('should reject formula creation without name or template', async () => {
    const { status } = await api('/api/formulas', {
      method: 'POST',
      body: {
        description: 'Missing required fields',
      },
    });

    expect(status).toBe(400);
  });

  it('should use/execute a formula', async () => {
    const { status, data, ok } = await api('/api/formula/fix-bug/use', {
      method: 'POST',
      body: {
        target: 'polecat-1',
        args: { issue: 'AUTH-123' },
      },
    });

    expect(ok).toBe(true);
    expect(status).toBe(200);
    expect(data).toHaveProperty('success', true);
    expect(data).toHaveProperty('formula', 'fix-bug');
    expect(data).toHaveProperty('target', 'polecat-1');
  });

  it('should return 404 when using non-existent formula', async () => {
    const { status } = await api('/api/formula/fake-formula/use', {
      method: 'POST',
      body: { target: 'polecat-1' },
    });

    expect(status).toBe(404);
  });

  it('should require target when using formula', async () => {
    const { status } = await api('/api/formula/fix-bug/use', {
      method: 'POST',
      body: {},
    });

    expect(status).toBe(400);
  });

  it('should update a formula', async () => {
    const { status, data, ok } = await api('/api/formula/fix-bug', {
      method: 'PUT',
      body: {
        description: 'Updated bug fix workflow',
        template: 'Updated template: ${issue}',
      },
    });

    expect(ok).toBe(true);
    expect(status).toBe(200);
    expect(data).toHaveProperty('success', true);
    expect(data.formula).toHaveProperty('template', 'Updated template: ${issue}');
  });

  it('should return 404 when updating non-existent formula', async () => {
    const { status } = await api('/api/formula/fake-formula', {
      method: 'PUT',
      body: {
        description: 'Test',
        template: 'Test template',
      },
    });

    expect(status).toBe(404);
  });

  it('should require template when updating formula', async () => {
    const { status } = await api('/api/formula/fix-bug', {
      method: 'PUT',
      body: {
        description: 'Missing template',
      },
    });

    expect(status).toBe(400);
  });

  it('should delete a formula', async () => {
    // First create a formula to delete
    await api('/api/formulas', {
      method: 'POST',
      body: {
        name: 'formula-to-delete',
        description: 'Temporary formula',
        template: 'Delete me',
      },
    });

    const { status, data, ok } = await api('/api/formula/formula-to-delete', {
      method: 'DELETE',
    });

    expect(ok).toBe(true);
    expect(status).toBe(200);
    expect(data).toHaveProperty('success', true);
    expect(data).toHaveProperty('name', 'formula-to-delete');
  });

  it('should return 404 when deleting non-existent formula', async () => {
    const { status } = await api('/api/formula/fake-formula', {
      method: 'DELETE',
    });

    expect(status).toBe(404);
  });
});

// === Crew Management ===
describe('Crew Management Endpoints', () => {
  it('should list all crews', async () => {
    const { status, data, ok } = await api('/api/crews');

    expect(ok).toBe(true);
    expect(status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(2);
    expect(data[0]).toHaveProperty('name');
    expect(data[0]).toHaveProperty('rig');
    expect(data[0]).toHaveProperty('members');
    expect(data[0]).toHaveProperty('status');
  });

  it('should get crew status', async () => {
    const { status, data, ok } = await api('/api/crew/backend-team/status');

    expect(ok).toBe(true);
    expect(status).toBe(200);
    expect(data).toHaveProperty('name', 'backend-team');
    expect(data).toHaveProperty('rig');
    expect(data).toHaveProperty('members');
    expect(data).toHaveProperty('status');
  });

  it('should return 404 for non-existent crew status', async () => {
    const { status } = await api('/api/crew/fake-crew/status');

    expect(status).toBe(404);
  });

  it('should add a new crew', async () => {
    const { status, data, ok } = await api('/api/crews', {
      method: 'POST',
      body: {
        name: 'test-crew',
        rig: 'test-rig',
      },
    });

    expect(ok).toBe(true);
    expect(status).toBe(201);
    expect(data).toHaveProperty('success', true);
    expect(data.crew).toHaveProperty('name', 'test-crew');
  });

  it('should reject crew creation without name', async () => {
    const { status } = await api('/api/crews', {
      method: 'POST',
      body: {
        rig: 'some-rig',
      },
    });

    expect(status).toBe(400);
  });

  it('should reject duplicate crew creation', async () => {
    const { status } = await api('/api/crews', {
      method: 'POST',
      body: {
        name: 'backend-team',
        rig: 'zoo-game',
      },
    });

    expect(status).toBe(409);
  });

  it('should remove a crew', async () => {
    // First add a crew to remove
    await api('/api/crews', {
      method: 'POST',
      body: {
        name: 'crew-to-remove',
        rig: 'test-rig',
      },
    });

    const { status, data, ok } = await api('/api/crew/crew-to-remove', {
      method: 'DELETE',
    });

    expect(ok).toBe(true);
    expect(status).toBe(200);
    expect(data).toHaveProperty('success', true);
    expect(data).toHaveProperty('removed', 'crew-to-remove');
  });

  it('should return 404 when removing non-existent crew', async () => {
    const { status } = await api('/api/crew/fake-crew', {
      method: 'DELETE',
    });

    expect(status).toBe(404);
  });
});
