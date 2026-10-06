import { describe, expect, it } from 'vitest';
import { buildModelIndex, matchModelId } from '../src/rules/openai.js';
import { AS_OF, byNode, registry, scanFixture } from './helpers.js';

const OPENAI_URL = 'https://developers.openai.com/api/docs/deprecations';

describe('matchModelId', () => {
  const index = buildModelIndex(registry.openai.models, registry.openai.legacyFineTunes);

  it('matches model IDs and listed aliases exactly', () => {
    expect(matchModelId('gpt-3.5-turbo-0125', index)).toMatchObject({ kind: 'exact', entry: { shutdownDate: '2026-10-23' } });
    expect(matchModelId('gpt-4', index)).toMatchObject({ kind: 'alias', entry: { id: 'gpt-4-0613' } });
    expect(matchModelId('o4-mini', index)).toMatchObject({ kind: 'alias', entry: { id: 'o4-mini-2025-04-16' } });
  });

  it('matches the models announced on 2026-10-01 (GPT-5.x and text-to-speech)', () => {
    expect(matchModelId('gpt-5.1', index)).toMatchObject({ kind: 'exact', entry: { shutdownDate: '2027-04-01', replacement: 'gpt-6-sol', announcement: '2026-10-01: GPT-5.3-Codex, GPT-5.1, GPT-5.4-Nano' } });
    expect(matchModelId('gpt-5.3-codex', index)).toMatchObject({ entry: { shutdownDate: '2027-04-01', replacement: 'gpt-6-sol' } });
    expect(matchModelId('gpt-5.4-nano', index)).toMatchObject({ entry: { shutdownDate: '2027-04-01', replacement: 'gpt-6-luna' } });
    for (const id of ['tts-1', 'tts-1-hd', 'gpt-4o-mini-tts-2025-03-20', 'gpt-4o-mini-tts-2025-12-15']) {
      expect(matchModelId(id, index), id).toMatchObject({ kind: 'exact', entry: { shutdownDate: '2027-01-06', replacement: 'gpt-realtime-2.1-mini', announcement: '2026-10-01: Text-to-speech models' } });
    }
  });

  it('does not match neighbours of those models that the page does not list', () => {
    // The page names exact IDs: not the undated gpt-4o-mini-tts alias, a dated gpt-5.1 snapshot, or other GPT-5.x models.
    for (const id of ['gpt-4o-mini-tts', 'gpt-5.1-2025-11-13', 'gpt-5.2', 'gpt-5.4-mini', 'gpt-5.4', 'tts-2', 'tts-1-1106']) {
      expect(matchModelId(id, index), id).toBeUndefined();
    }
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

  it('matches legacy /v1/fine-tunes IDs and provider-prefixed IDs', () => {
    expect(matchModelId('curie:ft-openai-internal-2021-08-23-17-54-10', index)).toMatchObject({ kind: 'legacy-fine-tune', entry: { shutdownDate: '2024-01-04' } });
    expect(matchModelId('gpt-4:ft-acme-2021', index)).toBeUndefined();
    expect(matchModelId('openai/gpt-4', index)).toMatchObject({ kind: 'provider-prefixed', entry: { id: 'gpt-4-0613' }, inner: { kind: 'alias' } });
    expect(matchModelId('openai/gpt-4o', index)).toBeUndefined();
    expect(matchModelId('anthropic/gpt-4', index)).toBeUndefined();
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

  it('flags an alias once, from the resource locator value only', () => {
    const findings = byNode(result, 'GPT-4 chat model');
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleId: 'openai/model-shutdown',
      category: 'openai-model',
      severity: 'breaking',
      workflow: 'Lead scoring',
      model: 'gpt-4',
      date: '2026-10-23',
      trigger: 'date',
      status: 'upcoming',
      countsTowardExit: true,
      daysUntil: 22,
      withinWindow: true,
      replacement: 'gpt-5.6-sol',
      verification: 'verified',
      sources: [OPENAI_URL],
      // Only the resource locator's value counts; cachedResultName is the editor's display copy.
      locations: ['OpenAI node parameter: model.value'],
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

  it('treats a request with OpenAI credentials as an OpenAI call, even when an expression sets the URL', () => {
    expect(byNode(result, 'Via OpenAI credential')).toMatchObject([{ model: 'gpt-4', locations: ['HTTP Request to api.openai.com: jsonBody'] }]);
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

  it('marks models with conflicting dates on the official page as unverified, using the newer announcement', () => {
    const [finding] = byNode(result, 'Conflicting dates');
    expect(finding).toMatchObject({ model: 'gpt-4-1106-preview', date: '2026-10-23', verification: 'unverified', replacement: 'gpt-5.6-sol' });
    expect(finding!.verificationNote).toContain('March 26, 2026');
    expect(finding!.verificationNote).toContain('newer announcement is used');
  });
});

describe('other nodes', () => {
  const result = scanFixture('rules/openai-other-nodes.json');

  it('reports a value assigned to a field named "model" as an unverified warning, not breaking', () => {
    const findings = byNode(result, 'Config');
    expect(findings).toMatchObject([
      {
        model: 'gpt-4',
        severity: 'warning',
        verification: 'unverified',
        countsTowardExit: false,
        locations: ['parameter named "model": assignments.assignments[0].value'],
      },
    ]);
    expect(findings[0]!.verificationNote).toContain('not an OpenAI node');
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

  it('pins the as-of date used by the other tests to a day the registry data already covers', () => {
    expect(AS_OF).toBe('2026-10-01');
    expect(registry.sources['openai-deprecations']!.accessed >= AS_OF).toBe(true);
    expect(registry.registryVersion >= AS_OF).toBe(true);
  });
});

describe('false positives', () => {
  const result = scanFixture('rules/openai-false-positives.json');

  it('downgrades an OpenAI node with a non-OpenAI base URL to an unverified warning', () => {
    const [finding] = byNode(result, 'Chat model via OpenRouter');
    expect(finding).toMatchObject({ model: 'gpt-4', severity: 'warning', verification: 'unverified', countsTowardExit: false });
    expect(finding!.verificationNote).toContain('https://openrouter.ai/api/v1');
  });

  it('keeps an explicit api.openai.com base URL as breaking', () => {
    expect(byNode(result, 'Chat model with explicit OpenAI URL')).toMatchObject([{ model: 'gpt-4', severity: 'breaking', verification: 'verified' }]);
  });

  it('only reads model IDs from the url field and quoted body text of HTTP Request nodes', () => {
    // gpt-4 sits in a header, o1 in an output option, /v1/assistants in prompt text: none of them count.
    expect(byNode(result, 'Responses call with lookalikes')).toEqual([]);
  });

  it('ignores HTTP requests to other hosts even with OpenAI credentials', () => {
    expect(byNode(result, 'Proxy with OpenAI credential')).toEqual([]);
  });

  it('ignores endpoint paths mentioned in code comments', () => {
    expect(byNode(result, 'Code mentioning a path in a comment')).toEqual([]);
  });
});

describe('model ID formats', () => {
  const result = scanFixture('rules/openai-id-formats.json');

  it('reports openai/<model> (OpenRouter style) as an unverified warning', () => {
    const [finding] = byNode(result, 'OpenRouter chat model');
    expect(finding).toMatchObject({ model: 'openai/gpt-4', severity: 'warning', verification: 'unverified', date: '2026-10-23' });
    expect(finding!.message).toContain('"openai/gpt-4" (provider name for gpt-4)');
    expect(byNode(result, 'Provider-prefixed in code')).toMatchObject([{ model: 'openai/gpt-3.5-turbo', severity: 'warning' }]);
    expect(byNode(result, 'Other provider prefix')).toEqual([]);
  });

  it('reports legacy /v1/fine-tunes models as breaking, citing the cookbook for the ID format', () => {
    const [finding] = byNode(result, 'Legacy fine-tune');
    expect(finding).toMatchObject({
      model: 'curie:ft-acme-2021-08-23-17-54-10',
      severity: 'breaking',
      verification: 'verified',
      date: '2024-01-04',
      status: 'past',
      replacement: 'Fine-tune a current base model with /v1/fine_tuning/jobs',
    });
    expect(finding!.sources).toEqual([
      'https://developers.openai.com/api/docs/deprecations',
      'https://github.com/openai/openai-cookbook/blob/2182005bcaf5a5cdd96bb46fb9995d08730e7b91/examples/fine-tuned_qa/olympics-3-train-qa.ipynb',
    ]);
    expect(byNode(result, 'Legacy fine-tune over HTTP')).toMatchObject([{ model: 'davinci:ft-personal-2022-01-01-00-00-00', severity: 'breaking' }]);
  });
});

describe('workflow and node flags', () => {
  const result = scanFixture('rules/workflow-flags.json');

  it('shows findings in disabled nodes and inactive or archived workflows, without counting disabled ones', () => {
    expect(result.findings).toMatchObject([
      { model: 'gpt-4', severity: 'breaking', nodeDisabled: true, countsTowardExit: false, workflowActive: false, workflowArchived: true },
    ]);
    expect(result.summary.exitFindings).toBe(0);
  });
});

describe('resource locators', () => {
  const result = scanFixture('rules/resource-locators.json');

  it('reads only the value, not the cached display name or URL', () => {
    expect(byNode(result, 'Model changed, stale cache')).toEqual([]);
    expect(byNode(result, 'Deprecated value')).toMatchObject([{ model: 'gpt-4', locations: ['OpenAI node parameter: model.value'] }]);
  });
});

describe('HTTP Request versions 1 and 2', () => {
  const result = scanFixture('rules/http-request-v1-v2.json');
  const models = (node: string) => byNode(result, node).filter((f) => f.ruleId === 'openai/model-shutdown');

  it('reads quoted IDs in bodyParametersJson', () => {
    expect(models('v1 JSON body')).toMatchObject([{ model: 'gpt-4', locations: ['HTTP Request to api.openai.com: bodyParametersJson'] }]);
  });

  it('reads model pairs in bodyParametersUi and queryParametersUi', () => {
    expect(models('v2 body list')).toMatchObject([{ model: 'o3-mini', locations: ['HTTP Request to api.openai.com: bodyParametersUi.parameter[0].value'] }]);
    expect(models('v1 query list')).toMatchObject([{ model: 'gpt-4o-realtime-preview' }]);
  });

  it('does not read model IDs from headers', () => {
    expect(byNode(result, 'v1 model ID in a header')).toEqual([]);
  });
});

describe('legacy fine-tunes with a custom suffix', () => {
  const index = buildModelIndex(registry.openai.models, registry.openai.legacyFineTunes);

  it('matches the documented {base}:ft-{org}:{suffix}-{timestamp} form', () => {
    expect(matchModelId('ada:ft-your-org:custom-model-name-2022-02-15-04-21-04', index)).toMatchObject({ kind: 'legacy-fine-tune', suffix: true });
    expect(matchModelId('curie:ft-acme-2021-08-23-17-54-10', index)).not.toHaveProperty('suffix');
    expect(matchModelId('ada:ft-your-org:custom:extra', index)).toBeUndefined();
  });

  it('reports it as unverified, citing openai-python for the format', () => {
    const [finding] = byNode(scanFixture('rules/openai-id-formats.json'), 'Legacy fine-tune with suffix');
    expect(finding).toMatchObject({ severity: 'breaking', verification: 'unverified', date: '2024-01-04' });
    expect(finding!.verificationNote).toContain('{base_model}:ft-{org-title}:{suffix}-{timestamp}');
    expect(finding!.sources).toEqual([
      'https://developers.openai.com/api/docs/deprecations',
      'https://github.com/openai/openai-python/blob/f7ccce126325ea35b6e5224ab954652c97a74896/openai/cli.py',
    ]);
  });
});

describe('OpenAI node defaults and fixed models', () => {
  const result = scanFixture('rules/openai-review-fixes.json', { asOf: '2026-10-06' });
  const AUDIO = 'https://github.com/n8n-io/n8n/tree/a9c858b4d95f8e09b1f26b608374f211148a2cc4/packages/@n8n/nodes-langchain/nodes/vendors/OpenAi';
  const TTS_NOTE = "gpt-realtime-2.1-mini (OpenAI's replacement; this node only offers tts-1 and tts-1-hd, so call the Realtime API with an HTTP Request node)";

  it('flags text to speech left at its default model, with a replacement that says the node cannot use it', () => {
    const [finding] = byNode(result, 'Text to speech (untouched)');
    expect(finding).toMatchObject({
      model: 'tts-1',
      date: '2027-01-06',
      severity: 'breaking',
      verification: 'unverified',
      replacement: TTS_NOTE,
      locations: ['OpenAI node: resource=audio, operation=generate: model not set, n8n default tts-1'],
    });
    expect(finding!.sources).toEqual(['https://developers.openai.com/api/docs/deprecations', AUDIO]);
  });

  it('uses the same node-specific replacement when the model is set', () => {
    expect(byNode(result, 'Text to speech HD (set)')[0]).toMatchObject({ model: 'tts-1-hd', verification: 'verified', replacement: TTS_NOTE });
  });

  it('flags Transcribe and Translate, which always use whisper-1', () => {
    for (const node of ['Transcribe a recording', 'Translate a recording']) {
      const [finding] = byNode(result, node);
      expect(finding, node).toMatchObject({ model: 'whisper-1', date: '2027-02-26', severity: 'breaking', verification: 'unverified' });
      expect(finding!.replacement, node).toContain('this node always uses whisper-1, so call the API with an HTTP Request node');
      expect(finding!.locations![0], node).toContain('(always uses whisper-1)');
    }
  });

  it('does not assume a default for other resources or for node versions it has not checked', () => {
    expect(byNode(result, 'Text resource (no audio default)')).toEqual([]);
    expect(byNode(result, 'Transcribe on a future node version')).toEqual([]);
  });

  it('notes when the listed replacement is itself going away', () => {
    expect(byNode(result, 'DALL-E 3 image')[0]!.replacement).toBe(
      'gpt-image-2, gpt-image-1 (itself shuts down on 2026-10-23; next: gpt-image-2.5-sunburst or gpt-image-2.5-flare), or gpt-image-1-mini',
    );
  });

  it('ignores model IDs in code comments', () => {
    expect(byNode(result, 'Old ID only in a comment')).toEqual([]);
  });
});
