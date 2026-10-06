#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { loadWorkflowsFromApi } from './api.js';
import { daysBetween, isIsoDay, utcToday } from './dates.js';
import { loadRegistry, missingProviderSections, type Registry } from './registry.js';
import { makeColors, renderTable, toJsonReport } from './report.js';
import { scanWorkflows } from './scan.js';
import { loadWorkflows, type LoadResult } from './workflows.js';

export const EXIT_OK = 0;
export const EXIT_BREAKING = 1;
export const EXIT_ERROR = 2;

/** The registry is a snapshot of official pages; warn once it is this many days older than --as-of. */
export const REGISTRY_WARN_AGE_DAYS = 14;
/** Default for --max-registry-age: older data fails the run (exit 2), since new shutdowns may be missing. */
export const REGISTRY_MAX_AGE_DAYS = 90;

const HELP = `Usage: n8n-sunset <path...> [options]
       n8n-sunset --from-api [options]

Scan n8n workflows for:
  - OpenAI models being shut down (gpt-4, gpt-3.5-turbo, o1-mini, ...)
  - Anthropic models being retired (claude-3-5-sonnet-20241022, claude-sonnet-4-5, ...)
  - Google Gemini models being shut down (gemini-2.0-flash, text-embedding-004, ...)
  - OpenAI endpoints being shut down (Assistants API, Videos API, reusable
    prompt objects, Evals API, OpenAI-Beta headers, legacy /v1 endpoints)
  - nodes removed or changed in n8n 3.0 (these apply when you upgrade)

Read workflows from exported JSON files (folders or single files), or straight
from a running n8n through its public API with --from-api.

Options:
  --from-api                  Read workflows from the n8n API instead of files, using
                              N8N_API_URL (e.g. https://n8n.example.com/api/v1) and
                              N8N_API_KEY; nothing is written to disk
  --json                      Print a JSON report instead of the table (errors too)
  --days <n>                  Window for the exit code, in days (default: 30)
  --as-of <date>              Measure dates from this day, YYYY-MM-DD (default: today, UTC)
  --target <ver>              Also fail on breaking changes on upgrade to this n8n
                              version (3.0, or 3)
  --skip-rule <id>            Leave out findings of this rule (e.g. gemini/model-shutdown)
                              or category (e.g. gemini-model); repeat for more
  --allow-skipped             Don't exit 2 for files that aren't readable n8n workflows,
                              or for symbolic links (which are never followed)
  --max-registry-age <days>   Exit 2 when the bundled data is older than this many days
                              before --as-of (default: ${REGISTRY_MAX_AGE_DAYS}); it warns after ${REGISTRY_WARN_AGE_DAYS}
  --registry <path>           Use this registry file instead of the bundled one
  --no-color                  Disable colors (also NO_COLOR, or FORCE_COLOR=0)
  -h, --help                  Show this help
  -v, --version               Show the version

Exit codes:
  0  no breaking finding takes effect within the window
  1  a breaking OpenAI, Anthropic or Gemini shutdown takes effect within the window
     or already has
     (with --target 3.0, also any breaking change on upgrade to n8n 3.0);
     findings on disabled nodes never count
  2  a problem with the input or the data: usage error, unreadable path, no
     workflows found, a JSON file that is not a readable n8n workflow or a
     symbolic link (unless --allow-skipped), an n8n API error, or a registry
     that is missing, invalid, or older than --max-registry-age
`;

export interface Io {
  stdout: { write(text: string): unknown; isTTY?: boolean; columns?: number };
  stderr: { write(text: string): unknown };
  cwd: string;
  env: Record<string, string | undefined>;
  now: Date;
  /** For tests; defaults to the global fetch. */
  fetch?: typeof globalThis.fetch;
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

/** "3", "3.0", "v3" and "v3.0" all mean n8n 3.0; anything else is not a supported target. */
export function normalizeTarget(value: string): string | undefined {
  return /^v?3(\.0)?$/i.test(value.trim()) ? '3.0' : undefined;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export async function main(argv: string[], io: Io): Promise<number> {
  const wantsJson = argv.includes('--json');
  const fail = (text: string, withHelp = false): number => {
    if (wantsJson) {
      io.stdout.write(`${JSON.stringify({ tool: 'n8n-sunset', error: { message: text }, exitCode: EXIT_ERROR }, null, 2)}\n`);
    } else {
      io.stderr.write(`n8n-sunset: ${text}\n${withHelp ? `\n${HELP}` : ''}`);
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
        'skip-rule': { type: 'string', multiple: true },
        'allow-skipped': { type: 'boolean', default: false },
        'from-api': { type: 'boolean', default: false },
        'max-registry-age': { type: 'string', default: String(REGISTRY_MAX_AGE_DAYS) },
        registry: { type: 'string' },
        'no-color': { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
        version: { type: 'boolean', short: 'v', default: false },
      },
    });
  } catch (error) {
    return fail(message(error), true);
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
  const fromApi = values['from-api'];
  if (fromApi && positionals.length > 0) return fail('pass either paths or --from-api, not both');
  if (!fromApi && positionals.length === 0) return fail('missing path to workflow exports (or use --from-api)', true);
  if (!/^\d+$/.test(values.days)) return fail(`--days must be a whole number of days, got "${values.days}"`);
  if (!/^\d+$/.test(values['max-registry-age'])) return fail(`--max-registry-age must be a whole number of days, got "${values['max-registry-age']}"`);
  const asOf = values['as-of'] ?? utcToday(io.now);
  if (!isIsoDay(asOf)) return fail(`--as-of must be a date like 2026-10-01, got "${asOf}"`);
  const targets: string[] = [];
  for (const raw of values.target ?? []) {
    const target = normalizeTarget(raw);
    if (!target) return fail(`--target supports 3.0 (or 3), got "${raw}"`);
    if (!targets.includes(target)) targets.push(target);
  }

  let registry: Registry;
  try {
    registry = values.registry ? loadRegistry(resolve(io.cwd, values.registry)) : loadRegistry();
  } catch (error) {
    return fail(message(error));
  }
  const known = knownRules(registry);
  const skipRules: string[] = [];
  for (const raw of values['skip-rule'] ?? []) {
    const rule = raw.trim();
    if (!known.includes(rule)) return fail(`--skip-rule does not know "${raw}". Rule IDs and categories: ${known.join(', ')}`);
    if (!skipRules.includes(rule)) skipRules.push(rule);
  }
  const age = daysBetween(registry.registryVersion, asOf);
  const maxAge = Number(values['max-registry-age']);
  if (age > maxAge) {
    return fail(
      `the registry is from ${registry.registryVersion}, ${age} days before ${asOf}, older than --max-registry-age ${maxAge}. ` +
        'Update n8n-sunset (npx n8n-sunset@latest), or raise --max-registry-age to accept older data.',
    );
  }

  let load: LoadResult;
  try {
    if (fromApi) {
      const baseUrl = io.env.N8N_API_URL;
      const apiKey = io.env.N8N_API_KEY;
      if (!baseUrl || !apiKey) return fail('--from-api needs the N8N_API_URL and N8N_API_KEY environment variables');
      load = await loadWorkflowsFromApi({ baseUrl, apiKey, ...(io.fetch ? { fetch: io.fetch } : {}) });
    } else {
      load = loadWorkflows(positionals, io.cwd);
    }
  } catch (error) {
    return fail(message(error));
  }
  if (load.workflows.length === 0 && load.errors.length === 0 && load.skipped.length === 0) {
    return fail(fromApi ? 'the n8n API returned no workflows' : `no n8n workflows found in ${positionals.join(', ')}`);
  }

  const warnings: string[] = [];
  if (age > REGISTRY_WARN_AGE_DAYS) {
    warnings.push(`the bundled registry is from ${registry.registryVersion}, ${age} days before ${asOf}; newer shutdowns may be missing. Update n8n-sunset.`);
  }
  for (const section of missingProviderSections(registry)) {
    warnings.push(`the registry has no ${section} section (it was written for n8n-sunset 0.1), so ${section === 'anthropic' ? 'Anthropic' : 'Google Gemini'} models are not checked.`);
  }
  for (const { file, message: text } of load.errors) warnings.push(`could not parse ${file}: ${text}`);
  for (const { file, reason } of load.skipped) warnings.push(`skipped ${file}: ${reason}`);

  const result = scanWorkflows(load.workflows, registry, { asOf, windowDays: Number(values.days), targets, skipRules });
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

/** Every value --skip-rule accepts: the rule IDs the registry can produce, and the finding categories. */
export function knownRules(registry: Registry): string[] {
  return [
    'openai/model-shutdown',
    'openai/endpoint-shutdown',
    'anthropic/model-retirement',
    'gemini/model-shutdown',
    'n8n3/removed-node',
    ...registry.n8n.changes.map((c) => `n8n3/${c.id}`),
    'openai-model',
    'openai-endpoint',
    'anthropic-model',
    'gemini-model',
    'n8n-3.0',
  ];
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
  main(process.argv.slice(2), {
    stdout: process.stdout,
    stderr: process.stderr,
    cwd: process.cwd(),
    env: process.env,
    now: new Date(),
  }).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      process.stderr.write(`n8n-sunset: ${message(error)}\n`);
      process.exitCode = EXIT_ERROR;
    },
  );
}
