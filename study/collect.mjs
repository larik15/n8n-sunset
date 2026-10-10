// Stage 1: GitHub code search, stratified by file size. Uses `gh api` (your own `gh auth login` session; this script holds no token),
// at most 10 search requests per minute. Writes search/<stratum>.jsonl (one hit per line) and strata.json (GitHub's estimated number
// of matching files per stratum) into the data folder (STUDY_DATA, default ./study-data), which is git-ignored.
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const DATA = process.env.STUDY_DATA ?? 'study-data';
mkdirSync(DATA, { recursive: true });
process.chdir(DATA);

const Q = '"n8n-nodes-base" "typeVersion" "connections" extension:json';
const EDGES = [0, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000, 11500, 13000, 14500, 16000, 18000, 20000, 22500, 25000, 28500, 32000, 38000, 45000, 55000, 70000, 90000, 120000, 200000, 400000];
const strata = EDGES.slice(0, -1).map((lo, i) => `${i === 0 ? 0 : lo + 1}..${EDGES[i + 1]}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync('search', { recursive: true });
const meta = existsSync('strata.json') ? JSON.parse(readFileSync('strata.json', 'utf8')) : {};

let last = 0;
async function search(q, page) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const wait = last + 6500 - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    try {
      const out = execFileSync('gh', ['api', '-X', 'GET', 'search/code', '-f', `q=${q}`, '-f', 'per_page=100', '-f', `page=${page}`], { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'pipe'] });
      return JSON.parse(out);
    } catch (e) {
      const msg = String(e.stderr || e.message);
      if (/422|Cannot access beyond the first 1000/i.test(msg)) return { items: [], total_count: 0, end: true };
      console.error(`retry ${q} p${page}: ${msg.split('\n')[0]}`);
      await sleep(60000 * (attempt + 1));
    }
  }
  throw new Error(`gave up on ${q} page ${page}`);
}

for (const range of strata) {
  if (meta[range]?.done) continue;
  const file = `search/${range}.jsonl`;
  writeFileSync(file, '');
  let total = 0, got = 0;
  for (let page = 1; page <= 10; page++) {
    const res = await search(`${Q} size:${range}`, page);
    if (page === 1) total = res.total_count;
    for (const it of res.items ?? []) {
      appendFileSync(file, JSON.stringify({ stratum: range, repo: it.repository.full_name, fork: it.repository.fork, path: it.path, sha: it.sha, ref: new URL(it.url).searchParams.get('ref') }) + '\n');
      got++;
    }
    if (res.end || (res.items ?? []).length < 100) break;
  }
  meta[range] = { total, got, done: true, at: new Date().toISOString() };
  writeFileSync('strata.json', JSON.stringify(meta, null, 2));
  console.log(`${range}: ${got} of ~${total}`);
}
