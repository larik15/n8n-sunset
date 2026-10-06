import { readFileSync } from 'node:fs';

/** breaking and behavior-change are confirmed; warning means "may break, needs review" and never fails CI. */
export type Severity = 'breaking' | 'behavior-change' | 'warning' | 'info';
export type Verification = 'verified' | 'unverified';
export type DatePrecision = 'day' | 'month';

export interface SourceRef {
  title: string;
  url: string;
  repoUrl?: string;
  previousUrl?: string;
  accessed: string;
}

export interface RemovedNode {
  type: string;
  displayName: string;
  severity: Severity;
  replacement: string | null;
  note?: string;
  verification: Verification;
  verificationNote?: string;
  sources: string[];
}

export interface NodeChange {
  id: string;
  title: string;
  nodeTypes: string[];
  /** Node types the rule also applies to, but which the official page does not name. */
  unverifiedNodeTypes?: string[];
  unverifiedNote?: string;
  severity: Severity;
  message: string;
  replacement: string | null;
  note?: string;
  verification: Verification;
  verificationNote?: string;
  sources: string[];
}

export interface OpenAiModel {
  id: string;
  aliases?: string[];
  shutdownDate: string;
  replacement: string | null;
  announcement: string;
  verification: Verification;
  verificationNote?: string;
  note?: string;
  /** Listed as a model family: dated snapshots (`<id>-YYYY-MM-DD`) match too. */
  matchDatedSnapshots?: boolean;
  /** Page label `ft-<base>`: fine-tuned models built on `<base>`. */
  fineTuneOf?: string;
}

/** A model with a retirement date announced by Anthropic or Google (Gemini API). */
export interface ProviderModel {
  id: string;
  /** Other names that resolve to this model, as documented by the provider. */
  aliases?: string[];
  /** The announced retirement or shutdown date, YYYY-MM-DD. */
  shutdownDate: string;
  replacement: string | null;
  /** Where the provider announced it, e.g. "2026-09-30: Claude Sonnet 4.5 model". */
  announcement: string;
  verification: Verification;
  verificationNote?: string;
  note?: string;
  /** Registry source keys for this entry. */
  sources: string[];
  /** Registry source keys that document the aliases; cited only when a workflow uses an alias. */
  aliasSources?: string[];
}

export interface ProviderModels {
  source: string;
  matching: string;
  excluded: string;
  models: ProviderModel[];
}

/** An n8n node that calls a deprecated OpenAI endpoint itself, e.g. the OpenAI node's "Assistant" resource. */
export interface OpenAiNodeUsage {
  nodeType: string;
  label: string;
  /** Type version range that has this option; a missing typeVersion counts as 1. */
  minTypeVersion?: number;
  maxTypeVersion?: number;
  /** When set, only nodes with this parameter set to this value match. */
  parameter?: string;
  value?: string;
  /** Value of `parameter` when the export leaves it out (n8n omits defaults). */
  parameterDefault?: string;
  /** Dotted parameter path that must be set (non-empty) for the usage to apply. */
  requires?: string;
  /** Names what was found, followed by the value at `requires`, e.g. "prompt object pmpt_123". */
  matchedLabel?: string;
  /** Parameter that selects the operation (default "operation"). */
  operationParameter?: string;
  /** Operation used when the workflow JSON leaves it out (n8n omits defaults). */
  defaultOperation: string;
  operations: Record<string, { name: string; paths: string[] }>;
  /** Falls back to the endpoint's replacement. */
  replacement?: string;
  note?: string;
  verification: Verification;
  verificationNote?: string;
  sources: string[];
}

export interface OpenAiEndpoint {
  id: string;
  /** How the message names it, e.g. "the Assistants API". */
  label: string;
  /** URL paths, e.g. "/v1/assistants". Paths below them match too, unless exactPath is set. */
  paths?: string[];
  exactPath?: boolean;
  /** Only requests with this HTTP method are affected. */
  method?: string;
  /** A request header that selects the deprecated API, e.g. OpenAI-Beta: realtime=v1. */
  header?: { name: string; value: string };
  /** Quoted object IDs with this prefix (e.g. "pmpt_") in request bodies or code also count as using the endpoint. */
  objectIdPrefix?: string;
  nodeUsages?: OpenAiNodeUsage[];
  shutdownDate: string;
  replacement: string | null;
  announcement: string;
  note?: string;
  verification: Verification;
  verificationNote?: string;
  sources: string[];
}

/** Models fine-tuned with the legacy /v1/fine-tunes API, e.g. curie:ft-acme-2021-08-23-17-54-10. */
export interface LegacyFineTunes {
  bases: string[];
  shutdownDate: string;
  replacement: string;
  announcement: string;
  note: string;
  verification: Verification;
  sources: string[];
  /** IDs created with a custom suffix: ada:ft-your-org:custom-model-name-2022-02-15-04-21-04. */
  suffixForm?: { verification: Verification; verificationNote: string; sources: string[] };
}

export interface Registry {
  registryVersion: string;
  description: string;
  sources: Record<string, SourceRef>;
  n8n: {
    release: {
      version: string;
      date: string;
      datePrecision: DatePrecision;
      verification: Verification;
      note: string;
      sources: string[];
    };
    removedNodes: RemovedNode[];
    changes: NodeChange[];
  };
  openai: {
    source: string;
    matching: string;
    endpointMatching: string;
    excluded: string;
    models: OpenAiModel[];
    legacyFineTunes: LegacyFineTunes;
    endpoints: OpenAiEndpoint[];
  };
  anthropic: ProviderModels;
  gemini: ProviderModels;
}

/** What a registry written before Anthropic and Gemini support gets, so `--registry` files from 0.1.x keep working. */
const noProviderModels = (): ProviderModels => ({ source: '', matching: '', excluded: '', models: [] });

const DEFAULT_REGISTRY_URL = new URL('../data/sunset-registry.json', import.meta.url);

/** Every source key the registry refers to. */
function referencedSources(registry: Registry): string[] {
  const { n8n, openai } = registry;
  return [
    ...n8n.release.sources,
    ...n8n.removedNodes.flatMap((n) => n.sources),
    ...n8n.changes.flatMap((c) => c.sources),
    openai.source,
    ...openai.legacyFineTunes.sources,
    ...(openai.legacyFineTunes.suffixForm?.sources ?? []),
    ...openai.endpoints.flatMap((e) => [...e.sources, ...(e.nodeUsages ?? []).flatMap((u) => u.sources)]),
    ...[registry.anthropic, registry.gemini].flatMap((p) => [
      ...(p.source ? [p.source] : []),
      ...p.models.flatMap((m) => [...m.sources, ...(m.aliasSources ?? [])]),
    ]),
  ];
}

/** Throws when a provider model entry is malformed: missing id, bad date, no source, or a duplicate ID or alias. */
function validateProviderModels(name: string, section: ProviderModels): void {
  const names = new Set<string>();
  for (const model of section.models) {
    if (typeof model.id !== 'string' || !model.id) throw new Error(`Registry ${name} has a model without an id`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(model.shutdownDate)) throw new Error(`Registry ${name} model ${model.id} has an invalid shutdownDate "${model.shutdownDate}"`);
    if (!Array.isArray(model.sources) || model.sources.length === 0) throw new Error(`Registry ${name} model ${model.id} cites no source`);
    for (const label of [model.id, ...(model.aliases ?? [])]) {
      if (names.has(label)) throw new Error(`Registry ${name} lists "${label}" twice`);
      names.add(label);
    }
  }
}

/** Throws when the registry is missing a section or refers to a source it doesn't define. */
export function validateRegistry(registry: Registry): Registry {
  if (!registry?.sources || !registry.n8n?.release || !registry.openai?.models || !registry.openai.endpoints || !registry.openai.legacyFineTunes) {
    throw new Error('Registry is missing required sections (sources, n8n, openai)');
  }
  registry.anthropic ??= noProviderModels();
  registry.gemini ??= noProviderModels();
  validateProviderModels('anthropic', registry.anthropic);
  validateProviderModels('gemini', registry.gemini);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(registry.registryVersion)) throw new Error(`Registry has an invalid registryVersion "${registry.registryVersion}"`);
  const unknown = [...new Set(referencedSources(registry).filter((key) => !registry.sources[key]))];
  if (unknown.length) throw new Error(`Registry references unknown source${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}`);
  return registry;
}

export function loadRegistry(path: string | URL = DEFAULT_REGISTRY_URL): Registry {
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read registry ${String(path)}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return validateRegistry(json as Registry);
}

export function sourceUrls(registry: Registry, keys: string[]): string[] {
  return keys.map((key) => {
    const source = registry.sources[key];
    if (!source) throw new Error(`Registry references unknown source "${key}"`);
    return source.url;
  });
}
