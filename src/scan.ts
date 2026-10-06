import { daysBetween } from './dates.js';
import type { Finding, Status } from './findings.js';
import type { Registry, Severity } from './registry.js';
import { checkN8nNode } from './rules/n8n.js';
import { buildModelIndex, checkOpenAiModels } from './rules/openai.js';
import { checkOpenAiEndpoints } from './rules/openai-endpoints.js';
import { buildProviderIndex, checkProviderModels } from './rules/providers.js';
import type { Workflow } from './workflows.js';

export interface ScanOptions {
  /** Date to measure from, YYYY-MM-DD (UTC). */
  asOf: string;
  /** Date findings that take effect within this many days (or already have) are "within the window". */
  windowDays: number;
  /** n8n versions you plan to upgrade to (e.g. ["3.0"]): their breaking findings also set the exit code. */
  targets?: string[];
}

export interface ScanSummary {
  workflowsScanned: number;
  findings: number;
  nodesAffected: number;
  workflowsAffected: number;
  breaking: number;
  behaviorChanges: number;
  warnings: number;
  info: number;
  upcoming: number;
  past: number;
  onUpgrade: number;
  /** Findings that set exit code 1: breaking, on an enabled node, and within the window (or on a targeted upgrade). */
  exitFindings: number;
  exitNodes: number;
  exitWorkflows: number;
}

export interface ScanResult extends ScanOptions {
  findings: Finding[];
  summary: ScanSummary;
}

/** "breaks on upgrade to n8n 3.0", "changes on upgrade to n8n 3.0", or "on upgrade to n8n 3.0". */
export function upgradeLabel(severity: Severity, version: string): string {
  const verb = severity === 'breaking' ? 'breaks on' : severity === 'behavior-change' ? 'changes on' : 'on';
  return `${verb} upgrade to n8n ${version}`;
}

const SEVERITY_RANK: Record<Severity, number> = { breaking: 0, 'behavior-change': 1, warning: 2, info: 3 };
const STATUS_RANK: Record<Status, number> = { upcoming: 0, past: 1, 'on-upgrade': 2 };

const nodeKey = (f: Finding) => `${f.file}\u0000${f.workflow}\u0000${f.node}`;
const workflowKey = (f: Finding) => `${f.file}\u0000${f.workflow}`;

/**
 * Upcoming shutdowns first (soonest first), then ones already past (most recent first),
 * then changes that apply when you upgrade n8n.
 */
function compareFindings(a: Finding, b: Finding): number {
  const byStatus = STATUS_RANK[a.status] - STATUS_RANK[b.status];
  if (byStatus) return byStatus;
  const byDays = a.status === 'past' ? (b.daysUntil ?? 0) - (a.daysUntil ?? 0) : (a.daysUntil ?? 0) - (b.daysUntil ?? 0);
  return (
    byDays ||
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
    a.workflow.localeCompare(b.workflow) ||
    a.node.localeCompare(b.node) ||
    a.message.localeCompare(b.message)
  );
}

export function scanWorkflows(workflows: Workflow[], registry: Registry, options: ScanOptions): ScanResult {
  const targets = options.targets ?? [];
  const index = buildModelIndex(registry.openai.models, registry.openai.legacyFineTunes);
  const anthropic = buildProviderIndex('anthropic', registry.anthropic.models);
  const gemini = buildProviderIndex('gemini', registry.gemini.models);
  const findings: Finding[] = [];

  for (const workflow of workflows) {
    for (const node of workflow.nodes) {
      const ruleFindings = [
        ...checkN8nNode(node, registry),
        ...checkOpenAiModels(node, registry, index, options.asOf),
        ...checkOpenAiEndpoints(node, registry, options.asOf),
        ...checkProviderModels(node, registry, anthropic, options.asOf),
        ...checkProviderModels(node, registry, gemini, options.asOf),
      ];
      for (const { trigger, ...f } of ruleFindings) {
        const daysUntil = trigger.kind === 'date' ? daysBetween(options.asOf, trigger.date) : null;
        const status: Status = trigger.kind === 'upgrade' ? 'on-upgrade' : daysUntil! <= 0 ? 'past' : 'upcoming';
        const withinWindow = daysUntil !== null && daysUntil <= options.windowDays;
        const nodeDisabled = node.disabled === true;
        // Disabled nodes never run, so they are reported but do not fail the run.
        const countsTowardExit =
          f.severity === 'breaking' && !nodeDisabled && (withinWindow || (trigger.kind === 'upgrade' && targets.includes(trigger.version)));
        findings.push({
          ...f,
          workflow: workflow.name,
          ...(workflow.id ? { workflowId: workflow.id } : {}),
          ...(workflow.active !== undefined ? { workflowActive: workflow.active } : {}),
          ...(workflow.archived ? { workflowArchived: true } : {}),
          file: workflow.file,
          node: node.name,
          nodeType: node.type,
          nodeDisabled,
          trigger: trigger.kind,
          date: trigger.kind === 'date' ? trigger.date : null,
          ...(trigger.kind === 'upgrade' ? { upgradeTo: trigger.version } : {}),
          when: trigger.kind === 'date' ? trigger.date : upgradeLabel(f.severity, trigger.version),
          daysUntil,
          status,
          withinWindow,
          countsTowardExit,
        });
      }
    }
  }

  findings.sort(compareFindings);

  const count = (pick: (f: Finding) => boolean) => findings.filter(pick).length;
  const distinct = (list: Finding[], key: (f: Finding) => string) => new Set(list.map(key)).size;
  const exit = findings.filter((f) => f.countsTowardExit);
  return {
    ...options,
    targets,
    findings,
    summary: {
      workflowsScanned: workflows.length,
      findings: findings.length,
      nodesAffected: distinct(findings, nodeKey),
      workflowsAffected: distinct(findings, workflowKey),
      breaking: count((f) => f.severity === 'breaking'),
      behaviorChanges: count((f) => f.severity === 'behavior-change'),
      warnings: count((f) => f.severity === 'warning'),
      info: count((f) => f.severity === 'info'),
      upcoming: count((f) => f.status === 'upcoming'),
      past: count((f) => f.status === 'past'),
      onUpgrade: count((f) => f.status === 'on-upgrade'),
      exitFindings: exit.length,
      exitNodes: distinct(exit, nodeKey),
      exitWorkflows: distinct(exit, workflowKey),
    },
  };
}
