import { readFileSync } from 'node:fs';

/** breaking and behavior-change are confirmed; warning means "may break, needs review" and never fails CI. */
export type Severity = 'breaking' | 'behavior-change' | 'warning' | 'info';
export type Verification = 'verified' | 'unverified';
export type DatePrecision = 'day' | 'month';

export interface SourceRef {
  title: string;
  url: string;
  repoUrl?: string;
  resolvedUrl?: string;
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
}

const DEFAULT_REGISTRY_URL = new URL('../data/sunset-registry.json', import.meta.url);

export function loadRegistry(path: string | URL = DEFAULT_REGISTRY_URL): Registry {
  return JSON.parse(readFileSync(path, 'utf8')) as Registry;
}

export function sourceUrls(registry: Registry, keys: string[]): string[] {
  return keys.map((key) => {
    const source = registry.sources[key];
    if (!source) throw new Error(`Registry references unknown source "${key}"`);
    return source.url;
  });
}
