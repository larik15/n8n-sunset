import { daysBetween, effectiveDay } from './dates.js';
import type { Finding } from './findings.js';
import type { Registry, Severity } from './registry.js';
import { checkN8nNode } from './rules/n8n.js';
import { buildModelIndex, checkOpenAiModels } from './rules/openai.js';
import type { Workflow } from './workflows.js';

export interface ScanOptions {
  /** Date to measure from, YYYY-MM-DD. */
  asOf: string;
  /** Findings that take effect within this many days (or already have) are "within the window". */
  windowDays: number;
}

export interface ScanSummary {
  workflowsScanned: number;
  workflowsAffected: number;
  findings: number;
  breaking: number;
  behaviorChanges: number;
  info: number;
  /** Breaking findings that take effect within the window or already have. These set exit code 1. */
  breakingWithinWindow: number;
}

export interface ScanResult extends ScanOptions {
  findings: Finding[];
  summary: ScanSummary;
}

const SEVERITY_RANK: Record<Severity, number> = { breaking: 0, 'behavior-change': 1, info: 2 };

export function scanWorkflows(workflows: Workflow[], registry: Registry, options: ScanOptions): ScanResult {
  const index = buildModelIndex(registry.openai.models);
  const findings: Finding[] = [];

  for (const workflow of workflows) {
    for (const node of workflow.nodes) {
      const ruleFindings = [...checkN8nNode(node, registry), ...checkOpenAiModels(node, registry, index, options.asOf)];
      for (const f of ruleFindings) {
        const daysUntil = daysBetween(options.asOf, effectiveDay(f.date, f.datePrecision));
        findings.push({
          ...f,
          workflow: workflow.name,
          ...(workflow.id ? { workflowId: workflow.id } : {}),
          file: workflow.file,
          node: node.name,
          nodeType: node.type,
          nodeDisabled: node.disabled === true,
          daysUntil,
          withinWindow: daysUntil <= options.windowDays,
        });
      }
    }
  }

  findings.sort(
    (a, b) =>
      a.daysUntil - b.daysUntil ||
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      a.workflow.localeCompare(b.workflow) ||
      a.node.localeCompare(b.node) ||
      a.message.localeCompare(b.message),
  );

  const count = (severity: Severity) => findings.filter((f) => f.severity === severity).length;
  return {
    ...options,
    findings,
    summary: {
      workflowsScanned: workflows.length,
      workflowsAffected: new Set(findings.map((f) => `${f.file}\u0000${f.workflow}`)).size,
      findings: findings.length,
      breaking: count('breaking'),
      behaviorChanges: count('behavior-change'),
      info: count('info'),
      breakingWithinWindow: findings.filter((f) => f.severity === 'breaking' && f.withinWindow).length,
    },
  };
}
