import type { Finding, Status } from './findings.js';
import type { Registry, Severity } from './registry.js';
import type { ScanResult } from './scan.js';
import { displayWidth, padEnd, wrap } from './width.js';
import type { LoadResult } from './workflows.js';

export { wrap } from './width.js';

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
/** Below this width the table no longer fits, so each finding is printed as a block. */
export const STACKED_BELOW = 90;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const SEVERITY_LABEL: Record<Severity, string> = { breaking: 'BREAKING', 'behavior-change': 'CHANGE', warning: 'WARNING', info: 'INFO' };

function severityStyle(severity: Severity, c: Colors): Style {
  if (severity === 'breaking') return (t) => c.bold(c.red(t));
  if (severity === 'behavior-change' || severity === 'warning') return c.yellow;
  return c.cyan;
}

function relative(f: Finding): string {
  if (f.daysUntil === null) return '';
  if (f.daysUntil === 0) return 'today';
  return f.daysUntil < 0 ? `${-f.daysUntil}d ago` : `in ${f.daysUntil}d`;
}

function whenCell(f: Finding, c: Colors): Cell {
  if (f.trigger === 'upgrade') return [{ text: f.when }];
  const style = f.status === 'past' ? c.red : f.withinWindow ? c.yellow : c.dim;
  return [{ text: f.date! }, { text: relative(f), style }];
}

function whenInline(f: Finding): string {
  return f.trigger === 'upgrade' ? f.when : `${f.date} (${relative(f)})`;
}

function workflowCell(f: Finding, c: Colors): Cell {
  const cell: Cell = [{ text: f.workflow }];
  if (f.workflowArchived) cell.push({ text: '(archived)', style: c.dim });
  else if (f.workflowActive === false) cell.push({ text: '(inactive)', style: c.dim });
  return cell;
}

function nodeCell(f: Finding, c: Colors): Cell {
  return f.nodeDisabled ? [{ text: f.node }, { text: '(disabled, not counted)', style: c.dim }] : [{ text: f.node }];
}

function whatCell(f: Finding, c: Colors): Cell {
  const cell: Cell = [{ text: f.message }];
  for (const location of f.locations ?? []) cell.push({ text: `at ${location}`, style: c.dim });
  if (f.verification === 'unverified') cell.push({ text: '[unverified]', style: c.magenta });
  return cell;
}

/** The widest single word in a column: a model ID or host name must not be split across lines. */
function longestWord(cells: Cell[][], i: number): number {
  return Math.max(0, ...cells.flatMap((row) => row[i]!.flatMap((p) => p.text.split(/\s+/).map((w) => displayWidth(w)))));
}

/**
 * Column widths that keep every word whole (a model ID or host name split across lines can't be copied), or
 * undefined when the terminal is too narrow for that; the caller then prints one block per finding instead.
 */
function fitWidths(columns: Column[], cells: Cell[][], total: number): number[] | undefined {
  const widths = columns.map((col, i) => {
    const natural = Math.max(displayWidth(col.header), ...cells.map((row) => Math.max(0, ...row[i]!.map((p) => displayWidth(p.text)))));
    return Math.max(col.min, Math.min(col.max, Math.max(natural, longestWord(cells, i))));
  });
  // Columns shrink to their minimum, but never below their longest word.
  const floor = columns.map((col, i) => Math.min(widths[i]!, Math.max(col.min, longestWord(cells, i))));
  const available = total - GAP * (columns.length - 1);
  while (widths.reduce((a, b) => a + b, 0) > available) {
    let widest = -1;
    for (let i = 0; i < widths.length; i++) {
      if (widths[i]! > floor[i]! && (widest < 0 || widths[i]! - floor[i]! > widths[widest]! - floor[widest]!)) widest = i;
    }
    if (widest < 0) return undefined;
    widths[widest]!--;
  }
  return widths;
}

function renderRow(cells: Cell[], widths: number[]): string[] {
  const wrapped = cells.map((cell, i) => cell.flatMap((para) => wrap(para.text, widths[i]!).map((text) => ({ text, style: para.style }))));
  const height = Math.max(...wrapped.map((lines) => lines.length));
  const out: string[] = [];
  for (let r = 0; r < height; r++) {
    const parts = wrapped.map((lines, i) => {
      const line = lines[r];
      const padded = padEnd(line?.text ?? '', widths[i]!);
      return line?.style ? line.style(padded) : padded;
    });
    out.push(parts.join(' '.repeat(GAP)).trimEnd());
  }
  return out;
}

const COLUMNS: Column[] = [
  { header: 'SEVERITY', min: 8, max: 8 },
  { header: 'WHEN', min: 10, max: 10 },
  { header: 'WORKFLOW', min: 10, max: 26 },
  { header: 'NODE', min: 10, max: 24 },
  { header: 'WHAT BREAKS', min: 24, max: 64 },
  { header: 'REPLACEMENT', min: 16, max: 44 },
];

function tableRow(f: Finding, c: Colors): Cell[] {
  return [
    [{ text: SEVERITY_LABEL[f.severity], style: severityStyle(f.severity, c) }],
    whenCell(f, c),
    workflowCell(f, c),
    nodeCell(f, c),
    whatCell(f, c),
    [{ text: f.replacement ?? '-' }],
  ];
}

/** Column widths sized over every finding, so all sections line up; undefined when words would have to be split. */
function tableWidths(all: Finding[], c: Colors, width: number): number[] | undefined {
  return fitWidths(COLUMNS, all.map((f) => tableRow(f, c)), width);
}

function renderTableRows(findings: Finding[], c: Colors, widths: number[]): string[] {
  const rows = findings.map((f) => tableRow(f, c));
  const out = [c.bold(renderRow(COLUMNS.map((col) => [{ text: col.header }]), widths)[0]!), c.dim(widths.map((w) => '─'.repeat(w)).join(' '.repeat(GAP)))];
  rows.forEach((row, i) => {
    if (i > 0) out.push('');
    out.push(...renderRow(row, widths));
  });
  return out;
}

/** One block per finding, for narrow terminals. */
function renderStacked(findings: Finding[], c: Colors, width: number): string[] {
  const label = 13;
  const valueWidth = Math.max(20, width - label - 2);
  const out: string[] = [];
  const field = (name: string, cell: Cell) => {
    let first = true;
    for (const para of cell) {
      for (const text of wrap(para.text, valueWidth)) {
        const styled = para.style ? para.style(text) : text;
        out.push(`  ${padEnd(first ? name : '', label)}${styled}`.trimEnd());
        first = false;
      }
    }
  };
  findings.forEach((f, i) => {
    if (i > 0) out.push('');
    out.push(`${severityStyle(f.severity, c)(SEVERITY_LABEL[f.severity])}  ${whenInline(f)}`);
    field('Workflow', workflowCell(f, c));
    field('Node', nodeCell(f, c));
    field('What breaks', whatCell(f, c));
    field('Replacement', [{ text: f.replacement ?? '-' }]);
  });
  return out;
}

/** Upcoming first, then already past, then the n8n upgrade grouped so each heading reads as the label. */
const SECTIONS: { title: (upgrade: string) => string; pick: (f: Finding) => boolean }[] = [
  { title: () => 'Upcoming shutdowns', pick: (f) => f.status === 'upcoming' },
  { title: () => 'Already shut down', pick: (f) => f.status === 'past' },
  { title: (v) => `Breaks on upgrade to n8n ${v}`, pick: (f) => f.status === 'on-upgrade' && f.severity === 'breaking' },
  { title: (v) => `Changes on upgrade to n8n ${v}`, pick: (f) => f.status === 'on-upgrade' && f.severity === 'behavior-change' },
  { title: (v) => `Also on upgrade to n8n ${v}`, pick: (f) => f.status === 'on-upgrade' && (f.severity === 'warning' || f.severity === 'info') },
];

export interface TableOptions {
  colors: Colors;
  width: number;
  exitCode: number;
  /** Files that set exit code 2 (unreadable or not a workflow), unless --allow-skipped. */
  failedFiles: number;
}

const HEADER_SEPARATOR = '  ·  ';

/**
 * "n8n-sunset  ·  3 workflows scanned  ·  ..." with the separators intact, broken between
 * segments (never inside one) when the line is wider than the terminal.
 */
function headerLines(segments: string[], width: number, c: Colors): string[] {
  const lines: string[] = [];
  let line = 'n8n-sunset';
  for (const segment of segments) {
    if (displayWidth(line + HEADER_SEPARATOR + segment) <= width) line += HEADER_SEPARATOR + segment;
    else {
      lines.push(line);
      line = segment;
    }
  }
  lines.push(line);
  return lines.map((text, i) => (i === 0 ? text.replace('n8n-sunset', c.bold('n8n-sunset')) : text).replace(/ {2}· {2}/g, `  ${c.dim('·')}  `));
}

export function renderTable(result: ScanResult, registry: Registry, load: LoadResult, options: TableOptions): string {
  const c = options.colors;
  const { summary } = result;
  const upgrade = registry.n8n.release.version;
  const out: string[] = [];
  /** Wraps prose to the terminal width before styling, so long lines stay readable in narrow terminals. */
  const prose = (text: string, style: Style = plain) => out.push(...wrap(text, options.width).map((line) => style(line)));

  const segments = [
    `${plural(summary.workflowsScanned, 'workflow')} scanned`,
    `as of ${result.asOf} (UTC)`,
    `window ${result.windowDays} days`,
    ...(result.targets?.length ? [`target n8n ${result.targets.join(', ')}`] : []),
    ...(result.skipRules?.length ? [`skipping ${result.skipRules.join(', ')}`] : []),
  ];
  out.push(...headerLines(segments, options.width, c), '');

  if (result.findings.length === 0) {
    prose(`No findings in ${plural(summary.workflowsScanned, 'workflow')}.`, c.green);
  } else {
    const widths = options.width < STACKED_BELOW ? undefined : tableWidths(result.findings, c, options.width);
    for (const section of SECTIONS) {
      const findings = result.findings.filter(section.pick);
      if (!findings.length) continue;
      prose(`${section.title(upgrade)} (${plural(findings.length, 'finding')})`, c.bold);
      out.push('', ...(widths ? renderTableRows(findings, c, widths) : renderStacked(findings, c, options.width)), '');
    }
    prose(
      `${plural(summary.findings, 'finding')} in ${plural(summary.nodesAffected, 'node')} across ${plural(summary.workflowsAffected, 'workflow')}: ` +
        `${summary.breaking} breaking, ${plural(summary.behaviorChanges, 'behavior change')}, ${plural(summary.warnings, 'warning')}, ${summary.info} info.`,
    );
    if (result.findings.some((f) => f.verification === 'unverified')) {
      prose('[unverified] = not fully confirmed from the official source; the --json output has the note for each finding.', c.dim);
    }
    if (result.findings.some((f) => f.severity === 'warning')) {
      prose('WARNING = may break, check how the node is used; warnings never fail the run.', c.dim);
    }
  }

  const unread = load.errors.length + load.skipped.length;
  if (unread) prose(`Could not read ${plural(unread, 'file')} as n8n workflows (reasons in the warnings).`, c.yellow);

  const providers: [string, string, string][] = [
    [registry.openai.source, 'OpenAI', 'the OpenAI deprecations page'],
    [registry.anthropic.source, 'Anthropic', 'the Anthropic deprecations page'],
    [registry.gemini.source, 'Google Gemini', 'the Gemini deprecations page'],
  ];
  const dates = providers.filter(([key]) => key).map(([key, name, fallback]) => `${registry.sources[key]?.url ?? fallback} (${name})`);
  const datesText = dates.length > 1 ? `${dates.slice(0, -1).join(', ')} and ${dates.at(-1)}` : (dates[0] ?? 'the providers');
  prose(
    `Data: n8n ${upgrade} changes apply when you upgrade (the release is scheduled for ${registry.n8n.release.date}); ` +
      `model shutdown dates from ${datesText}. Registry ${registry.registryVersion}.`,
    c.dim,
  );
  out.push('');
  for (const [text, style] of resultLines(result, options, c, upgrade)) prose(text, style);
  return out.join('\n') + '\n';
}

/** The closing lines that explain the exit code, as [text, style] pairs. */
function resultLines(result: ScanResult, options: TableOptions, c: Colors, upgrade: string): [string, Style][] {
  const { summary, findings } = result;
  const lines: [string, Style][] = [];
  const alarm: Style = (t) => c.bold(c.red(t));
  const targeted = result.targets?.includes(upgrade);
  if (summary.exitFindings > 0) {
    const one = summary.exitFindings === 1;
    const [take, have, brk] = one ? ['takes', 'has', 'breaks'] : ['take', 'have', 'break'];
    const reason = targeted
      ? `${take} effect within ${result.windowDays} days, already ${have}, or ${brk} on upgrade to n8n ${upgrade}`
      : `${take} effect within ${result.windowDays} days or already ${have}`;
    lines.push([
      `${plural(summary.exitFindings, 'breaking finding')} in ${plural(summary.exitNodes, 'node')} across ${plural(summary.exitWorkflows, 'workflow')} ${reason}.`,
      alarm,
    ]);
  } else {
    lines.push([`No breaking findings take effect within the next ${result.windowDays} days.`, c.green]);
  }
  const disabled = findings.filter((f) => f.severity === 'breaking' && f.nodeDisabled && (f.withinWindow || (targeted && f.trigger === 'upgrade'))).length;
  if (disabled) lines.push([`${plural(disabled, 'breaking finding')} on disabled nodes ${disabled === 1 ? 'is' : 'are'} not counted.`, c.dim]);
  if (!targeted) {
    const onUpgrade = findings.filter((f) => f.severity === 'breaking' && f.trigger === 'upgrade');
    if (onUpgrade.length) {
      const one = onUpgrade.length === 1;
      const nodes = new Set(onUpgrade.map((f) => `${f.file}\u0000${f.workflow}\u0000${f.node}`)).size;
      lines.push([
        `${plural(onUpgrade.length, 'breaking finding')} in ${plural(nodes, 'node')} ${one ? 'breaks' : 'break'} on upgrade to n8n ${upgrade}; ` +
          `add --target ${upgrade} to fail on ${one ? 'it' : 'them'}.`,
        c.yellow,
      ]);
    }
  }
  if (options.failedFiles > 0 && options.exitCode === 2) {
    lines.push([`Exit code 2: ${plural(options.failedFiles, 'file')} could not be read as n8n workflows; pass --allow-skipped to ignore them.`, alarm]);
  }
  return lines;
}

export function toJsonReport(
  result: ScanResult,
  registry: Registry,
  load: LoadResult,
  meta: { version: string; exitCode: number; warnings: string[] },
) {
  return {
    tool: 'n8n-sunset',
    version: meta.version,
    asOf: result.asOf,
    windowDays: result.windowDays,
    targets: result.targets ?? [],
    skipRules: result.skipRules ?? [],
    exitCode: meta.exitCode,
    summary: { ...result.summary, filesSkipped: load.skipped.length, fileErrors: load.errors.length, symlinksNotFollowed: load.symlinks.length },
    registry: {
      version: registry.registryVersion,
      n8nRelease: registry.n8n.release,
      sources: registry.sources,
    },
    findings: result.findings,
    warnings: meta.warnings,
    skipped: load.skipped,
    errors: load.errors,
    symlinks: load.symlinks,
  };
}
