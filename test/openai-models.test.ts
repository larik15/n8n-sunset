import { describe, expect, it } from 'vitest';
import { buildModelIndex, matchModelId } from '../src/rules/openai.js';
import { AS_OF, byNode, registry, scanFixture } from './helpers.js';

const OPENAI_URL = 'https://platform.openai.com/docs/deprecations';

describe('matchModelId', () => {
  const index = buildModelIndex(registry.openai.models);

  it('matches model IDs and listed aliases exactly', () => {
    expect(matchModelId('gpt-3.5-turbo-0125', index)).toMatchObject({ kind: 'exact', entry: { shutdownDate: '2026-10-23' } });
    expect(matchModelId('gpt-4', index)).toMatchObject({ kind: 'alias', entry: { id: 'gpt-4-0613' } });
    expect(matchModelId('o4-mini', index)).toMatchObject({ kind: 'alias', entry: { id: 'o4-mini-2025-04-16' } });
  });

  it('does not match models that are not listed', () => {
    for (const id of ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-5', 'o3', 'gpt-5.6-sol', 'GPT-4']) {
      expect(matchModelId(id, index), id).toBeUndefined();
    }
  });

  it('matches dated snapshots of listed model families only', () => {
    expect(matchModelId('gpt-realtime-2025-08-28', index)).toMatchObject({ kind: 'dated-snapshot', entry: { id: 'gpt-realtime' } });
    expect(matchModelId('gpt-realtime-2.1', index)).toBeUndefined();
    expect(matchModelId('gpt-5-2025-08-07', index)).toMatchObject({ kind: 'exact' });
  });

  it('matches fine-tuned model IDs by base model', () => {
    expect(matchModelId('ft:gpt-3.5-turbo-0125:acme::abc', index)).toMatchObject({ kind: 'fine-tune', entry: { id: 'ft-gpt-3.5-turbo' } });
    expect(matchModelId('ft:gpt-4-0613:acme::abc', index)).toMatchObject({ kind: 'fine-tune', entry: { id: 'ft-gpt-4' } });
    expect(matchModelId('ft:gpt-4.1-nano-2025-04-14:acme::abc', index)).toMatchObject({ entry: { id: 'ft-gpt-4.1-nano-2025-04-14' } });
    expect(matchModelId('ft:gpt-4o-2024-05-13:acme::abc', index)).toMatchObject({ kind: 'fine-tune', entry: { id: 'gpt-4o-2024-05-13' } });
    expect(matchModelId('ft:gpt-4o-mini-2024-07-18:acme::abc', index)).toBeUndefined();
  });
});

describe('OpenAI LLM nodes', () => {
  const result = scanFixture('rules/openai-llm-nodes.json');

  it('flags an alias once, listing every place it appears', () => {
    const findings = byNode(result, 'GPT-4 chat model');
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleId: 'openai/model-shutdown',
      category: 'openai-model',
      severity: 'breaking',
      workflow: 'Lead scoring',
      model: 'gpt-4',
      date: '2026-10-23',
      datePrecision: 'day',
      daysUntil: 22,
      withinWindow: true,
      replacement: 'gpt-5.6-sol',
      verification: 'verified',
      sources: [OPENAI_URL],
      locations: ['OpenAI node parameter: model.value', 'OpenAI node parameter: model.cachedResultName'],
    });
    expect(findings[0]!.message).toBe('OpenAI shuts down model "gpt-4" (alias of gpt-4-0613); API calls will fail.');
  });

  it('finds quoted IDs inside a model expression', () => {
    expect(byNode(result, 'Tiered chat model').map((f) => f.model)).toEqual(['gpt-4-turbo']);
  });

  it('reports models that are already shut down, and ignores prompt text', () => {
    const findings = byNode(result, 'Message a model');
    expect(findings.map((f) => f.model)).toEqual(['o1-mini']);
    expect(findings[0]).toMatchObject({ date: '2025-10-27', withinWindow: true });
    expect(findings[0]!.daysUntil).toBeLessThan(0);
    expect(findings[0]!.message).toBe('OpenAI has shut down model "o1-mini"; API calls fail.');
  });

  it('ignores current models and Azure OpenAI deployments', () => {
    expect(byNode(result, 'Current chat model')).toEqual([]);
    expect(byNode(result, 'Azure deployment')).toEqual([]);
  });
});

describe('HTTP Request nodes calling api.openai.com', () => {
  const result = scanFixture('rules/openai-http.json');

  it('finds the model in a JSON body, not words in the prompt', () => {
    expect(byNode(result, 'Chat completion')).toMatchObject([
      { model: 'gpt-3.5-turbo', locations: ['HTTP Request to api.openai.com: jsonBody'] },
    ]);
  });

  it('finds the model in body parameters', () => {
    expect(byNode(result, 'Responses call')).toMatchObject([
      { model: 'o3-mini', locations: ['HTTP Request to api.openai.com: bodyParameters.parameters[0].value'] },
    ]);
  });

  it('finds the model in the URL', () => {
    expect(byNode(result, 'Realtime session')).toMatchObject([{ model: 'gpt-4o-realtime-preview', date: '2026-05-07' }]);
  });

  it('ignores requests to other hosts', () => {
    expect(byNode(result, 'Other provider')).toEqual([]);
  });
});

describe('Code nodes', () => {
  const result = scanFixture('rules/openai-code.json');

  it('finds quoted model IDs in JavaScript but not identifiers or comments', () => {
    expect(byNode(result, 'Summarize in JS')).toMatchObject([{ model: 'gpt-4-turbo', locations: ['Code node source: jsCode'] }]);
  });

  it('finds model IDs in Python', () => {
    expect(byNode(result, 'Summarize in Python')).toMatchObject([{ model: 'text-davinci-003', date: '2024-01-04' }]);
  });

  it('finds model IDs inside escaped JSON strings', () => {
    expect(byNode(result, 'Escaped JSON body')).toMatchObject([{ model: 'gpt-4-0613' }]);
  });
});

describe('matching edge cases', () => {
  const result = scanFixture('rules/openai-matching.json');

  it('flags dated snapshots of a deprecated family, outside the 30-day window', () => {
    expect(byNode(result, 'Realtime snapshot')[0]).toMatchObject({ model: 'gpt-realtime-2025-08-28', date: '2027-01-20', withinWindow: false });
    expect(byNode(result, 'Realtime snapshot')[0]!.message).toContain('(snapshot of gpt-realtime)');
    expect(byNode(result, 'Realtime replacement')).toEqual([]);
  });

  it('marks fine-tuned model matches as unverified', () => {
    for (const node of ['Fine-tuned 3.5', 'Fine-tuned 4o']) {
      const [finding] = byNode(result, node);
      expect(finding, node).toMatchObject({ verification: 'unverified', date: '2026-10-23' });
      expect(finding!.verificationNote).toContain('Fine-tuned model ID');
    }
    expect(byNode(result, 'Fine-tuned 4o mini')).toEqual([]);
  });

  it('marks models with conflicting dates on the official page as unverified, using the earliest date', () => {
    const [finding] = byNode(result, 'Conflicting dates');
    expect(finding).toMatchObject({ model: 'gpt-4-1106-preview', date: '2026-03-26', verification: 'unverified' });
    expect(finding!.verificationNote).toContain('2026-10-23');
  });
});

describe('other nodes', () => {
  const result = scanFixture('rules/openai-other-nodes.json');

  it('flags a value assigned to a field named "model"', () => {
    expect(byNode(result, 'Config')).toMatchObject([
      { model: 'gpt-4', locations: ['parameter named "model": assignments.assignments[0].value'] },
    ]);
  });

  it('ignores sticky notes and non-OpenAI model nodes', () => {
    expect(byNode(result, 'Sticky Note')).toEqual([]);
    expect(byNode(result, 'Anthropic model')).toEqual([]);
  });
});

describe('shutdown day itself', () => {
  it('treats the shutdown day as already shut down', () => {
    const result = scanFixture('rules/openai-other-nodes.json', { asOf: '2026-10-23' });
    expect(result.findings[0]).toMatchObject({ daysUntil: 0, withinWindow: true });
    expect(result.findings[0]!.message).toContain('has shut down');
  });

  it('pins the as-of date used by the other tests', () => {
    expect(AS_OF).toBe(registry.registryVersion);
  });
});
