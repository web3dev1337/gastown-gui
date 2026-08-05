/**
 * CLI conformance: assert that every flag this GUI emits actually exists in the
 * installed `gt` / `bd` binaries.
 *
 * The GUI shells out to CLIs it does not version-lock, and upstream renames flags.
 * A silent rename turns into a runtime "unknown flag" for the user — which is exactly
 * how `gt sling --quality=...` shipped broken. This test reads `<cmd> --help` and
 * fails loudly instead.
 *
 * Skips cleanly when the binary is absent so CI (and `npm publish`) stay green on
 * machines without Gas Town installed.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';

const GT = process.env.GT_BIN || 'gt';
const BD = process.env.BD_BIN || 'bd';

function help(binary, args) {
  try {
    return execFileSync(binary, [...args, '--help'], {
      encoding: 'utf8',
      timeout: 20000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    // Cobra writes help to stdout but exits non-zero for some subcommands.
    const output = `${err.stdout || ''}${err.stderr || ''}`;
    if (output.trim()) return output;
    return null;
  }
}

function isAvailable(binary) {
  try {
    execFileSync(binary, ['version'], { timeout: 20000, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Every (command, flags) pair the GUI can emit. Keep this in sync with the
 * gateways — a flag added there without a row here is an untested flag.
 */
const GT_COMMANDS = [
  { args: ['sling'], flags: ['--formula', '--args'], source: 'server/gateways/GTGateway.js sling()' },
  { args: ['escalate'], flags: ['-s', '-r'], source: 'server/gateways/GTGateway.js escalate()' },
  { args: ['convoy', 'create'], flags: ['--notify'], source: 'server/gateways/GTGateway.js createConvoy()' },
  { args: ['formula', 'run'], flags: ['--rig'], source: 'server/services/FormulaService.js run()' },
];

const BD_COMMANDS = [
  { args: ['create'], flags: ['--description', '--priority', '--labels'], source: 'server/gateways/BDGateway.js create()' },
  { args: ['close'], flags: ['-r'], source: 'server/gateways/BDGateway.js markDone()' },
  { args: ['update'], flags: ['--status', '--assignee'], source: 'server/gateways/BDGateway.js release()/reassign()' },
];

/**
 * Flags the GUI must NOT emit — they were removed or never existed upstream.
 * Guards against a regression that reintroduces them.
 */
const GT_FORBIDDEN = [
  { args: ['sling'], flags: ['--quality', '--molecule'] },
];

function describeSuite(label, binary, commands, forbidden = []) {
  const available = isAvailable(binary);

  describe.skipIf(!available)(label, () => {
    for (const { args, flags, source } of commands) {
      const name = `${binary} ${args.join(' ')}`;
      it(`${name} supports ${flags.join(', ')} (used by ${source})`, () => {
        const text = help(binary, args);
        expect(text, `could not read help for "${name}"`).toBeTruthy();
        for (const flag of flags) {
          // Match the flag as a whole token so --arg does not satisfy --args.
          const pattern = new RegExp(`(^|[\\s,])${flag.replace(/-/g, '\\-')}([\\s,=]|$)`, 'm');
          expect(pattern.test(text), `"${name}" has no ${flag} flag`).toBe(true);
        }
      });
    }

    for (const { args, flags } of forbidden) {
      const name = `${binary} ${args.join(' ')}`;
      it(`${name} does not offer ${flags.join(', ')} (the GUI must not send them)`, () => {
        const text = help(binary, args);
        expect(text, `could not read help for "${name}"`).toBeTruthy();
        for (const flag of flags) {
          const pattern = new RegExp(`(^|[\\s,])${flag.replace(/-/g, '\\-')}([\\s,=]|$)`, 'm');
          expect(pattern.test(text), `"${name}" now offers ${flag} — revisit the gateway`).toBe(false);
        }
      });
    }
  });

  if (!available) {
    // Surface the skip reason rather than silently reporting zero tests.
    describe(label, () => {
      it.skip(`${binary} is not installed — CLI conformance not verified`, () => {});
    });
  }
}

describeSuite('gt CLI conformance', GT, GT_COMMANDS, GT_FORBIDDEN);
describeSuite('bd CLI conformance', BD, BD_COMMANDS);
