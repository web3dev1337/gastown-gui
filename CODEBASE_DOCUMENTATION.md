# Gas Town GUI - Codebase Documentation

> **Keep this file current.** If you add, delete, or move files/systems, update this doc before creating a PR. Keep it token-efficient.

## Quick Navigation

```
ENTRY:    server.js - Express bridge server (gt/bd CLI → HTTP/WS)
CLI:      bin/cli.js - npx gastown-gui entry point
FRONTEND: js/ - Browser SPA (vanilla JS, no framework)
BACKEND:  server/ - Refactored backend modules (services, gateways, routes)
STYLES:   css/ - CSS custom properties + component styles
TESTS:    test/ - Vitest unit + integration, Puppeteer E2E
CONFIG:   vitest.config.js, vitest.unit.config.js, package.json, flake.nix
ASSETS:   assets/ - Favicons + screenshots
DOCS:     docs/, refactoring-analysis/, CLI-COMPATIBILITY.md
```

## Backend — Entry & App

```
server.js - Monolith Express server; imports refactored modules + legacy endpoints
├─ Wires gateways → services → routes
├─ WebSocket server for real-time events (gt feed)
├─ Legacy endpoints still inline: mail, agents, nudge, polecat, service controls
└─ ~1700 lines, partially refactored

server/app/createApp.js - Express app factory with CORS config
```

## Backend — Domain Values

```
server/domain/session/SessionNames.js - Upstream-compatible tmux session naming + rigs.json prefix registry
server/domain/agents/normalizeRigAgents.js - Normalizes rig worker payloads across `rig.agents` and legacy `rig.hooks`

server/domain/values/AgentPath.js - Validates rig/agent path pairs
└─ Enforces SafeSegment on both segments

server/domain/values/SafeSegment.js - Input sanitization for CLI args
└─ Rejects shell metacharacters, path traversal
```

## Backend — Gateways (CLI Wrappers)

```
server/gateways/GTGateway.js - Wraps gt CLI commands via execFile
├─ status, convoy, sling, mail, nudge, feed, doctor, etc.
└─ Uses CommandRunner for safe execution

server/gateways/BDGateway.js - Wraps bd (beads) CLI commands
├─ list, search, create, show, close, defer, update
└─ Maps GUI actions to current bd CLI syntax

server/gateways/GitHubGateway.js - Wraps gh CLI for PR/issue/repo queries
server/gateways/GitGateway.js - Wraps git CLI for branch info
server/gateways/TmuxGateway.js - Tmux session management for polecats
```

## Backend — Infrastructure

```
server/infrastructure/CommandRunner.js - Safe child_process.execFile wrapper
├─ Timeout, error handling, output parsing
└─ No shell execution (injection-safe)

server/infrastructure/CacheRegistry.js - TTL cache for CLI output
server/infrastructure/EventBus.js - Internal pub/sub for cache invalidation
server/infrastructure/ExecutableResolver.js - Resolves gt/bd binaries from PATH, env overrides, and Homebrew/Linuxbrew fallback paths
```

## Backend — Services

```
server/services/StatusService.js - Town status aggregation
server/services/ConvoyService.js - Convoy CRUD via GTGateway
server/services/FormulaService.js - Formula CRUD + run via GTGateway
server/services/BeadService.js - Bead CRUD via BDGateway
server/services/WorkService.js - Work lifecycle (close, defer, reassign)
server/services/GitHubService.js - PR/issue/repo queries via GitHubGateway
server/services/TargetService.js - Available sling targets
server/services/CLICompatibilityService.js - Old/new gt & bd command fallback orchestration for server endpoints
```

## Backend — Routes

```
server/routes/status.js - GET /api/status, /api/health
server/routes/convoys.js - GET/POST /api/convoys, /api/convoy/:id
server/routes/formulas.js - CRUD /api/formulas, /api/formula/:name
server/routes/beads.js - CRUD /api/beads, /api/bead/:id
server/routes/work.js - POST /api/work/:id/{done,park,release,reassign}
server/routes/github.js - GET /api/github/{prs,issues,repos}
server/routes/targets.js - GET /api/targets
```

## Frontend — Core

```
js/app.js - App initialization helpers, tab routing, event wiring, status polling
js/api.js - HTTP client for /api/* + WebSocket client class
js/state.js - Global reactive state store, component subscriptions
```

## Frontend — Components

```
js/components/dashboard.js - Main dashboard layout + tab switching
js/components/sidebar.js - Agent tree, service controls, stats, hook display
js/components/agent-grid.js - Agent cards with status/actions
js/components/convoy-list.js - Convoy management panel
js/components/mail-list.js - Mail inbox/compose/reply
js/components/issue-list.js - Beads/issues list with search
js/components/pr-list.js - GitHub PR list
js/components/formula-list.js - Formula editor/executor
js/components/work-list.js - Active work items display
js/components/rig-list.js - Rig management + polecat spawn/stop
js/components/crew-list.js - Crew CRUD operations
js/components/health-check.js - System health display (doctor)
js/components/activity-feed.js - Real-time event stream
js/components/modals.js - Modal dialogs (sling, nudge, compose)
js/components/onboarding.js - First-run setup wizard
js/components/tutorial.js - Interactive tutorial overlay
js/components/autocomplete.js - Search input with suggestions
js/components/toast.js - Toast notification system
```

## Frontend — Shared & Utils

```
js/shared/agent-types.js - Agent type definitions, icons, colors
js/shared/animations.js - Shared animation helpers
js/shared/beads.js - Bead domain helpers/constants
js/shared/close-reason.js - close_reason formatting
js/shared/events.js - Custom event names/bus
js/shared/github-repos.js - Bead/rig → GitHub repo mapping
js/shared/timing.js - Shared timing constants (polling, debounce)

js/utils/formatting.js - Date/number formatters
js/utils/html.js - escapeHtml, escapeAttr, truncate, capitalize
js/utils/performance.js - Debounce/throttle utilities
js/utils/tooltip.js - Tooltip positioning helpers
```

## Styles

```
css/variables.css - CSS custom properties (colors, spacing, z-index)
css/reset.css - Browser reset
css/layout.css - Grid/flex layouts, responsive breakpoints
css/components.css - Component-specific styles
css/animations.css - Transitions & keyframes
```

## Tests

```
test/setup.js - Vitest test environment setup
test/globalSetup.js - Global setup (port allocation)
test/mock-server.js - Mock Express server mimicking gt CLI responses

test/e2e.test.js - Puppeteer browser tests (real server + browser)
test/integration.test.js - Legacy integration tests
test/integration/endpoints.test.js - API endpoint contract tests
test/integration/cli-compatibility.test.js - Real server + stubbed CLI coverage for gt/bd old/new command fallback behavior
test/integration/cli-executable-resolution.test.js - Real server coverage for gt/bd executable path resolution and missing-gt activity-stream crash prevention
test/integration/rig-parsing-fallback.test.js - Real server + stubbed CLI coverage for rig list fallback/emoji parsing
test/integration/websocket.test.js - WebSocket lifecycle tests
test/integration/cache.test.js - Cache invalidation tests
test/integration/realtime-cache-invalidation.test.js - Real server cache invalidation coverage for rig/service mutation freshness

test/unit/ - 33 unit test files covering:
├─ Domain values: safeSegment, agentPath
├─ Rig agent normalization: normalizeRigAgents
├─ Session naming: sessionNames
├─ Gateways: gtGateway, bdGateway, githubGateway, gitGateway, tmuxGateway
├─ Infrastructure: cacheRegistry, commandRunner, eventBus
├─ Services: statusService, targetService, githubService, convoyService,
│            formulaService, beadService, workService
├─ CLI resolution: executableResolver
├─ Routes: statusRoutes, targetRoutes, githubRoutes, convoyRoutes,
│          formulaRoutes, beadRoutes, workRoutes
├─ Frontend: state, htmlUtils, quoteArg, formattingTime, animationsShared,
│            beadsShared, githubRepos
└─ Security: quoteArg (shell injection prevention)

test/manual/ - Manual test scripts (debug-button, onboarding, UI flow)
```

## Config & Scripts

```
package.json - Dependencies: express, cors, ws. Dev: vitest, puppeteer
vitest.config.js - Main test config (all tests)
vitest.unit.config.js - Unit-only test config
bin/cli.js - CLI entry point (gastown-gui command)
scripts/extract_user_prompts.mjs - Sanitized prompt log builder
flake.nix - Flake outputs for package/app + NixOS module export
nix/deployment.nix - NixOS module defining services.gastown-gui
```

## Documentation

```
docs/ - Project-specific audits and review writeups
CLI-COMPATIBILITY.md - gt/bd CLI command compatibility audit
refactoring-analysis/ - Refactor plans, reports, and analysis docs
refactoring-analysis/trace/ - Sanitized prompt/trace exports
```

## Key Patterns

- **Gateway pattern:** CLI tools (gt, bd, gh, git, tmux) wrapped in gateway classes; services compose gateways; routes call services
- **Safe execution:** All CLI calls use `execFile` (no shell) + `SafeSegment` validation — prevents injection
- **Cache + invalidation:** `CacheRegistry` with TTL; `EventBus` triggers cache clears on mutations
- **Frontend:** Vanilla JS SPA, no build step. Components render via innerHTML, subscribe to global state
- **Service controls:** Witness/refinery require a `rig` parameter for start/stop/restart; mayor/deacon do not
