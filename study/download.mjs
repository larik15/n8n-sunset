// Stage 2: download each distinct blob once from raw.githubusercontent.com (public files, no authentication), three at a time with pauses
// and a back-off on any error. Reads search/ and writes raw/<sha>.json and index.json into the data folder (STUDY_DATA, default ./study-data).
// Files are only written to disk; nothing from them is printed.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

const DATA = process.env.STUDY_DATA ?? 'study-data';
mkdirSync(DATA, { recursive: true });
process.chdir(DATA);

// n8n's own repositories hold product test fixtures and docs, and this project's repository holds its own test fixtures.
const EXCLUDED_OWNERS = new Set(['larik15', 'n8n-io']);
const items = readdirSync('search').flatMap((f) => readFileSync(`search/${f}`, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)));
const bySha = new Map();
for (const it of items) {
  if (it.fork || EXCLUDED_OWNERS.has(it.repo.split('/')[0].toLowerCase())) continue;
  if (!bySha.has(it.sha)) bySha.set(it.sha, it);
}
console.log(`search items ${items.length}, distinct blobs ${bySha.size}`);
mkdirSync('raw', { recursive: true });
const todo = [...bySha.values()].filter((it) => !existsSync(`raw/${it.sha}.json`) && !existsSync(`raw/${it.sha}.missing`));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let done = 0, failed = 0, pause = 0;

async function get(it) {
  const url = `https://raw.githubusercontent.com/${it.repo}/${it.ref}/${it.path.split('/').map(encodeURIComponent).join('/')}`;
  for (let attempt = 0; attempt < 5; attempt++) {
    while (Date.now() < pause) await sleep(1000);
    const res = await fetch(url, { headers: { 'User-Agent': 'n8n-sunset-study (aggregate research; github.com/larik15/n8n-sunset)' } }).catch(() => null);
    if (res?.ok) return writeFileSync(`raw/${it.sha}.json`, Buffer.from(await res.arrayBuffer()));
    if (res && res.status === 404) return writeFileSync(`raw/${it.sha}.missing`, '');
    pause = Date.now() + 30000 * (attempt + 1); // 429/5xx/network: everyone backs off
  }
  failed++;
}

const queue = [...todo];
await Promise.all(Array.from({ length: 3 }, async () => {
  while (queue.length) {
    await get(queue.shift());
    await sleep(250);
    if (++done % 500 === 0) console.log(`${done}/${todo.length} (failed ${failed})`);
  }
}));
writeFileSync('index.json', JSON.stringify([...bySha.values()]));
console.log(`done ${done}, failed ${failed}`);
