import { describe, expect, it } from 'vitest';
import { isIsoDay } from '../src/dates.js';
import { DETECTORS } from '../src/rules/n8n.js';
import { registry } from './helpers.js';

const SEVERITIES = ['breaking', 'behavior-change', 'info'];
const VERIFICATION = ['verified', 'unverified'];

describe('sunset registry', () => {
  it('cites every source with a URL and an access date', () => {
    for (const [key, source] of Object.entries(registry.sources)) {
      expect(source.url, key).toMatch(/^https:\/\//);
      expect(isIsoDay(source.accessed), key).toBe(true);
    }
    expect(registry.sources['n8n-v3-breaking-changes']!.url).toBe('https://docs.n8n.io/changelog/v30-breaking-changes');
    expect(registry.sources['openai-deprecations']!.url).toBe('https://platform.openai.com/docs/deprecations');
  });

  it('only references sources it defines', () => {
    const refs = [
      ...registry.n8n.release.sources,
      ...registry.n8n.removedNodes.flatMap((n) => n.sources),
      ...registry.n8n.changes.flatMap((c) => c.sources),
      registry.openai.source,
      ...registry.openai.endpoints.flatMap((e) => e.sources),
      ...registry.openai.endpoints.flatMap((e) => (e.nodeUsages ?? []).flatMap((u) => u.sources)),
    ];
    for (const ref of refs) expect(registry.sources, ref).toHaveProperty([ref]);
  });

  it('records the n8n 3.0 release month as information, not as a deadline', () => {
    expect(registry.n8n.release).toMatchObject({ version: '3.0', date: '2026-10', datePrecision: 'month' });
    expect(registry.n8n.release.note).toContain('take effect when you upgrade');
  });

  it('describes legacy fine-tunes with the date the deprecations page gives', () => {
    expect(registry.openai.legacyFineTunes).toMatchObject({ bases: ['ada', 'babbage', 'curie', 'davinci'], shutdownDate: '2024-01-04', verification: 'verified' });
    for (const ref of registry.openai.legacyFineTunes.sources) expect(registry.sources, ref).toHaveProperty([ref]);
  });

  it('lists removed nodes with valid, unique node types', () => {
    const types = registry.n8n.removedNodes.map((n) => n.type);
    expect(new Set(types).size).toBe(types.length);
    for (const node of registry.n8n.removedNodes) {
      expect(node.type).toMatch(/^(n8n-nodes-base|@n8n\/n8n-nodes-langchain)\.[A-Za-z]+$/);
      expect(SEVERITIES).toContain(node.severity);
      expect(VERIFICATION).toContain(node.verification);
      expect(node.replacement ?? node.note, node.type).toBeTruthy();
    }
    expect(types).toEqual(expect.arrayContaining(['n8n-nodes-base.function', 'n8n-nodes-base.cron', '@n8n/n8n-nodes-langchain.lmOpenAi']));
  });

  it('has a detector for every change, and a change for every detector', () => {
    expect(registry.n8n.changes.map((c) => c.id).sort()).toEqual(Object.keys(DETECTORS).sort());
    for (const change of registry.n8n.changes) {
      expect(SEVERITIES).toContain(change.severity);
      expect(VERIFICATION).toContain(change.verification);
    }
  });

  it('lists OpenAI models with valid dates and unique IDs', () => {
    const ids = registry.openai.models.flatMap((m) => [m.id, ...(m.aliases ?? [])]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const model of registry.openai.models) {
      expect(isIsoDay(model.shutdownDate), model.id).toBe(true);
      expect(VERIFICATION).toContain(model.verification);
      if (model.verification === 'unverified') expect(model.verificationNote, model.id).toBeTruthy();
    }
  });

  it('lists OpenAI endpoints with a path or header, a valid date, and the deprecations page as a source', () => {
    const ids = registry.openai.endpoints.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const endpoint of registry.openai.endpoints) {
      expect(Boolean(endpoint.paths?.length) !== Boolean(endpoint.header), endpoint.id).toBe(true);
      for (const path of endpoint.paths ?? []) expect(path, endpoint.id).toMatch(/^\/v1\/[a-z_-]+(\/[a-z_-]+)*$/);
      expect(isIsoDay(endpoint.shutdownDate), endpoint.id).toBe(true);
      expect(VERIFICATION).toContain(endpoint.verification);
      expect(endpoint.sources[0], endpoint.id).toBe('openai-deprecations');
    }
    expect(registry.openai.endpoints.find((e) => e.id === 'assistants-api')).toMatchObject({
      paths: ['/v1/assistants', '/v1/threads'],
      shutdownDate: '2026-08-26',
    });
  });

  it('maps every n8n node operation that calls an endpoint to one of its paths', () => {
    const usages = registry.openai.endpoints.flatMap((e) => (e.nodeUsages ?? []).map((u) => ({ endpoint: e, usage: u })));
    expect(usages.length).toBeGreaterThan(0);
    for (const { endpoint, usage } of usages) {
      expect(usage.operations, usage.label).toHaveProperty([usage.defaultOperation]);
      for (const op of Object.values(usage.operations)) {
        // A usage found through a parameter value (the prompt ID) calls no listed path itself.
        if (!usage.requires) expect(op.paths.length, usage.label).toBeGreaterThan(0);
        for (const path of op.paths) expect(endpoint.paths, usage.label).toContain(path);
      }
      expect(usage.parameter === undefined, usage.label).toBe(usage.value === undefined);
      expect(VERIFICATION).toContain(usage.verification);
    }
    expect(usages.map(({ endpoint, usage }) => [endpoint.id, usage.nodeType, usage.minTypeVersion, usage.maxTypeVersion, usage.value])).toEqual([
      ['assistants-api', '@n8n/n8n-nodes-langchain.openAi', undefined, 1.8, 'assistant'],
      ['assistants-api', '@n8n/n8n-nodes-langchain.openAiAssistant', undefined, undefined, undefined],
      ['videos-api', '@n8n/n8n-nodes-langchain.openAi', 2, 2.3, 'video'],
      ['prompts-api', '@n8n/n8n-nodes-langchain.openAi', 2, 2.3, 'text'],
    ]);
  });

  it('keeps aliases with their snapshot, as the official page lists them', () => {
    const gpt35 = registry.openai.models.find((m) => m.id === 'gpt-3.5-turbo-0125');
    expect(gpt35).toMatchObject({ aliases: ['gpt-3.5-turbo', 'gpt-3.5-turbo-completions'], shutdownDate: '2026-10-23', replacement: 'gpt-5.6-terra' });
  });
});
