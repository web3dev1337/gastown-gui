# Deploying gastown-gui

> **Read this first.** gastown-gui ships **no authentication**. Every visitor who can reach
> the port can start and stop agents, add and remove rigs, sling work, and run
> `gt doctor --fix` against your town. It is a remote control for your fleet. Treat the
> port the way you would treat an unauthenticated Docker socket.

## Contents

- `gastown-gui.service` — systemd **user** unit template.

## Why a user unit

The server shells out to `gt` and `bd`. Those own the files under `GT_ROOT`, drive a tmux
server, and talk to a Dolt instance — all as the human who created the town. Running the
GUI as a system user or a separate service account breaks all three. Install it under
`systemctl --user` as the town's owner, and enable lingering so it survives logout and
reboot:

```bash
mkdir -p ~/.config/systemd/user
cp deploy/gastown-gui.service ~/.config/systemd/user/
$EDITOR ~/.config/systemd/user/gastown-gui.service     # set the Environment= lines
loginctl enable-linger "$USER"
systemctl --user daemon-reload
systemctl --user enable --now gastown-gui
journalctl --user -u gastown-gui -f
```

The GUI cannot run in a container unless you also bind-mount `GT_ROOT`, the `gt`/`bd`
binaries, the tmux socket, and the Dolt data directory — at which point you have a
container with the host's privileges. Running it on the host is the honest option.

## Exposing it safely

Bind it somewhere only an authenticating proxy can reach, then put the proxy in front.
Three options, most to least preferred:

1. **Loopback + proxy on the same host.** `HOST=127.0.0.1`. Simplest and tightest.
2. **A private interface the proxy can route to.** If the proxy runs in a container,
   loopback is not reachable from it; bind the container network's gateway address
   instead (e.g. `HOST=172.18.0.1` for a bridge on `172.18.0.0/16`). Containers on that
   bridge can reach it; the LAN cannot route to it.
3. **`0.0.0.0` plus a firewall rule.** Workable, but the firewall is now the only thing
   between your fleet and the network. If you take this route, verify the rule is
   actually loaded — an inactive `ufw` protects nothing.

Set `CORS_ORIGINS` to exactly the proxied origin, e.g.
`CORS_ORIGINS=https://gastown.example.com`.

### Reverse proxy requirements

- **WebSocket upgrade must be enabled.** The dashboard streams `gt feed` over `/ws`; with
  upgrades disabled every pane sits at "connecting…" forever.
- Forward the original `Host` header, or generated redirects will point at the backend.
- Terminate TLS at the proxy.

Minimal nginx:

```nginx
location / {
    proxy_pass http://127.0.0.1:7667;
    proxy_set_header Host $host;

    # required — the dashboard is dead without this
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $http_connection;
}
```

### Single sign-on

Any proxy-level SSO works, because the GUI has no user model of its own to integrate
with — authenticate at the proxy and let only authenticated requests through.

With an nginx `auth_request`-style forward-auth provider (Authentik, Authelia, oauth2-proxy),
put the `auth_request` inside the same `location /` that proxies to the GUI so the
WebSocket upgrade is covered by it too. Placing the auth check on a narrower location and
letting `/ws` through unauthenticated leaves the live event stream — and the ability to
open it — publicly readable.

Keep any machine clients (scrapers, uptime probes) pointed at the backend address
directly rather than punching unauthenticated path exemptions through the proxy.
