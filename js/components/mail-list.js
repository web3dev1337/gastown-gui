/**
 * Gas Town GUI - Mail List Component
 *
 * Renders the mail inbox with messages from the Gastown system.
 */

import { AGENT_TYPES, getAgentType, getAgentConfig, formatAgentName } from '../shared/agent-types.js';
import { api } from '../api.js';
import { showToast } from './toast.js';
import { escapeHtml, truncate } from '../utils/html.js';
import { MAIL_DETAIL, MAIL_READ, MAIL_REFRESH } from '../shared/events.js';
import { TIME_MS } from '../utils/formatting.js';
import { debounce } from '../utils/performance.js';
import { getStaggerClass } from '../shared/animations.js';

// Priority icons and colors
const PRIORITY_CONFIG = {
  high: { icon: 'priority_high', class: 'priority-high' },
  normal: { icon: 'mail', class: 'priority-normal' },
  low: { icon: 'mail_outline', class: 'priority-low' },
};

/**
 * Get unique agents from mail list for filtering
 */
function getUniqueAgents(mail) {
  const agents = new Map();
  mail.forEach(m => {
    if (m.from) {
      const type = getAgentType(m.from);
      const name = formatAgentName(m.from);
      agents.set(m.from, { path: m.from, name, type });
    }
    if (m.to) {
      const type = getAgentType(m.to);
      const name = formatAgentName(m.to);
      agents.set(m.to, { path: m.to, name, type });
    }
  });
  return Array.from(agents.values()).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Get unique rigs from mail list
 */
function getUniqueRigs(mail) {
  const rigs = new Set();
  mail.forEach(m => {
    if (m.from) {
      const rig = m.from.split('/')[0];
      if (rig && rig !== 'mayor' && rig !== 'human') rigs.add(rig);
    }
    if (m.to) {
      const rig = m.to.split('/')[0];
      if (rig && rig !== 'mayor' && rig !== 'human') rigs.add(rig);
    }
  });
  return Array.from(rigs).sort();
}


/**
 * Render the mail list
 * @param {HTMLElement} container - The mail list container
 * @param {Array} mail - Array of mail objects
 */
// Current filter state (module-level)
let currentFilters = {
  agentType: 'all',
  rig: 'all',
  category: 'all',
  search: '',
};

const SIGNAL_CONFIG = {
  crash: { label: 'Crash', icon: 'warning', tone: 'critical', rank: 0 },
  escalation: { label: 'Escalation', icon: 'priority_high', tone: 'critical', rank: 0 },
  'recovery-needed': { label: 'Recovery Needed', icon: 'build_circle', tone: 'critical', rank: 0 },
  'recovery-update': { label: 'Recovery Update', icon: 'sync_problem', tone: 'warning', rank: 1 },
  delivery: { label: 'Delivery', icon: 'forward_to_inbox', tone: 'warning', rank: 1 },
  system: { label: 'System', icon: 'settings', tone: 'info', rank: 2 },
  note: { label: 'Note', icon: 'mail', tone: 'info', rank: 2 },
};

function getMailSignal(mail) {
  const subject = String(mail?.subject || '').toUpperCase();

  if (subject.includes('CRASHED_POLECAT')) return { key: 'crash', ...SIGNAL_CONFIG.crash };
  if (subject.includes('ESCALATION')) return { key: 'escalation', ...SIGNAL_CONFIG.escalation };
  if (subject.includes('RECOVERY_NEEDED')) return { key: 'recovery-needed', ...SIGNAL_CONFIG['recovery-needed'] };
  if (subject.includes('RECOVERY_UPDATE')) return { key: 'recovery-update', ...SIGNAL_CONFIG['recovery-update'] };
  if (subject.includes('DELIVERY') || subject.includes('ACK')) return { key: 'delivery', ...SIGNAL_CONFIG.delivery };
  if (mail?.feedEvent) return { key: 'system', ...SIGNAL_CONFIG.system };
  return { key: 'note', ...SIGNAL_CONFIG.note };
}

function matchesSignalCategory(mail, category) {
  if (category === 'all') return true;

  const signal = getMailSignal(mail);
  if (category === 'action') {
    return signal.tone === 'critical' || signal.tone === 'warning';
  }

  if (category === 'recovery') {
    return signal.key === 'recovery-needed' || signal.key === 'recovery-update';
  }

  return signal.key === category;
}

function summarizeSignals(mail) {
  const summary = {
    total: mail.length,
    action: 0,
    crash: 0,
    recovery: 0,
    escalation: 0,
  };

  mail.forEach(item => {
    const signal = getMailSignal(item);
    if (signal.tone === 'critical' || signal.tone === 'warning') summary.action += 1;
    if (signal.key === 'crash') summary.crash += 1;
    if (signal.key === 'escalation') summary.escalation += 1;
    if (signal.key === 'recovery-needed' || signal.key === 'recovery-update') summary.recovery += 1;
  });

  return summary;
}

export function renderMailList(container, mail, options = {}) {
  if (!container) return;

  const isAllMail = options.isAllMail || (mail && mail[0]?.feedEvent);

  if (!mail || mail.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="material-icons empty-icon">${isAllMail ? 'forum' : 'mail'}</span>
        <h3>${isAllMail ? 'No System Mail' : 'No Mail'}</h3>
        <p>${isAllMail ? 'No mail activity in the system yet' : 'Your inbox is empty'}</p>
      </div>
    `;
    return;
  }

  // Build filter UI for all-mail view
  const filterHtml = isAllMail ? buildFilterUI(mail) : '';

  // Apply filters
  let filtered = [...mail];
  if (isAllMail) {
    if (currentFilters.agentType !== 'all') {
      filtered = filtered.filter(m =>
        getAgentType(m.from) === currentFilters.agentType ||
        getAgentType(m.to) === currentFilters.agentType
      );
    }
    if (currentFilters.rig !== 'all') {
      filtered = filtered.filter(m =>
        m.from?.startsWith(currentFilters.rig) ||
        m.to?.startsWith(currentFilters.rig)
      );
    }
    if (currentFilters.category !== 'all') {
      filtered = filtered.filter(m => matchesSignalCategory(m, currentFilters.category));
    }
    if (currentFilters.search) {
      const searchLower = currentFilters.search.toLowerCase();
      filtered = filtered.filter(m =>
        m.subject?.toLowerCase().includes(searchLower) ||
        m.from?.toLowerCase().includes(searchLower) ||
        m.to?.toLowerCase().includes(searchLower) ||
        m.body?.toLowerCase().includes(searchLower)
      );
    }
  }

  // Sort by date (newest first), then by read status
  const sorted = filtered.sort((a, b) => {
    if (isAllMail) {
      const signalDiff = getMailSignal(a).rank - getMailSignal(b).rank;
      if (signalDiff !== 0) return signalDiff;
      return new Date(b.timestamp || 0) - new Date(a.timestamp || 0);
    }

    // Unread first
    if (a.read !== b.read) return a.read ? 1 : -1;
    // Then by date
    return new Date(b.timestamp || 0) - new Date(a.timestamp || 0);
  });

  // Render
  const summaryHtml = isAllMail ? renderMailSummary(filtered) : '';
  const itemsHtml = sorted.length > 0
    ? sorted.map((item, index) => renderMailItem(item, index)).join('')
    : `<div class="empty-state small">
        <span class="material-icons">filter_list_off</span>
        <p>No mail matches your filters</p>
      </div>`;

  container.innerHTML = filterHtml + summaryHtml + itemsHtml;

  // Add filter event handlers
  if (isAllMail) {
    setupFilterHandlers(container, mail, options);
  }

  // Add click handlers
  container.querySelectorAll('.mail-item').forEach(item => {
    item.addEventListener('click', (e) => {
      // Don't trigger detail view if clicking action buttons
      if (e.target.closest('.mail-actions')) return;

      const mailId = item.dataset.mailId;
      showMailDetail(mailId, mail.find(m => m.id === mailId));
    });
  });

  // Add action handlers
  container.querySelectorAll('[data-action="toggle-read"]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const mailId = btn.dataset.mailId;
      const mailItem = mail.find(m => m.id === mailId);
      if (mailItem) {
        await handleToggleRead(mailId, !mailItem.read, btn);
      }
    });
  });
}

/**
 * Handle toggle read/unread status
 */
async function handleToggleRead(mailId, markAsRead, btn) {
  const originalIcon = btn.innerHTML;
  btn.innerHTML = '<span class="material-icons spinning">sync</span>';
  btn.disabled = true;

  try {
    const result = markAsRead
      ? await api.markMailRead(mailId)
      : await api.markMailUnread(mailId);

    if (result.success) {
      showToast(`Mail marked as ${markAsRead ? 'read' : 'unread'}`, 'success');
      // Trigger mail refresh
      document.dispatchEvent(new CustomEvent(MAIL_REFRESH));
    } else {
      showToast(`Failed: ${result.error}`, 'error');
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  } finally {
    btn.innerHTML = originalIcon;
    btn.disabled = false;
  }
}

/**
 * Build filter UI HTML
 */
function buildFilterUI(mail) {
  const rigs = getUniqueRigs(mail);
  const agentTypes = Object.entries(AGENT_TYPES);

  return `
    <div class="mail-filters">
      <div class="filter-row">
        <div class="filter-group">
          <label>Agent Type</label>
          <select id="mail-agent-filter" class="filter-select">
            <option value="all">All Types</option>
            ${agentTypes.map(([key, config]) => `
              <option value="${key}" ${currentFilters.agentType === key ? 'selected' : ''}>
                ${config.label}
              </option>
            `).join('')}
          </select>
        </div>

        <div class="filter-group">
          <label>Rig</label>
          <select id="mail-rig-filter" class="filter-select">
            <option value="all">All Rigs</option>
            ${rigs.map(rig => `
              <option value="${rig}" ${currentFilters.rig === rig ? 'selected' : ''}>
                ${rig}
              </option>
            `).join('')}
          </select>
        </div>

        <div class="filter-group">
          <label>Signal</label>
          <select id="mail-category-filter" class="filter-select">
            <option value="all" ${currentFilters.category === 'all' ? 'selected' : ''}>All Signals</option>
            <option value="action" ${currentFilters.category === 'action' ? 'selected' : ''}>Action Needed</option>
            <option value="recovery" ${currentFilters.category === 'recovery' ? 'selected' : ''}>Recovery</option>
            <option value="crash" ${currentFilters.category === 'crash' ? 'selected' : ''}>Crashes</option>
            <option value="escalation" ${currentFilters.category === 'escalation' ? 'selected' : ''}>Escalations</option>
            <option value="delivery" ${currentFilters.category === 'delivery' ? 'selected' : ''}>Delivery</option>
            <option value="system" ${currentFilters.category === 'system' ? 'selected' : ''}>System</option>
          </select>
        </div>

        <div class="filter-group search-group">
          <label>Search</label>
          <input type="text" id="mail-search" class="filter-input"
                 placeholder="Search mail..." value="${escapeHtml(currentFilters.search)}">
        </div>

        <button class="btn btn-ghost btn-sm" id="mail-clear-filters" title="Clear filters">
          <span class="material-icons">clear</span>
        </button>
      </div>

      <div class="agent-legend">
        ${agentTypes.map(([key, config]) => `
          <span class="legend-item" style="--agent-color: ${config.color}">
            <span class="material-icons" style="color: ${config.color}">${config.icon}</span>
            ${config.label}
          </span>
        `).join('')}
      </div>
    </div>
  `;
}

/**
 * Setup filter event handlers
 */
function setupFilterHandlers(container, mail, options) {
  const agentFilter = container.querySelector('#mail-agent-filter');
  const rigFilter = container.querySelector('#mail-rig-filter');
  const categoryFilter = container.querySelector('#mail-category-filter');
  const searchInput = container.querySelector('#mail-search');
  const clearBtn = container.querySelector('#mail-clear-filters');

  if (agentFilter) {
    agentFilter.addEventListener('change', () => {
      currentFilters.agentType = agentFilter.value;
      renderMailList(container, mail, options);
    });
  }

  if (rigFilter) {
    rigFilter.addEventListener('change', () => {
      currentFilters.rig = rigFilter.value;
      renderMailList(container, mail, options);
    });
  }

  if (categoryFilter) {
    categoryFilter.addEventListener('change', () => {
      currentFilters.category = categoryFilter.value;
      renderMailList(container, mail, options);
    });
  }

  if (searchInput) {
    const handleSearch = debounce(() => {
      currentFilters.search = searchInput.value;
      renderMailList(container, mail, options);
    }, 300);
    searchInput.addEventListener('input', handleSearch);
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      currentFilters = { agentType: 'all', rig: 'all', category: 'all', search: '' };
      renderMailList(container, mail, options);
    });
  }
}

function renderMailSummary(mail) {
  const summary = summarizeSignals(mail);

  return `
    <div class="mail-summary">
      <div class="mail-summary-chip total">
        <span class="material-icons">forum</span>
        ${summary.total} visible
      </div>
      <div class="mail-summary-chip action">
        <span class="material-icons">notification_important</span>
        ${summary.action} action needed
      </div>
      <div class="mail-summary-chip critical">
        <span class="material-icons">warning</span>
        ${summary.crash} crashes
      </div>
      <div class="mail-summary-chip warning">
        <span class="material-icons">build_circle</span>
        ${summary.recovery} recovery
      </div>
      <div class="mail-summary-chip info">
        <span class="material-icons">priority_high</span>
        ${summary.escalation} escalations
      </div>
    </div>
  `;
}

/**
 * Render a single mail item
 */
function renderMailItem(mail, index) {
  const priority = mail.priority || 'normal';
  const priorityConfig = PRIORITY_CONFIG[priority] || PRIORITY_CONFIG.normal;
  const isUnread = !mail.read;
  const isFeedMail = mail.feedEvent; // From all-mail view
  const signal = getMailSignal(mail);

  // Get agent types for color coding
  const fromType = getAgentType(mail.from);
  const toType = getAgentType(mail.to);
  const fromConfig = AGENT_TYPES[fromType] || AGENT_TYPES.system;
  const toConfig = AGENT_TYPES[toType] || AGENT_TYPES.system;

  // For feed mail, show both from and to with colors
  const fromTo = isFeedMail && mail.to
    ? `<span class="agent-badge" style="--agent-color: ${fromConfig.color}">
         <span class="material-icons">${fromConfig.icon}</span>
         ${formatAgentName(mail.from)}
       </span>
       <span class="mail-arrow">→</span>
       <span class="agent-badge" style="--agent-color: ${toConfig.color}">
         <span class="material-icons">${toConfig.icon}</span>
         ${formatAgentName(mail.to)}
       </span>`
    : `<span class="agent-badge" style="--agent-color: ${fromConfig.color}">
         <span class="material-icons">${fromConfig.icon}</span>
         ${escapeHtml(mail.from || 'System')}
       </span>`;

  return `
    <div class="mail-item ${isUnread ? 'unread' : ''} ${isFeedMail ? 'feed-mail' : ''} tone-${signal.tone} animate-spawn ${getStaggerClass(index)}"
         data-mail-id="${mail.id}"
         style="--from-color: ${fromConfig.color}">
      <div class="mail-status">
        <span class="material-icons" style="color: ${isFeedMail ? 'var(--signal-color, ' + fromConfig.color + ')' : fromConfig.color}">${isFeedMail ? signal.icon : fromConfig.icon}</span>
      </div>

      <div class="mail-content">
        <div class="mail-header">
          <span class="mail-from">${fromTo}</span>
          <span class="mail-time">${formatTime(mail.timestamp)}</span>
        </div>
        <div class="mail-subject-row">
          <div class="mail-subject ${isUnread ? 'unread' : ''}">${escapeHtml(mail.subject || '(No Subject)')}</div>
          ${isFeedMail ? `<span class="mail-signal-chip tone-${signal.tone}"><span class="material-icons">${signal.icon}</span>${signal.label}</span>` : ''}
        </div>
        <div class="mail-preview">${escapeHtml(truncate(mail.message || mail.body || '', 80))}</div>

        ${mail.tags?.length ? `
          <div class="mail-tags">
            ${mail.tags.map(tag => `
              <span class="mail-tag">${escapeHtml(tag)}</span>
            `).join('')}
          </div>
        ` : ''}
      </div>

      ${!isFeedMail ? `
        <div class="mail-actions">
          <button class="btn btn-icon btn-sm" title="${isUnread ? 'Mark as read' : 'Mark as unread'}" data-action="toggle-read" data-mail-id="${mail.id}">
            <span class="material-icons">${isUnread ? 'mark_email_read' : 'mark_email_unread'}</span>
          </button>
          <button class="btn btn-icon btn-sm" title="Archive" data-action="archive" data-mail-id="${mail.id}">
            <span class="material-icons">archive</span>
          </button>
          <button class="btn btn-icon btn-sm" title="Delete" data-action="delete" data-mail-id="${mail.id}">
            <span class="material-icons">delete</span>
          </button>
        </div>
      ` : ''}
    </div>
  `;
}

/**
 * Format agent name for display (shorten long paths)
 */
function formatAgent(name) {
  if (!name) return 'unknown';
  // Shorten paths like "hytopia-map-compression/polecats/slit" to "slit"
  // or "hytopia-map-compression/witness" to "witness"
  const parts = name.split('/');
  if (parts.length > 1) {
    return escapeHtml(parts[parts.length - 1]);
  }
  return escapeHtml(name);
}

/**
 * Show mail detail modal
 */
async function showMailDetail(mailId, mail) {
  if (!mail) return;

  // Mark as read
  const event = new CustomEvent(MAIL_READ, { detail: { mailId } });
  document.dispatchEvent(event);

  // If body is missing and this is a real bead (not a synthetic feed event), fetch the full message
  let fullMail = mail;
  if (!mail.body && !mail.message && !mail.feedEvent) {
    try {
      const fetched = await api.get(`/api/mail/${encodeURIComponent(mailId)}`);
      if (fetched && (fetched.body || fetched.message)) {
        fullMail = { ...mail, ...fetched };
      }
    } catch {
      // fall through with original mail data
    }
  }

  // Show modal
  const modalEvent = new CustomEvent(MAIL_DETAIL, {
    detail: { mailId, mail: fullMail }
  });
  document.dispatchEvent(modalEvent);
}

/**
 * Format timestamp for display
 */
function formatTime(timestamp) {
  if (!timestamp) return '';

  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  // Today - show time
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // This week - show day
  if (diff < TIME_MS.WEEK) {
    return date.toLocaleDateString([], { weekday: 'short' });
  }

  // Older - show date
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
