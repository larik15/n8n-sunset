import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
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
  /** From the export's "active" flag; undefined when the export doesn't say. */
  active?: boolean;
  /** From the export's "isArchived" flag. */
  archived?: boolean;
  nodes: WorkflowNode[];
}

export interface SkippedFile {
  file: string;
  /** Why no workflow was read from it. */
  reason: string;
}

export interface LoadResult {
  workflows: Workflow[];
  /** Files that could not be read or parsed as JSON. */
  errors: { file: string; message: string }[];
  /** JSON files that parsed but held no n8n workflow, with the reason. */
  skipped: SkippedFile[];
  /** Symbolic links found while walking folders; they are not followed. */
  symlinks: string[];
}

const SKIP_DIRS = new Set(['node_modules', '.git']);

function displayPath(file: string, cwd: string): string {
  const rel = relative(cwd, file);
  const shown = rel && !rel.startsWith('..') ? rel : file;
  return shown.split(sep).join('/');
}

function walkFolder(dir: string, files: string[], symlinks: string[]): void {
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isSymbolicLink()) symlinks.push(full);
    else if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) walkFolder(full, files, symlinks);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
      files.push(full);
    }
  }
}

type Obj = Record<string, unknown>;
const isObject = (value: unknown): value is Obj => typeof value === 'object' && value !== null && !Array.isArray(value);
const hasNodes = (value: unknown): value is Obj & { nodes: unknown[] } => isObject(value) && Array.isArray(value.nodes);

function isNode(value: unknown): value is WorkflowNode {
  return isObject(value) && typeof value.type === 'string' && typeof value.name === 'string';
}

/**
 * The workflow inside one candidate, which is either an exported workflow ({ nodes }) or an
 * n8n.io template, either { workflow: { nodes } } or the template API's
 * { workflow: { name, workflow: { nodes } } }. `meta` holds the name and flags.
 */
function unwrap(candidate: unknown): { meta: Obj; body: Obj & { nodes: unknown[] } } | undefined {
  if (hasNodes(candidate)) return { meta: candidate, body: candidate };
  if (isObject(candidate) && isObject(candidate.workflow)) {
    const inner = candidate.workflow;
    if (hasNodes(inner)) return { meta: inner, body: inner };
    if (hasNodes(inner.workflow)) return { meta: inner, body: inner.workflow };
  }
  return undefined;
}

/**
 * Pulls workflows out of the shapes n8n produces: a single exported workflow, an array of
 * workflows (`n8n export:workflow --all`), an API page (`{ data: [...] }`), or an n8n.io template.
 * Returns the reason when the JSON holds no workflow.
 */
export function readWorkflows(json: unknown, file: string): { workflows: Workflow[]; reason?: string } {
  let candidates: unknown[];
  let shape: string;
  if (Array.isArray(json)) {
    candidates = json;
    shape = json.length === 0 ? 'empty array' : 'array without n8n workflows';
  } else if (isObject(json) && Array.isArray(json.data)) {
    candidates = json.data;
    shape = 'API page ("data") without n8n workflows';
  } else {
    candidates = [json];
    shape = isObject(json) ? 'JSON object without a "nodes" array' : `JSON ${json === null ? 'null' : typeof json}, not an object`;
  }

  // An empty API page ({ "data": [], "nextCursor": null }) is a valid answer from an instance with no workflows.
  if (isObject(json) && Array.isArray(json.data) && json.data.length === 0) return { workflows: [] };

  const found = candidates.map(unwrap).filter((w) => w !== undefined);
  const workflows = found.map(({ meta, body }, index) => ({
    name: typeof meta.name === 'string' && meta.name.trim() ? meta.name : found.length > 1 ? `${basename(file)} #${index + 1}` : basename(file),
    id: typeof meta.id === 'string' || typeof meta.id === 'number' ? String(meta.id) : undefined,
    file,
    ...(typeof meta.active === 'boolean' ? { active: meta.active } : {}),
    ...(meta.isArchived === true ? { archived: true } : {}),
    nodes: body.nodes.filter(isNode),
  }));
  return workflows.length ? { workflows } : { workflows, reason: shape };
}

export function loadWorkflows(paths: string[], cwd = process.cwd()): LoadResult {
  const result: LoadResult = { workflows: [], errors: [], skipped: [], symlinks: [] };
  const found: string[] = [];
  const symlinks: string[] = [];
  for (const path of paths) {
    const full = resolve(cwd, path);
    let stats;
    try {
      stats = statSync(full);
    } catch {
      throw new Error(`Path not found: ${path}`);
    }
    if (stats.isDirectory()) walkFolder(full, found, symlinks);
    else found.push(full);
  }

  // The same file can be reached twice ("./workflows ./workflows/a.json", overlapping folders,
  // different spellings of one path); read each real file once.
  const seen = new Set<string>();
  const files = found.filter((file) => {
    const real = realpathSync.native(file);
    const key = process.platform === 'win32' || process.platform === 'darwin' ? real.toLowerCase() : real;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Links are not followed; they count as skipped files so a scan never silently misses them.
  for (const link of [...new Set(symlinks)]) {
    const shown = displayPath(link, cwd);
    result.symlinks.push(shown);
    result.skipped.push({ file: shown, reason: 'symbolic link, not followed' });
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
    const { workflows, reason } = readWorkflows(json, shown);
    if (reason) result.skipped.push({ file: shown, reason });
    result.workflows.push(...workflows);
  }
  return result;
}
