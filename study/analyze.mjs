// Stage 3: parse the downloaded files, deduplicate, scan with the published n8n-sunset package, and write aggregate numbers only
// (results.json in the data folder: STUDY_DATA, default ./study-data). Repository names are used in memory to count and are never written
// or printed; credentials in the files are never read out, printed or used (only node types, parameters for model IDs, and counts leave the scan).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadRegistry, readWorkflows, scanWorkflows } from 'n8n-sunset';

const DATA = process.env.STUDY_DATA ?? 'study-data';
mkdirSync(DATA, { recursive: true });
process.chdir(DATA);

const AS_OF = process.env.AS_OF ?? '2026-10-08';
const toolVersion = JSON.parse(readFileSync(new URL('./node_modules/n8n-sunset/package.json', import.meta.url), 'utf8')).version;
const registry = loadRegistry();
const index = JSON.parse(readFileSync('index.json', 'utf8'));
const strata = JSON.parse(readFileSync('strata.json', 'utf8'));

// Canonical form for "the same workflow published twice": node types, versions, parameters and disabled flags, in a stable order.
// Names, IDs, positions, credentials, webhook IDs, connections and workflow metadata are left out.
const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v);
const fingerprint = (wf) => {
  const nodes = wf.nodes.map((n) => JSON.stringify(sortKeys({ t: n.type, v: n.typeVersion ?? 1, p: n.parameters ?? {}, d: n.disabled === true }))).sort();
  return createHash('sha256').update(nodes.join('\n')).digest('hex');
};

const stats = { files: index.length, missing: 0, invalidJson: 0, notWorkflow: 0, workflowsParsed: 0, duplicatesRemoved: 0 };
const seen = new Map(); // fingerprint -> record (the first copy found decides the repository)
for (const it of index) {
  const file = `raw/${it.sha}.json`;
  if (!existsSync(file)) { stats.missing++; continue; }
  let json;
  try { json = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch { stats.invalidJson++; continue; }
  // A file may hold one workflow, an array of them, or an API-style { data: [...] }. Each object only counts as an
  // n8n workflow if it has a non-empty "nodes" array and a "connections" object.
  const candidates = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [json];
  const valid = candidates.filter((c) => c && typeof c === 'object' && Array.isArray(c.nodes) && c.nodes.length > 0 && c.connections && typeof c.connections === 'object' && !Array.isArray(c.connections));
  if (!valid.length) { stats.notWorkflow++; continue; }
  for (const raw of valid) {
    const [wf] = readWorkflows(raw, it.sha).workflows;
    if (!wf?.nodes?.length) { stats.notWorkflow++; continue; }
    stats.workflowsParsed++;
    const fp = fingerprint(wf);
    if (seen.has(fp)) { stats.duplicatesRemoved++; seen.get(fp).copies++; continue; }
    seen.set(fp, { wf: { ...wf, name: fp.slice(0, 12), file: fp.slice(0, 12) }, repo: it.repo, stratum: it.stratum, copies: 1, template: Boolean(raw?.meta?.templateId) });
  }
}
const records = [...seen.values()];
stats.distinctWorkflows = records.length;
stats.repos = new Set(records.map((r) => r.repo)).size;

const result = scanWorkflows(records.map((r) => r.wf), registry, { asOf: AS_OF, windowDays: 30, targets: ['3.0'] });
const byWf = new Map(records.map((r) => [r.wf.file, { rec: r, findings: [] }]));
for (const f of result.findings) byWf.get(f.file).findings.push(f);
const rows = [...byWf.values()];
const N = rows.length;

const wilson = (k, n) => {
  if (!n) return [0, 0];
  const z = 1.96, p = k / n, d = 1 + (z * z) / n, c = p + (z * z) / (2 * n), m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [((c - m) / d) * 100, ((c + m) / d) * 100];
};
const isAi = (r) => r.rec.wf.nodes.some((n) => /langchain|openAi|anthropic|gemini/i.test(n.type));
const shareAmongAi = (pred) => {
  const ai = rows.filter(isAi);
  const k = ai.filter(pred).length;
  const [lo, hi] = wilson(k, ai.length);
  return { workflows: k, of: ai.length, pct: +((k / ai.length) * 100).toFixed(1), ci95: [+lo.toFixed(1), +hi.toFixed(1)] };
};
const perRepoCount = new Map();
for (const r of rows) perRepoCount.set(r.rec.repo, (perRepoCount.get(r.rec.repo) ?? 0) + 1);
const inStratum = new Map();
for (const r of rows) inStratum.set(r.rec.stratum, (inStratum.get(r.rec.stratum) ?? 0) + 1);
const totalPop = [...inStratum.keys()].reduce((s, k) => s + strata[k].total, 0);
const share = (pred) => {
  const k = rows.filter(pred).length;
  const [lo, hi] = wilson(k, N);
  // Repo-balanced: every repository counts once, split evenly across its workflows.
  const repoBalanced = rows.reduce((s, r) => s + (pred(r) ? 1 / perRepoCount.get(r.rec.repo) : 0), 0) / perRepoCount.size;
  // Size-weighted: each stratum weighted by GitHub's estimated number of matching files in it.
  const weighted = rows.reduce((s, r) => s + (pred(r) ? strata[r.rec.stratum].total / inStratum.get(r.rec.stratum) : 0), 0) / totalPop;
  return { workflows: k, pct: +((k / N) * 100).toFixed(1), ci95: [+lo.toFixed(1), +hi.toFixed(1)], repoBalancedPct: +(repoBalanced * 100).toFixed(1), sizeWeightedPct: +(weighted * 100).toFixed(1) };
};

// A No Operation node never sends a request, even when it still carries another node's parameters and credentials
// (n8n-sunset 0.2.0 reports those through the credential check; that is a false positive for this study).
const NOOP = 'n8n-nodes-base.noOp';
const breakingRaw = (f) => f.severity === 'breaking' && !f.nodeDisabled;
const breaking = (f) => breakingRaw(f) && f.nodeType !== NOOP;
const dated = (f) => f.trigger === 'date';
const has = (r, pred) => r.findings.some(pred);
// Fine-tuned model IDs contain the owner's organization and a suffix after the base model name (and, for the legacy form, after an "ft-" marker):
// only the base model is kept, so no organization name can reach the results.
const safeModel = (m) => String(m).replace(/^(ft:[^:]+):.*$/s, '$1:*').replace(/^([a-z0-9.-]+):ft-.*$/si, '$1:ft-*');
const PROVIDERS = { 'openai-model': 'OpenAI models', 'openai-endpoint': 'OpenAI endpoints', 'anthropic-model': 'Anthropic models', 'gemini-model': 'Gemini models' };

// Per shutdown date (breaking, enabled nodes), both past and upcoming. A date row counts a workflow once, however many of the date's models it uses.
const dates = new Map();
for (const r of rows) for (const d of new Set(r.findings.filter((f) => breaking(f) && dated(f)).map((f) => f.date))) dates.set(d, (dates.get(d) ?? 0) + 1);
const modelsOnDate = (date) => {
  const m = new Map();
  for (const r of rows) for (const model of new Set(r.findings.filter((f) => breaking(f) && f.date === date && f.model).map((f) => safeModel(f.model)))) m.set(model, (m.get(model) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([model, workflows]) => ({ model, workflows }));
};
const perDate = [...dates.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date]) => {
  const cats = new Set(rows.flatMap((r) => r.findings.filter((f) => breaking(f) && f.date === date).map((f) => f.category)));
  return { date, status: date <= AS_OF ? 'past' : 'upcoming', categories: [...cats].sort(), ...share((r) => has(r, (f) => breaking(f) && f.date === date)), models: modelsOnDate(date) };
});

const top = (pick, limit = 15) => {
  const m = new Map();
  for (const r of rows) for (const key of new Set(r.findings.filter(pick.filter).map(pick.key))) m.set(key, (m.get(key) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([key, k]) => ({ key, workflows: k, pct: +((k / N) * 100).toFixed(1) }));
};

// Repository concentration, by rank only (names never leave memory).
const repoCounts = [...perRepoCount.values()].sort((a, b) => b - a);
let cumulative = 0;
const repoConcentration = {
  repositories: repoCounts.length,
  top10: repoCounts.slice(0, 10).map((n, i) => { cumulative += n; return { rank: i + 1, workflows: n, pct: +((n / N) * 100).toFixed(1), cumulativePct: +((cumulative / N) * 100).toFixed(1) }; }),
  others: { repositories: repoCounts.length - 10, workflows: N - cumulative, pct: +(((N - cumulative) / N) * 100).toFixed(1) },
  repositoriesWithOneWorkflow: repoCounts.filter((n) => n === 1).length,
  repositoriesWithOneWorkflowPct: +((repoCounts.filter((n) => n === 1).length / repoCounts.length) * 100).toFixed(1),
  medianWorkflowsPerRepository: repoCounts[Math.floor(repoCounts.length / 2)],
};

const out = {
  asOf: AS_OF,
  tool: `n8n-sunset@${toolVersion}`,
  registryVersion: registry.registryVersion,
  query: '"n8n-nodes-base" "typeVersion" "connections" extension:json',
  strata: Object.keys(strata).length,
  estimatedPopulation: Object.values(strata).reduce((s, x) => s + x.total, 0),
  collection: stats,
  sample: {
    largestRepoSharePct: repoConcentration.top10[0].pct,
    top10RepoSharePct: repoConcentration.top10[9].cumulativePct,
    withTemplateIdPct: +((records.filter((r) => r.template).length / N) * 100).toFixed(1),
    publishedMoreThanOncePct: +((records.filter((r) => r.copies > 1).length / N) * 100).toFixed(1),
    usesAnyAiNodePct: +((rows.filter(isAi).length / N) * 100).toFixed(1),
  },
  repoConcentration,
  headline: {
    anyBreakingAlreadyPast: share((r) => has(r, (f) => breaking(f) && dated(f) && f.status === 'past')),
    anyBreakingWithin30Days: share((r) => has(r, (f) => breaking(f) && dated(f) && f.status === 'upcoming' && f.withinWindow)),
    anyBreakingUpcomingLater: share((r) => has(r, (f) => breaking(f) && dated(f) && f.status === 'upcoming' && !f.withinWindow)),
    anyBreakingDated: share((r) => has(r, (f) => breaking(f) && dated(f))),
    anyBreakingDatedIncludingNoOp: share((r) => has(r, (f) => breakingRaw(f) && dated(f))),
    anyBreakingDatedVerifiedOnly: share((r) => has(r, (f) => breaking(f) && dated(f) && f.verification === 'verified')),
    anyWarningOrChangeOnly: share((r) => !has(r, (f) => breaking(f) && dated(f)) && has(r, (f) => dated(f) && !f.nodeDisabled && f.nodeType !== NOOP)),
    breaksOnN8n3: share((r) => has(r, (f) => breaking(f) && f.trigger === 'upgrade')),
  },
  amongAiWorkflows: {
    anyBreakingAlreadyPast: shareAmongAi((r) => has(r, (f) => breaking(f) && dated(f) && f.status === 'past')),
    anyBreakingWithin30Days: shareAmongAi((r) => has(r, (f) => breaking(f) && dated(f) && f.status === 'upcoming' && f.withinWindow)),
    anyBreakingDated: shareAmongAi((r) => has(r, (f) => breaking(f) && dated(f))),
    breaksOnN8n3: shareAmongAi((r) => has(r, (f) => breaking(f) && f.trigger === 'upgrade')),
  },
  byProvider: Object.fromEntries(Object.entries(PROVIDERS).map(([cat, label]) => [label, {
    past: share((r) => has(r, (f) => breaking(f) && f.category === cat && f.status === 'past')),
    upcoming: share((r) => has(r, (f) => breaking(f) && f.category === cat && f.status === 'upcoming')),
  }])),
  perDate,
  topModels: top({ filter: (f) => breaking(f) && f.model, key: (f) => `${safeModel(f.model)} (${f.date}, ${f.status})` }, 60),
  topModelNodeTypes: top({ filter: (f) => breaking(f) && dated(f), key: (f) => f.nodeType }),
  topN8n3Changes: top({ filter: (f) => breaking(f) && f.trigger === 'upgrade', key: (f) => f.ruleId }),
  topN8n3NodeTypes: top({ filter: (f) => breaking(f) && f.trigger === 'upgrade', key: (f) => f.nodeType }),
};
writeFileSync('results.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify({ tool: out.tool, registry: out.registryVersion, collection: stats, headline: Object.fromEntries(Object.entries(out.headline).map(([k, v]) => [k, `${v.workflows} (${v.pct}%)`])) }, null, 2));
