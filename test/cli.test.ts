import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EXIT_BREAKING, EXIT_ERROR, EXIT_OK, main } from '../src/cli.js';
import { AS_OF, fixture } from './helpers.js';

const ANSI = /\u001b\[[0-9;]*m/g;

function run(args: string[], options: { env?: Record<string, string>; columns?: number } = {}) {
  let stdout = '';
  let stderr = '';
  const code = main(args, {
    stdout: { write: (text: string) => (stdout += text), isTTY: false, columns: options.columns ?? 160 },
    stderr: { write: (text: string) => (stderr += text) },
    cwd: process.cwd(),
    env: options.env ?? {},
    now: new Date(2026, 9, 1, 12, 0, 0),
  });
  return { code, stdout, stderr };
}

describe('table output', () => {
  it('prints a table and exits 1 when something breaks within 30 days', () => {
    const { code, stdout } = run([fixture('rules'), '--as-of', AS_OF]);
    expect(code).toBe(EXIT_BREAKING);
    for (const text of ['SEVERITY', 'DATE', 'WORKFLOW', 'NODE', 'WHAT BREAKS', 'REPLACEMENT', 'Lead scoring', 'GPT-4 chat model', 'gpt-5.6-sol']) {
      expect(stdout).toContain(text);
    }
    expect(stdout).toMatch(/\d+ breaking issues take effect within 30 days or already have\./);
    expect(stdout).toContain('[unverified]');
  });

  it('keeps every line within the terminal width', () => {
    const { stdout } = run([fixture('rules'), '--as-of', AS_OF], { columns: 100 });
    for (const line of stdout.split('\n')) {
      if (line.startsWith('Data:') || line.startsWith('[unverified]')) continue; // footnotes are prose
      expect(line.replace(ANSI, '').length, line).toBeLessThanOrEqual(100);
    }
  });

  it('reports a clean folder', () => {
    const { code, stdout } = run([fixture('rules/clean.json')]);
    expect(code).toBe(EXIT_OK);
    expect(stdout).toContain('No issues found in 1 workflow.');
    expect(stdout).toContain('Nothing breaking takes effect within the next 30 days.');
  });

  it('uses colors only on a TTY or with FORCE_COLOR, and never with NO_COLOR or --no-color', () => {
    const target = fixture('rules/gmail-trigger.json');
    expect(run([target]).stdout).not.toMatch(ANSI);
    expect(run([target], { env: { FORCE_COLOR: '1' } }).stdout).toMatch(ANSI);
    expect(run([target], { env: { FORCE_COLOR: '1', NO_COLOR: '1' } }).stdout).not.toMatch(ANSI);
    expect(run([target, '--no-color'], { env: { FORCE_COLOR: '1' } }).stdout).not.toMatch(ANSI);
  });
});

describe('--json', () => {
  it('prints every finding with workflow, node, what breaks, date and replacement', () => {
    const { code, stdout } = run([fixture('rules'), '--json', '--as-of', AS_OF]);
    const report = JSON.parse(stdout);
    expect(code).toBe(EXIT_BREAKING);
    expect(report).toMatchObject({ tool: 'n8n-sunset', asOf: AS_OF, windowDays: 30, exitCode: EXIT_BREAKING });
    expect(report.summary.workflowsScanned).toBe(readdirSync(fixture('rules')).length);
    expect(report.findings.length).toBe(report.summary.findings);
    for (const f of report.findings) {
      expect(f).toEqual(expect.objectContaining({ workflow: expect.any(String), node: expect.any(String), message: expect.any(String), date: expect.any(String) }));
      expect(f).toHaveProperty('replacement');
    }
    expect(report.registry.sources['openai-deprecations'].accessed).toBe('2026-10-01');
  });

  it('defaults the as-of date to today', () => {
    expect(JSON.parse(run([fixture('rules/clean.json'), '--json']).stdout).asOf).toBe('2026-10-01');
  });
});

describe('exit code window', () => {
  // The only finding is the gpt-4 alias, shut down on 2026-10-23.
  const target = fixture('rules/openai-other-nodes.json');

  it('ignores shutdowns beyond the window', () => {
    expect(run([target, '--as-of', '2026-09-01']).code).toBe(EXIT_OK);
  });

  it('words a single breaking issue in the singular', () => {
    expect(run([target, '--as-of', AS_OF]).stdout).toContain('1 breaking issue takes effect within 30 days or already has.');
  });

  it('honors --days', () => {
    expect(run([target, '--as-of', '2026-09-01', '--days', '60']).code).toBe(EXIT_BREAKING);
  });

  it('counts shutdowns that already happened', () => {
    expect(run([fixture('rules/openai-code.json'), '--as-of', AS_OF, '--days', '0']).code).toBe(EXIT_BREAKING);
  });

  it('does not fail on behavior changes alone', () => {
    expect(run([fixture('rules/gmail-trigger.json'), '--as-of', AS_OF]).code).toBe(EXIT_OK);
  });
});

describe('input formats', () => {
  const { code, stdout, stderr } = run([fixture('formats'), '--json', '--as-of', AS_OF]);
  const report = JSON.parse(stdout);

  it('reads exported arrays, API pages and nested folders, skipping node_modules', () => {
    expect(code).toBe(EXIT_BREAKING);
    expect(report.summary.workflowsScanned).toBe(4);
    const workflows = new Set(report.findings.map((f: { workflow: string }) => f.workflow));
    expect(workflows).toEqual(new Set(['Second exported workflow', 'From the n8n API', 'inner.json']));
  });

  it('skips JSON that is not a workflow and warns about broken files', () => {
    expect(report.skipped).toEqual(['test/fixtures/formats/not-a-workflow.json']);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0].file).toBe('test/fixtures/formats/broken.json');
    expect(stderr).toContain('warning: could not parse test/fixtures/formats/broken.json');
  });
});

describe('usage errors', () => {
  it.each([
    [[], 'missing path'],
    [['does-not-exist'], 'Path not found: does-not-exist'],
    [[fixture('formats/not-a-workflow.json')], 'no n8n workflows found'],
    [[fixture('rules'), '--days', 'soon'], '--days must be a whole number'],
    [[fixture('rules'), '--as-of', '2026-13-01'], '--as-of must be a date'],
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
