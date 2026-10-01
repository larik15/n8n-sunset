import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';

export interface WorkflowNode {
  id?: string;
  name: string;
  type: string;
  typeVersion?: number;
  parameters?: Record<string, unknown>;
  credentials?: Record<string, unknown>;
  alwaysOutputData?: boolean;
  disabled?: boolean;
}

export interface Workflow {
  name: string;
  id?: string;
  /** Path of the file the workflow came from, relative to the working directory. */
  file: string;
  nodes: WorkflowNode[];
}

export interface LoadResult {
  workflows: Workflow[];
  /** Files that could not be read or parsed. */
  errors: { file: string; message: string }[];
  /** JSON files that parsed but contained no n8n workflow. */
  skipped: string[];
}

const SKIP_DIRS = new Set(['node_modules', '.git']);

function displayPath(file: string, cwd: string): string {
  const rel = relative(cwd, file);
  const shown = rel && !rel.startsWith('..') ? rel : file;
  return shown.split(sep).join('/');
}

function findJsonFiles(dir: string, out: string[]): void {
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) findJsonFiles(full, out);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
      out.push(full);
    }
  }
}

function isWorkflowLike(value: unknown): value is { name?: unknown; id?: unknown; nodes: unknown[] } {
  return typeof value === 'object' && value !== null && Array.isArray((value as { nodes?: unknown }).nodes);
}

function isNode(value: unknown): value is WorkflowNode {
  if (typeof value !== 'object' || value === null) return false;
  const node = value as Record<string, unknown>;
  return typeof node.type === 'string' && typeof node.name === 'string';
}

/**
 * Pulls workflows out of the shapes n8n produces: a single exported workflow,
 * an array of workflows (`n8n export:workflow --all`), or an API page (`{ data: [...] }`).
 */
export function extractWorkflows(json: unknown, file: string): Workflow[] {
  let candidates: unknown[];
  if (Array.isArray(json)) candidates = json;
  else if (isWorkflowLike(json)) candidates = [json];
  else if (typeof json === 'object' && json !== null && Array.isArray((json as { data?: unknown }).data)) {
    candidates = (json as { data: unknown[] }).data;
  } else candidates = [];

  return candidates.filter(isWorkflowLike).map((wf, index) => ({
    name:
      typeof wf.name === 'string' && wf.name.trim()
        ? wf.name
        : candidates.length > 1
          ? `${basename(file)} #${index + 1}`
          : basename(file),
    id: typeof wf.id === 'string' || typeof wf.id === 'number' ? String(wf.id) : undefined,
    file,
    nodes: wf.nodes.filter(isNode),
  }));
}

export function loadWorkflows(paths: string[], cwd = process.cwd()): LoadResult {
  const result: LoadResult = { workflows: [], errors: [], skipped: [] };
  const files: string[] = [];
  for (const path of paths) {
    const full = resolve(cwd, path);
    let stats;
    try {
      stats = statSync(full);
    } catch {
      throw new Error(`Path not found: ${path}`);
    }
    if (stats.isDirectory()) findJsonFiles(full, files);
    else files.push(full);
  }

  for (const file of files) {
    const shown = displayPath(file, cwd);
    let json: unknown;
    try {
      json = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    } catch (error) {
      result.errors.push({ file: shown, message: error instanceof Error ? error.message : String(error) });
      continue;
    }
    const workflows = extractWorkflows(json, shown);
    if (workflows.length === 0) result.skipped.push(shown);
    result.workflows.push(...workflows);
  }
  return result;
}
