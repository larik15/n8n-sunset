import type { RuleFinding } from '../findings.js';
import type { OpenAiModel, Registry } from '../registry.js';
import { stringLeaves, type StringLeaf } from '../walk.js';
import type { WorkflowNode } from '../workflows.js';
import { STICKY_NOTE } from './n8n.js';

export interface ModelIndex {
  exact: Map<string, { entry: OpenAiModel; alias: boolean }>;
  families: Map<string, OpenAiModel>;
  fineTunes: OpenAiModel[];
}

export interface ModelMatch {
  token: string;
  entry: OpenAiModel;
  kind: 'exact' | 'alias' | 'dated-snapshot' | 'fine-tune';
}

export function buildModelIndex(models: OpenAiModel[]): ModelIndex {
  const index: ModelIndex = { exact: new Map(), families: new Map(), fineTunes: [] };
  for (const entry of models) {
    index.exact.set(entry.id, { entry, alias: false });
    for (const alias of entry.aliases ?? []) index.exact.set(alias, { entry, alias: true });
    if (entry.matchDatedSnapshots) index.families.set(entry.id, entry);
    if (entry.fineTuneOf) index.fineTunes.push(entry);
  }
  index.fineTunes.sort((a, b) => b.fineTuneOf!.length - a.fineTuneOf!.length);
  return index;
}

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
  return undefined;
}

const CODE_TYPES = new Set([
  'n8n-nodes-base.code',
  'n8n-nodes-base.function',
  'n8n-nodes-base.functionItem',
  '@n8n/n8n-nodes-langchain.code',
  '@n8n/n8n-nodes-langchain.toolCode',
]);
const HTTP_TYPES = new Set(['n8n-nodes-base.httpRequest', '@n8n/n8n-nodes-langchain.toolHttpRequest']);
const OPENAI_HOST = 'api.openai.com';

type Strategy = { kind: 'http' | 'llm' | 'code' | 'other'; where: string };

function strategyFor(node: WorkflowNode): Strategy | null {
  if (node.type === STICKY_NOTE) return null;
  if (CODE_TYPES.has(node.type)) return { kind: 'code', where: 'Code node source' };
  if (HTTP_TYPES.has(node.type) && [...stringLeaves(node.parameters)].some((leaf) => leaf.value.includes(OPENAI_HOST))) {
    return { kind: 'http', where: `HTTP Request to ${OPENAI_HOST}` };
  }
  // Azure OpenAI uses deployment names and its own retirement schedule, so it is left out.
  if (/azure/i.test(node.type) || node.credentials?.azureOpenAiApi !== undefined) return null;
  if (/openai/i.test(node.type) || node.credentials?.openAiApi !== undefined) return { kind: 'llm', where: 'OpenAI node parameter' };
  return { kind: 'other', where: 'parameter named "model"' };
}

const TOKEN = /[A-Za-z0-9][A-Za-z0-9._:-]*/g;
const QUOTES = new Set(['"', "'", '`']);

/** Tokens wrapped in quotes, e.g. 'gpt-4' in code or "gpt-4" in a JSON body (escaped quotes included). */
function quotedTokens(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(TOKEN)) {
    const before = text[m.index - 1];
    const after = text[m.index + m[0].length];
    if (before !== undefined && QUOTES.has(before) && after !== undefined && (QUOTES.has(after) || after === '\\')) out.push(m[0]);
  }
  return out;
}

/** Path and query segments of a URL, e.g. ".../realtime?model=gpt-4o-realtime-preview". */
function urlSegments(text: string): string[] {
  if (!text.includes('://') && !text.startsWith('/')) return [];
  return text.split(/[/?&=#\s]/).filter(Boolean);
}

/** The whole parameter value, with n8n's "=" expression prefix removed when it holds a plain literal. */
function wholeValue(text: string): string {
  const trimmed = text.trim();
  return trimmed.startsWith('=') && !trimmed.includes('{{') ? trimmed.slice(1).trim() : trimmed;
}

/** A parameter that holds a model: "model", "modelId.value", or a { name: "model", value } pair. */
function isModelNamed(leaf: StringLeaf): boolean {
  if (/model/i.test(leaf.path)) return true;
  const name = (leaf.parent as { name?: unknown } | undefined)?.name;
  return /value/i.test(leaf.key) && typeof name === 'string' && /model/i.test(name);
}

/**
 * Strings that might be model IDs. Free text (code, prompts) only counts when quoted,
 * so a variable named o1 or a prompt mentioning davinci is not reported.
 */
function candidates(leaf: StringLeaf, kind: Strategy['kind']): string[] {
  const modelNamed = isModelNamed(leaf);
  switch (kind) {
    case 'http':
      return [wholeValue(leaf.value), ...quotedTokens(leaf.value), ...urlSegments(leaf.value)];
    case 'llm':
      return modelNamed ? [wholeValue(leaf.value), ...quotedTokens(leaf.value)] : [wholeValue(leaf.value)];
    case 'code':
      return modelNamed ? [wholeValue(leaf.value), ...quotedTokens(leaf.value)] : quotedTokens(leaf.value);
    case 'other':
      return modelNamed ? [wholeValue(leaf.value)] : [];
  }
}

function describe(match: ModelMatch): string {
  const { token, entry, kind } = match;
  if (kind === 'alias') return `"${token}" (alias of ${entry.id})`;
  if (kind === 'dated-snapshot') return `"${token}" (snapshot of ${entry.id})`;
  if (kind === 'fine-tune') return `"${token}" (fine-tune matched to ${entry.id})`;
  return `"${token}"`;
}

const FINE_TUNE_NOTE =
  'Fine-tuned model ID matched to the deprecations page by its base model. The page states that inference on fine-tuned models stops when the underlying base model is deprecated, but does not list individual fine-tuned IDs.';

export function checkOpenAiModels(node: WorkflowNode, registry: Registry, index: ModelIndex, asOf: string): RuleFinding[] {
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

  const source = registry.sources[registry.openai.source];
  if (!source) throw new Error(`Registry references unknown source "${registry.openai.source}"`);

  return [...matches.values()].map(({ match, paths }) => {
    const { entry } = match;
    const past = entry.shutdownDate <= asOf;
    const unverifiedNote = match.kind === 'fine-tune' ? FINE_TUNE_NOTE : entry.verification === 'unverified' ? entry.verificationNote : undefined;
    return {
      category: 'openai-model',
      ruleId: 'openai/model-shutdown',
      severity: 'breaking',
      message: past
        ? `OpenAI has shut down model ${describe(match)}; API calls fail.`
        : `OpenAI shuts down model ${describe(match)}; API calls will fail.`,
      date: entry.shutdownDate,
      datePrecision: 'day',
      replacement: entry.replacement ?? 'None listed by OpenAI',
      verification: unverifiedNote ? 'unverified' : 'verified',
      ...(unverifiedNote ? { verificationNote: unverifiedNote } : {}),
      sources: [source.url],
      model: match.token,
      locations: paths.map((path) => `${strategy.where}: ${path}`),
    } satisfies RuleFinding;
  });
}
