import { describe, expect, it } from 'vitest';
import { knownRules } from '../src/cli.js';
import { scanWorkflows } from '../src/scan.js';
import { loadWorkflows } from '../src/workflows.js';
import { byNode, fixturesDir, PROVIDERS_AS_OF, registry, scanFixture } from './helpers.js';

describe('models n8n uses by default (second review)', () => {
  const result = scanFixture('rules/review-2-fixes.json', { asOf: PROVIDERS_AS_OF });
  const only = (node: string) => {
    const findings = byNode(result, node);
    expect(findings, node).toHaveLength(1);
    return findings[0]!;
  };

  it('flags OpenAI Image > Generate left at its default: dall-e-3 up to version 2.1, gpt-image-1-mini from 2.2', () => {
    expect(only('OpenAI image, untouched (1.8)')).toMatchObject({
      model: 'dall-e-3',
      severity: 'breaking',
      verification: 'unverified',
      locations: ['OpenAI node: resource=image, operation=generate: model not set, n8n default dall-e-3'],
    });
    expect(only('OpenAI image, untouched (2.2)')).toMatchObject({
      model: 'gpt-image-1-mini',
      locations: ['OpenAI node: resource=image, operation=generate: modelId not set, n8n default gpt-image-1-mini'],
    });
    expect(byNode(result, 'OpenAI image, model set (2.3)')).toEqual([]);
  });

  it('treats an empty model, or an empty resource locator, like a missing one', () => {
    expect(only('OpenAI image, model emptied (2.1)').model).toBe('dall-e-3');
    expect(only('OpenAI image, empty locator (2.3)').model).toBe('gpt-image-1-mini');
    expect(only('Gemini image edit, empty locator (1.2)').model).toBe('gemini-2.5-flash-image-preview');
    expect(only('Anthropic Chat Model 1.3, empty locator').model).toBe('claude-sonnet-4-5-20250929');
  });

  it("flags Gemini Image > Edit without a model, which falls back to gemini-2.5-flash-image-preview in every version", () => {
    expect(only('Gemini image edit, untouched (1)')).toMatchObject({
      model: 'gemini-2.5-flash-image-preview',
      severity: 'breaking',
      verification: 'unverified',
      locations: ['Google Gemini node: resource=image, operation=edit: modelId not set, n8n default models/gemini-2.5-flash-image-preview'],
    });
    expect(byNode(result, 'Gemini image edit, model set (1.2)')).toEqual([]);
  });

  it('says the Anthropic Chat Model 1 and 1.1 defaults are less certain, and not the 1.2 or 1.3 ones', () => {
    expect(only('Anthropic Chat Model 1, untouched').verificationNote).toContain('declares the model parameter twice for this version');
    expect(only('Anthropic Chat Model 1.3, empty locator').verificationNote).not.toContain('twice');
    const notes = Object.fromEntries(registry.modelDefaults.map((d) => [d.id, d.note]));
    expect(notes['anthropic-chat-model-v1']).toBeDefined();
    expect(notes['anthropic-chat-model-v1.1']).toBeDefined();
    expect(notes['anthropic-chat-model-v1.2']).toBeUndefined();
  });
});

describe('Code nodes that call Bedrock or Vertex AI (second review)', () => {
  const result = scanFixture('rules/review-2-fixes.json', { asOf: PROVIDERS_AS_OF });

  it('needs a real client, not the word "bedrock" or a commented-out client', () => {
    expect(byNode(result, 'Anthropic SDK, Bedrock only mentioned')[0]).toMatchObject({ model: 'claude-2.1', severity: 'breaking', verification: 'verified' });
    expect(byNode(result, 'Gemini SDK, Vertex only in a comment')[0]).toMatchObject({ model: 'gemini-2.0-flash', severity: 'breaking' });
  });

  it('still downgrades code that calls the other platform', () => {
    expect(byNode(result, 'Anthropic on Bedrock')[0]).toMatchObject({ model: 'claude-2.1', severity: 'warning' });
    expect(byNode(result, 'Gemini SDK on Vertex')[0]).toMatchObject({ model: 'gemini-2.0-flash', severity: 'warning' });
  });

  it('ignores an endpoint that only appears in a comment', () => {
    expect(byNode(result, 'Assistants call only in a comment')).toEqual([]);
  });
});

describe('registry notes in findings (second review)', () => {
  it('shows the notice-date caveat for the Gemini 1.5 IDs and the source of a redirect', () => {
    const gemini = scanFixture('rules/gemini-review-fixes.json', { asOf: PROVIDERS_AS_OF });
    const redirect = byNode(gemini, 'Pro 3 preview (redirected)')[0]!;
    expect(redirect.message).toContain('Source: the release notes of 2026-03-09');
    expect(redirect.verification).toBe('verified');
    const nodes = scanFixture('rules/gemini-nodes.json', { asOf: PROVIDERS_AS_OF });
    const flash15 = nodes.findings.find((f) => f.model === 'gemini-1.5-flash')!;
    expect(flash15.message).toContain('2025-09-29 is the date of that notice');
    expect(flash15.verification).toBe('verified');
  });
});

describe('rule IDs', () => {
  it('emits only rule IDs and categories that --skip-rule accepts, across every fixture', () => {
    const { workflows } = loadWorkflows([fixturesDir]);
    const known = knownRules(registry);
    const seen = new Set<string>();
    for (const asOf of ['2026-10-01', PROVIDERS_AS_OF]) {
      const result = scanWorkflows(workflows, registry, { asOf, windowDays: 30, targets: ['3.0'] });
      for (const f of result.findings) {
        seen.add(f.ruleId);
        expect(known, f.ruleId).toContain(f.ruleId);
        expect(known, f.category).toContain(f.category);
      }
    }
    // Every detector is exercised, so a new rule ID can't slip past this test.
    for (const id of ['openai/model-shutdown', 'openai/endpoint-shutdown', 'anthropic/model-retirement', 'gemini/model-shutdown', 'n8n3/removed-node']) {
      expect(seen, id).toContain(id);
    }
    expect([...seen].some((id) => id.startsWith('n8n3/') && id !== 'n8n3/removed-node')).toBe(true);
  });
});
