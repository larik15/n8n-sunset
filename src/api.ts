import { readWorkflows, type LoadResult } from './workflows.js';

/** Largest page the n8n public API allows (limit parameter, maximum 250). */
export const API_PAGE_LIMIT = 250;
const MAX_PAGES = 10_000;

export interface ApiOptions {
  /** The API base, e.g. https://n8n.example.com/api/v1 (the N8N_API_URL environment variable). */
  baseUrl: string;
  /** Sent as the X-N8N-API-KEY header; never printed. */
  apiKey: string;
  fetch?: typeof globalThis.fetch;
  /** Per-request timeout in milliseconds. */
  timeoutMs?: number;
}

/** The API base without a trailing slash, checked to end in /api/v<n>. */
export function apiBase(baseUrl: string): URL {
  let url: URL;
  try {
    url = new URL(baseUrl.trim());
  } catch {
    throw new Error(`N8N_API_URL is not a URL: "${baseUrl}"`);
  }
  if (!/^https?:$/.test(url.protocol)) throw new Error(`N8N_API_URL must use http or https, got "${url.protocol}"`);
  url.pathname = url.pathname.replace(/\/+$/, '');
  if (!/\/api\/v\d+$/.test(url.pathname)) {
    throw new Error(`N8N_API_URL must end with the API version path, for example https://n8n.example.com/api/v1 (got "${url.origin}${url.pathname}")`);
  }
  url.search = '';
  url.hash = '';
  return url;
}

/** Where a workflow opens in the n8n editor: the API base without /api/v1, plus /workflow/<id>. */
function editorUrl(base: URL, id: unknown): string {
  const root = base.pathname.replace(/\/api\/v\d+$/, '');
  return `${base.origin}${root}/workflow/${String(id)}`;
}

async function getPage(options: Required<Pick<ApiOptions, 'apiKey' | 'fetch' | 'timeoutMs'>>, url: URL): Promise<unknown> {
  let response: Response;
  try {
    response = await options.fetch(url, {
      headers: { 'X-N8N-API-KEY': options.apiKey, accept: 'application/json' },
      signal: AbortSignal.timeout(options.timeoutMs),
    });
  } catch (error) {
    const reason = error instanceof Error ? (error.name === 'TimeoutError' ? `timed out after ${options.timeoutMs} ms` : error.message) : String(error);
    throw new Error(`Could not reach the n8n API at ${url.origin}${url.pathname}: ${reason}`);
  }
  const text = await response.text();
  if (!response.ok) {
    let detail = '';
    try {
      const message = (JSON.parse(text) as { message?: unknown }).message;
      if (typeof message === 'string') detail = `: ${message}`;
    } catch {
      // not JSON; the status is enough
    }
    const hint = response.status === 401 || response.status === 403 ? ' (check N8N_API_KEY)' : '';
    throw new Error(`The n8n API answered ${response.status} ${response.statusText}${detail}${hint}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`The n8n API at ${url.origin}${url.pathname} did not return JSON; check that N8N_API_URL points to the API (…/api/v1)`);
  }
}

/**
 * Reads every workflow through GET /workflows, following nextCursor, without writing files.
 * Each workflow's `file` is its editor URL, so findings point straight at it.
 */
export async function loadWorkflowsFromApi(options: ApiOptions): Promise<LoadResult & { pages: number }> {
  const base = apiBase(options.baseUrl);
  if (!options.apiKey) throw new Error('N8N_API_KEY is empty');
  const request = { apiKey: options.apiKey, fetch: options.fetch ?? globalThis.fetch, timeoutMs: options.timeoutMs ?? 30_000 };
  const result: LoadResult & { pages: number } = { workflows: [], errors: [], skipped: [], symlinks: [], pages: 0 };
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  do {
    const url = new URL(`${base.href}/workflows`);
    url.searchParams.set('limit', String(API_PAGE_LIMIT));
    url.searchParams.set('excludePinnedData', 'true');
    if (cursor) url.searchParams.set('cursor', cursor);

    const page = await getPage(request, url);
    result.pages++;
    const data = (page as { data?: unknown }).data;
    if (!Array.isArray(data)) throw new Error('The n8n API response has no "data" array; is N8N_API_URL the n8n public API?');
    for (const item of data) {
      const id = (item as { id?: unknown })?.id;
      const label = id === undefined ? `${base.origin}${base.pathname}/workflows (page ${result.pages})` : editorUrl(base, id);
      const { workflows, reason } = readWorkflows(item, label);
      if (reason) result.skipped.push({ file: label, reason });
      result.workflows.push(...workflows);
    }

    const next = (page as { nextCursor?: unknown }).nextCursor;
    cursor = typeof next === 'string' && next !== '' ? next : undefined;
    if (cursor) {
      if (seenCursors.has(cursor)) throw new Error('The n8n API returned the same nextCursor twice; stopping to avoid a loop');
      seenCursors.add(cursor);
    }
    if (result.pages >= MAX_PAGES) throw new Error(`Stopped after ${MAX_PAGES} pages from the n8n API`);
  } while (cursor);

  return result;
}
