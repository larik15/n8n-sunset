import { describe, expect, it } from 'vitest';
import { EXIT_BREAKING, main } from '../src/cli.js';
import { buildProviderIndex, matchProviderModel } from '../src/rules/providers.js';
import { scanWorkflows } from '../src/scan.js';
import { loadWorkflows } from '../src/workflows.js';
import { PROVIDERS_AS_OF, byNode, fixture, registry, scanFixture } from './helpers.js';

const DEPRECATIONS = 'https://ai.google.dev/gemini-api/docs/deprecations';
const CHANGELOG = 'https://ai.google.dev/gemini-api/docs/changelog';
const scan = (path: string, options: { asOf?: string; windowDays?: number } = {}) => scanFixture(path, { asOf: PROVIDERS_AS_OF, ...options });

describe('Gemini registry data', () => {
  const models = registry.gemini.models;
  const byId = (id: string) => models.find((m) => m.id === id);

  it('records every model that has a shutdown date, with its replacement, its dated announcement and its sources', () => {
    expect(models).toHaveLength(66);
    expect(byId('gemini-2.0-flash')).toMatchObject({
      shutdownDate: '2026-06-01',
      replacement: 'gemini-3.6-flash',
      verification: 'verified',
      dateStatus: 'confirmed',
      announcement: '2026-02-18: release notes (shutdown date announced); 2026-06-01: release notes (reported as shut down)',
      sources: ['gemini-deprecations', 'gemini-changelog'],
    });
    expect(byId('imagen-4.0-generate-001')).toMatchObject({ dateStatus: 'announced', announcement: '2026-06-15: release notes (shutdown date announced)' });
    expect(byId('text-embedding-004')).toMatchObject({ shutdownDate: '2026-01-14', replacement: 'gemini-embedding-2' });
    expect(byId('gemini-2.5-flash-image')).toMatchObject({ shutdownDate: '2026-10-02', replacement: 'gemini-3.1-flash-image-preview' });
    expect(byId('veo-3.1-generate-preview')).toMatchObject({ shutdownDate: '2026-10-22', replacement: 'gemini-omni-1.1-flash' });
    expect(byId('gemini-embedding-001')).toMatchObject({ shutdownDate: '2028-05-14' });
    expect(registry.sources[registry.gemini.source]).toMatchObject({ url: DEPRECATIONS });
    expect(registry.sources['gemini-changelog']!.url).toBe(CHANGELOG);
  });

  it('takes models that only the release notes carry from the release notes, with no invented replacement', () => {
    const onlyChangelog = models.filter((m) => m.sources.length === 1 && m.sources[0] === 'gemini-changelog');
    expect(onlyChangelog.map((m) => m.id).sort()).toEqual([
      'gemini-1.5-flash', 'gemini-1.5-flash-001', 'gemini-1.5-flash-002', 'gemini-1.5-flash-8b', 'gemini-1.5-flash-8b-001', 'gemini-1.5-pro',
      'gemini-1.5-pro-001', 'gemini-1.5-pro-002',
      'gemini-2.0-flash-exp', 'gemini-2.0-flash-exp-image-generation', 'gemini-2.0-flash-thinking-exp', 'gemini-2.0-flash-thinking-exp-01-21',
      'gemini-2.0-flash-thinking-exp-1219', 'gemini-2.0-pro-exp', 'gemini-2.0-pro-exp-02-05',
      'gemini-2.5-flash-exp-native-audio-thinking-dialog', 'gemini-2.5-flash-lite-preview-06-17', 'gemini-2.5-flash-preview-native-audio-dialog',
      'gemini-2.5-pro-exp-03-25',
    ]);
    for (const m of onlyChangelog.filter((x) => !x.id.includes('native-audio'))) expect(m.replacement, m.id).toBeNull();
    expect(byId('gemini-2.0-pro-exp')).toMatchObject({ shutdownDate: '2025-12-09', dateStatus: 'announced', announcement: '2025-11-04: release notes (shutdown date announced)' });
  });

  it('marks how firm each date is; only table rows with no dated release note are "earliest"', () => {
    const earliest = models.filter((m) => m.dateStatus === 'earliest').map((m) => m.id).sort();
    expect(earliest).toEqual([
      'embedding-2-preview', 'gemini-2.5-computer-use-preview-10-2025', 'gemini-2.5-flash-image', 'gemini-3.1-flash-lite', 'gemini-embedding-001',
      'veo-3.1-fast-generate-preview', 'veo-3.1-generate-preview', 'veo-3.1-lite-generate-preview',
    ]);
    for (const m of models) expect(['confirmed', 'announced', 'earliest'], m.id).toContain(m.dateStatus);
    for (const m of models.filter((x) => x.dateStatus !== 'earliest')) expect(m.sources, m.id).toContain('gemini-changelog');
  });

  it('records the redirect, the launched IDs, the 1.5 family and the managed agent', () => {
    expect(byId('gemini-3-pro-preview')).toMatchObject({ redirectsTo: 'gemini-3.1-pro-preview', dateStatus: 'confirmed' });
    expect(byId('gemini-2.5-flash-preview-09-25')).toMatchObject({ aliases: ['gemini-2.5-flash-preview-09-2025'], aliasSources: ['gemini-changelog'] });
    expect(byId('embedding-2-preview')).toMatchObject({ aliases: ['gemini-embedding-2-preview'] });
    expect(byId('gemini-1.5-flash')).toMatchObject({ shutdownDate: '2025-09-29', verification: 'verified', dateStatus: 'confirmed' });
    expect(byId('gemini-1.5-flash-002')).toMatchObject({ aliases: ['gemini-1.5-flash-latest'], verification: 'unverified' });
    expect(byId('gemini-1.5-pro-002')).toMatchObject({ aliases: ['gemini-1.5-pro-latest'], verification: 'unverified' });
    expect(byId('antigravity-preview-05-2026')).toMatchObject({ shutdownDate: '2026-10-05', replacement: 'antigravity-preview-09-2026', noun: 'Gemini API managed agent' });
  });

  it('leaves out models with no shutdown date and models the release notes never report as shut down', () => {
    for (const id of [
      'gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite', 'gemini-3.5-flash', 'gemini-3-flash-preview', 'gemini-3.1-pro-preview',
      'gemini-3.8-flash', 'gemini-omni-flash-preview', 'gemini-pro-latest', 'gemini-1.0-pro', 'gemini-pro', 'antigravity-preview-09-2026',
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
      sources: [DEPRECATIONS, CHANGELOG],
      locations: ['Google Gemini node parameter: modelName'],
    });
    expect(findings[0]!.message).toBe('Google has shut down Gemini API model "gemini-2.0-flash"; API calls fail.');
  });

  it('reports a past date that nothing confirms as a warning, not as a shutdown, and follows its dead replacement', () => {
    // gemini-2.5-flash-image: only the table's earliest date (2026-10-02); the release notes say nothing.
    const [finding] = byNode(result, 'Flash Image (shut down 2026-10-02)');
    expect(finding).toMatchObject({ date: '2026-10-02', status: 'past', daysUntil: -4, severity: 'warning', verification: 'unverified', countsTowardExit: false });
    expect(finding!.message).toBe('Gemini API model "gemini-2.5-flash-image" is past Google\'s earliest shutdown date (2026-10-02); calls may already fail.');
    expect(finding!.replacement).toBe('gemini-3.1-flash-image-preview (itself shut down on 2026-06-25; next: gemini-3.1-flash-image)');
  });

  it('grades by date: an earliest-possible date inside the window fails the run, one far away does not, and both say "at the earliest"', () => {
    const [soon] = byNode(result, 'Video generation');
    expect(soon).toMatchObject({
      model: 'veo-3.1-generate-preview',
      date: '2026-10-22',
      status: 'upcoming',
      daysUntil: 16,
      withinWindow: true,
      countsTowardExit: true,
      severity: 'breaking',
      replacement: 'gemini-omni-1.1-flash',
      locations: ['Google Gemini node parameter: modelId.value'],
    });
    expect(soon!.message).toBe('Google lists 2026-10-22 as the earliest shutdown date for Gemini API model "veo-3.1-generate-preview"; calls can fail from 2026-10-22 at the earliest.');
    const [later] = byNode(result, 'Flash-Lite 3.1 (shutdown 2027-05-07)');
    expect(later).toMatchObject({ date: '2027-05-07', status: 'upcoming', daysUntil: 213, withinWindow: false, countsTowardExit: false, severity: 'breaking' });
    expect(later!.message).toContain('at the earliest');
  });

  it('reads the embeddings node and the models inside an expression', () => {
    expect(byNode(result, 'Embeddings')[0]).toMatchObject({ model: 'text-embedding-004', replacement: 'gemini-embedding-2' });
    expect(byNode(result, 'Tiered model').map((f) => f.model)).toEqual(['gemini-2.0-flash-lite']);
  });

  it('says so when Google lists no replacement', () => {
    expect(byNode(result, 'Behind a gateway')[0]).toMatchObject({ model: 'gemini-2.0-flash-exp', replacement: 'None listed by Google', sources: [CHANGELOG] });
  });

  it('ignores an options.baseURL on the Gemini nodes, which take their endpoint from the credential', () => {
    // The real gateway setting is the credential's "host", which is not in the workflow JSON (a documented limitation).
    expect(byNode(result, 'Behind a gateway')[0]).toMatchObject({ severity: 'breaking', verification: 'verified', countsTowardExit: true });
  });

  it('never counts a disabled node', () => {
    expect(byNode(result, 'Disabled Pro preview')[0]).toMatchObject({ nodeDisabled: true, countsTowardExit: false });
  });

  it('reports nothing for models with no shutdown date, or for Vertex AI', () => {
    for (const node of ['Flash 2.5 (no shutdown date)', 'Flash 3 preview (replacement listed, no date)', 'Vertex AI model']) expect(byNode(result, node), node).toEqual([]);
  });

  it('reports the Gemini 1.5 models the release notes name as shut down, and the rest of the family as unverified', () => {
    const [finding] = byNode(result, 'Gemini 1.5 Flash');
    expect(finding).toMatchObject({
      model: 'gemini-1.5-flash',
      severity: 'breaking',
      date: '2025-09-29',
      status: 'past',
      countsTowardExit: true,
      replacement: 'None listed by Google',
      verification: 'verified',
      sources: [CHANGELOG],
    });
    expect(finding!.message).toBe('Google has shut down Gemini API model "gemini-1.5-flash"; API calls fail.');
    const [version] = byNode(result, 'Gemini 1.5 Pro 002 (version name, not in the dated entry)');
    expect(version).toMatchObject({ model: 'gemini-1.5-pro-002', severity: 'breaking', verification: 'unverified', countsTowardExit: true });
    expect(version!.verificationNote).toContain('assumes the whole 1.5 family shut down');
  });
});

describe('Gemini review fixes', () => {
  const result = scan('rules/gemini-review-fixes.json');

  it('reports a redirected ID as a behavior change that never fails the run', () => {
    const [finding] = byNode(result, 'Pro 3 preview (redirected)');
    expect(finding).toMatchObject({ severity: 'behavior-change', verification: 'verified', countsTowardExit: false, replacement: 'gemini-3.1-pro-preview', sources: [DEPRECATIONS, CHANGELOG] });
    expect(finding!.message).toBe(
      'Google shut down the model behind Gemini API model "gemini-3-pro-preview"; the ID now points to gemini-3.1-pro-preview, so calls still work but get a different model.',
    );
  });

  it('reports past earliest-only dates as warnings', () => {
    expect(byNode(result, 'Computer use preview (earliest date passed)')[0]).toMatchObject({ severity: 'warning', verification: 'unverified', countsTowardExit: false });
  });

  it('matches the IDs as launched, as unverified aliases', () => {
    const [embedding] = byNode(result, 'Embedding 2 preview, launched ID');
    expect(embedding).toMatchObject({ model: 'gemini-embedding-2-preview', severity: 'warning', verification: 'unverified' });
    expect(embedding!.verificationNote).toContain('Launched under this ID');
    const [flash] = byNode(result, 'Flash preview, launched ID');
    expect(flash).toMatchObject({ model: 'gemini-2.5-flash-preview-09-2025', severity: 'breaking', verification: 'unverified', countsTowardExit: true });
    expect(flash!.message).toContain('(alias of gemini-2.5-flash-preview-09-25)');
  });

  it('matches the 1.5 -latest names and the other models the release notes report as shut down', () => {
    expect(byNode(result, '1.5 Flash latest')[0]).toMatchObject({ model: 'gemini-1.5-flash-latest', severity: 'breaking', verification: 'unverified' });
    expect(byNode(result, 'Native audio dialog')[0]).toMatchObject({ date: '2025-10-20', severity: 'breaking', verification: 'verified' });
  });

  it('flags the managed agent sent in a request body', () => {
    const [finding] = byNode(result, 'Antigravity agent call');
    expect(finding).toMatchObject({ date: '2026-10-05', severity: 'breaking', replacement: 'antigravity-preview-09-2026' });
    expect(finding!.message).toBe('Google has shut down Gemini API managed agent "antigravity-preview-05-2026"; API calls fail.');
  });

  it('treats an OpenAI-compatible node pointed at the Gemini API as calling Google', () => {
    expect(byNode(result, 'OpenAI Chat Model pointed at Gemini')[0]).toMatchObject({
      model: 'gemini-2.0-flash',
      severity: 'breaking',
      countsTowardExit: true,
      locations: ['node calling generativelanguage.googleapis.com through options.baseURL: model.value'],
    });
  });

  it('reads the model from REST URLs inside code', () => {
    expect(byNode(result, 'Code calling the Gemini REST API')[0]).toMatchObject({ model: 'gemini-2.0-flash-lite', severity: 'breaking' });
  });

  it('downgrades code that calls Vertex AI to a warning', () => {
    const [finding] = byNode(result, 'Code calling Vertex AI');
    expect(finding).toMatchObject({ model: 'gemini-2.0-flash', severity: 'warning', countsTowardExit: false });
    expect(finding!.verificationNote).toContain('Vertex AI');
  });

  it('ignores IDs in JavaScript and Python comments, but not slashes or hashes inside strings', () => {
    expect(byNode(result, 'Old IDs only in JS comments')).toEqual([]);
    expect(byNode(result, 'Old IDs only in Python comments')).toEqual([]);
    expect(byNode(result, 'Slashes inside a string are not a comment')[0]).toMatchObject({ model: 'gemini-2.0-flash-001' });
  });

  it('reports one finding when a node names a model and its alias, under the model ID', () => {
    const findings = byNode(result, 'Alias and its model in one node');
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      model: 'embedding-2-preview',
      locations: ['HTTP Request to generativelanguage.googleapis.com: url', 'HTTP Request to generativelanguage.googleapis.com: jsonBody'],
    });
  });

  it("flags n8n's default image model when the node leaves it unset, as unverified", () => {
    const [finding] = byNode(result, 'Untouched image generation (1.2)');
    expect(finding).toMatchObject({
      model: 'gemini-3.1-flash-image-preview',
      severity: 'breaking',
      verification: 'unverified',
      replacement: 'gemini-3.1-flash-image',
      locations: ['Google Gemini node: resource=image, operation=generate: modelId not set, n8n default models/gemini-3.1-flash-image-preview'],
    });
    expect(finding!.verificationNote).toContain('leaves "modelId" unset');
    expect(finding!.sources).toContain('https://github.com/n8n-io/n8n/blob/a9c858b4d95f8e09b1f26b608374f211148a2cc4/packages/@n8n/nodes-langchain/nodes/vendors/GoogleGemini/actions/image/generate.operation.ts');
    expect(byNode(result, 'Untouched image generation (1.1, no default model)')).toEqual([]);
    // a model set in the workflow is checked by the model rule only
    expect(byNode(result, 'Image generation with a model set').map((f) => f.model)).toEqual(['imagen-4.0-generate-001']);
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
    // The table wraps between words, never inside a model ID.
    expect(stdout).toContain('Google has shut down Gemini API model');
    expect(stdout).toContain('"gemini-2.0-flash"; API calls fail.');
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
