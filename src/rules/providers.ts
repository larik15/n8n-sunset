import type { RuleFinding } from '../findings.js';
import type { ProviderModel, Registry, Severity } from '../registry.js';
import { sourceUrls } from '../registry.js';
import { stringLeaves, type StringLeaf } from '../walk.js';
import type { WorkflowNode } from '../workflows.js';
import { STICKY_NOTE } from './n8n.js';
import { CODE_TYPES, HTTP_BODY_TEXT_KEYS, HTTP_PARAMETER_LIST_KEYS, HTTP_TYPES, isModelNamed, isModelPair, rootKey, urlHost, urlSegments, wholeValue } from './openai.js';

/**
 * Model retirements announced by Anthropic and Google (Gemini API). One engine serves both: a provider is
 * described by where its models are named (its own nodes, HTTP Request nodes on its API host, Code nodes)
 * and how the provider words a retirement.
 */
export type ProviderKey = 'anthropic' | 'gemini';

interface ProviderSpec {
  key: ProviderKey;
  category: 'anthropic-model' | 'gemini-model';
  ruleId: string;
  host: string;
  /** Credential type n8n stores for the provider's own nodes. */
  credential: string;
  /** Node types of the provider's own nodes (chat models, the Anthropic / Google Gemini node, embeddings). */
  ownNode: RegExp;
  /** Platforms that resell the model under their own IDs and schedule (Bedrock, Vertex AI, Azure): not checked. */
  skipNode: RegExp;
  /** Name used in locations and notes: "Anthropic node parameter". */
  nodeLabel: string;
  /** The provider's own nodes as a phrase, and the provider as a name: "an Anthropic node", "Anthropic". */
  ownNodePhrase: string;
  providerName: string;
  shutdownVerb: { past: string; upcoming: string };
  replacementNone: string;
  /** Extra sentence for findings that are still ahead; Google lists its table dates as the earliest possible. */
  upcomingNote?: string;
  /** What the model is called in a message, e.g. `Gemini API model "gemini-2.0-flash"`. */
  noun: string;
}

const SPECS: Record<ProviderKey, ProviderSpec> = {
  anthropic: {
    key: 'anthropic',
    category: 'anthropic-model',
    ruleId: 'anthropic/model-retirement',
    host: 'api.anthropic.com',
    credential: 'anthropicApi',
    ownNode: /anthropic/i,
    skipNode: /bedrock|vertex|azure/i,
    nodeLabel: 'Anthropic node parameter',
    ownNodePhrase: 'an Anthropic node',
    providerName: 'Anthropic',
    shutdownVerb: { past: 'Anthropic has retired', upcoming: 'Anthropic retires' },
    replacementNone: 'None listed by Anthropic',
    noun: 'model',
  },
  gemini: {
    key: 'gemini',
    category: 'gemini-model',
    ruleId: 'gemini/model-shutdown',
    host: 'generativelanguage.googleapis.com',
    credential: 'googlePalmApi',
    ownNode: /googleGemini/i,
    skipNode: /vertex|bedrock|azure/i,
    nodeLabel: 'Google Gemini node parameter',
    ownNodePhrase: 'a Google Gemini node',
    providerName: 'Google',
    shutdownVerb: { past: 'Google has shut down', upcoming: 'Google shuts down' },
    replacementNone: 'None listed by Google',
    upcomingNote: "Google lists this as the earliest possible shutdown date and confirms the exact date in advance.",
    noun: 'Gemini API model',
  },
};

export interface ProviderIndex {
  spec: ProviderSpec;
  exact: Map<string, { entry: ProviderModel; alias: boolean }>;
}

export function buildProviderIndex(key: ProviderKey, models: ProviderModel[]): ProviderIndex {
  const exact = new Map<string, { entry: ProviderModel; alias: boolean }>();
  for (const entry of models) {
    exact.set(entry.id, { entry, alias: false });
    for (const alias of entry.aliases ?? []) exact.set(alias, { entry, alias: true });
  }
  return { spec: SPECS[key], exact };
}

export interface ProviderMatch {
  /** The model ID without a "models/" prefix or ":method" suffix, as it is listed in the registry. */
  token: string;
  entry: ProviderModel;
  alias: boolean;
}

/**
 * Gemini names a model "gemini-2.5-flash", "models/gemini-2.5-flash" (the form n8n's Google Gemini nodes store)
 * or "gemini-2.5-flash:generateContent" (in a REST URL). Strip the prefix and the method, then look it up exactly.
 */
export function matchProviderModel(token: string, index: ProviderIndex): ProviderMatch | undefined {
  let id = token.startsWith('models/') ? token.slice('models/'.length) : token;
  const colon = id.indexOf(':');
  if (colon > 0) id = id.slice(0, colon);
  const hit = index.exact.get(id);
  return hit ? { token: id, entry: hit.entry, alias: hit.alias } : undefined;
}

type Strategy = { kind: 'http' | 'llm' | 'code' | 'other'; where: string; warning?: string };

/** The literal host of an HTTP Request node's url, or whether credentials/URL text say it calls the provider. */
function isProviderHttpNode(node: WorkflowNode, spec: ProviderSpec): boolean {
  if (!HTTP_TYPES.has(node.type)) return false;
  const url = node.parameters?.url;
  const host = typeof url === 'string' ? urlHost(url) : undefined;
  if (host !== undefined) return host === spec.host;
  return node.credentials?.[spec.credential] !== undefined || (typeof url === 'string' && url.includes(spec.host));
}

/** A base URL that sends the provider node's requests somewhere other than the provider's own API. */
function customBaseUrl(node: WorkflowNode, spec: ProviderSpec): string | undefined {
  const options = node.parameters?.options;
  if (typeof options !== 'object' || options === null) return undefined;
  const o = options as Record<string, unknown>;
  const base = [o.baseURL, o.baseUrl, o.apiUrl].find((v): v is string => typeof v === 'string' && v.trim() !== '');
  return base !== undefined && urlHost(base) !== spec.host ? base : undefined;
}

function strategyFor(node: WorkflowNode, spec: ProviderSpec): Strategy | null {
  if (node.type === STICKY_NOTE) return null;
  if (CODE_TYPES.has(node.type)) return { kind: 'code', where: 'Code node source' };
  if (isProviderHttpNode(node, spec)) return { kind: 'http', where: `HTTP Request to ${spec.host}` };
  if (HTTP_TYPES.has(node.type)) return null; // an HTTP request to some other host
  // Bedrock, Vertex AI and Azure resell the models under their own IDs and retirement schedules.
  if (spec.skipNode.test(node.type)) return null;
  if (spec.ownNode.test(node.type) || node.credentials?.[spec.credential] !== undefined) {
    const base = customBaseUrl(node, spec);
    return base
      ? {
          kind: 'llm',
          where: spec.nodeLabel,
          warning: `This node sends requests to ${base}, not ${spec.host}, so the model may be served by another provider on its own schedule.`,
        }
      : { kind: 'llm', where: spec.nodeLabel };
  }
  return {
    kind: 'other',
    where: 'parameter named "model"',
    warning: `Found in a field named "model" on a node that is not ${spec.ownNodePhrase}, so it may never be sent to ${spec.providerName}. Check how the value is used.`,
  };
}

// An optional "models/" prefix, as in "models/gemini-2.5-flash"; ":generateContent"-style suffixes stay in the token.
const TOKEN = /(?:models\/)?[A-Za-z0-9][A-Za-z0-9._:-]*/g;
const QUOTES = new Set(['"', "'", '`']);

/** Tokens wrapped in quotes, with the Gemini "models/" prefix kept, e.g. 'models/gemini-2.5-flash' in code. */
function quotedModelTokens(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(TOKEN)) {
    const before = text[m.index - 1];
    const after = text[m.index + m[0].length];
    if (before !== undefined && QUOTES.has(before) && after !== undefined && (QUOTES.has(after) || after === '\\')) out.push(m[0]);
  }
  return out;
}

/** Same rules as the OpenAI checks: free text only counts when quoted, model-named fields count as a whole. */
function candidates(leaf: StringLeaf, kind: Strategy['kind']): string[] {
  switch (kind) {
    case 'http': {
      const root = rootKey(leaf);
      if (leaf.path === 'url') return urlSegments(leaf.value);
      if (HTTP_BODY_TEXT_KEYS.has(root)) return quotedModelTokens(leaf.value);
      if (HTTP_PARAMETER_LIST_KEYS.has(root) && isModelPair(leaf)) return [wholeValue(leaf.value)];
      return [];
    }
    case 'llm':
      return isModelNamed(leaf) ? [wholeValue(leaf.value), ...quotedModelTokens(leaf.value)] : [];
    case 'code':
      return isModelNamed(leaf) ? [wholeValue(leaf.value), ...quotedModelTokens(leaf.value)] : quotedModelTokens(leaf.value);
    case 'other':
      return isModelNamed(leaf) ? [wholeValue(leaf.value)] : [];
  }
}

function describe(match: ProviderMatch): string {
  return match.alias ? `"${match.token}" (alias of ${match.entry.id})` : `"${match.token}"`;
}

export function checkProviderModels(node: WorkflowNode, registry: Registry, index: ProviderIndex, asOf: string): RuleFinding[] {
  if (index.exact.size === 0) return [];
  const { spec } = index;
  const strategy = strategyFor(node, spec);
  if (!strategy) return [];

  const matches = new Map<string, { match: ProviderMatch; paths: string[] }>();
  for (const leaf of stringLeaves(node.parameters)) {
    for (const token of new Set(candidates(leaf, strategy.kind))) {
      const match = matchProviderModel(token, index);
      if (!match) continue;
      // One finding per model, even when the node names it twice ("models/x" in the URL, "x" in the body).
      const seen = matches.get(match.token);
      if (seen) {
        if (!seen.paths.includes(leaf.path)) seen.paths.push(leaf.path);
      } else matches.set(match.token, { match, paths: [leaf.path] });
    }
  }

  return [...matches.values()].map(({ match, paths }) => {
    const { entry } = match;
    const past = entry.shutdownDate <= asOf;
    const unverifiedNote = strategy.warning ?? (entry.verification === 'unverified' ? entry.verificationNote : undefined);
    const severity: Severity = strategy.warning ? 'warning' : 'breaking';
    const verb = past ? spec.shutdownVerb.past : spec.shutdownVerb.upcoming;
    const tail = past ? 'API calls fail.' : 'API calls will fail.';
    const note = !past && spec.upcomingNote ? ` ${spec.upcomingNote}` : '';
    return {
      category: spec.category,
      ruleId: spec.ruleId,
      severity,
      message: `${verb} ${spec.noun} ${describe(match)}; ${tail}${note}`,
      trigger: { kind: 'date', date: entry.shutdownDate },
      replacement: entry.replacement ?? spec.replacementNone,
      verification: unverifiedNote ? 'unverified' : 'verified',
      ...(unverifiedNote ? { verificationNote: unverifiedNote } : {}),
      sources: sourceUrls(registry, [...entry.sources, ...(match.alias ? (entry.aliasSources ?? []) : [])]),
      model: match.token,
      locations: paths.map((path) => `${strategy.where}: ${path}`),
    } satisfies RuleFinding;
  });
}
