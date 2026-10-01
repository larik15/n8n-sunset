import type { Finding } from './findings.js';
import type { Registry, Severity } from './registry.js';
import type { ScanResult } from './scan.js';
import type { LoadResult } from './workflows.js';

type Style = (text: string) => string;

export interface Colors {
  red: Style;
  yellow: Style;
  cyan: Style;
  green: Style;
  magenta: Style;
  dim: Style;
  bold: Style;
}

const ansi = (open: number, close: number): Style => (text) => (text ? `\u001b[${open}m${text}\u001b[${close}m` : text);
const plain: Style = (text) => text;

export function makeColors(enabled: boolean): Colors {
  if (!enabled) return { red: plain, yellow: plain, cyan: plain, green: plain, magenta: plain, dim: plain, bold: plain };
  return {
    red: ansi(31, 39),
    yellow: ansi(33, 39),
    cyan: ansi(36, 39),
    green: ansi(32, 39),
    magenta: ansi(35, 39),
    dim: ansi(2, 22),
    bold: ansi(1, 22),
  };
}

interface Para {
  text: string;
  style?: Style;
}
type Cell = Para[];

interface Column {
  header: string;
  min: number;
  max: number;
}

const GAP = 2;

/** Greedy word wrap; words longer than the width are split. */
export function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (let word of text.split(/\s+/).filter(Boolean)) {
    while (word.length > width) {
      if (line) {
        lines.push(line);
        line = '';
      }
      lines.push(word.slice(0, width));
      word = word.slice(width);
    }
    if (!line) line = word;
    else if (line.length + 1 + word.length <= width) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line || lines.length === 0) lines.push(line);
  return lines;
}

function fitWidths(columns: Column[], cells: Cell[][], total: number): number[] {
  const widths = columns.map((col, i) => {
    const natural = Math.max(col.header.length, ...cells.map((row) => Math.max(0, ...row[i]!.map((p) => p.text.length))));
    return Math.max(col.min, Math.min(col.max, natural));
  });
  const available = total - GAP * (columns.length - 1);
  while (widths.reduce((a, b) => a + b, 0) > available) {
    let widest = -1;
    for (let i = 0; i < widths.length; i++) {
      if (widths[i]! > columns[i]!.min && (widest < 0 || widths[i]! - columns[i]!.min > widths[widest]! - columns[widest]!.min)) widest = i;
    }
    if (widest < 0) break; // every column is at its minimum; let the terminal wrap
    widths[widest]!--;
  }
  return widths;
}

function renderRow(cells: Cell[], widths: number[]): string[] {
  const wrapped = cells.map((cell, i) =>
    cell.flatMap((para) => wrap(para.text, widths[i]!).map((text) => ({ text, style: para.style }))),
  );
  const height = Math.max(...wrapped.map((lines) => lines.length));
  const out: string[] = [];
  for (let r = 0; r < height; r++) {
    const parts = wrapped.map((lines, i) => {
      const line = lines[r];
      const padded = (line?.text ?? '').padEnd(widths[i]!);
      return line?.style ? line.style(padded) : padded;
    });
    out.push(parts.join(' '.repeat(GAP)).trimEnd());
  }
  return out;
}

const SEVERITY_LABEL: Record<Severity, string> = { breaking: 'BREAKING', 'behavior-change': 'CHANGE', info: 'INFO' };

function dateCell(f: Finding, c: Colors): Cell {
  if (f.datePrecision === 'month') {
    const when = f.daysUntil > 0 ? `in ${f.daysUntil}d+` : f.daysUntil > -28 ? 'this month' : 'past';
    return [{ text: f.date }, { text: '(day TBA)', style: c.dim }, { text: when, style: c.dim }];
  }
  if (f.daysUntil < 0) return [{ text: f.date }, { text: `${-f.daysUntil}d ago`, style: c.red }];
  if (f.daysUntil === 0) return [{ text: f.date }, { text: 'today', style: c.red }];
  return [{ text: f.date }, { text: `in ${f.daysUntil}d`, style: f.withinWindow ? c.yellow : c.dim }];
}

function severityStyle(severity: Severity, c: Colors): Style {
  if (severity === 'breaking') return (t) => c.bold(c.red(t));
  return severity === 'behavior-change' ? c.yellow : c.cyan;
}

export interface TableOptions {
  colors: Colors;
  width: number;
}

export function renderTable(result: ScanResult, registry: Registry, load: LoadResult, options: TableOptions): string {
  const c = options.colors;
  const { summary } = result;
  const out: string[] = [];
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

  out.push(
    `${c.bold('n8n-sunset')}  ${c.dim('·')}  ${plural(summary.workflowsScanned, 'workflow')} scanned  ${c.dim('·')}  as of ${result.asOf}  ${c.dim('·')}  window ${result.windowDays} days`,
    '',
  );

  if (result.findings.length === 0) {
    out.push(c.green(`No issues found in ${plural(summary.workflowsScanned, 'workflow')}.`));
  } else {
    const columns: Column[] = [
      { header: 'SEVERITY', min: 8, max: 8 },
      { header: 'DATE', min: 10, max: 10 },
      { header: 'WORKFLOW', min: 10, max: 26 },
      { header: 'NODE', min: 10, max: 24 },
      { header: 'WHAT BREAKS', min: 24, max: 64 },
      { header: 'REPLACEMENT', min: 16, max: 44 },
    ];
    const rows: Cell[][] = result.findings.map((f) => {
      const what: Cell = [{ text: f.message }];
      for (const location of f.locations ?? []) what.push({ text: `at ${location}`, style: c.dim });
      if (f.verification === 'unverified') what.push({ text: '[unverified]', style: c.magenta });
      return [
        [{ text: SEVERITY_LABEL[f.severity], style: severityStyle(f.severity, c) }],
        dateCell(f, c),
        [{ text: f.workflow }],
        [{ text: f.node }, ...(f.nodeDisabled ? [{ text: '(disabled)', style: c.dim }] : [])],
        what,
        [{ text: f.replacement ?? '-' }],
      ];
    });
    const widths = fitWidths(columns, rows, options.width);
    out.push(c.bold(renderRow(columns.map((col) => [{ text: col.header }]), widths)[0]!));
    out.push(c.dim(widths.map((w) => '─'.repeat(w)).join(' '.repeat(GAP))));
    rows.forEach((row, i) => {
      if (i > 0) out.push('');
      out.push(...renderRow(row, widths));
    });
    out.push(
      '',
      `${plural(summary.findings, 'finding')} in ${summary.workflowsAffected} of ${plural(summary.workflowsScanned, 'workflow')}: ` +
        `${summary.breaking} breaking, ${plural(summary.behaviorChanges, 'behavior change')}, ${summary.info} info.`,
    );
    if (result.findings.some((f) => f.verification === 'unverified')) {
      out.push(c.dim('[unverified] = not fully confirmed from the official source; the --json output has the note for each finding.'));
    }
  }

  if (load.skipped.length) out.push(c.dim(`Skipped ${plural(load.skipped.length, 'JSON file')} with no n8n workflow.`));
  if (load.errors.length) out.push(c.yellow(`Could not parse ${plural(load.errors.length, 'file')} (see warnings above).`));

  const { release } = registry.n8n;
  const releaseDate = release.datePrecision === 'month' ? `${release.date} (exact day not announced)` : release.date;
  const openai = registry.sources[registry.openai.source];
  out.push(
    c.dim(
      `Data: n8n ${release.version} is scheduled for ${releaseDate}; ` +
        `OpenAI shutdown dates from ${openai?.url ?? 'the OpenAI deprecations page'}. Registry ${registry.registryVersion}.`,
    ),
    '',
  );

  if (summary.breakingWithinWindow > 0) {
    const one = summary.breakingWithinWindow === 1;
    out.push(
      c.bold(
        c.red(
          `${plural(summary.breakingWithinWindow, 'breaking issue')} ${one ? 'takes' : 'take'} effect within ${result.windowDays} days or already ${one ? 'has' : 'have'}.`,
        ),
      ),
    );
  } else {
    out.push(c.green(`Nothing breaking takes effect within the next ${result.windowDays} days.`));
  }
  return out.join('\n') + '\n';
}

export function toJsonReport(result: ScanResult, registry: Registry, load: LoadResult, meta: { version: string; exitCode: number }) {
  return {
    tool: 'n8n-sunset',
    version: meta.version,
    asOf: result.asOf,
    windowDays: result.windowDays,
    exitCode: meta.exitCode,
    summary: { ...result.summary, filesSkipped: load.skipped.length, fileErrors: load.errors.length },
    registry: {
      version: registry.registryVersion,
      n8nRelease: registry.n8n.release,
      sources: registry.sources,
    },
    findings: result.findings,
    skipped: load.skipped,
    errors: load.errors,
  };
}
