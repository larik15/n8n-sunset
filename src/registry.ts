import { readFileSync } from 'node:fs';

export type Severity = 'breaking' | 'behavior-change' | 'info';
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
  /** Highest typeVersion that has this option; a missing typeVersion counts as 1. */
  maxTypeVersion: number;
  parameter: string;
  value: string;
  /** Operation used when the workflow JSON leaves it out (n8n omits defaults). */
  defaultOperation: string;
  operations: Record<string, { name: string; path: string }>;
  replacement: string;
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
  nodeUsages?: OpenAiNodeUsage[];
  shutdownDate: string;
  replacement: string | null;
  announcement: string;
  note?: string;
  verification: Verification;
  verificationNote?: string;
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
