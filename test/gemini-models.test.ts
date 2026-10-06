import { describe, expect, it } from 'vitest';
import { EXIT_BREAKING, main } from '../src/cli.js';
import { buildProviderIndex, matchProviderModel } from '../src/rules/providers.js';
import { scanWorkflows } from '../src/scan.js';
import { loadWorkflows } from '../src/workflows.js';
import { PROVIDERS_AS_OF, byNode, fixture, registry, scanFixture } from './helpers.js';

const DEPRECATIONS = 'https://ai.google.dev/gemini-api/docs/deprecations';
const CHANGELOG = 'https://ai.google.dev/gemini-api/docs/changelog';
const EARLIEST = 'Google lists this as the earliest possible shutdown date and confirms the exact date in advance.';
const scan = (path: string, options: { asOf?: string; windowDays?: number } = {}) => scanFixture(path, { asOf: PROVIDERS_AS_OF, ...options });

describe('Gemini registry data', () => {
  const models = registry.gemini.models;
  const byId = (id: string) => models.find((m) => m.id === id);

  it('records every model that has a shutdown date, with its replacement and source', () => {
    expect(models).toHaveLength(54);
    expect(byId('gemini-2.0-flash')).toMatchObject({
      shutdownDate: '2026-06-01',
      replacement: 'gemini-3.6-flash',
      verification: 'verified',
      sources: ['gemini-deprecations'],
    });
    expect(byId('text-embedding-004')).toMatchObject({ shutdownDate: '2026-01-14', replacement: 'gemini-embedding-2' });
    expect(byId('gemini-2.5-flash-image')).toMatchObject({ shutdownDate: '2026-10-02', replacement: 'gemini-3.1-flash-image-preview' });
    expect(byId('veo-3.1-generate-preview')).toMatchObject({ shutdownDate: '2026-10-22', replacement: 'gemini-omni-1.1-flash' });
    expect(byId('gemini-embedding-001')).toMatchObject({ shutdownDate: '2028-05-14' });
    expect(registry.sources[registry.gemini.source]).toMatchObject({ url: DEPRECATIONS });
    expect(registry.sources['gemini-changelog']!.url).toBe(CHANGELOG);
  });

  it('takes dated announcements that only the release notes carry from the release notes, with no invented replacement', () => {
    const fromChangelog = models.filter((m) => m.sources.includes('gemini-changelog'));
    expect(fromChangelog.map((m) => m.id).sort()).toEqual([
      'gemini-2.0-flash-exp', 'gemini-2.0-flash-exp-image-generation', 'gemini-2.0-flash-thinking-exp', 'gemini-2.0-flash-thinking-exp-01-21',
      'gemini-2.0-flash-thinking-exp-1219', 'gemini-2.0-pro-exp', 'gemini-2.0-pro-exp-02-05', 'gemini-2.5-flash-lite-preview-06-17',
    ]);
    for (const m of fromChangelog) expect(m.replacement, m.id).toBeNull();
    expect(byId('gemini-2.0-pro-exp')).toMatchObject({ shutdownDate: '2025-12-09', announcement: '2025-11-04: release notes' });
  });

  it('leaves out models with no shutdown date, managed agents and models only reported as already shut down', () => {
    for (const id of [
      'gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite', 'gemini-3.5-flash', 'gemini-3-flash-preview', 'gemini-3.1-pro-preview',
      'gemini-3.8-flash', 'antigravity-preview-05-2026', 'gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-omni-flash-preview', 'gemini-pro-latest',
    ]) {
      expect(byId(id), id).toBeUndefined();
    }
  });
});

describe('matchProviderModel (Gemini)', () => {
  const index = buildProviderIndex('gemini', registry.gemini.models);

  it('matches the bare ID, the "models/" form n8n stores, and the REST URL form', () => {
    for (const token of ['gemini-2.0-flash', 'models/gemini-2.0-flash', 'gemini-2.0-flash:generateContent', 'models/gemini-2.0-flash:streamGenerateContent']) {
      expect(matchProviderModel(token, index), token).toMatchObject({ token: 'gemini-2.0-flash', alias: false, entry: { shutdownDate: '2026-06-01' } });
    }
  });

  it('does not match near misses, other casing, longer names, Vertex paths, or unlisted models', () => {
    for (const token of [
      'gemini-2.0-flash-lite-002', 'Gemini-2.0-Flash', 'gemini-2.0-flash-exp-extra', 'publishers/google/models/gemini-2.0-flash',
      'tunedModels/gemini-2.0-flash', 'gemini-2.5-flash', 'models/', ':generateContent', 'google/gemini-2.0-flash',
    ]) {
      expect(matchProviderModel(token, index), token).toBeUndefined();
    }
  });
});

describe('Google Gemini nodes', () => {
  const result = scan('rules/gemini-nodes.json');

  it('flags a shut down model once and strips the "models/" prefix', () => {
    const findings = byNode(result, 'Shut down Flash 2.0');
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleId: 'gemini/model-shutdown',
      category: 'gemini-model',
      severity: 'breaking',
      workflow: 'Content pipeline',
      nodeType: '@n8n/n8n-nodes-langchain.lmChatGoogleGemini',
      model: 'gemini-2.0-flash',
      date: '2026-06-01',
      trigger: 'date',
      status: 'past',
      countsTowardExit: true,
      replacement: 'gemini-3.6-flash',
      verification: 'verified',
      sources: [DEPRECATIONS],
      locations: ['Google Gemini node parameter: modelName'],
    });
    expect(findings[0]!.message).toBe('Google has shut down Gemini API model "gemini-2.0-flash"; API calls fail.');
  });

  it('flags a shutdown that happened a few days ago', () => {
    expect(byNode(result, 'Flash Image (shut down 2026-10-02)')[0]).toMatchObject({ date: '2026-10-02', status: 'past', daysUntil: -4, countsTowardExit: true });
  });

  it('grades by date: a shutdown inside the window fails the run, one far away does not, and both carry the earliest-date note', () => {
    const [soon] = byNode(result, 'Video generation');
    expect(soon).toMatchObject({
      model: 'veo-3.1-generate-preview',
      date: '2026-10-22',
      status: 'upcoming',
      daysUntil: 16,
      withinWindow: true,
      countsTowardExit: true,
      replacement: 'gemini-omni-1.1-flash',
      locations: ['Google Gemini node parameter: modelId.value'],
    });
    expect(soon!.message).toBe(`Google shuts down Gemini API model "veo-3.1-generate-preview"; API calls will fail. ${EARLIEST}`);
    const [later] = byNode(result, 'Flash-Lite 3.1 (shutdown 2027-05-07)');
    expect(later).toMatchObject({ date: '2027-05-07', status: 'upcoming', daysUntil: 213, withinWindow: false, countsTowardExit: false, severity: 'breaking' });
    expect(later!.message).toContain(EARLIEST);
  });

  it('reads the embeddings node and the models inside an expression', () => {
    expect(byNode(result, 'Embeddings')[0]).toMatchObject({ model: 'text-embedding-004', replacement: 'gemini-embedding-2' });
    expect(byNode(result, 'Tiered model').map((f) => f.model)).toEqual(['gemini-2.0-flash-lite']);
  });

  it('says so when Google lists no replacement', () => {
    expect(byNode(result, 'Behind a gateway')[0]).toMatchObject({ model: 'gemini-2.0-flash-exp', replacement: 'None listed by Google', sources: [CHANGELOG] });
  });

  it('downgrades a node behind another base URL to an unverified warning, and a disabled node never counts', () => {
    expect(byNode(result, 'Behind a gateway')[0]).toMatchObject({ severity: 'warning', verification: 'unverified', countsTowardExit: false });
    expect(byNode(result, 'Disabled Pro preview')[0]).toMatchObject({ nodeDisabled: true, countsTowardExit: false });
  });

  it('reports nothing for models with no shutdown date, or for Vertex AI', () => {
    for (const node of ['Flash 2.5 (no shutdown date)', 'Flash 3 preview (replacement listed, no date)', 'Vertex AI model']) expect(byNode(result, node), node).toEqual([]);
  });
});

describe('Gemini in HTTP Request nodes, Code nodes and other nodes', () => {
  const result = scan('rules/gemini-http-code.json');

  it('reads the model from the URL path, without the method', () => {
    const [finding] = byNode(result, 'generateContent (model in the URL)');
    expect(finding).toMatchObject({ model: 'gemini-2.0-flash', locations: ['HTTP Request to generativelanguage.googleapis.com: url'], severity: 'breaking' });
  });

  it('reads the model from the body of the OpenAI-compatible endpoint', () => {
    expect(byNode(result, 'OpenAI-compatible endpoint (model in the body)')[0]).toMatchObject({
      model: 'gemini-2.0-flash-lite',
      locations: ['HTTP Request to generativelanguage.googleapis.com: jsonBody'],
    });
  });

  it('reports a model named in both the URL and the body as one finding with both locations', () => {
    const findings = byNode(result, 'Same model in URL and body');
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      model: 'text-embedding-004',
      locations: ['HTTP Request to generativelanguage.googleapis.com: url', 'HTTP Request to generativelanguage.googleapis.com: jsonBody'],
    });
  });

  it('treats an expression URL as Gemini when the node uses Gemini credentials', () => {
    expect(byNode(result, 'Expression URL with Gemini credentials')[0]).toMatchObject({ model: 'gemini-2.0-flash-001', severity: 'breaking' });
  });

  it('ignores Vertex AI endpoints, other hosts, and old model names that appear only in prompt text', () => {
    for (const node of ['Vertex AI endpoint', 'Some other host', 'Current model, old names only in the prompt']) expect(byNode(result, node), node).toEqual([]);
  });

  it('finds quoted model names in Code nodes, not variables, prose, or unlisted aliases', () => {
    const findings = byNode(result, 'Code with model names');
    expect(findings.map((f) => f.model)).toEqual(['gemini-2.0-flash']);
    expect(findings[0]).toMatchObject({ severity: 'breaking', locations: ['Code node source: jsCode'] });
  });

  it('reports a "model" field on any other node as an unverified warning', () => {
    const [finding] = byNode(result, 'Set model name');
    expect(finding).toMatchObject({ severity: 'warning', verification: 'unverified', model: 'gemini-2.0-flash-001', countsTowardExit: false });
    expect(finding!.verificationNote).toContain('not a Google Gemini node');
  });
});

describe('Gemini findings in the CLI', () => {
  async function run(args: string[], day = 6) {
    let stdout = '';
    const code = await main(args, {
      stdout: { write: (text: string) => (stdout += text), isTTY: false, columns: 160 },
      stderr: { write: () => undefined },
      cwd: process.cwd(),
      env: {},
      now: new Date(Date.UTC(2026, 9, day, 12)),
    });
    return { code, stdout };
  }

  it('exits 1 for shut down models, lists the date and replacement, and names the Google source in the footer', async () => {
    const { code, stdout } = await run([fixture('rules/gemini-nodes.json'), '--as-of', PROVIDERS_AS_OF]);
    expect(code).toBe(EXIT_BREAKING);
    expect(stdout).toContain('Google has shut down Gemini API model "gemini-2.0-flash"');
    expect(stdout).toContain('gemini-3.6-flash');
    expect(stdout).toContain(`${DEPRECATIONS} (Google Gemini)`);
  });

  it('puts the new category and rule IDs in the JSON report', async () => {
    const { stdout } = await run([fixture('rules/gemini-nodes.json'), fixture('rules/anthropic-llm-nodes.json'), '--as-of', PROVIDERS_AS_OF, '--json']);
    const report = JSON.parse(stdout);
    const pairs = new Set(report.findings.map((f: { category: string; ruleId: string }) => `${f.category} ${f.ruleId}`));
    expect(pairs).toEqual(new Set(['gemini-model gemini/model-shutdown', 'anthropic-model anthropic/model-retirement']));
    expect(report.registry.sources['gemini-deprecations'].url).toBe(DEPRECATIONS);
  });

  it('does not fail the run when the only breaking Gemini finding is more than 30 days away', () => {
    const { workflows } = loadWorkflows([fixture('rules/gemini-nodes.json')]);
    const only = { ...workflows[0]!, nodes: workflows[0]!.nodes.filter((n) => n.name === 'Flash-Lite 3.1 (shutdown 2027-05-07)') };
    const result = scanWorkflows([only], registry, { asOf: PROVIDERS_AS_OF, windowDays: 30 });
    expect(result.summary).toMatchObject({ breaking: 1, upcoming: 1, exitFindings: 0 });
  });
});
