import { describe, expect, it } from 'vitest';
import { EXIT_BREAKING, main } from '../src/cli.js';
import { buildProviderIndex, matchProviderModel } from '../src/rules/providers.js';
import { scanWorkflows } from '../src/scan.js';
import { loadWorkflows } from '../src/workflows.js';
import { PROVIDERS_AS_OF, byNode, fixture, registry, scanFixture } from './helpers.js';

const DEPRECATIONS = 'https://platform.claude.com/docs/en/about-claude/model-deprecations';
const MODEL_IDS = 'https://platform.claude.com/docs/en/about-claude/models/model-ids-and-versions';
const scan = (path: string, options: { asOf?: string } = {}) => scanFixture(path, { asOf: PROVIDERS_AS_OF, ...options });

describe('Anthropic registry data', () => {
  const models = registry.anthropic.models;
  const byId = (id: string) => models.find((m) => m.id === id);

  it('records every model with an announced retirement date, its replacement and its source', () => {
    expect(models).toHaveLength(20);
    expect(byId('claude-sonnet-4-5-20250929')).toMatchObject({
      shutdownDate: '2026-11-30',
      replacement: 'claude-sonnet-5-5',
      announcement: '2026-09-30: Claude Sonnet 4.5 model',
      verification: 'verified',
      sources: ['anthropic-deprecations'],
    });
    expect(byId('claude-3-opus-20240229')).toMatchObject({ shutdownDate: '2026-01-05', replacement: 'claude-opus-4-8' });
    expect(byId('claude-3-5-sonnet-20241022')).toMatchObject({ shutdownDate: '2025-10-28', replacement: 'claude-sonnet-4-6' });
    expect(byId('claude-instant-1.2')).toMatchObject({ shutdownDate: '2024-11-06', replacement: 'claude-haiku-4-5-20251001' });
    expect(registry.sources[registry.anthropic.source]).toMatchObject({ url: DEPRECATIONS, previousUrl: 'https://docs.anthropic.com/en/docs/about-claude/model-deprecations' });
  });

  it('leaves out models without an announced date', () => {
    // Active models only have a "Not sooner than" floor; claude-mythos-preview says "To be announced".
    for (const id of ['claude-haiku-4-5-20251001', 'claude-opus-4-8', 'claude-opus-4-5-20251101', 'claude-sonnet-5-5', 'claude-mythos-preview']) {
      expect(byId(id), id).toBeUndefined();
    }
  });

  it('documents the one alias it lists and cites the page that documents it', () => {
    const withAliases = models.filter((m) => m.aliases?.length);
    expect(withAliases.map((m) => [m.id, m.aliases])).toEqual([['claude-sonnet-4-5-20250929', ['claude-sonnet-4-5']]]);
    expect(withAliases[0]!.aliasSources).toEqual(['anthropic-model-ids']);
    expect(registry.sources['anthropic-model-ids']!.url).toBe(MODEL_IDS);
  });
});

describe('matchProviderModel (Anthropic)', () => {
  const index = buildProviderIndex('anthropic', registry.anthropic.models);

  it('matches model IDs and the documented alias exactly', () => {
    expect(matchProviderModel('claude-3-5-sonnet-20241022', index)).toMatchObject({ alias: false, entry: { shutdownDate: '2025-10-28' } });
    expect(matchProviderModel('claude-sonnet-4-5', index)).toMatchObject({ alias: true, entry: { id: 'claude-sonnet-4-5-20250929' } });
  });

  it('does not match current models, near misses, other casing, or Bedrock and Vertex names', () => {
    for (const id of [
      'claude-sonnet-5-5', 'claude-opus-4-8', 'claude-haiku-4-5-20251001', 'claude-3-5-sonnet', 'claude-3-5-sonnet-20241023',
      'Claude-2.1', 'claude-2', 'anthropic.claude-3-5-sonnet-20240620-v1:0', 'claude-3-5-sonnet@20240620', 'anthropic/claude-2.1',
    ]) {
      expect(matchProviderModel(id, index), id).toBeUndefined();
    }
  });
});

describe('Anthropic chat model nodes', () => {
  const result = scan('rules/anthropic-llm-nodes.json');

  it('flags a retired model once, from the resource locator value only', () => {
    const findings = byNode(result, 'Retired Sonnet 3.5');
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleId: 'anthropic/model-retirement',
      category: 'anthropic-model',
      severity: 'breaking',
      workflow: 'Support triage',
      nodeType: '@n8n/n8n-nodes-langchain.lmChatAnthropic',
      model: 'claude-3-5-sonnet-20241022',
      date: '2025-10-28',
      trigger: 'date',
      status: 'past',
      countsTowardExit: true,
      replacement: 'claude-sonnet-4-6',
      verification: 'verified',
      sources: [DEPRECATIONS],
      // Only the resource locator's value counts; cachedResultName is the editor's display copy.
      locations: ['Anthropic node parameter: model.value'],
    });
    expect(findings[0]!.message).toBe('Anthropic has retired model "claude-3-5-sonnet-20241022"; API calls fail.');
  });

  it('grades by date: an announced retirement outside the window is reported but does not fail the run', () => {
    const [dated] = byNode(result, 'Sonnet 4.5 dated');
    expect(dated).toMatchObject({
      severity: 'breaking',
      date: '2026-11-30',
      status: 'upcoming',
      daysUntil: 55,
      withinWindow: false,
      countsTowardExit: false,
      replacement: 'claude-sonnet-5-5',
    });
    expect(dated!.message).toBe('Anthropic retires model "claude-sonnet-4-5-20250929"; API calls will fail.');
    // The same finding fails the run once the window reaches it.
    const wide = scanFixture('rules/anthropic-llm-nodes.json', { asOf: PROVIDERS_AS_OF, windowDays: 60 });
    expect(byNode(wide, 'Sonnet 4.5 dated')[0]).toMatchObject({ withinWindow: true, countsTowardExit: true });
  });

  it('flags the documented alias and cites both pages', () => {
    const [alias] = byNode(result, 'Sonnet 4.5 alias');
    expect(alias).toMatchObject({ model: 'claude-sonnet-4-5', date: '2026-11-30', sources: [DEPRECATIONS, MODEL_IDS] });
    expect(alias!.message).toBe('Anthropic retires model "claude-sonnet-4-5" (alias of claude-sonnet-4-5-20250929); API calls will fail.');
  });

  it('finds the retired model inside an expression and ignores the current one in it', () => {
    const findings = byNode(result, 'Tiered model');
    expect(findings.map((f) => f.model)).toEqual(['claude-opus-4-1-20250805']);
    expect(findings[0]).toMatchObject({ status: 'past', replacement: 'claude-opus-4-8' });
  });

  it('reads the Anthropic node (modelId) and ignores model names in its prompt text', () => {
    const findings = byNode(result, 'Anthropic node');
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ model: 'claude-3-haiku-20240307', locations: ['Anthropic node parameter: modelId.value'] });
  });

  it('downgrades a node behind another base URL to an unverified warning', () => {
    const [finding] = byNode(result, 'Behind a gateway');
    expect(finding).toMatchObject({ severity: 'warning', verification: 'unverified', countsTowardExit: false, model: 'claude-2.1' });
    expect(finding!.verificationNote).toContain('gateway.example.com');
  });

  it('does not count a disabled node toward the exit code', () => {
    expect(byNode(result, 'Disabled Opus 3')[0]).toMatchObject({ nodeDisabled: true, countsTowardExit: false, severity: 'breaking' });
  });

  it('reports nothing for current models, models with no announced date, Bedrock or Vertex AI', () => {
    for (const node of ['Current model', 'Opus 4.8 (no announced date)', 'Bedrock Claude', 'Vertex Claude']) expect(byNode(result, node), node).toEqual([]);
  });
});

describe('Anthropic in HTTP Request nodes, Code nodes and other nodes', () => {
  const result = scan('rules/anthropic-http-code.json');

  it('reads the model from the JSON body of a request to api.anthropic.com', () => {
    const [finding] = byNode(result, 'Messages call (JSON body)');
    expect(finding).toMatchObject({
      model: 'claude-3-7-sonnet-20250219',
      date: '2026-02-19',
      replacement: 'claude-sonnet-4-6',
      severity: 'breaking',
      locations: ['HTTP Request to api.anthropic.com: jsonBody'],
    });
  });

  it('reads a model/value pair in the body parameters, with a port in the URL', () => {
    const [finding] = byNode(result, 'Messages call (body parameters)');
    expect(finding).toMatchObject({ model: 'claude-3-haiku-20240307', locations: ['HTTP Request to api.anthropic.com: bodyParameters.parameters[0].value'] });
  });

  it('treats an expression URL as Anthropic when the node uses Anthropic credentials, and as unknown otherwise', () => {
    expect(byNode(result, 'Expression URL with Anthropic credentials')[0]).toMatchObject({ model: 'claude-3-opus-20240229', severity: 'breaking' });
    expect(byNode(result, 'Expression URL, host unknown')).toEqual([]);
  });

  it('checks the HTTP Request tool attached to an AI Agent', () => {
    expect(byNode(result, 'HTTP tool for the agent')[0]).toMatchObject({ model: 'claude-1.3', date: '2024-11-06' });
  });

  it('ignores requests to other hosts and model names that appear only in prompt text', () => {
    expect(byNode(result, 'Other host')).toEqual([]);
    expect(byNode(result, 'Model names only in the prompt text')).toEqual([]);
  });

  it('finds quoted model names in Code nodes, not variables or prose', () => {
    const findings = byNode(result, 'Code with model names');
    expect(findings.map((f) => f.model).sort()).toEqual(['claude-2.1', 'claude-3-opus-20240229']);
    for (const f of findings) expect(f).toMatchObject({ severity: 'breaking', locations: ['Code node source: jsCode'] });
  });

  it('reports a "model" field on any other node as an unverified warning, and only that field', () => {
    const findings = byNode(result, 'Set model name');
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: 'warning', verification: 'unverified', model: 'claude-3-haiku-20240307', countsTowardExit: false });
    expect(findings[0]!.verificationNote).toContain('not an Anthropic node');
  });

  it('skips sticky notes', () => {
    expect(byNode(result, 'Sticky Note')).toEqual([]);
  });
});

describe('Anthropic findings in the CLI', () => {
  async function run(args: string[]) {
    let stdout = '';
    const code = await main(args, {
      stdout: { write: (text: string) => (stdout += text), isTTY: false, columns: 160 },
      stderr: { write: () => undefined },
      cwd: process.cwd(),
      env: {},
      now: new Date(Date.UTC(2026, 9, 6, 12)),
    });
    return { code, stdout };
  }

  it('exits 1 for a retired model and prints the Anthropic source in the footer', async () => {
    const { code, stdout } = await run([fixture('rules/anthropic-llm-nodes.json'), '--as-of', PROVIDERS_AS_OF]);
    expect(code).toBe(EXIT_BREAKING);
    expect(stdout).toContain('Anthropic has retired model "claude-3-5-sonnet-20241022"');
    expect(stdout).toContain('claude-sonnet-4-6');
    expect(stdout).toContain(`${DEPRECATIONS} (Anthropic)`);
  });

  it('does not fail the run when the only breaking Anthropic finding is more than 30 days away', () => {
    const { workflows } = loadWorkflows([fixture('rules/anthropic-llm-nodes.json')]);
    const only = { ...workflows[0]!, nodes: workflows[0]!.nodes.filter((n) => n.name === 'Sonnet 4.5 dated') };
    const result = scanWorkflows([only], registry, { asOf: PROVIDERS_AS_OF, windowDays: 30 });
    expect(result.summary).toMatchObject({ breaking: 1, upcoming: 1, exitFindings: 0 });
  });
});
