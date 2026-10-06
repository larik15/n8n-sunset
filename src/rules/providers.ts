import type { RuleFinding } from '../findings.js';
import type { ProviderModel, Registry, Severity } from '../registry.js';
import { sourceUrls } from '../registry.js';
import { stringLeaves, type StringLeaf } from '../walk.js';
import type { WorkflowNode } from '../workflows.js';
import { codeLanguage, stripComments } from './code.js';
import { STICKY_NOTE } from './n8n.js';
import { CODE_TYPES, HTTP_BODY_TEXT_KEYS, HTTP_PARAMETER_LIST_KEYS, HTTP_TYPES, isModelNamed, isModelPair, rootKey, urlHost, urlSegments, wholeValue } from './openai.js';
import { annotateReplacement, type ReplacementLookup } from './replacements.js';

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
  /** Platforms that serve the models under their own retirement schedules (Amazon Bedrock, Google Cloud Vertex AI): not checked. */
  skipNode: RegExp;
  /** Code that calls those platforms instead of the provider's own API. */
  foreignCode: RegExp;
  foreignName: string;
  /** Name used in locations: "Anthropic node parameter". */
  nodeLabel: string;
  /** The provider's own nodes as a phrase, and the provider as a name: "an Anthropic node", "Anthropic". */
  ownNodePhrase: string;
  providerName: string;
  shutdownVerb: { past: string; upcoming: string };
  replacementNone: string;
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
    // Anthropic's dates also cover Claude Platform on AWS and Microsoft Foundry; only Bedrock and Google Cloud differ.
    skipNode: /bedrock|vertex/i,
    foreignCode: /bedrock|aiplatform\.googleapis\.com|AnthropicVertex|AnthropicBedrock|@anthropic-ai\/(vertex|bedrock)-sdk/i,
    foreignName: 'Amazon Bedrock or Google Cloud Vertex AI',
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
    skipNode: /vertex|bedrock/i,
    foreignCode: /aiplatform\.googleapis\.com|vertexai\s*[:=]\s*(true|True)|@google-cloud\/vertexai|vertexai\.generative_models|\bVertexAI\b/,
    foreignName: 'Google Cloud Vertex AI',
    nodeLabel: 'Google Gemini node parameter',
    ownNodePhrase: 'a Google Gemini node',
    providerName: 'Google',
    shutdownVerb: { past: 'Google has shut down', upcoming: 'Google shuts down' },
    replacementNone: 'None listed by Google',
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

/** For replacement notes: the date of a listed model; Gemini table-only dates are marked tentative, redirected IDs skipped. */
export function providerLookup(index: ProviderIndex): ReplacementLookup {
  return (id) => {
    const entry = index.exact.get(id)?.entry;
    if (!entry || entry.redirectsTo) return undefined;
    return { shutdownDate: entry.shutdownDate, replacement: entry.replacement, tentative: entry.dateStatus === 'earliest' };
  };
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

/** An OpenAI-compatible node (e.g. the OpenAI Chat Model) whose options.baseURL points at the provider's own API. */
function compatibleBaseUrlHost(node: WorkflowNode): string | undefined {
  const options = node.parameters?.options;
  const baseURL = typeof options === 'object' && options !== null ? (options as Record<string, unknown>).baseURL : undefined;
  return typeof baseURL === 'string' ? urlHost(baseURL) : undefined;
}

function strategyFor(node: WorkflowNode, spec: ProviderSpec): Strategy | null {
  if (node.type === STICKY_NOTE) return null;
  if (CODE_TYPES.has(node.type)) {
    const source = [...stringLeaves(node.parameters)].map((leaf) => leaf.value).join('\n');
    // The same model IDs are served by Vertex AI / Bedrock on their own schedules.
    if (spec.foreignCode.test(source) && !source.includes(spec.host)) {
      return {
        kind: 'code',
        where: 'Code node source',
        warning: `This Code node calls ${spec.foreignName}, which sets its own retirement dates, so ${spec.providerName}'s date may not apply. Check where the request goes.`,
      };
    }
    return { kind: 'code', where: 'Code node source' };
  }
  if (isProviderHttpNode(node, spec)) return { kind: 'http', where: `HTTP Request to ${spec.host}` };
  if (HTTP_TYPES.has(node.type)) return null; // an HTTP request to some other host
  if (spec.skipNode.test(node.type)) return null;
  if (compatibleBaseUrlHost(node) === spec.host) return { kind: 'llm', where: `node calling ${spec.host} through options.baseURL` };
  // The provider's own nodes. A gateway set in the credential (Anthropic "url", Gemini "host") is not in the workflow JSON.
  if (spec.ownNode.test(node.type) || node.credentials?.[spec.credential] !== undefined) return { kind: 'llm', where: spec.nodeLabel };
  return {
    kind: 'other',
    where: 'parameter named "model"',
    warning: `Found in a field named "model" on a node that is not ${spec.ownNodePhrase}, so it may never be sent to ${spec.providerName}. Check how the value is used.`,
  };
}

// An optional "models/" prefix, as in "models/gemini-2.5-flash"; ":generateContent"-style suffixes stay in the token.
const TOKEN = /(?:models\/)?[A-Za-z0-9][A-Za-z0-9._:-]*/g;
const QUOTES = new Set(['"', "'", '`']);
const URL_IN_TEXT = /https?:\/\/[^\s'"`]+/g;

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

/** Path segments of URLs on the provider's host inside code, e.g. '.../v1beta/models/gemini-2.0-flash:generateContent'. */
function urlTokensInCode(text: string, host: string): string[] {
  return [...text.matchAll(URL_IN_TEXT)].filter((m) => urlHost(m[0]) === host).flatMap((m) => urlSegments(m[0]));
}

/** Same rules as the OpenAI checks: free text only counts when quoted, model-named fields count as a whole. */
function candidates(leaf: StringLeaf, kind: Strategy['kind'], spec: ProviderSpec): string[] {
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
    case 'code': {
      // Comments don't run: `// was 'claude-2.1'` must not keep a migrated workflow failing.
      const code = stripComments(leaf.value, codeLanguage(leaf.key));
      const tokens = [...quotedModelTokens(code), ...urlTokensInCode(code, spec.host)];
      return isModelNamed(leaf) ? [wholeValue(leaf.value), ...tokens] : tokens;
    }
    case 'other':
      return isModelNamed(leaf) ? [wholeValue(leaf.value)] : [];
  }
}

function describe(match: ProviderMatch): string {
  return match.alias ? `"${match.token}" (alias of ${match.entry.id})` : `"${match.token}"`;
}

export interface ProviderFindingOptions {
  /** Makes the finding a warning (may break, never fails the run). */
  warning?: string;
  /** Extra reason the finding is unverified, e.g. that the model comes from an n8n default. */
  unverifiedNote?: string;
  replacement?: string;
  extraSources?: string[];
}

/** One finding for a matched model; also used for models that n8n nodes use by default. */
export function providerFinding(
  registry: Registry,
  index: ProviderIndex,
  match: ProviderMatch,
  locations: string[],
  asOf: string,
  windowDays: number,
  options: ProviderFindingOptions = {},
): RuleFinding {
  const { spec } = index;
  const { entry } = match;
  const date = entry.shutdownDate;
  const past = date <= asOf;
  const noun = entry.noun ?? spec.noun;
  const name = describe(match);
  const notes: string[] = [];
  if (options.warning) notes.push(options.warning);
  if (options.unverifiedNote) notes.push(options.unverifiedNote);
  if (match.alias) notes.push(entry.aliasNote ?? 'Matched by an alias; no page says when an alias stops working, so it is assumed to retire with its model.');
  if (entry.verification === 'unverified' && entry.verificationNote) notes.push(entry.verificationNote);

  let severity: Severity = options.warning ? 'warning' : 'breaking';
  let message: string;
  if (entry.redirectsTo && past) {
    // The old model is gone, but the ID still answers with another model: a behavior change, not a failure.
    if (!options.warning) severity = 'behavior-change';
    message = `${spec.providerName} shut down the model behind ${noun} ${name}; the ID now points to ${entry.redirectsTo}, so calls still work but get a different model.`;
  } else if (entry.dateStatus === 'earliest' && past) {
    // Nothing confirms the shutdown; only the earliest possible date has passed.
    severity = 'warning';
    message = `${noun[0]!.toUpperCase()}${noun.slice(1)} ${name} is past ${spec.providerName}'s earliest shutdown date (${date}); calls may already fail.`;
    notes.push(`The release notes neither announce nor confirm this shutdown; the deprecations table lists ${date} as the earliest possible date.`);
  } else if (entry.dateStatus === 'earliest') {
    message = `${spec.providerName} lists ${date} as the earliest shutdown date for ${noun} ${name}; calls can fail from ${date} at the earliest.`;
  } else {
    message = past ? `${spec.shutdownVerb.past} ${noun} ${name}; API calls fail.` : `${spec.shutdownVerb.upcoming} ${noun} ${name}; API calls will fail.`;
  }

  const listed = options.replacement ?? entry.replacement;
  const replacement = listed ? annotateReplacement(listed, providerLookup(index), asOf, windowDays) : spec.replacementNone;
  return {
    category: spec.category,
    ruleId: spec.ruleId,
    severity,
    message,
    trigger: { kind: 'date', date },
    replacement,
    verification: notes.length ? 'unverified' : 'verified',
    ...(notes.length ? { verificationNote: notes.join(' ') } : {}),
    sources: sourceUrls(registry, [...new Set([...entry.sources, ...(match.alias ? (entry.aliasSources ?? []) : []), ...(options.extraSources ?? [])])]),
    model: match.token,
    locations,
  };
}

export function checkProviderModels(node: WorkflowNode, registry: Registry, index: ProviderIndex, asOf: string, windowDays = 30): RuleFinding[] {
  if (index.exact.size === 0) return [];
  const { spec } = index;
  const strategy = strategyFor(node, spec);
  if (!strategy) return [];

  // One finding per registry entry, even when the node names it twice ("models/x" in the URL and "x" in the body,
  // or an alias and its model): the direct ID wins over an alias.
  const matches = new Map<string, { match: ProviderMatch; paths: string[] }>();
  for (const leaf of stringLeaves(node.parameters)) {
    for (const token of new Set(candidates(leaf, strategy.kind, spec))) {
      const match = matchProviderModel(token, index);
      if (!match) continue;
      const seen = matches.get(match.entry.id);
      if (!seen) matches.set(match.entry.id, { match, paths: [leaf.path] });
      else {
        if (seen.match.alias && !match.alias) seen.match = match;
        if (!seen.paths.includes(leaf.path)) seen.paths.push(leaf.path);
      }
    }
  }

  return [...matches.values()].map(({ match, paths }) =>
    providerFinding(registry, index, match, paths.map((path) => `${strategy.where}: ${path}`), asOf, windowDays, strategy.warning ? { warning: strategy.warning } : {}),
  );
}
