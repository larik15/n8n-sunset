#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { daysBetween, isIsoDay, utcToday } from './dates.js';
import { loadRegistry } from './registry.js';
import { makeColors, renderTable, toJsonReport } from './report.js';
import { scanWorkflows } from './scan.js';
import { loadWorkflows } from './workflows.js';

export const EXIT_OK = 0;
export const EXIT_BREAKING = 1;
export const EXIT_ERROR = 2;

/** The registry is a snapshot of official pages; warn once it is this many days older than --as-of. */
export const REGISTRY_MAX_AGE_DAYS = 30;
const SUPPORTED_TARGETS = ['3.0'];

const HELP = `Usage: n8n-sunset <path...> [options]

Scan n8n workflow exports (folders of JSON files, or single files) for:
  - OpenAI models being shut down (gpt-4, gpt-3.5-turbo, o1-mini, ...)
  - OpenAI endpoints being shut down (Assistants API, Videos API, reusable
    prompt objects, Evals API, OpenAI-Beta headers, legacy /v1 endpoints)
  - nodes removed or changed in n8n 3.0 (these apply when you upgrade)

Options:
  --json             Print a JSON report instead of the table (errors too)
  --days <n>         Window for the exit code, in days (default: 30)
  --as-of <date>     Measure dates from this day, YYYY-MM-DD (default: today, UTC)
  --target <ver>     Also fail on breaking changes on upgrade to this n8n version (3.0)
  --allow-skipped    Don't exit 2 for files that aren't readable n8n workflows
  --no-color         Disable colors (also NO_COLOR, or FORCE_COLOR=0)
  -h, --help         Show this help
  -v, --version      Show the version

Exit codes:
  0  no breaking finding takes effect within the window
  1  a breaking OpenAI shutdown takes effect within the window or already has
     (with --target 3.0, also any breaking change on upgrade to n8n 3.0);
     findings on disabled nodes never count
  2  usage error, unreadable path, no workflows found, or a JSON file that is
     not a readable n8n workflow (unless --allow-skipped)
`;

export interface Io {
  stdout: { write(text: string): unknown; isTTY?: boolean; columns?: number };
  stderr: { write(text: string): unknown };
  cwd: string;
  env: Record<string, string | undefined>;
  now: Date;
}

function packageVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  return pkg.version;
}

/** NO_COLOR counts only when set to a non-empty value (no-color.org); FORCE_COLOR=0 or false turns color off. */
export function colorEnabled(env: Io['env'], isTTY: boolean | undefined, noColorFlag: boolean): boolean {
  if (noColorFlag) return false;
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return false;
  const force = env.FORCE_COLOR;
  if (force !== undefined) return !['0', 'false'].includes(force.trim().toLowerCase());
  return isTTY === true;
}

export function main(argv: string[], io: Io): number {
  const wantsJson = argv.includes('--json');
  const fail = (message: string, withHelp = false): number => {
    if (wantsJson) {
      io.stdout.write(`${JSON.stringify({ tool: 'n8n-sunset', error: { message }, exitCode: EXIT_ERROR }, null, 2)}\n`);
    } else {
      io.stderr.write(`n8n-sunset: ${message}\n${withHelp ? `\n${HELP}` : ''}`);
    }
    return EXIT_ERROR;
  };

  let args;
  try {
    args = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        json: { type: 'boolean', default: false },
        days: { type: 'string', default: '30' },
        'as-of': { type: 'string' },
        target: { type: 'string', multiple: true },
        'allow-skipped': { type: 'boolean', default: false },
        'no-color': { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
        version: { type: 'boolean', short: 'v', default: false },
      },
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error), true);
  }
  const { values, positionals } = args;

  if (values.help) {
    io.stdout.write(HELP);
    return EXIT_OK;
  }
  if (values.version) {
    io.stdout.write(`${packageVersion()}\n`);
    return EXIT_OK;
  }
  if (positionals.length === 0) return fail('missing path to workflow exports', true);
  if (!/^\d+$/.test(values.days)) return fail(`--days must be a whole number of days, got "${values.days}"`);
  const asOf = values['as-of'] ?? utcToday(io.now);
  if (!isIsoDay(asOf)) return fail(`--as-of must be a date like 2026-10-01, got "${asOf}"`);
  const targets = (values.target ?? []).map((t) => t.replace(/^v/i, ''));
  const unsupported = targets.filter((t) => !SUPPORTED_TARGETS.includes(t));
  if (unsupported.length) return fail(`--target supports ${SUPPORTED_TARGETS.join(', ')}, got "${unsupported.join(', ')}"`);

  let load;
  try {
    load = loadWorkflows(positionals, io.cwd);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
  if (load.workflows.length === 0 && load.errors.length === 0 && load.skipped.length === 0) {
    return fail(`no n8n workflows found in ${positionals.join(', ')}`);
  }

  const registry = loadRegistry();
  const warnings: string[] = [];
  const age = daysBetween(registry.registryVersion, asOf);
  if (age > REGISTRY_MAX_AGE_DAYS) {
    warnings.push(
      `the bundled registry is from ${registry.registryVersion}, ${age} days before ${asOf}; newer shutdowns may be missing. Update n8n-sunset.`,
    );
  }
  for (const { file, message } of load.errors) warnings.push(`could not parse ${file}: ${message}`);
  for (const { file, reason } of load.skipped) warnings.push(`skipped ${file}: ${reason}`);
  for (const link of load.symlinks) warnings.push(`did not follow symbolic link ${link}`);

  const result = scanWorkflows(load.workflows, registry, { asOf, windowDays: Number(values.days), targets });
  const failedFiles = load.errors.length + load.skipped.length;
  const exitCode =
    load.workflows.length === 0 || (failedFiles > 0 && !values['allow-skipped'])
      ? EXIT_ERROR
      : result.summary.exitFindings > 0
        ? EXIT_BREAKING
        : EXIT_OK;

  if (values.json) {
    io.stdout.write(`${JSON.stringify(toJsonReport(result, registry, load, { version: packageVersion(), exitCode, warnings }), null, 2)}\n`);
  } else {
    for (const warning of warnings) io.stderr.write(`n8n-sunset: warning: ${warning}\n`);
    const width = io.stdout.columns ?? (Number(io.env.COLUMNS) || 120);
    io.stdout.write(
      renderTable(result, registry, load, {
        colors: makeColors(colorEnabled(io.env, io.stdout.isTTY, values['no-color'])),
        width: Math.max(width, 40),
        exitCode,
        failedFiles,
      }),
    );
  }
  return exitCode;
}

function isEntryPoint(): boolean {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  process.exitCode = main(process.argv.slice(2), {
    stdout: process.stdout,
    stderr: process.stderr,
    cwd: process.cwd(),
    env: process.env,
    now: new Date(),
  });
}
