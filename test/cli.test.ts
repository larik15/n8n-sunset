import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { EXIT_BREAKING, EXIT_ERROR, EXIT_OK, main } from '../src/cli.js';
import { displayWidth } from '../src/width.js';
import { AS_OF, fixture } from './helpers.js';

const ANSI = /\u001b\[[0-9;]*m/g;

function run(args: string[], options: { env?: Record<string, string>; columns?: number; now?: Date } = {}) {
  let stdout = '';
  let stderr = '';
  const code = main(args, {
    stdout: { write: (text: string) => (stdout += text), isTTY: false, columns: options.columns ?? 160 },
    stderr: { write: (text: string) => (stderr += text) },
    cwd: process.cwd(),
    env: options.env ?? {},
    now: options.now ?? new Date(Date.UTC(2026, 9, 1, 12, 0, 0)),
  });
  return { code, stdout, stderr };
}

const json = (args: string[], options?: Parameters<typeof run>[1]) => {
  const result = run([...args, '--json'], options);
  return { ...result, report: JSON.parse(result.stdout) };
};

describe('table output', () => {
  const { code, stdout } = run([fixture('rules'), '--as-of', AS_OF]);

  it('exits 1 when an OpenAI shutdown takes effect within 30 days or already has', () => {
    expect(code).toBe(EXIT_BREAKING);
    for (const text of ['SEVERITY', 'WHEN', 'WORKFLOW', 'NODE', 'WHAT BREAKS', 'REPLACEMENT', 'Lead scoring', 'GPT-4 chat model', 'gpt-5.6-sol']) {
      expect(stdout).toContain(text);
    }
    expect(stdout).toContain('[unverified]');
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

  it('labels n8n 3.0 findings by the upgrade instead of a date', () => {
    expect(stdout).toMatch(/^Breaks on upgrade to n8n 3\.0 \(\d+ findings\)$/m);
    expect(stdout).toMatch(/^Changes on upgrade to n8n 3\.0 \(\d+ findings\)$/m);
    const stacked = run([fixture('rules/removed-nodes.json'), '--as-of', AS_OF], { columns: 80 }).stdout;
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
    expect(stdout).toContain('(disabled, not counted)');
    expect(stdout).toContain('(archived)');
  });

  it('never prints a month label, even at the end of the month', () => {
    const late = run([fixture('rules'), '--as-of', '2026-10-31']).stdout;
    expect(late).not.toContain('this month');
    expect(late).toContain('Breaks on upgrade to n8n 3.0 (');
    expect(json([fixture('rules/removed-nodes.json'), '--as-of', '2026-10-31']).report.findings[0].when).toBe('breaks on upgrade to n8n 3.0');
  });

  it('keeps every table line within the terminal width', () => {
    const narrow = run([fixture('rules'), '--as-of', AS_OF], { columns: 100 }).stdout;
    for (const line of narrow.split('\n')) expect(displayWidth(line.replace(ANSI, '')), line).toBeLessThanOrEqual(100);
  });

  it('switches to a stacked layout below 90 columns', () => {
    const stacked = run([fixture('rules/openai-llm-nodes.json'), '--as-of', AS_OF], { columns: 80 }).stdout;
    expect(stacked).not.toContain('SEVERITY');
    expect(stacked).toMatch(/^BREAKING {2}2026-10-23 \(in 22d\)$/m);
    expect(stacked).toMatch(/^ {2}Workflow {5}Lead scoring$/m);
    expect(stacked).toMatch(/^ {2}Replacement {2}gpt-5\.6-sol$/m);
    // Every line fits, including the header and the closing summary.
    for (const line of stacked.split('\n')) expect(displayWidth(line), line).toBeLessThanOrEqual(80);
    const tiny = run([fixture('rules'), '--as-of', AS_OF, '--target', '3.0'], { columns: 50 }).stdout;
    for (const line of tiny.split('\n')) expect(displayWidth(line), line).toBeLessThanOrEqual(50);
  });

  it('aligns columns by display width when names contain emoji or CJK', () => {
    const out = run([fixture('cli/emoji.json'), '--as-of', AS_OF]).stdout.split('\n');
    const header = out.find((line) => line.includes('WHAT BREAKS'))!;
    const row = out.find((line) => line.includes('🤖 Bot ✅'))!;
    const column = displayWidth(header.slice(0, header.indexOf('WHAT BREAKS')));
    expect(displayWidth(row.slice(0, row.indexOf('OpenAI shuts')))).toBe(column);
  });

  it('reports a clean workflow', () => {
    const clean = run([fixture('rules/clean.json')]);
    expect(clean.code).toBe(EXIT_OK);
    expect(clean.stdout).toContain('No findings in 1 workflow.');
    expect(clean.stdout).toContain('No breaking findings take effect within the next 30 days.');
  });

  it('uses colors only on a TTY or with FORCE_COLOR, never with NO_COLOR, FORCE_COLOR=0 or --no-color', () => {
    const target = fixture('rules/gmail-trigger.json');
    expect(run([target]).stdout).not.toMatch(ANSI);
    expect(run([target], { env: { FORCE_COLOR: '1' } }).stdout).toMatch(ANSI);
    expect(run([target], { env: { FORCE_COLOR: '0' } }).stdout).not.toMatch(ANSI);
    expect(run([target], { env: { FORCE_COLOR: '1', NO_COLOR: '1' } }).stdout).not.toMatch(ANSI);
    expect(run([target], { env: { FORCE_COLOR: '1', NO_COLOR: '' } }).stdout).toMatch(ANSI);
    expect(run([target, '--no-color'], { env: { FORCE_COLOR: '1' } }).stdout).not.toMatch(ANSI);
  });
});

describe('--json', () => {
  it('prints every finding with workflow, node, what breaks, when and replacement', () => {
    const { code, report } = json([fixture('rules'), '--as-of', AS_OF]);
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

  it('defaults the as-of date to today in UTC', () => {
    // 23:30 UTC on Sep 30: already Oct 1 east of UTC, but the report uses the UTC day.
    expect(json([fixture('rules/clean.json')], { now: new Date(Date.UTC(2026, 8, 30, 23, 30)) }).report.asOf).toBe('2026-09-30');
  });

  it('prints errors as JSON on stdout', () => {
    for (const args of [['does-not-exist'], [fixture('rules'), '--frobnicate'], [fixture('rules'), '--target', '4.0']]) {
      const { code, stdout, stderr } = run([...args, '--json']);
      expect(code, args.join(' ')).toBe(EXIT_ERROR);
      expect(stderr).toBe('');
      expect(JSON.parse(stdout)).toMatchObject({ tool: 'n8n-sunset', error: { message: expect.any(String) }, exitCode: EXIT_ERROR });
    }
  });
});

describe('exit code', () => {
  // The only finding is the gpt-4 alias, shut down on 2026-10-23.
  const gpt4 = fixture('cli/gpt-4-alias.json');

  it('ignores shutdowns beyond the window and honors --days', () => {
    expect(run([gpt4, '--as-of', '2026-09-01']).code).toBe(EXIT_OK);
    expect(run([gpt4, '--as-of', '2026-09-01', '--days', '60']).code).toBe(EXIT_BREAKING);
  });

  it('words a single breaking finding in the singular', () => {
    expect(run([gpt4, '--as-of', AS_OF]).stdout).toContain('1 breaking finding in 1 node across 1 workflow takes effect within 30 days or already has.');
  });

  it('words a single n8n 3.0 breaking finding in the singular', () => {
    expect(run([fixture('rules/ai-agent-v1.json'), '--as-of', AS_OF]).stdout).toContain(
      '2 breaking findings in 2 nodes break on upgrade to n8n 3.0; add --target 3.0 to fail on them.',
    );
    expect(run([fixture('rules/code-evaluate-expression.json'), '--as-of', AS_OF]).stdout).toContain(
      '1 breaking finding in 1 node breaks on upgrade to n8n 3.0; add --target 3.0 to fail on it.',
    );
  });

  it('counts shutdowns that already happened', () => {
    expect(run([fixture('rules/openai-code.json'), '--as-of', AS_OF, '--days', '0']).code).toBe(EXIT_BREAKING);
  });

  it('does not fail on behavior changes, warnings or info alone', () => {
    expect(run([fixture('rules/gmail-trigger.json'), '--as-of', AS_OF]).code).toBe(EXIT_OK);
    expect(run([fixture('rules/openai-other-nodes.json'), '--as-of', AS_OF]).code).toBe(EXIT_OK);
  });

  it('does not count n8n 3.0 breaking changes unless --target 3.0 is given', () => {
    const removed = fixture('rules/removed-nodes.json');
    expect(run([removed, '--as-of', AS_OF]).code).toBe(EXIT_OK);
    const targeted = run([removed, '--as-of', AS_OF, '--target', '3.0']);
    expect(targeted.code).toBe(EXIT_BREAKING);
    expect(targeted.stdout).toContain('5 breaking findings in 5 nodes across 1 workflow take effect within 30 days, already have, or break on upgrade to n8n 3.0.');
    expect(targeted.stdout).toContain('target n8n 3.0');
  });

  it('does not count findings on disabled nodes', () => {
    const { code, stdout } = run([fixture('rules/workflow-flags.json'), '--as-of', AS_OF]);
    expect(code).toBe(EXIT_OK);
    expect(stdout).toContain('1 breaking finding on disabled nodes is not counted.');
    expect(stdout).toContain('(archived)');
  });
});

describe('registry age', () => {
  const target = fixture('rules/clean.json');

  it('warns when the registry is more than 30 days older than --as-of', () => {
    expect(run([target, '--as-of', '2026-10-31']).stderr).toBe('');
    const old = run([target, '--as-of', '2026-11-15']);
    expect(old.code).toBe(EXIT_OK);
    expect(old.stderr).toContain('the bundled registry is from 2026-10-01, 45 days before 2026-11-15');
    expect(old.stderr).toContain('Update n8n-sunset.');
  });

  it('puts the warning in the JSON report', () => {
    const { stderr, report } = json([target, '--as-of', '2026-11-15']);
    expect(stderr).toBe('');
    expect(report.warnings).toEqual([expect.stringContaining('Update n8n-sunset.')]);
  });
});

describe('input formats', () => {
  it('reads exported arrays, API pages, n8n.io templates and nested folders, skipping node_modules', () => {
    const { report } = json([fixture('formats'), '--as-of', AS_OF, '--allow-skipped']);
    expect(report.summary.workflowsScanned).toBe(5);
    const workflows = new Set(report.findings.map((f: { workflow: string }) => f.workflow));
    expect(workflows).toEqual(new Set(['Second exported workflow', 'From the n8n API', 'inner.json', 'Template: summarize support tickets']));
  });

  it('exits 2 for unreadable files and files that are not workflows, explaining why', () => {
    const { code, stdout, stderr } = run([fixture('formats'), '--as-of', AS_OF]);
    expect(code).toBe(EXIT_ERROR);
    expect(stderr).toContain('warning: could not parse test/fixtures/formats/broken.json');
    expect(stderr).toContain('warning: skipped test/fixtures/formats/not-a-workflow.json: JSON object without a "nodes" array');
    expect(stdout).toContain('Exit code 2: 2 files could not be read as n8n workflows; pass --allow-skipped to ignore them.');

    const { report } = json([fixture('formats'), '--as-of', AS_OF]);
    expect(report.exitCode).toBe(EXIT_ERROR);
    expect(report.skipped).toEqual([{ file: 'test/fixtures/formats/not-a-workflow.json', reason: 'JSON object without a "nodes" array' }]);
    expect(report.errors).toMatchObject([{ file: 'test/fixtures/formats/broken.json' }]);
  });

  it('uses the findings for the exit code with --allow-skipped', () => {
    // The template's gpt-3.5-turbo shuts down on 2026-10-23.
    expect(run([fixture('formats'), '--as-of', AS_OF, '--allow-skipped']).code).toBe(EXIT_BREAKING);
  });

  describe('symbolic links', () => {
    const dir = mkdtempSync(join(tmpdir(), 'n8n-sunset-'));
    afterAll(() => rmSync(dir, { recursive: true, force: true }));
    writeFileSync(join(dir, 'real.json'), JSON.stringify({ name: 'Real', nodes: [] }));
    mkdirSync(join(dir, 'elsewhere'));
    let linked = true;
    try {
      // A junction needs no special rights on Windows; elsewhere it is an ordinary symlink.
      symlinkSync(join(dir, 'elsewhere'), join(dir, 'linked'), 'junction');
    } catch {
      linked = false;
    }

    it.skipIf(!linked)('warns about links it does not follow', () => {
      const { code, stderr } = run([dir, '--as-of', AS_OF]);
      expect(code).toBe(EXIT_OK);
      expect(stderr).toMatch(/warning: did not follow symbolic link .*linked/);
    });
  });
});

describe('usage errors', () => {
  it.each([
    [[], 'missing path'],
    [['does-not-exist'], 'Path not found: does-not-exist'],
    [[fixture('formats/not-a-workflow.json')], 'skipped'],
    [[fixture('rules'), '--days', 'soon'], '--days must be a whole number'],
    [[fixture('rules'), '--as-of', '2026-13-01'], '--as-of must be a date'],
    [[fixture('rules'), '--target', '4.0'], '--target supports 3.0'],
    [[fixture('rules'), '--frobnicate'], "Unknown option '--frobnicate'"],
  ])('exits 2 for %j', (args, message) => {
    const { code, stderr } = run(args as string[]);
    expect(code).toBe(EXIT_ERROR);
    expect(stderr).toContain(message);
  });

  it('prints help and version', () => {
    expect(run(['--help'])).toMatchObject({ code: EXIT_OK, stdout: expect.stringContaining('Usage: n8n-sunset <path...>') });
    expect(run(['--version'])).toMatchObject({ code: EXIT_OK, stdout: '0.1.0\n' });
  });
});
