import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { main } from '../src/cli.js';

const README = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

/** The command line and output inside a README code block between <!-- name:start --> and <!-- name:end -->. */
function example(name: string): { args: string[]; pipe?: string; output: string } {
  const block = new RegExp(`<!-- ${name}:start -->\\n\`\`\`\\n([\\s\\S]*?)\\n\`\`\`\\n<!-- ${name}:end -->`).exec(README.replace(/\r\n/g, '\n'));
  if (!block) throw new Error(`README has no ${name} block`);
  const [command, ...rest] = block[1]!.split('\n');
  const m = /^\$ npx n8n-sunset@latest (.*?)(?: \| (.*))?$/.exec(command!);
  if (!m) throw new Error(`Unexpected command line: ${command}`);
  return { args: m[1]!.split(' '), pipe: m[2], output: rest.join('\n').replace(/^\n/, '') };
}

function run(args: string[], columns: number) {
  let stdout = '';
  const code = main(args, {
    stdout: { write: (text: string) => (stdout += text), isTTY: false, columns },
    stderr: { write: () => undefined },
    cwd: process.cwd(),
    env: {},
    now: new Date(Date.UTC(2026, 9, 2, 12)),
  });
  return { code, stdout };
}

describe('README examples', () => {
  it('shows the real table output for the example workflows (100 columns)', () => {
    const { args, output } = example('example-table');
    const { code, stdout } = run(args, 100);
    expect(code).toBe(1);
    expect(output).toBe(stdout.replace(/\n$/, ''));
  });

  it('shows the real JSON output, selected the way the jq filter in the README does', () => {
    const { args, pipe, output } = example('example-json');
    expect(pipe).toBe("jq '{exitCode, summary, firstFinding: .findings[0]}'");
    const report = JSON.parse(run(args, 100).stdout);
    const selected = { exitCode: report.exitCode, summary: report.summary, firstFinding: report.findings[0] };
    expect(output).toBe(JSON.stringify(selected, null, 2));
  });
});
