# PR #12 Review: Nix flake + nixosModule for deployment

## Scope Reviewed
- Changed files: `flake.nix`, `flake.lock`, `nix/deployment.nix`, `README.md`, `CODEBASE_DOCUMENTATION.md`
- Context files: `package.json`, `package-lock.json`
- PR metadata checked via GitHub CLI (`#12`, head is `ropwareJB:master`, cross-repo)

Note: this is a static review. Runtime `nix build` verification was not possible in this environment because `nix` is not installed.

## Executive Summary
**Decision: Request Changes (do not merge yet).**

The flake packaging direction is good, and `buildNpmPackage` is mostly set up correctly for this repository. The blocking issue is the NixOS module's default runtime identity: it configures `User=gastown`/`Group=gastown` but does not create them. On a clean machine this commonly fails service startup. Security hardening is also too weak for a network service intended for production deployment.

## Bugs Found

### Critical
1. **Default service user/group are not created, likely causing startup failure on fresh NixOS hosts**
- Evidence:
  - Defaults are set: `nix/deployment.nix:39`, `nix/deployment.nix:45`
  - Service enforces them: `nix/deployment.nix:82`, `nix/deployment.nix:83`
  - No `users.users.*` / `users.groups.*` declarations anywhere in module
- Impact: systemd can fail with user/group lookup errors unless operators pre-create `gastown` manually.
- Why blocking: README deployment snippet does not mention manual user/group creation, so default path is unreliable.

### Minor
1. **`host` and `gtRoot` option typing is too loose for deployment ergonomics**
- `host` uses `lib.types.str` instead of a stricter match (`nix/deployment.nix:27`)
- `gtRoot` is `nullOr str` even though it represents a filesystem path (`nix/deployment.nix:51`)
- Impact: easier misconfiguration, weaker module validation.

2. **No explicit firewall/reverse-proxy/deployment surface options**
- Module exposes `host`/`port` only (`nix/deployment.nix:27`, `nix/deployment.nix:33`)
- Impact: production operators must hand-roll common integration glue (open firewall, reverse proxy, TLS boundaries).

3. **README NixOS section omits operational prerequisites**
- Example enables the service but does not call out required user/group provisioning or hardened defaults (`README.md:84`)
- Impact: users may copy/paste and get a failing or under-hardened deployment.

## Security Risks
1. **Weak systemd sandboxing/hardening**
- Current config only sets restart behavior and identity (`nix/deployment.nix:78`)
- Missing common hardening controls for internet-reachable services: `NoNewPrivileges`, `PrivateTmp`, `ProtectSystem`, `ProtectHome`, `ProtectKernelTunables`, `ProtectControlGroups`, `PrivateDevices`, `RestrictSUIDSGID`, `LockPersonality`, `CapabilityBoundingSet`, `SystemCallFilter`.
- Risk: if the Node/Express process is compromised, blast radius is larger than necessary.

2. **`DynamicUser = false` with static account but no managed state-dir policy**
- `DynamicUser = false` (`nix/deployment.nix:81`) is not wrong by itself, but then module should create/own a bounded state dir and ensure least-privilege file access.
- Risk: privilege/data boundaries depend on out-of-band host setup.

## Nix Correctness Assessment

### `buildNpmPackage` setup
- Good:
  - Pulls name/version from `package.json` (`flake.nix:13`, `flake.nix:17`, `flake.nix:18`)
  - Uses fixed-output npm dependency hash (`flake.nix:21`)
  - `dontNpmBuild = true` is appropriate for this repo because there is no build script (`package.json:10-19`, `flake.nix:23`)
  - `PUPPETEER_SKIP_DOWNLOAD = "true"` is correctly expressed as string env var (`flake.nix:24`) and is sensible given Puppeteer is present in `devDependencies` (`package-lock.json:22`, `package-lock.json:3059`)
- Caveat:
  - Could not execute `nix build` in this environment, so hash/build success is unverified at runtime.

### `npmDepsHash` drift behavior
- `npmDepsHash` in `flake.nix:21` is fixed-output and will fail deterministically when npm dependency graph changes (for example lockfile updates).
- This is expected and correct Nix behavior.
- Operational implication: every dependency lockfile drift requires updating `npmDepsHash`; otherwise builds fail fast.

## NixOS Module Quality
- Positives:
  - Options are typed and documented (`nix/deployment.nix:6-63`)
  - Uses `lib.mkEnableOption`, `lib.mkOption`, `types.port`, optional PATH injection for `gt`/`beads` (`nix/deployment.nix:7`, `nix/deployment.nix:34`, `nix/deployment.nix:71-74`)
- Gaps:
  - No managed identity creation for default `user`/`group`
  - Hardening profile is minimal
  - Missing deployment-friendly options (`openFirewall`, reverse-proxy assumptions, state directory model)

## nixos-unstable for Production
- Current input pins `nixos-unstable` (`flake.nix:5`, `flake.lock:32`).
- For production, this is usually higher operational risk (frequent breakage/churn). Consider stable channel pinning for deployment (for example current stable branch) and only track unstable intentionally.

## PR Pattern Concern (`ropwareJB:master`)
- PR head is fork default branch (`headRefName = "master"`, `isCrossRepository = true`).
- Risk: future unrelated commits on that fork `master` can accidentally alter PR contents/history and complicate review hygiene.
- Recommendation: require feature branches in forks (`user/feature-...`) for cleaner, immutable review scope.

## Documentation Quality
- `CODEBASE_DOCUMENTATION.md` updates are accurate and minimal for new Nix files (`CODEBASE_DOCUMENTATION.md:14`, `CODEBASE_DOCUMENTATION.md:186-187`).
- README Nix section is useful but incomplete for production operational safety and first-run success (user/group creation + hardening expectations are missing).

## Integration with Existing Codebase
1. The runtime command wiring is compatible:
- Service runs `gastown-gui start --host --port` (`nix/deployment.nix:80`)
- CLI supports those args (`bin/cli.js:47-50`, `bin/cli.js:206-223`)

2. External CLI dependencies remain operationally required:
- App behavior depends heavily on `gt`/`bd`/`gh`; module only optionally injects `gt`/`beads` packages (`nix/deployment.nix:15-25`, `nix/deployment.nix:71-74`).
- For robust deployments, module should more strongly guide/protect operators from missing runtime binaries.

## Recommended Changes Before Merge
1. Add managed identity provisioning when defaults are used:
- Define `users.groups.${cfg.group}` and `users.users.${cfg.user}` (or switch to `DynamicUser=true` + `StateDirectory=` pattern).

2. Add baseline systemd hardening in `serviceConfig`.

3. Strengthen options:
- Use stricter host/path typing.
- Consider `openFirewall` and explicit deployment-mode options.

4. Improve README NixOS instructions:
- Include user/group expectations and a hardened production example.

5. Add note in docs/workflow that `npmDepsHash` must be updated whenever dependency lockfile changes.

## Overall Merge Readiness
**Not merge-ready yet.**

After identity creation + hardening changes are in place, this can move to mergeable quickly. The packaging foundation is sound; the deployment module needs stronger production defaults.
