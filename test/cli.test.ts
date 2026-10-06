import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EXIT_BREAKING, EXIT_ERROR, EXIT_OK, main, normalizeTarget } from '../src/cli.js';
import { displayWidth } from '../src/width.js';
import { AS_OF, fixture } from './helpers.js';

const ANSI = /\u001b\[[0-9;]*m/g;

interface RunOptions {
  env?: Record<string, string>;
  columns?: number;
  now?: Date;
  cwd?: string;
}

async function run(args: string[], options: RunOptions = {}) {
  let stdout = '';
  let stderr = '';
  const code = await main(args, {
    stdout: { write: (text: string) => (stdout += text), isTTY: false, columns: options.columns ?? 160 },
    stderr: { write: (text: string) => (stderr += text) },
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? {},
    now: options.now ?? new Date(Date.UTC(2026, 9, 1, 12, 0, 0)),
  });
  return { code, stdout, stderr };
}

const json = async (args: string[], options?: RunOptions) => {
  const result = await run([...args, '--json'], options);
  return { ...result, report: JSON.parse(result.stdout) };
};

const tempDir = () => mkdtempSync(join(tmpdir(), 'n8n-sunset-'));

describe('table output', () => {
  let code: number;
  let stdout: string;
  beforeAll(async () => ({ code, stdout } = await run([fixture('rules'), '--as-of', AS_OF])));

  it('exits 1 when an OpenAI shutdown takes effect within 30 days or already has', () => {
    expect(code).toBe(EXIT_BREAKING);
    for (const text of ['SEVERITY', 'WHEN', 'WORKFLOW', 'NODE', 'WHAT BREAKS', 'REPLACEMENT', 'Lead scoring', 'GPT-4 chat model', 'gpt-5.6-sol']) {
      expect(stdout).toContain(text);
    }
    expect(stdout).toContain('[unverified]');
  });

  it('keeps the header separators as "  ·  "', () => {
    expect(stdout.split('\n')[0]).toMatch(/^n8n-sunset {2}· {2}\d+ workflows scanned {2}· {2}as of 2026-10-01 \(UTC\) {2}· {2}window 30 days$/);
  });

  it('lists upcoming shutdowns first, then past ones, then n8n 3.0 upgrade changes', () => {
    const upcoming = stdout.indexOf('Upcoming shutdowns (');
    const past = stdout.indexOf('Already shut down (');
    const upgrade = stdout.indexOf('Breaks on upgrade to n8n 3.0 (');
    expect(upcoming).toBeGreaterThan(-1);
    expect(past).toBeGreaterThan(upcoming);
    expect(upgrade).toBeGreaterThan(past);
    // Soonest first among upcoming: Oct 23 before Nov 30.
    const section = stdout.slice(upcoming, past);
    expect(section.indexOf('2026-10-23')).toBeLessThan(section.indexOf('2026-11-30'));
  });

  it('labels n8n 3.0 findings by the upgrade instead of a date', async () => {
    expect(stdout).toMatch(/^Breaks on upgrade to n8n 3\.0 \(\d+ findings\)$/m);
    expect(stdout).toMatch(/^Changes on upgrade to n8n 3\.0 \(\d+ findings\)$/m);
    const stacked = (await run([fixture('rules/removed-nodes.json'), '--as-of', AS_OF], { columns: 80 })).stdout;
    expect(stacked).toMatch(/^BREAKING {2}breaks on upgrade to n8n 3\.0$/m);
    expect(stdout).not.toContain('this month');
    expect(stdout).not.toContain('day TBA');
    expect(stdout).toMatch(/breaking findings? in \d+ nodes? break on upgrade to n8n 3\.0; add --target 3\.0 to fail on them\./);
  });

  it('counts findings, nodes and workflows', () => {
    expect(stdout).toMatch(/^\d+ findings in \d+ nodes across \d+ workflows: \d+ breaking, /m);
    expect(stdout).toMatch(/^\d+ breaking findings in \d+ nodes across \d+ workflows take effect within 30 days or already have\.$/m);
  });

  it('marks disabled nodes and archived or inactive workflows', () => {
    // The marker may wrap between its words inside the NODE column.
    expect(stdout).toMatch(/\(disabled, not( counted\)|\s*\n[^\n]*counted\))/);
    expect(stdout).toContain('(archived)');
  });

  it('never prints a month label, even at the end of the month', async () => {
    const late = (await run([fixture('rules'), '--as-of', '2026-10-31'])).stdout;
    expect(late).not.toContain('this month');
    expect(late).toContain('Breaks on upgrade to n8n 3.0 (');
    expect((await json([fixture('rules/removed-nodes.json'), '--as-of', '2026-10-31'])).report.findings[0].when).toBe('breaks on upgrade to n8n 3.0');
  });

  it('keeps every table line within the terminal width', async () => {
    const narrow = (await run([fixture('rules'), '--as-of', AS_OF], { columns: 100 })).stdout;
    for (const line of narrow.split('\n')) expect(displayWidth(line.replace(ANSI, '')), line).toBeLessThanOrEqual(100);
  });

  it('switches to a stacked layout below 90 columns', async () => {
    const stacked = (await run([fixture('rules/openai-llm-nodes.json'), '--as-of', AS_OF], { columns: 80 })).stdout;
    expect(stacked).not.toContain('SEVERITY');
    expect(stacked).toMatch(/^BREAKING {2}2026-10-23 \(in 22d\)$/m);
    expect(stacked).toMatch(/^ {2}Workflow {5}Lead scoring$/m);
    expect(stacked).toMatch(/^ {2}Replacement {2}gpt-5\.6-sol$/m);
    // Every line fits, including the header (broken between segments) and the closing summary.
    for (const line of stacked.split('\n')) expect(displayWidth(line), line).toBeLessThanOrEqual(80);
    const tiny = (await run([fixture('rules'), '--as-of', AS_OF, '--target', '3.0'], { columns: 50 })).stdout;
    for (const line of tiny.split('\n')) expect(displayWidth(line), line).toBeLessThanOrEqual(50);
    const count = readdirSync(fixture('rules')).length;
    expect(tiny.split('\n').slice(0, 3)).toEqual([
      `n8n-sunset  ·  ${count} workflows scanned`,
      'as of 2026-10-01 (UTC)  ·  window 30 days',
      'target n8n 3.0',
    ]);
  });

  it('aligns columns by display width when names contain emoji or CJK', async () => {
    const out = (await run([fixture('cli/emoji.json'), '--as-of', AS_OF])).stdout.split('\n');
    const header = out.find((line) => line.includes('WHAT BREAKS'))!;
    const row = out.find((line) => line.includes('🤖 Bot ✅'))!;
    const column = displayWidth(header.slice(0, header.indexOf('WHAT BREAKS')));
    expect(displayWidth(row.slice(0, row.indexOf('OpenAI shuts')))).toBe(column);
  });

  it('reports a clean workflow', async () => {
    const clean = await run([fixture('rules/clean.json')]);
    expect(clean.code).toBe(EXIT_OK);
    expect(clean.stdout).toContain('No findings in 1 workflow.');
    expect(clean.stdout).toContain('No breaking findings take effect within the next 30 days.');
  });

  it('uses colors only on a TTY or with FORCE_COLOR, never with NO_COLOR, FORCE_COLOR=0 or --no-color', async () => {
    const target = fixture('rules/gmail-trigger.json');
    expect((await run([target])).stdout).not.toMatch(ANSI);
    expect((await run([target], { env: { FORCE_COLOR: '1' } })).stdout).toMatch(ANSI);
    expect((await run([target], { env: { FORCE_COLOR: '0' } })).stdout).not.toMatch(ANSI);
    expect((await run([target], { env: { FORCE_COLOR: '1', NO_COLOR: '1' } })).stdout).not.toMatch(ANSI);
    expect((await run([target], { env: { FORCE_COLOR: '1', NO_COLOR: '' } })).stdout).toMatch(ANSI);
    expect((await run([target, '--no-color'], { env: { FORCE_COLOR: '1' } })).stdout).not.toMatch(ANSI);
  });
});

describe('--json', () => {
  it('prints every finding with workflow, node, what breaks, when and replacement', async () => {
    const { code, report } = await json([fixture('rules'), '--as-of', AS_OF]);
    expect(code).toBe(EXIT_BREAKING);
    expect(report).toMatchObject({ tool: 'n8n-sunset', asOf: AS_OF, windowDays: 30, targets: [], exitCode: EXIT_BREAKING, warnings: [] });
    expect(report.summary.workflowsScanned).toBe(readdirSync(fixture('rules')).length);
    expect(report.findings.length).toBe(report.summary.findings);
    expect(report.summary.exitFindings).toBe(report.findings.filter((f: { countsTowardExit: boolean }) => f.countsTowardExit).length);
    for (const f of report.findings) {
      expect(f).toEqual(expect.objectContaining({ workflow: expect.any(String), node: expect.any(String), message: expect.any(String), status: expect.any(String) }));
      expect(f).toHaveProperty('replacement');
      if (f.trigger === 'upgrade') expect(f).toMatchObject({ date: null, upgradeTo: '3.0', status: 'on-upgrade', countsTowardExit: false });
      else expect(f.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('defaults the as-of date to today in UTC', async () => {
    // 23:30 UTC on Sep 30: already Oct 1 east of UTC, but the report uses the UTC day.
    expect((await json([fixture('rules/clean.json')], { now: new Date(Date.UTC(2026, 8, 30, 23, 30)) })).report.asOf).toBe('2026-09-30');
  });

  it('prints errors as JSON on stdout', async () => {
    for (const args of [['does-not-exist'], [fixture('rules'), '--frobnicate'], [fixture('rules'), '--target', '4.0']]) {
      const { code, stdout, stderr } = await run([...args, '--json']);
      expect(code, args.join(' ')).toBe(EXIT_ERROR);
      expect(stderr).toBe('');
      expect(JSON.parse(stdout)).toMatchObject({ tool: 'n8n-sunset', error: { message: expect.any(String) }, exitCode: EXIT_ERROR });
    }
  });
});

describe('exit code', () => {
  // The only finding is the gpt-4 alias, shut down on 2026-10-23.
  const gpt4 = fixture('cli/gpt-4-alias.json');

  it('ignores shutdowns beyond the window and honors --days', async () => {
    expect((await run([gpt4, '--as-of', '2026-09-01'])).code).toBe(EXIT_OK);
    expect((await run([gpt4, '--as-of', '2026-09-01', '--days', '60'])).code).toBe(EXIT_BREAKING);
  });

  it('words a single breaking finding in the singular', async () => {
    expect((await run([gpt4, '--as-of', AS_OF])).stdout).toContain('1 breaking finding in 1 node across 1 workflow takes effect within 30 days or already has.');
  });

  it('words a single n8n 3.0 breaking finding in the singular', async () => {
    expect((await run([fixture('rules/ai-agent-v1.json'), '--as-of', AS_OF])).stdout).toContain(
      '2 breaking findings in 2 nodes break on upgrade to n8n 3.0; add --target 3.0 to fail on them.',
    );
    expect((await run([fixture('rules/code-evaluate-expression.json'), '--as-of', AS_OF])).stdout).toContain(
      '1 breaking finding in 1 node breaks on upgrade to n8n 3.0; add --target 3.0 to fail on it.',
    );
  });

  it('counts shutdowns that already happened', async () => {
    expect((await run([fixture('rules/openai-code.json'), '--as-of', AS_OF, '--days', '0'])).code).toBe(EXIT_BREAKING);
  });

  it('does not fail on behavior changes, warnings or info alone', async () => {
    expect((await run([fixture('rules/gmail-trigger.json'), '--as-of', AS_OF])).code).toBe(EXIT_OK);
    expect((await run([fixture('rules/openai-other-nodes.json'), '--as-of', AS_OF])).code).toBe(EXIT_OK);
  });

  it('does not count n8n 3.0 breaking changes unless --target 3.0 (or 3) is given', async () => {
    const removed = fixture('rules/removed-nodes.json');
    expect((await run([removed, '--as-of', AS_OF])).code).toBe(EXIT_OK);
    const targeted = await run([removed, '--as-of', AS_OF, '--target', '3.0']);
    expect(targeted.code).toBe(EXIT_BREAKING);
    expect(targeted.stdout).toContain('5 breaking findings in 5 nodes across 1 workflow take effect within 30 days, already have, or break on upgrade to n8n 3.0.');
    expect(targeted.stdout).toContain('target n8n 3.0');
    for (const spelling of ['3', 'v3', '3.0', 'V3.0']) {
      const { code, report } = await json([removed, '--as-of', AS_OF, '--target', spelling]);
      expect(code, spelling).toBe(EXIT_BREAKING);
      expect(report.targets, spelling).toEqual(['3.0']);
    }
  });

  it('does not count findings on disabled nodes', async () => {
    const { code, stdout } = await run([fixture('rules/workflow-flags.json'), '--as-of', AS_OF]);
    expect(code).toBe(EXIT_OK);
    expect(stdout).toContain('1 breaking finding on disabled nodes is not counted.');
    expect(stdout).toContain('(archived)');
  });
});

describe('normalizeTarget', () => {
  it('accepts 3, 3.0, v3 and v3.0 as n8n 3.0 and nothing else', () => {
    for (const ok of ['3', '3.0', 'v3', 'v3.0', ' 3 ']) expect(normalizeTarget(ok), ok).toBe('3.0');
    for (const bad of ['4', '3.1', '30', '2.0', 'latest', '']) expect(normalizeTarget(bad), bad).toBeUndefined();
  });
});

describe('registry age and --registry', () => {
  const target = fixture('rules/clean.json');

  it('warns when the registry is more than 14 days older than --as-of', async () => {
    expect((await run([target, '--as-of', '2026-10-20'])).stderr).toBe('');
    const old = await run([target, '--as-of', '2026-10-21']);
    expect(old.code).toBe(EXIT_OK);
    expect(old.stderr).toContain('the bundled registry is from 2026-10-06, 15 days before 2026-10-21');
    expect(old.stderr).toContain('Update n8n-sunset.');
  });

  it('puts the warning in the JSON report', async () => {
    const { stderr, report } = await json([target, '--as-of', '2026-11-15']);
    expect(stderr).toBe('');
    expect(report.warnings).toEqual([expect.stringContaining('Update n8n-sunset.')]);
  });

  it('exits 2 once the registry is older than --max-registry-age (default 90 days)', async () => {
    expect((await run([target, '--as-of', '2027-01-04'])).code).toBe(EXIT_OK); // 90 days: still allowed
    const stale = await run([target, '--as-of', '2027-01-05']);
    expect(stale.code).toBe(EXIT_ERROR);
    expect(stale.stderr).toContain('the registry is from 2026-10-06, 91 days before 2027-01-05, older than --max-registry-age 90');
    expect((await run([target, '--as-of', '2027-01-05', '--max-registry-age', '120'])).code).toBe(EXIT_OK);
    expect((await run([target, '--as-of', '2026-10-20', '--max-registry-age', '10'])).code).toBe(EXIT_ERROR);
    expect((await run([target, '--max-registry-age', 'old'])).stderr).toContain('--max-registry-age must be a whole number');
  });

  it('loads another registry with --registry, and rejects one with unknown sources', async () => {
    const dir = tempDir();
    try {
      const registry = JSON.parse(readFileSync(new URL('../data/sunset-registry.json', import.meta.url), 'utf8'));
      // A newer registry that moves the gpt-4 shutdown out of the 30-day window.
      registry.registryVersion = '2026-10-01';
      const gpt4 = registry.openai.models.find((m: { id: string }) => m.id === 'gpt-4-0613');
      gpt4.shutdownDate = '2027-06-01';
      writeFileSync(join(dir, 'newer.json'), JSON.stringify(registry));
      expect((await run([fixture('cli/gpt-4-alias.json'), '--as-of', AS_OF])).code).toBe(EXIT_BREAKING);
      expect((await run([fixture('cli/gpt-4-alias.json'), '--as-of', AS_OF, '--registry', join(dir, 'newer.json')])).code).toBe(EXIT_OK);

      registry.openai.legacyFineTunes.sources.push('no-such-source');
      writeFileSync(join(dir, 'broken.json'), JSON.stringify(registry));
      const broken = await run([target, '--registry', join(dir, 'broken.json')]);
      expect(broken.code).toBe(EXIT_ERROR);
      expect(broken.stderr).toContain('Registry references unknown source: no-such-source');

      const missing = await run([target, '--registry', join(dir, 'nope.json')]);
      expect(missing.code).toBe(EXIT_ERROR);
      expect(missing.stderr).toContain('Could not read registry');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('input paths', () => {
  it('reads each file once, however the paths overlap', async () => {
    const dir = tempDir();
    try {
      mkdirSync(join(dir, 'workflows', 'sub'), { recursive: true });
      copyFileSync(fixture('cli/gpt-4-alias.json'), join(dir, 'workflows', 'a.json'));
      copyFileSync(fixture('rules/clean.json'), join(dir, 'workflows', 'sub', 'b.json'));
      const once = (await json(['workflows', '--as-of', AS_OF], { cwd: dir })).report;
      expect(once.summary).toMatchObject({ workflowsScanned: 2, findings: 1 });
      for (const paths of [
        ['./workflows', './workflows/a.json'],
        ['workflows', 'workflows/sub'],
        ['workflows', join(dir, 'workflows')],
        ['workflows/a.json', 'workflows/../workflows/a.json', 'workflows/sub', 'workflows'],
      ]) {
        const { report } = await json([...paths, '--as-of', AS_OF], { cwd: dir });
        expect(report.summary, paths.join(' ')).toMatchObject({ workflowsScanned: 2, findings: 1 });
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('input formats', () => {
  it('reads exported arrays, API pages, n8n.io templates and nested folders, skipping node_modules', async () => {
    const { report } = await json([fixture('formats'), '--as-of', AS_OF, '--allow-skipped']);
    expect(report.summary.workflowsScanned).toBe(5);
    const workflows = new Set(report.findings.map((f: { workflow: string }) => f.workflow));
    expect(workflows).toEqual(new Set(['Second exported workflow', 'From the n8n API', 'inner.json', 'Template: summarize support tickets']));
  });

  it('exits 2 for unreadable files and files that are not workflows, explaining why', async () => {
    const { code, stdout, stderr } = await run([fixture('formats'), '--as-of', AS_OF]);
    expect(code).toBe(EXIT_ERROR);
    expect(stderr).toContain('warning: could not parse test/fixtures/formats/broken.json');
    expect(stderr).toContain('warning: skipped test/fixtures/formats/not-a-workflow.json: JSON object without a "nodes" array');
    expect(stdout).toContain('Exit code 2: 2 files could not be read as n8n workflows; pass --allow-skipped to ignore them.');

    const { report } = await json([fixture('formats'), '--as-of', AS_OF]);
    expect(report.exitCode).toBe(EXIT_ERROR);
    expect(report.skipped).toEqual([{ file: 'test/fixtures/formats/not-a-workflow.json', reason: 'JSON object without a "nodes" array' }]);
    expect(report.errors).toMatchObject([{ file: 'test/fixtures/formats/broken.json' }]);
  });

  it('uses the findings for the exit code with --allow-skipped', async () => {
    // The template's gpt-3.5-turbo shuts down on 2026-10-23.
    expect((await run([fixture('formats'), '--as-of', AS_OF, '--allow-skipped'])).code).toBe(EXIT_BREAKING);
  });

  describe('symbolic links', () => {
    const dir = tempDir();
    afterAll(() => rmSync(dir, { recursive: true, force: true }));
    copyFileSync(fixture('rules/clean.json'), join(dir, 'real.json'));
    mkdirSync(join(dir, 'elsewhere'));
    let linked = true;
    try {
      // A junction needs no special rights on Windows; elsewhere it is an ordinary symlink.
      symlinkSync(join(dir, 'elsewhere'), join(dir, 'linked'), 'junction');
    } catch {
      linked = false;
    }

    it.skipIf(!linked)('counts links it does not follow as skipped files: exit 2 unless --allow-skipped', async () => {
      const { code, stderr, stdout } = await run([dir, '--as-of', AS_OF]);
      expect(code).toBe(EXIT_ERROR);
      expect(stderr).toMatch(/warning: skipped .*linked: symbolic link, not followed/);
      expect(stdout).toContain('Exit code 2: 1 file could not be read as n8n workflows');
      const { report } = await json([dir, '--as-of', AS_OF, '--allow-skipped']);
      expect(report.exitCode).toBe(EXIT_OK);
      expect(report.skipped).toEqual([{ file: expect.stringMatching(/linked$/), reason: 'symbolic link, not followed' }]);
      expect(report.summary.symlinksNotFollowed).toBe(1);
    });
  });
});

describe('--from-api', () => {
  const KEY = 'test-key-do-not-print';
  const examples = (name: string) => JSON.parse(readFileSync(new URL(`../examples/workflows/${name}`, import.meta.url), 'utf8'));
  const requests: { path: string; query: Record<string, string>; key: string | undefined }[] = [];
  let server: Server;
  let base: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      const url = new URL(req.url!, 'http://localhost');
      requests.push({ path: url.pathname, query: Object.fromEntries(url.searchParams), key: req.headers['x-n8n-api-key'] as string | undefined });
      const send = (status: number, body: unknown, type = 'application/json') => {
        res.writeHead(status, { 'content-type': type });
        res.end(typeof body === 'string' ? body : JSON.stringify(body));
      };
      if (req.headers['x-n8n-api-key'] !== KEY) return send(401, { message: 'unauthorized' });
      const cursor = url.searchParams.get('cursor');
      switch (url.pathname) {
        case '/ok/api/v1/workflows':
          if (!cursor) return send(200, { data: [examples('support-bot.json'), examples('lead-enrichment.json')], nextCursor: 'MTIz+/ZQ==' });
          if (cursor === 'MTIz+/ZQ==') return send(200, { data: [examples('weekly-digest.json')], nextCursor: null });
          return send(400, { message: `bad cursor ${cursor}` });
        case '/loop/api/v1/workflows':
          return send(200, { data: [examples('support-bot.json')], nextCursor: 'same' });
        case '/html/api/v1/workflows':
          return send(200, '<!doctype html><title>n8n</title>', 'text/html');
        case '/empty/api/v1/workflows':
          return send(200, { data: [], nextCursor: null });
        default:
          return send(404, { message: 'not found' });
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const env = (path: string, key = KEY) => ({ N8N_API_URL: `${base}${path}`, N8N_API_KEY: key });

  it('pages through GET /workflows with the API key, limit 250 and excludePinnedData, writing no files', async () => {
    const dir = tempDir();
    try {
      requests.length = 0;
      const { code, report, stderr } = await json(['--from-api', '--as-of', '2026-10-02'], { env: env('/ok/api/v1/'), cwd: dir });
      expect(stderr).toBe('');
      expect(code).toBe(EXIT_BREAKING);
      expect(report.summary).toMatchObject({ workflowsScanned: 3, findings: 10, exitFindings: 5 });
      expect(requests).toEqual([
        { path: '/ok/api/v1/workflows', query: { limit: '250', excludePinnedData: 'true' }, key: KEY },
        { path: '/ok/api/v1/workflows', query: { limit: '250', excludePinnedData: 'true', cursor: 'MTIz+/ZQ==' }, key: KEY },
      ]);
      // Findings point at the workflow in the n8n editor.
      expect(report.findings.map((f: { file: string }) => f.file)).toContain(`${base}/ok/workflow/Lp4Nv8LeadEnrich`);
      expect(readdirSync(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exits 2 without printing the key when the API rejects it', async () => {
    const { code, stdout, stderr } = await run(['--from-api'], { env: env('/ok/api/v1', 'wrong-key-secret-123') });
    expect(code).toBe(EXIT_ERROR);
    expect(stderr).toContain('The n8n API answered 401 Unauthorized: unauthorized (check N8N_API_KEY)');
    expect(stdout + stderr).not.toContain('wrong-key-secret-123');
  });

  it.each([
    [{}, '--from-api needs the N8N_API_URL and N8N_API_KEY environment variables'],
    [{ N8N_API_URL: 'https://n8n.example.com', N8N_API_KEY: 'k' }, 'N8N_API_URL must end with the API version path'],
    [{ N8N_API_URL: 'not a url', N8N_API_KEY: 'k' }, 'N8N_API_URL is not a URL'],
  ])('exits 2 for a missing or wrong N8N_API_URL (%j)', async (vars, text) => {
    const { code, stderr } = await run(['--from-api'], { env: vars as Record<string, string> });
    expect(code).toBe(EXIT_ERROR);
    expect(stderr).toContain(text);
  });

  it('exits 2 for HTML instead of JSON, a repeating cursor, an unreachable host, or no workflows', async () => {
    expect((await run(['--from-api'], { env: env('/html/api/v1') })).stderr).toContain('did not return JSON');
    expect((await run(['--from-api'], { env: env('/loop/api/v1') })).stderr).toContain('returned the same nextCursor twice');
    expect((await run(['--from-api'], { env: env('/empty/api/v1') })).stderr).toContain('the n8n API returned no workflows');
    expect((await run(['--from-api'], { env: { N8N_API_URL: 'http://127.0.0.1:9/api/v1', N8N_API_KEY: KEY } })).stderr).toContain('Could not reach the n8n API');
  });

  it('refuses paths together with --from-api', async () => {
    const { code, stderr } = await run(['--from-api', fixture('rules')], { env: env('/ok/api/v1') });
    expect(code).toBe(EXIT_ERROR);
    expect(stderr).toContain('pass either paths or --from-api, not both');
  });
});

describe('usage errors', () => {
  it.each([
    [[], 'missing path'],
    [['does-not-exist'], 'Path not found: does-not-exist'],
    [[fixture('formats/not-a-workflow.json')], 'skipped'],
    [[fixture('rules'), '--days', 'soon'], '--days must be a whole number'],
    [[fixture('rules'), '--as-of', '2026-13-01'], '--as-of must be a date'],
    [[fixture('rules'), '--target', '4.0'], '--target supports 3.0 (or 3)'],
    [[fixture('rules'), '--frobnicate'], "Unknown option '--frobnicate'"],
  ])('exits 2 for %j', async (args, message) => {
    const { code, stderr } = await run(args as string[]);
    expect(code).toBe(EXIT_ERROR);
    expect(stderr).toContain(message);
  });

  it('prints help and version', async () => {
    expect(await run(['--help'])).toMatchObject({ code: EXIT_OK, stdout: expect.stringContaining('Usage: n8n-sunset <path...> [options]') });
    const help = (await run(['--help'])).stdout;
    expect(help).toContain('--from-api');
    expect(help).toContain('Anthropic models being retired');
    expect(help).toContain('Google Gemini models being shut down');
    const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    expect(version).toBe('0.2.0');
    expect(await run(['--version'])).toMatchObject({ code: EXIT_OK, stdout: `${version}\n` });
  });
});

describe('--skip-rule', () => {
  const gemini = fixture('rules/gemini-nodes.json');

  it('leaves out a rule by ID, which can turn a failing run green, and says so in the header and the JSON', async () => {
    expect((await run([gemini, '--as-of', '2026-10-06'])).code).toBe(EXIT_BREAKING);
    const skipped = await run([gemini, '--as-of', '2026-10-06', '--skip-rule', 'gemini/model-shutdown']);
    expect(skipped.code).toBe(EXIT_OK);
    expect(skipped.stdout).toContain('skipping gemini/model-shutdown');
    expect(skipped.stdout).not.toContain('Gemini API model');
    const { report } = await json([gemini, '--as-of', '2026-10-06', '--skip-rule', 'gemini-model', '--skip-rule', 'gemini-model']);
    expect(report.skipRules).toEqual(['gemini-model']);
    expect(report.findings).toEqual([]);
  });

  it('accepts categories and keeps the other rules', async () => {
    const { report } = await json([fixture('rules/anthropic-review-fixes.json'), '--as-of', '2026-10-06', '--skip-rule', 'anthropic-model']);
    expect(report.findings.every((f: { category: string }) => f.category !== 'anthropic-model')).toBe(true);
  });

  it('rejects an unknown rule and lists the valid ones', async () => {
    const bad = await run([gemini, '--skip-rule', 'gemini']);
    expect(bad.code).toBe(EXIT_ERROR);
    expect(bad.stderr).toContain('--skip-rule does not know "gemini"');
    expect(bad.stderr).toContain('gemini/model-shutdown');
    expect(bad.stderr).toContain('n8n3/removed-node');
  });
});

describe('a registry file from 0.1.x', () => {
  it('warns that Anthropic and Gemini are not checked and leaves them out of the footer', async () => {
    const dir = tempDir();
    try {
      const old = JSON.parse(readFileSync(new URL('../data/sunset-registry.json', import.meta.url), 'utf8'));
      delete old.anthropic;
      delete old.gemini;
      delete old.modelDefaults;
      const file = join(dir, 'old-registry.json');
      writeFileSync(file, JSON.stringify(old));
      const result = await run([fixture('rules/gemini-nodes.json'), '--as-of', '2026-10-06', '--registry', file]);
      expect(result.stderr).toContain('the registry has no anthropic section (it was written for n8n-sunset 0.1), so Anthropic models are not checked.');
      expect(result.stderr).toContain('the registry has no gemini section');
      expect(result.stdout).not.toContain('(Anthropic)');
      expect(result.stdout).not.toContain('(Google Gemini)');
      expect(result.code).toBe(EXIT_OK);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('table wrapping', () => {
  it('never splits a model ID or a host name across lines when the terminal is wide enough', async () => {
    const { stdout } = await run([fixture('rules/gemini-http-code.json'), fixture('rules/anthropic-llm-nodes.json'), '--as-of', '2026-10-06'], { columns: 100 });
    expect(stdout).toContain('generativelanguage.googleapis.com');
    expect(stdout).toContain('"claude-3-5-sonnet-20241022";');
    expect(stdout).not.toMatch(/generativelanguage\.googleap\s*\n/);
  });
});
