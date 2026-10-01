import type { RuleFinding } from '../findings.js';
import type { OpenAiEndpoint, Registry } from '../registry.js';
import { sourceUrls } from '../registry.js';
import { stringLeaves, type StringLeaf } from '../walk.js';
import type { WorkflowNode } from '../workflows.js';
import { CODE_TYPES, HTTP_WHERE, isOpenAiHttpNode, mentionsOpenAiHost, OPENAI_HOST } from './openai.js';

const CODE_WHERE = 'Code node source';

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Blanks out URLs on other hosts, so another API's /v1/search is not reported. */
function withoutForeignUrls(text: string): string {
  return text.replace(/https?:\/\/([^/\s'"`?#\\]+)[^\s'"`\\]*/g, (url, host: string) =>
    host.toLowerCase() === OPENAI_HOST ? url : ' '.repeat(url.length),
  );
}

/**
 * "/v1/threads" also matches "/v1/threads/abc/runs" unless the entry is exact. The unversioned
 * form ("/threads") only counts right after an expression, as in "={{ $vars.OPENAI_BASE }}/threads".
 */
function pathPattern(path: string, exact: boolean, versioned: boolean): RegExp {
  const tail = exact ? '(?![A-Za-z0-9_/-])' : '(?![A-Za-z0-9_-])';
  return versioned
    ? new RegExp(`${escapeRegExp(path)}${tail}`)
    : new RegExp(`(?<=\\}\\}\\s*)${escapeRegExp(path.replace(/^\/v1(?=\/)/, ''))}${tail}`);
}

/** The HTTP method of an HTTP Request node, or undefined when an expression sets it. */
function httpMethod(node: WorkflowNode): string | undefined {
  const params = node.parameters ?? {};
  // Versions 1 and 2 call the parameter requestMethod; both default to GET.
  const method = params.method ?? params.requestMethod ?? 'GET';
  return typeof method === 'string' && !method.startsWith('=') ? method.toUpperCase() : undefined;
}

function headerLeaves(leaves: StringLeaf[], header: { name: string; value: string }): StringLeaf[] {
  const name = header.name.toLowerCase();
  if (!leaves.some((leaf) => leaf.value.toLowerCase().includes(name))) return [];
  const value = new RegExp(`(?<![A-Za-z0-9_.-])${escapeRegExp(header.value)}(?![A-Za-z0-9_.])`);
  return leaves.filter((leaf) => value.test(leaf.value));
}

interface Hit {
  endpoint: OpenAiEndpoint;
  matched: string[];
  paths: string[];
  unverifiedNote?: string;
}

/** n8n nodes that call a deprecated endpoint themselves, such as the OpenAI node's "Assistant" resource. */
function checkNodeUsages(node: WorkflowNode, registry: Registry, asOf: string): RuleFinding[] {
  const params = node.parameters ?? {};
  const findings: RuleFinding[] = [];
  for (const endpoint of registry.openai.endpoints) {
    for (const usage of endpoint.nodeUsages ?? []) {
      if (node.type !== usage.nodeType || (node.typeVersion ?? 1) > usage.maxTypeVersion || params[usage.parameter] !== usage.value) continue;
      const operation = typeof params.operation === 'string' ? params.operation : usage.defaultOperation;
      const known = usage.operations[operation];
      const path = known?.path ?? [...new Set(Object.values(usage.operations).map((op) => op.path))].join(', ');
      const past = endpoint.shutdownDate <= asOf;
      let message =
        `OpenAI ${past ? 'has shut down' : 'shuts down'} ${endpoint.label} (${path}), ` +
        `which this node's "${known?.name ?? operation}" operation calls; calls ${past ? 'fail' : 'will fail'}.`;
      if (endpoint.note) message += ` ${endpoint.note}`;
      const note = usage.verification === 'unverified' ? usage.verificationNote : endpoint.verification === 'unverified' ? endpoint.verificationNote : undefined;
      findings.push({
        category: 'openai-endpoint',
        ruleId: 'openai/endpoint-shutdown',
        severity: 'breaking',
        message,
        date: endpoint.shutdownDate,
        datePrecision: 'day',
        replacement: usage.replacement,
        verification: note ? 'unverified' : 'verified',
        ...(note ? { verificationNote: note } : {}),
        sources: sourceUrls(registry, [...endpoint.sources, ...usage.sources]),
        endpoint: path,
        locations: [`${usage.label}: ${usage.parameter}`],
      });
    }
  }
  return findings;
}

export function checkOpenAiEndpoints(node: WorkflowNode, registry: Registry, asOf: string): RuleFinding[] {
  const usageFindings = checkNodeUsages(node, registry, asOf);
  const leaves = [...stringLeaves(node.parameters)];
  const isHttp = isOpenAiHttpNode(node);
  const isCode = CODE_TYPES.has(node.type) && (mentionsOpenAiHost(node) || leaves.some((leaf) => /openai-beta/i.test(leaf.value)));
  if (!isHttp && !isCode) return usageFindings;
  const where = isHttp ? HTTP_WHERE : CODE_WHERE;

  const hits = new Map<string, Hit>();
  const add = (endpoint: OpenAiEndpoint, matched: string, path: string, unverifiedNote?: string) => {
    const hit = hits.get(endpoint.id) ?? { endpoint, matched: [], paths: [] };
    if (!hit.matched.includes(matched)) hit.matched.push(matched);
    if (!hit.paths.includes(path)) hit.paths.push(path);
    hit.unverifiedNote ??= unverifiedNote;
    hits.set(endpoint.id, hit);
  };

  for (const endpoint of registry.openai.endpoints) {
    if (endpoint.header) {
      for (const leaf of headerLeaves(leaves, endpoint.header)) add(endpoint, `${endpoint.header.name}: ${endpoint.header.value}`, leaf.path);
      continue;
    }
    for (const path of endpoint.paths ?? []) {
      const versioned = pathPattern(path, endpoint.exactPath === true, true);
      const bare = pathPattern(path, endpoint.exactPath === true, false);
      for (const leaf of leaves) {
        const text = withoutForeignUrls(leaf.value);
        if (!versioned.test(text) && !(isHttp && leaf.key === 'url' && bare.test(text))) continue;
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
    const past = endpoint.shutdownDate <= asOf;
    const shown = matched.join(', ');
    const what = endpoint.label.includes(shown) ? endpoint.label : `${endpoint.label} (${shown})`;
    let message = `OpenAI ${past ? 'has shut down' : 'shuts down'} ${what}; calls ${past ? 'fail' : 'will fail'}.`;
    if (endpoint.note) message += ` ${endpoint.note}`;
    const note = unverifiedNote ?? (endpoint.verification === 'unverified' ? endpoint.verificationNote : undefined);
    return {
      category: 'openai-endpoint',
      ruleId: 'openai/endpoint-shutdown',
      severity: 'breaking',
      message,
      date: endpoint.shutdownDate,
      datePrecision: 'day',
      replacement: endpoint.replacement ?? 'None listed by OpenAI',
      verification: note ? 'unverified' : 'verified',
      ...(note ? { verificationNote: note } : {}),
      sources: sourceUrls(registry, endpoint.sources),
      endpoint: shown,
      locations: paths.map((path) => `${where}: ${path}`),
    } satisfies RuleFinding;
  });
  return [...usageFindings, ...pathFindings];
}
