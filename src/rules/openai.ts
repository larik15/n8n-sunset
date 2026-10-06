import type { RuleFinding } from '../findings.js';
import type { LegacyFineTunes, OpenAiModel, Registry, Severity } from '../registry.js';
import { sourceUrls } from '../registry.js';
import { stringLeaves, type StringLeaf } from '../walk.js';
import type { WorkflowNode } from '../workflows.js';
import { codeLanguage, stripComments } from './code.js';
import { STICKY_NOTE } from './n8n.js';
import { annotateReplacement, type ReplacementLookup } from './replacements.js';

export interface ModelIndex {
  exact: Map<string, { entry: OpenAiModel; alias: boolean }>;
  families: Map<string, OpenAiModel>;
  fineTunes: OpenAiModel[];
  legacyFineTunes?: { pattern: RegExp; suffixPattern: RegExp; entry: OpenAiModel };
}

export interface ModelMatch {
  token: string;
  entry: OpenAiModel;
  kind: 'exact' | 'alias' | 'dated-snapshot' | 'fine-tune' | 'legacy-fine-tune' | 'provider-prefixed';
  /** For provider-prefixed IDs: the match for the part after "openai/". */
  inner?: ModelMatch;
  /** For legacy fine-tunes: the ID carries a custom suffix (ada:ft-org:my-suffix-2022-...). */
  suffix?: boolean;
}

export function buildModelIndex(models: OpenAiModel[], legacy?: LegacyFineTunes): ModelIndex {
  const index: ModelIndex = { exact: new Map(), families: new Map(), fineTunes: [] };
  for (const entry of models) {
    index.exact.set(entry.id, { entry, alias: false });
    for (const alias of entry.aliases ?? []) index.exact.set(alias, { entry, alias: true });
    if (entry.matchDatedSnapshots) index.families.set(entry.id, entry);
    if (entry.fineTuneOf) index.fineTunes.push(entry);
  }
  index.fineTunes.sort((a, b) => b.fineTuneOf!.length - a.fineTuneOf!.length);
  if (legacy) {
    const bases = legacy.bases.join('|');
    index.legacyFineTunes = {
      // curie:ft-acme-2021-08-23-17-54-10
      pattern: new RegExp(`^(${bases}):ft-[A-Za-z0-9-]+$`),
      // ada:ft-your-org:custom-model-name-2022-02-15-04-21-04 (created with a suffix)
      suffixPattern: new RegExp(`^(${bases}):ft-[A-Za-z0-9-]+:[A-Za-z0-9-]+$`),
      entry: {
        id: '<base>:ft-…',
        shutdownDate: legacy.shutdownDate,
        replacement: legacy.replacement,
        announcement: legacy.announcement,
        verification: legacy.verification,
        note: legacy.note,
      },
    };
  }
  return index;
}

const PROVIDER_PREFIX = 'openai/';

export function matchModelId(token: string, index: ModelIndex): ModelMatch | undefined {
  const hit = index.exact.get(token);
  if (hit) return { token, entry: hit.entry, kind: hit.alias ? 'alias' : 'exact' };

  const snapshot = /^(.+)-\d{4}-\d{2}-\d{2}$/.exec(token);
  const family = snapshot && index.families.get(snapshot[1]!);
  if (family) return { token, entry: family, kind: 'dated-snapshot' };

  // Fine-tuned model IDs look like ft:<base-model>:<org>:<suffix>:<id>.
  if (token.startsWith('ft:')) {
    const base = token.split(':')[1];
    if (!base) return undefined;
    const label = index.fineTunes.find((e) => base === e.fineTuneOf || base.startsWith(`${e.fineTuneOf}-`));
    if (label) return { token, entry: label, kind: 'fine-tune' };
    const baseMatch = matchModelId(base, index);
    if (baseMatch) return { token, entry: baseMatch.entry, kind: 'fine-tune' };
  }

  // Legacy /v1/fine-tunes models look like curie:ft-acme-2021-08-23-17-54-10.
  const legacy = index.legacyFineTunes;
  if (legacy?.pattern.test(token)) return { token, entry: legacy.entry, kind: 'legacy-fine-tune' };
  if (legacy?.suffixPattern.test(token)) return { token, entry: legacy.entry, kind: 'legacy-fine-tune', suffix: true };

  // OpenRouter and similar providers name OpenAI models openai/<model>.
  if (token.startsWith(PROVIDER_PREFIX)) {
    const inner = matchModelId(token.slice(PROVIDER_PREFIX.length), index);
    if (inner && inner.kind !== 'provider-prefixed') return { token, entry: inner.entry, kind: 'provider-prefixed', inner };
  }
  return undefined;
}

export const CODE_TYPES = new Set([
  'n8n-nodes-base.code',
  'n8n-nodes-base.function',
  'n8n-nodes-base.functionItem',
  '@n8n/n8n-nodes-langchain.code',
  '@n8n/n8n-nodes-langchain.toolCode',
]);
// httpRequestTool is the HTTP Request node attached to an AI Agent as a tool.
export const HTTP_TYPES = new Set(['n8n-nodes-base.httpRequest', 'n8n-nodes-base.httpRequestTool', '@n8n/n8n-nodes-langchain.toolHttpRequest']);
export const OPENAI_HOST = 'api.openai.com';
export const HTTP_WHERE = `HTTP Request to ${OPENAI_HOST}`;

/** The literal host of a URL ("api.openai.com" for "https://api.openai.com:443/v1"), or undefined when an expression sets it. */
export function urlHost(text: string): string | undefined {
  const m = /^=?\s*[a-z][a-z0-9+.-]*:\/\/(?:[^@/\s?#]*@)?([^/\s?#:{}]+)(?::\d+)?(?=[/?#\s]|$)/i.exec(text.trim());
  return m ? m[1]!.toLowerCase() : undefined;
}

export function isOpenAiHost(host: string | undefined): boolean {
  return host === OPENAI_HOST;
}

export function mentionsOpenAiHost(node: WorkflowNode): boolean {
  return [...stringLeaves(node.parameters)].some((leaf) => leaf.value.includes(OPENAI_HOST));
}

/**
 * An HTTP Request node that calls OpenAI: its url field is on api.openai.com, or the URL comes
 * from an expression and the node authenticates with OpenAI credentials or mentions api.openai.com.
 */
export function isOpenAiHttpNode(node: WorkflowNode): boolean {
  if (!HTTP_TYPES.has(node.type)) return false;
  const url = node.parameters?.url;
  const host = typeof url === 'string' ? urlHost(url) : undefined;
  if (host !== undefined) return isOpenAiHost(host);
  return node.credentials?.openAiApi !== undefined || (typeof url === 'string' && url.includes(OPENAI_HOST));
}

/** A base URL that sends an OpenAI node's requests somewhere other than api.openai.com. */
function customBaseUrl(node: WorkflowNode): string | undefined {
  const options = node.parameters?.options;
  const baseURL = typeof options === 'object' && options !== null ? (options as Record<string, unknown>).baseURL : undefined;
  if (typeof baseURL !== 'string' || baseURL.trim() === '') return undefined;
  return isOpenAiHost(urlHost(baseURL)) ? undefined : baseURL;
}

type Strategy = { kind: 'http' | 'llm' | 'code' | 'other'; where: string; warning?: string };

const OTHER_NOTE =
  'Found in a field named "model" on a node that is not an OpenAI node, so it may never be sent to OpenAI. Check how the value is used.';

function strategyFor(node: WorkflowNode): Strategy | null {
  if (node.type === STICKY_NOTE) return null;
  if (CODE_TYPES.has(node.type)) return { kind: 'code', where: 'Code node source' };
  if (isOpenAiHttpNode(node)) return { kind: 'http', where: HTTP_WHERE };
  if (HTTP_TYPES.has(node.type)) return null; // an HTTP request to some other host
  // Azure OpenAI uses deployment names and its own retirement schedule, so it is left out.
  if (/azure/i.test(node.type) || node.credentials?.azureOpenAiApi !== undefined) return null;
  if (/openai/i.test(node.type) || node.credentials?.openAiApi !== undefined) {
    const base = customBaseUrl(node);
    return base
      ? {
          kind: 'llm',
          where: 'OpenAI node parameter',
          warning: `This node sends requests to ${base}, not api.openai.com, so the model may be served by another provider on its own schedule.`,
        }
      : { kind: 'llm', where: 'OpenAI node parameter' };
  }
  return { kind: 'other', where: 'parameter named "model"', warning: OTHER_NOTE };
}

const TOKEN = /(?:openai\/)?[A-Za-z0-9][A-Za-z0-9._:-]*/g;
const QUOTES = new Set(['"', "'", '`']);

/** Tokens wrapped in quotes, e.g. 'gpt-4' in code or "gpt-4" in a JSON body (escaped quotes included). */
export function quotedTokens(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(TOKEN)) {
    const before = text[m.index - 1];
    const after = text[m.index + m[0].length];
    if (before !== undefined && QUOTES.has(before) && after !== undefined && (QUOTES.has(after) || after === '\\')) out.push(m[0]);
  }
  return out;
}

/** Path and query segments of a URL, e.g. ".../realtime?model=gpt-4o-realtime-preview". */
export function urlSegments(text: string): string[] {
  return text.split(/[/?&=#\s]/).filter(Boolean);
}

/** The whole parameter value, with n8n's "=" expression prefix removed when it holds a plain literal. */
export function wholeValue(text: string): string {
  const trimmed = text.trim();
  return trimmed.startsWith('=') && !trimmed.includes('{{') ? trimmed.slice(1).trim() : trimmed;
}

/** A { name: "model", value } pair, as in body parameters or Edit Fields assignments. */
export function isModelPair(leaf: StringLeaf): boolean {
  const name = (leaf.parent as { name?: unknown } | undefined)?.name;
  return /value/i.test(leaf.key) && typeof name === 'string' && /^model$/i.test(name.trim());
}

/** A parameter that holds a model: "model", "modelId.value", or a { name: "model", value } pair. */
export function isModelNamed(leaf: StringLeaf): boolean {
  return /model/i.test(leaf.path) || isModelPair(leaf);
}

/**
 * Request body and query text of the HTTP Request node, where model IDs appear as quoted JSON
 * strings: jsonBody/body/jsonQuery from version 3 on, bodyParametersJson/queryParametersJson in 1-2.
 */
export const HTTP_BODY_TEXT_KEYS = new Set(['jsonBody', 'body', 'jsonQuery', 'bodyParametersJson', 'queryParametersJson']);
/** Name/value parameter lists: bodyParameters/queryParameters (v3+), bodyParametersUi/queryParametersUi (v1-2). */
export const HTTP_PARAMETER_LIST_KEYS = new Set(['bodyParameters', 'queryParameters', 'bodyParametersUi', 'queryParametersUi']);
export const rootKey = (leaf: StringLeaf) => leaf.path.split(/[.[]/)[0]!;

/**
 * Strings that might be model IDs. Free text (code, request bodies) only counts when quoted,
 * so a variable named o1 or a prompt mentioning davinci is not reported.
 */
function candidates(leaf: StringLeaf, kind: Strategy['kind']): string[] {
  switch (kind) {
    case 'http': {
      const root = rootKey(leaf);
      if (leaf.path === 'url') return urlSegments(leaf.value);
      if (HTTP_BODY_TEXT_KEYS.has(root)) return quotedTokens(leaf.value);
      if (HTTP_PARAMETER_LIST_KEYS.has(root) && isModelPair(leaf)) return [wholeValue(leaf.value)];
      return [];
    }
    case 'llm':
      return isModelNamed(leaf) ? [wholeValue(leaf.value), ...quotedTokens(leaf.value)] : [];
    case 'code': {
      // Comments don't run: a quoted ID in `// was 'gpt-4'` must not keep a migrated workflow failing.
      const code = stripComments(leaf.value, codeLanguage(leaf.key));
      return isModelNamed(leaf) ? [wholeValue(leaf.value), ...quotedTokens(code)] : quotedTokens(code);
    }
    case 'other':
      return isModelNamed(leaf) ? [wholeValue(leaf.value)] : [];
  }
}

function describe(match: ModelMatch): string {
  const { token, entry, kind } = match;
  if (kind === 'alias') return `"${token}" (alias of ${entry.id})`;
  if (kind === 'dated-snapshot') return `"${token}" (snapshot of ${entry.id})`;
  if (kind === 'fine-tune') return `"${token}" (fine-tune matched to ${entry.id})`;
  if (kind === 'legacy-fine-tune') return `"${token}" (legacy /v1/fine-tunes model)`;
  if (kind === 'provider-prefixed') return `"${token}" (provider name for ${match.inner!.token})`;
  return `"${token}"`;
}

const FINE_TUNE_NOTE =
  'Fine-tuned model ID matched to the deprecations page by its base model. The page states that inference on fine-tuned models stops when the underlying base model is deprecated, but does not list individual fine-tuned IDs.';
const PROVIDER_NOTE =
  'Provider-prefixed model ID (openai/<model>, as used by OpenRouter). OpenAI\'s date applies to OpenAI\'s API; the provider decides when its own route stops working.';

/** For replacement notes: the date and replacement of a model the deprecations page lists by ID or alias. */
export function openAiLookup(index: ModelIndex): ReplacementLookup {
  return (id) => {
    const entry = index.exact.get(id)?.entry;
    return entry ? { shutdownDate: entry.shutdownDate, replacement: entry.replacement } : undefined;
  };
}

export interface OpenAiFindingOptions {
  /** Makes the finding a warning (may break, never fails the run). */
  warning?: string;
  /** Extra reason the finding is unverified, e.g. that the model comes from an n8n default. */
  unverifiedNote?: string;
  replacement?: string;
  extraSources?: string[];
}

/** One finding for a matched model; also used for models that n8n nodes use by default or always. */
export function openAiModelFinding(
  registry: Registry,
  index: ModelIndex,
  match: ModelMatch,
  locations: string[],
  asOf: string,
  windowDays: number,
  options: OpenAiFindingOptions = {},
): RuleFinding {
  const { entry } = match;
  const legacy = registry.openai.legacyFineTunes;
  const past = entry.shutdownDate <= asOf;
  // A warning is a possible break that needs review; it never sets the exit code.
  const warning = options.warning ?? (match.kind === 'provider-prefixed' ? PROVIDER_NOTE : undefined);
  const suffixForm = match.suffix || match.inner?.suffix ? legacy.suffixForm : undefined;
  const dataNote =
    match.kind === 'fine-tune' || match.inner?.kind === 'fine-tune'
      ? FINE_TUNE_NOTE
      : suffixForm?.verification === 'unverified'
        ? suffixForm.verificationNote
        : entry.verification === 'unverified'
          ? entry.verificationNote
          : undefined;
  const notes = [warning ?? dataNote, options.unverifiedNote].filter((n): n is string => Boolean(n));
  const legacyKind = match.kind === 'legacy-fine-tune' || match.inner?.kind === 'legacy-fine-tune';
  const severity: Severity = warning ? 'warning' : 'breaking';
  const listed = options.replacement ?? entry.replacement;
  const sources = legacyKind ? sourceUrls(registry, suffixForm?.sources ?? legacy.sources) : sourceUrls(registry, [registry.openai.source]);
  return {
    category: 'openai-model',
    ruleId: 'openai/model-shutdown',
    severity,
    message: past
      ? `OpenAI has shut down model ${describe(match)}; API calls fail.`
      : `OpenAI shuts down model ${describe(match)}; API calls will fail.`,
    trigger: { kind: 'date', date: entry.shutdownDate },
    replacement: listed ? annotateReplacement(listed, openAiLookup(index), asOf, windowDays) : 'None listed by OpenAI',
    verification: notes.length ? 'unverified' : 'verified',
    ...(notes.length ? { verificationNote: notes.join(' ') } : {}),
    sources: [...new Set([...sources, ...sourceUrls(registry, options.extraSources ?? [])])],
    model: match.token,
    locations,
  };
}

export function checkOpenAiModels(node: WorkflowNode, registry: Registry, index: ModelIndex, asOf: string, windowDays = 30): RuleFinding[] {
  const strategy = strategyFor(node);
  if (!strategy) return [];

  const matches = new Map<string, { match: ModelMatch; paths: string[] }>();
  for (const leaf of stringLeaves(node.parameters)) {
    for (const token of new Set(candidates(leaf, strategy.kind))) {
      const match = matchModelId(token, index);
      if (!match) continue;
      const seen = matches.get(token);
      if (seen) {
        if (!seen.paths.includes(leaf.path)) seen.paths.push(leaf.path);
      } else matches.set(token, { match, paths: [leaf.path] });
    }
  }

  return [...matches.values()].map(({ match, paths }) =>
    openAiModelFinding(registry, index, match, paths.map((path) => `${strategy.where}: ${path}`), asOf, windowDays, strategy.warning ? { warning: strategy.warning } : {}),
  );
}
