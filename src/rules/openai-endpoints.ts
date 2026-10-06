import type { RuleFinding } from '../findings.js';
import type { OpenAiEndpoint, OpenAiNodeUsage, Registry } from '../registry.js';
import { sourceUrls } from '../registry.js';
import { stringLeaves, type StringLeaf } from '../walk.js';
import type { WorkflowNode } from '../workflows.js';
import { codeLanguage, stripComments } from './code.js';
import { CODE_TYPES, HTTP_BODY_TEXT_KEYS, HTTP_WHERE, isOpenAiHttpNode, mentionsOpenAiHost, quotedTokens, rootKey } from './openai.js';

const CODE_WHERE = 'Code node source';

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const tailFor = (exact: boolean) => (exact ? '(?![A-Za-z0-9_/-])' : '(?![A-Za-z0-9_-])');

/** "/v1/threads" in an HTTP Request url field; also "/threads" right after an expression ("={{ $vars.BASE }}/threads"). */
function urlFieldPatterns(path: string, exact: boolean): RegExp[] {
  const tail = tailFor(exact);
  return [
    new RegExp(`${escapeRegExp(path)}${tail}`),
    new RegExp(`(?<=\\}\\}\\s*)${escapeRegExp(path.replace(/^\/v1(?=\/)/, ''))}${tail}`),
  ];
}

/** In code: "/v1/threads" only inside an api.openai.com URL (any port) or a string literal that starts with it. */
function codePattern(path: string, exact: boolean): RegExp {
  return new RegExp(`(?<=api\\.openai\\.com(?::\\d+)?|['"\`])${escapeRegExp(path)}${tailFor(exact)}`, 'i');
}

/** The HTTP method of an HTTP Request node, or undefined when an expression sets it. */
function httpMethod(node: WorkflowNode): string | undefined {
  const params = node.parameters ?? {};
  // Versions 1 and 2 call the parameter requestMethod; both default to GET.
  const method = params.method ?? params.requestMethod ?? 'GET';
  return typeof method === 'string' && !method.startsWith('=') ? method.toUpperCase() : undefined;
}

/** Header fields: headerParameters/jsonHeaders (v3+), headerParametersUi/headerParametersJson (v1-2). */
const HTTP_HEADER_KEYS = new Set(['headerParameters', 'jsonHeaders', 'headerParametersUi', 'headerParametersJson']);
/** Request body fields of every HTTP Request version. */
const HTTP_BODY_KEYS = new Set([...HTTP_BODY_TEXT_KEYS, 'bodyParameters', 'bodyParametersUi']);

function headerLeaves(leaves: StringLeaf[], header: { name: string; value: string }): StringLeaf[] {
  const name = header.name.toLowerCase();
  if (!leaves.some((leaf) => leaf.value.toLowerCase().includes(name))) return [];
  const value = new RegExp(`(?<![A-Za-z0-9_.-])${escapeRegExp(header.value)}(?![A-Za-z0-9_.])`);
  return leaves.filter((leaf) => value.test(leaf.value));
}

/** Drops entries covered by a shorter one: "/v1/threads/runs" next to "/v1/threads", or "a.b" next to "a". */
export function dedupeOverlapping(items: string[]): string[] {
  const unique = [...new Set(items)];
  return unique.filter((item) => !unique.some((other) => other !== item && /^[/.[]/.test(item.slice(other.length)) && item.startsWith(other)));
}

/** Reads a dotted parameter path; fixed collections may be stored as an object or a one-item array. */
function getParam(params: Record<string, unknown>, path: string): unknown {
  let value: unknown = params;
  for (const key of path.split('.')) {
    if (Array.isArray(value)) value = value[0];
    if (typeof value !== 'object' || value === null) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

function endpointMessage(endpoint: OpenAiEndpoint, what: string, asOf: string, via?: string): string {
  const past = endpoint.shutdownDate <= asOf;
  let message = `OpenAI ${past ? 'has shut down' : 'shuts down'} ${what}`;
  if (via) message += `, which this node's "${via}" operation ${endpoint.objectIdPrefix && what.includes(endpoint.objectIdPrefix) ? 'uses' : 'calls'}`;
  message += `; calls ${past ? 'fail' : 'will fail'}.`;
  return endpoint.note ? `${message} ${endpoint.note}` : message;
}

/**
 * Where a node usage was found, as the settings that select it:
 * "OpenAI node: resource=assistant, operation=message (default)". Values the export leaves out
 * (n8n omits defaults) are marked "(default)".
 */
function usageLocation(
  usage: OpenAiNodeUsage,
  params: Record<string, unknown>,
  operationParameter: string,
  operation: string,
  required: string | undefined,
): string {
  const setting = (name: string, actual: unknown, effective: string) =>
    `${name}=${effective}${typeof actual === 'string' ? '' : ' (default)'}`;
  const parts: string[] = [];
  if (usage.parameter !== undefined) parts.push(setting(usage.parameter, params[usage.parameter], usage.value!));
  parts.push(setting(operationParameter, params[operationParameter], operation));
  if (usage.requires && required !== undefined) parts.push(`${usage.requires.split('.').pop()}=${required}`);
  const node = usage.label.split(',')[0]!;
  return `${node}: ${parts.join(', ')}`;
}

/** n8n nodes that call a deprecated endpoint themselves, such as the OpenAI node's "Assistant" resource. */
function checkNodeUsages(node: WorkflowNode, registry: Registry, asOf: string): RuleFinding[] {
  const params = node.parameters ?? {};
  const version = node.typeVersion ?? 1;
  const findings: RuleFinding[] = [];
  for (const endpoint of registry.openai.endpoints) {
    for (const usage of endpoint.nodeUsages ?? []) {
      if (node.type !== usage.nodeType) continue;
      if ((usage.minTypeVersion !== undefined && version < usage.minTypeVersion) || (usage.maxTypeVersion !== undefined && version > usage.maxTypeVersion)) continue;
      if (usage.parameter !== undefined && (params[usage.parameter] ?? usage.parameterDefault) !== usage.value) continue;
      const operationParameter = usage.operationParameter ?? 'operation';
      const value = params[operationParameter];
      const operation = typeof value === 'string' ? value : usage.defaultOperation;
      const known = usage.operations[operation];
      if (!known) continue;
      let required: string | undefined;
      if (usage.requires) {
        const found = getParam(params, usage.requires);
        if (typeof found !== 'string' || found.trim() === '' || found.trim() === '=') continue;
        required = found.trim();
      }
      const shown = required !== undefined ? `${usage.matchedLabel ?? usage.requires} ${required}` : dedupeOverlapping(known.paths).join(', ');
      const what = `${endpoint.label} (${shown})`;
      const note = usage.verification === 'unverified' ? usage.verificationNote : endpoint.verification === 'unverified' ? endpoint.verificationNote : undefined;
      findings.push({
        category: 'openai-endpoint',
        ruleId: 'openai/endpoint-shutdown',
        severity: 'breaking',
        message: endpointMessage(endpoint, what, asOf, known.name),
        trigger: { kind: 'date', date: endpoint.shutdownDate },
        replacement: usage.replacement ?? endpoint.replacement ?? 'None listed by OpenAI',
        verification: note ? 'unverified' : 'verified',
        ...(note ? { verificationNote: note } : {}),
        sources: sourceUrls(registry, [...endpoint.sources, ...usage.sources]),
        endpoint: shown,
        locations: [usageLocation(usage, params, operationParameter, operation, required)],
      });
    }
  }
  return findings;
}

interface Hit {
  endpoint: OpenAiEndpoint;
  matched: string[];
  paths: string[];
  unverifiedNote?: string;
}

export function checkOpenAiEndpoints(node: WorkflowNode, registry: Registry, asOf: string): RuleFinding[] {
  const usageFindings = checkNodeUsages(node, registry, asOf);
  // Comments don't run: a commented-out `/v1/assistants` call must not keep a migrated Code node failing.
  const leaves = [...stringLeaves(node.parameters)].map((leaf) =>
    CODE_TYPES.has(node.type) ? { ...leaf, value: stripComments(leaf.value, codeLanguage(leaf.key)) } : leaf,
  );
  const isHttp = isOpenAiHttpNode(node);
  const isCode = CODE_TYPES.has(node.type) && (mentionsOpenAiHost(node) || leaves.some((leaf) => /openai-beta/i.test(leaf.value)));
  if (!isHttp && !isCode) return usageFindings;
  const where = isHttp ? HTTP_WHERE : CODE_WHERE;

  // Where each kind of evidence may come from.
  const urlLeaves = isHttp ? leaves.filter((leaf) => leaf.path === 'url') : leaves;
  const headerSource = isHttp ? leaves.filter((leaf) => HTTP_HEADER_KEYS.has(rootKey(leaf))) : leaves;
  const bodySource = isHttp ? leaves.filter((leaf) => HTTP_BODY_KEYS.has(rootKey(leaf))) : leaves;

  const hits = new Map<string, Hit>();
  const add = (endpoint: OpenAiEndpoint, matched: string, path: string, unverifiedNote?: string) => {
    const hit = hits.get(endpoint.id) ?? { endpoint, matched: [], paths: [] };
    hit.matched.push(matched);
    hit.paths.push(path);
    hit.unverifiedNote ??= unverifiedNote;
    hits.set(endpoint.id, hit);
  };

  for (const endpoint of registry.openai.endpoints) {
    if (endpoint.header) {
      for (const leaf of headerLeaves(headerSource, endpoint.header)) add(endpoint, `${endpoint.header.name}: ${endpoint.header.value}`, leaf.path);
    }
    if (endpoint.objectIdPrefix) {
      for (const leaf of bodySource) {
        for (const id of quotedTokens(leaf.value).filter((token) => token.startsWith(endpoint.objectIdPrefix!))) add(endpoint, `prompt object ${id}`, leaf.path);
      }
    }
    for (const path of endpoint.paths ?? []) {
      const exact = endpoint.exactPath === true;
      const patterns = isHttp ? urlFieldPatterns(path, exact) : [codePattern(path, exact)];
      for (const leaf of urlLeaves) {
        if (!patterns.some((pattern) => pattern.test(leaf.value))) continue;
        let unverifiedNote: string | undefined;
        if (endpoint.method) {
          const method = isHttp ? httpMethod(node) : undefined;
          if (method !== undefined && method !== endpoint.method) continue;
          if (method === undefined) {
            unverifiedNote = `The request method could not be determined; only ${endpoint.method} requests to this endpoint are affected.`;
          }
        }
        add(endpoint, endpoint.method ? `${endpoint.method} ${path}` : path, leaf.path, unverifiedNote);
      }
    }
  }

  const pathFindings = [...hits.values()].map(({ endpoint, matched, paths, unverifiedNote }) => {
    const shown = dedupeOverlapping(matched).join(', ');
    const what = endpoint.label.includes(shown) ? endpoint.label : `${endpoint.label} (${shown})`;
    const note = unverifiedNote ?? (endpoint.verification === 'unverified' ? endpoint.verificationNote : undefined);
    return {
      category: 'openai-endpoint',
      ruleId: 'openai/endpoint-shutdown',
      severity: 'breaking',
      message: endpointMessage(endpoint, what, asOf),
      trigger: { kind: 'date', date: endpoint.shutdownDate },
      replacement: endpoint.replacement ?? 'None listed by OpenAI',
      verification: note ? 'unverified' : 'verified',
      ...(note ? { verificationNote: note } : {}),
      sources: sourceUrls(registry, endpoint.sources),
      endpoint: shown,
      locations: dedupeOverlapping(paths).map((path) => `${where}: ${path}`),
    } satisfies RuleFinding;
  });
  return [...usageFindings, ...pathFindings];
}
