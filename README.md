# Gas Town GUI

A standalone web GUI for [Gas Town](https://github.com/steveyegge/gastown) - the multi-agent orchestration system for Claude Code.

![Gas Town GUI Screenshot](assets/screenshot.png)

![Gas Town Loading Screen](assets/loading-background.jpeg)

> **Note:** This is an independent companion project, not part of the official Gas Town repository. Originally submitted as [PR #212](https://github.com/steveyegge/gastown/pull/212), now maintained as a standalone package per Steve's recommendation.

> *"Thank you for the impressive work on this GUI! The effort and thought that went into it is clear - the architecture is clean, the documentation is thorough, and it demonstrates a solid understanding of Gas Town's workflow. [...] If you're interested in continuing this work, I'd encourage publishing it as a standalone companion project."*
>
> — **Steve Yegge**, creator of Gas Town ([PR #212 comment](https://github.com/steveyegge/gastown/pull/212))

**Status:** 🚧 **Candidate for Testing** - Provides a solid starting point for a Gas Town GUI interface.

---

## Quick Start

### 1. Install Prerequisites

```bash
# Gas Town CLI (required)
npm install -g @gastown/gt
# Or: go install github.com/steveyegge/gastown/cmd/gt@latest

# GitHub CLI (optional, for PR tracking)
gh auth login
```

### 2. Install Gas Town GUI

```bash
# Via npm (recommended)
npm install -g gastown-gui

# Or from source
git clone https://github.com/web3dev1337/gastown-gui.git
cd gastown-gui
npm install
npm link
```

### 3. Start the GUI

```bash
gastown-gui start --open
```

Opens `http://localhost:7667` in your browser.

### 4. Verify Setup

```bash
gastown-gui doctor
```

---

## Nix / NixOS

### Build with Nix flake

```bash
nix build .#gastown-gui
./result/bin/gastown-gui start
```

### Run as a NixOS service

Import the module from this repository's flake and enable it:

```nix
{
  inputs.gastown-gui.url = "github:web3dev1337/gastown-gui";

  outputs = { self, nixpkgs, gastown-gui, ... }: {
    nixosConfigurations.my-host = nixpkgs.lib.nixosSystem {
      system = "x86_64-linux";
      modules = [
        gastown-gui.nixosModules.deployment
        ({
          services.gastown-gui = {
            enable = true;
            host = "127.0.0.1";
            port = 7667;
            openFirewall = false; # keep false when reverse-proxying locally

            # Optional: add runtime tools to PATH for service subprocesses
            # gtPackage = pkgs.gastown-gt;
            # beadsPackage = pkgs.beads;

            # Defaults: create and run as system user/group "gastown"
            # user = "gastown";
            # group = "gastown";
            # createUser = true;
            # createGroup = true;

            # Optional: where your Gas Town rigs live
            # gtRoot = "/var/lib/gastown/gt";

            # Optional: extra env vars
            # environment = { CORS_ORIGINS = "http://localhost:3000"; };
          };
        })
      ];
    };
  };
}
```

Then rebuild your system:

```bash
sudo nixos-rebuild switch --flake .#my-host
```

Service hardening defaults are enabled in the module (for example `NoNewPrivileges`, `PrivateTmp`, `ProtectSystem`).

---

## Features

- **Rig Management** - Add, view, and organize project repositories
- **Work Tracking** - Create and manage work items (beads)
- **Task Assignment** - Sling work to rigs and agents
- **Real-Time Updates** - Live WebSocket updates for all operations
- **PR Tracking** - View GitHub pull requests across projects
- **Mail Inbox** - Read messages from agents and polecats
- **Health Monitoring** - Run doctor checks and view system status

---

## CLI Usage

```bash
# Start server (default port 7667)
gastown-gui

# Custom port
gastown-gui start --port 4000

# Open browser automatically
gastown-gui start --open

# Development mode
gastown-gui start --dev

# Check prerequisites
gastown-gui doctor

# Show version
gastown-gui version

# Show help
gastown-gui help
```

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `--port, -p` | Server port | 7667 |
| `--host, -h` | Server host | 127.0.0.1 |
| `--open, -o` | Open browser | false |
| `--dev` | Development mode | false |

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `GASTOWN_PORT` | Server port | 7667 |
| `HOST` | Server host | 127.0.0.1 |
| `GT_ROOT` | Gas Town root directory | ~/gt |

---

## How It Works

The GUI acts as a **bridge** between your browser and the Gas Town CLI:

```
┌─────────────┐
│   Browser   │
│   (Client)  │
└──────┬──────┘
       │ HTTP API / WebSocket
       ↓
┌─────────────┐
│  gastown-   │
│  gui server │
└──────┬──────┘
       │ subprocess (gt, bd, gh)
       ↓
┌─────────────┐
│   ~/gt/     │
│  workspace  │
└─────────────┘
```

All operations execute through the official `gt` and `bd` commands - the GUI never directly modifies Gas Town's internal state.

---

## Architecture

### Tech Stack

- **Backend:** Node.js + Express
- **Frontend:** Vanilla JavaScript (no framework)
- **Communication:** WebSocket for real-time updates
- **Testing:** Vitest + Puppeteer E2E tests

### Design Principles

1. **Server-Authoritative** - All operations execute via `gt` and `bd` CLI commands
2. **Non-Blocking UI** - Modals close immediately, operations run in background
3. **Real-Time Updates** - WebSocket broadcasts status changes to all clients
4. **Graceful Degradation** - UI handles missing data and command failures
5. **Cache & Refresh** - Background data preloading with stale-while-revalidate

---

## API Endpoints

| Method | Endpoint | Description | CLI Command |
|--------|----------|-------------|-------------|
| GET | `/api/status` | System status | `gt status --json` |
| GET | `/api/rigs` | List rigs | `gt rig list` |
| POST | `/api/rigs` | Add rig | `gt rig add` |
| GET | `/api/work` | List work items | `bd list` |
| POST | `/api/work` | Create work | `bd new` |
| POST | `/api/sling` | Sling work | `gt sling` |
| GET | `/api/prs` | GitHub PRs | `gh pr list` |
| GET | `/api/mail` | Mail inbox | `gt mail inbox` |
| GET | `/api/doctor` | Health check | `gt doctor` |

---

## Project Structure

```
gastown-gui/
├── bin/cli.js           # CLI entry point
├── server.js            # Express + WebSocket server
├── index.html           # Main HTML (single page)
├── css/                 # Stylesheets
│   ├── variables.css
│   ├── reset.css
│   ├── layout.css
│   ├── components.css
│   └── animations.css
├── js/
│   ├── app.js           # Main app entry
│   ├── api.js           # API client
│   ├── state.js         # State management
│   └── components/      # UI components
│       ├── dashboard.js
│       ├── rig-list.js
│       ├── work-list.js
│       ├── pr-list.js
│       ├── mail-list.js
│       └── ...
├── test/
│   ├── unit/            # Unit tests
│   └── e2e.test.js      # E2E tests
└── assets/              # Favicons, icons
```

---

## Testing

```bash
# All tests
npm test

# Unit tests only
npm run test:unit

# E2E tests
npm run test:e2e

# Watch mode
npm run test:watch
```

---

## Known Limitations

### Remaining Features (Use CLI)

| Feature | Status |
|---------|--------|
| Agent configuration UI | ❌ Not implemented |

### Implemented Features

| Feature | Status |
|---------|--------|
| Polecat spawn/stop/restart | ✅ UI in Rig list |
| Rig deletion | ✅ Remove button in Rig list |
| Crew management | ✅ Create/list/view |
| Formula operations | ✅ Create/list/use |
| Test coverage | ✅ 206 tests passing |

**Known Issues:**
- GT CLI sling may fail with "mol bond requires direct database access" (upstream issue)

---

## Compatibility

- **Gas Town:** v0.2.x and later
- **Node.js:** 18, 20, 22
- **Browsers:** Chrome, Firefox, Safari (latest)

The GUI calls CLI commands via subprocess, so it should work with any Gas Town version that has compatible CLI output.

---

## Contributing

Contributions welcome!

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. **Update `CLAUDE.md`** if you add, rename, or delete files
5. Test locally (start server with `npm start`, verify in browser)
6. Run automated tests: `npm test` (206 tests must pass)
7. Submit a pull request

### Looking for Maintainers

We're looking for maintainers to help review and merge PRs. If you're interested in helping maintain this project, please open an issue or reach out!

---

## License

MIT

---

## Credits

- **Gas Town:** [steveyegge/gastown](https://github.com/steveyegge/gastown) by Steve Yegge
- **GUI Implementation:** Built with Claude Code
- **Original PR:** [#212](https://github.com/steveyegge/gastown/pull/212)

### Contributors

Thanks to these community members who contributed to the original PR through testing, comments, and recommended fixes:

- [@gsxdsm](https://github.com/gsxdsm)
- [@michaellady](https://github.com/michaellady)
- [@olivierlefloch](https://github.com/olivierlefloch)
- [@zalo](https://github.com/zalo)
- [@irelandpaul](https://github.com/irelandpaul)

---

**Disclaimer:** This is an independent community project, not officially affiliated with Gas Town. Use at your own risk.
