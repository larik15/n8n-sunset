import type { RuleFinding } from '../findings.js';
import type { NodeChange, Registry } from '../registry.js';
import { sourceUrls } from '../registry.js';
import { stringLeaves } from '../walk.js';
import type { WorkflowNode } from '../workflows.js';

export const STICKY_NOTE = 'n8n-nodes-base.stickyNote';

interface Detection {
  /** Extra context appended to the message, e.g. "typeVersion 1.7". */
  detail?: string;
  locations?: string[];
  /** Set when the match relies on something the official page does not state. */
  unverifiedNote?: string;
}

type Detector = (node: WorkflowNode, change: NodeChange) => Detection | null;

const version = (node: WorkflowNode) => node.typeVersion ?? 1;
const params = (node: WorkflowNode) => node.parameters ?? {};
const appliesTo = (change: NodeChange, node: WorkflowNode) =>
  change.nodeTypes.includes('*') ? node.type !== STICKY_NOTE : change.nodeTypes.includes(node.type);

/**
 * How each change in the registry is detected in workflow JSON. n8n leaves parameters at
 * their default value out of exports, so a missing parameter means the default.
 */
export const DETECTORS: Record<string, Detector> = {
  'ai-agent-v1': (node, change) =>
    appliesTo(change, node) && version(node) < 2 ? { detail: `typeVersion ${version(node)}` } : null,

  'execute-workflow-source': (node, change) => {
    const source = params(node).source;
    return appliesTo(change, node) && (source === 'localFile' || source === 'url') ? { detail: `source: ${source}` } : null;
  },

  'get-paired-item': (node, change) => {
    if (!appliesTo(change, node)) return null;
    const paths = [...stringLeaves(node.parameters)].filter((leaf) => leaf.value.includes('$getPairedItem')).map((leaf) => leaf.path);
    return paths.length ? { locations: paths } : null;
  },

  'code-evaluate-expression': (node, change) => {
    const { language = 'javaScript', jsCode } = params(node);
    return appliesTo(change, node) && language === 'javaScript' && typeof jsCode === 'string' && /\$evaluateExpression\s*\(/.test(jsCode)
      ? { locations: ['jsCode'] }
      : null;
  },

  'gmail-trigger-pre-1-4': (node, change) =>
    appliesTo(change, node) && version(node) < 1.4 ? { detail: `typeVersion ${version(node)}` } : null,

  'always-output-data-multi-output': (node, change) => {
    if (node.alwaysOutputData !== true) return null;
    if (change.nodeTypes.includes(node.type)) return {};
    // Loop Over Items only has two outputs from version 3 on.
    if (node.type === 'n8n-nodes-base.splitInBatches' && version(node) < 3) return null;
    if (change.unverifiedNodeTypes?.includes(node.type)) return { unverifiedNote: change.unverifiedNote };
    return null;
  },

  'webflow-v1-oauth2': (node, change) =>
    appliesTo(change, node) &&
    version(node) < 2 &&
    (params(node).authentication === 'oAuth2' || node.credentials?.webflowOAuth2Api !== undefined)
      ? { detail: 'typeVersion 1 with OAuth2' }
      : null,

  'chat-trigger-json-frames': (node, change) => {
    const p = params(node);
    const options = typeof p.options === 'object' && p.options !== null ? (p.options as Record<string, unknown>) : {};
    return appliesTo(change, node) && (p.responseMode === 'responseNodes' || options.responseMode === 'responseNodes') ? {} : null;
  },

  'compression-limits': (node, change) =>
    appliesTo(change, node) && (params(node).operation ?? 'decompress') === 'decompress' ? {} : null,
};

export function checkN8nNode(node: WorkflowNode, registry: Registry): RuleFinding[] {
  const { release, removedNodes, changes } = registry.n8n;
  // n8n 3.0 changes apply when the instance is upgraded, not on a calendar date.
  const base = { category: 'n8n-3.0' as const, trigger: { kind: 'upgrade' as const, version: release.version } };
  const findings: RuleFinding[] = [];

  const removed = removedNodes.find((entry) => entry.type === node.type);
  if (removed) {
    const verb = removed.severity === 'info' ? 'is retired' : 'is removed';
    let message = `${removed.displayName} node ${verb} in n8n ${release.version}.`;
    if (removed.replacement && removed.note) message += ` ${removed.note}`;
    findings.push({
      ...base,
      ruleId: 'n8n3/removed-node',
      severity: removed.severity,
      message,
      replacement: removed.replacement ?? removed.note ?? null,
      verification: removed.verification,
      ...(removed.verificationNote ? { verificationNote: removed.verificationNote } : {}),
      sources: sourceUrls(registry, removed.sources),
    });
  }

  for (const change of changes) {
    const detect = DETECTORS[change.id];
    const hit = detect?.(node, change);
    if (!hit) continue;
    const unverifiedNote = hit.unverifiedNote ?? (change.verification === 'unverified' ? change.verificationNote : undefined);
    findings.push({
      ...base,
      ruleId: `n8n3/${change.id}`,
      severity: change.severity,
      message: hit.detail ? `${change.message} (${hit.detail})` : change.message,
      replacement: change.replacement,
      verification: unverifiedNote ? 'unverified' : 'verified',
      ...(unverifiedNote ? { verificationNote: unverifiedNote } : {}),
      sources: sourceUrls(registry, change.sources),
      ...(hit.locations ? { locations: hit.locations } : {}),
    });
  }
  return findings;
}
