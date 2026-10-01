#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { isIsoDay, localToday } from './dates.js';
import { loadRegistry } from './registry.js';
import { makeColors, renderTable, toJsonReport } from './report.js';
import { scanWorkflows } from './scan.js';
import { loadWorkflows } from './workflows.js';

export const EXIT_OK = 0;
export const EXIT_BREAKING = 1;
export const EXIT_ERROR = 2;

const HELP = `Usage: n8n-sunset <path...> [options]

Scan n8n workflow exports (a folder of JSON files, or single files) for nodes
removed or changed in n8n 3.0 and for OpenAI models that are being shut down.

Options:
  --json             Print a JSON report instead of the table
  --days <n>         Window for the exit code, in days (default: 30)
  --as-of <date>     Measure dates from this day, YYYY-MM-DD (default: today)
  --no-color         Disable colors (also honors NO_COLOR)
  -h, --help         Show this help
  -v, --version      Show the version

Exit codes:
  0  nothing breaking takes effect within the window
  1  at least one breaking change takes effect within the window, or already has
  2  usage error, unreadable path, or no workflows found
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

export function main(argv: string[], io: Io): number {
  let args;
  try {
    args = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        json: { type: 'boolean', default: false },
        days: { type: 'string', default: '30' },
        'as-of': { type: 'string' },
        'no-color': { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
        version: { type: 'boolean', short: 'v', default: false },
      },
    });
  } catch (error) {
    io.stderr.write(`n8n-sunset: ${error instanceof Error ? error.message : String(error)}\n\n${HELP}`);
    return EXIT_ERROR;
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
  if (positionals.length === 0) {
    io.stderr.write(`n8n-sunset: missing path to workflow exports\n\n${HELP}`);
    return EXIT_ERROR;
  }
  if (!/^\d+$/.test(values.days)) {
    io.stderr.write(`n8n-sunset: --days must be a whole number of days, got "${values.days}"\n`);
    return EXIT_ERROR;
  }
  const asOf = values['as-of'] ?? localToday(io.now);
  if (!isIsoDay(asOf)) {
    io.stderr.write(`n8n-sunset: --as-of must be a date like 2026-10-01, got "${asOf}"\n`);
    return EXIT_ERROR;
  }

  let load;
  try {
    load = loadWorkflows(positionals, io.cwd);
  } catch (error) {
    io.stderr.write(`n8n-sunset: ${error instanceof Error ? error.message : String(error)}\n`);
    return EXIT_ERROR;
  }
  for (const { file, message } of load.errors) io.stderr.write(`n8n-sunset: warning: could not parse ${file}: ${message}\n`);
  if (load.workflows.length === 0) {
    io.stderr.write(`n8n-sunset: no n8n workflows found in ${positionals.join(', ')}\n`);
    return EXIT_ERROR;
  }

  const registry = loadRegistry();
  const result = scanWorkflows(load.workflows, registry, { asOf, windowDays: Number(values.days) });
  const exitCode = result.summary.breakingWithinWindow > 0 ? EXIT_BREAKING : EXIT_OK;

  if (values.json) {
    io.stdout.write(`${JSON.stringify(toJsonReport(result, registry, load, { version: packageVersion(), exitCode }), null, 2)}\n`);
  } else {
    const colorEnabled =
      !values['no-color'] && io.env.NO_COLOR === undefined && (io.env.FORCE_COLOR !== undefined || io.stdout.isTTY === true);
    const width = io.stdout.columns ?? (Number(io.env.COLUMNS) || 120);
    io.stdout.write(renderTable(result, registry, load, { colors: makeColors(colorEnabled), width: Math.max(width, 80) }));
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
