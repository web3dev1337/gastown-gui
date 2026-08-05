# Gastown GUI ↔ CLI Compatibility Report

Audit date: 2026-08-05 (previous audit: 2026-02-12)
Upstream CLI verified against: `gt` v1.2.1, `bd` 1.0.4
Upstream CLI: [steveyegge/gastown](https://github.com/steveyegge/gastown) + [steveyegge/beads](https://github.com/steveyegge/beads)

## Summary

The GUI was built against an older version of `gt`/`bd`. The CLI has since renamed and restructured several commands. **28 of 41 commands work, 7 are broken, 3 have wrong flags, 3 are partially matched.**

`test/unit/cliConformance.test.js` now asserts that every flag the GUI emits exists in the
installed `gt`/`bd` help output (and that the removed ones stay removed). It skips when the
binaries are absent, so keep this document as the human-readable record and that test as the
enforcement.

## Broken Commands (don't exist in current CLI)

| GUI calls | Real CLI equivalent | Affected file |
|---|---|---|
| `gt polecat spawn <rig/name>` | No standalone spawn — handled internally by `gt sling` | `server.js` |
| `gt <service> down` | `gt mayor stop`, `gt witness stop <rig>`, `gt refinery stop [rig]`, `gt deacon stop` | `server.js` |
| `gt formula use <name> --target X --args X` | `gt formula run [name] --rig X --pr X --dry-run` | `server/services/FormulaService.js` |
| `bd done <id> -m <summary>` | `bd close <id> -r <reason>` | `server/gateways/BDGateway.js` |
| `bd park <id> -m <reason>` | `bd defer <id>` | `server/gateways/BDGateway.js` |
| `bd release <id>` | `bd update <id> --status open` | `server/gateways/BDGateway.js` |
| `bd reassign <id> <target>` | `bd update <id> --assignee <target>` | `server/gateways/BDGateway.js` |

## Wrong Flags / Missing Arguments

| GUI calls | Issue | Affected file |
|---|---|---|
| `gt escalate ... -m <msg>` | Flag should be `-r`/`--reason`, not `-m` | `server/gateways/GTGateway.js` |
| `gt witness start` (no rig) | Requires `<rig>` argument | `server.js` |
| `gt refinery start` (no rig) | Requires `[rig]` argument | `server.js` |
| ~~`gt sling --quality=<q>`~~ | **No such flag.** `gt sling` errors `unknown flag: --quality` before doing anything. The Sling modal always sent it (default `shiny`), so *every* sling from the UI failed. `shiny`/`basic`/`chrome` were not formulas either. Fixed 2026-08-05 → optional `--formula`, chosen from `gt formula list`. | `server/gateways/GTGateway.js` |
| ~~`gt sling --molecule <text>`~~ | **No such flag.** Carried the "Instructions" textarea (which was mis-named `molecule` in `index.html`). Fixed 2026-08-05 → `-a/--args`, the documented natural-language flag. | `server/gateways/GTGateway.js`, `index.html` |
| ~~`gt sling --rig <rig> --agent <name>`~~ | **Dead fallback.** `gt sling` has no `--rig`, and `--agent` selects a *runtime* (claude/gemini/codex), not a polecat. Removed 2026-08-05; polecat start now falls back only to `gt polecat wake`. | `server/services/CLICompatibilityService.js` |
| ~~`bd create --label <l>`~~ | Works, but `--label` is an undocumented alias. Switched to the documented `--labels` 2026-08-05. | `server/gateways/BDGateway.js`, `server/services/CLICompatibilityService.js` |

## Partial Matches

| GUI calls | Issue |
|---|---|
| `gt formula create --description --template` | Real CLI may use `--type` instead |
| `bd create --role-type` | Flag not confirmed in current CLI |
| `bd --no-daemon` | Flag not confirmed; may be silently ignored |

## Working Commands (28)

`gt status`, `gt convoy list/status/create`, `gt sling` (bare, and with `--formula`/`--args` — **not** with the removed `--quality`/`--molecule`), `gt mail inbox/send/read/mark-read/mark-unread`, `gt nudge`, `gt mayor start`, `gt rig list/add/remove`, `gt crew list/status/add/remove`, `gt doctor`, `gt doctor --fix`, `gt hook status`, `gt feed`, `gt version`, `gt formula list/show`, `bd list`, `bd search`, `bd new`, `bd show`, `bd version`, `bd formula list`.

## Graceful Fallbacks

| Command | Behavior |
|---|---|
| `gt doctor --json` | `--json` flag doesn't exist; GUI falls back to plain text parsing |
| `gt rig list` | No `--json` flag; GUI parses text output |
