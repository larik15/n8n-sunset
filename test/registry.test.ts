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
    ];
    for (const ref of refs) expect(registry.sources, ref).toHaveProperty([ref]);
  });

  it('records the n8n 3.0 release month', () => {
    expect(registry.n8n.release).toMatchObject({ version: '3.0', date: '2026-10', datePrecision: 'month' });
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

  it('keeps aliases with their snapshot, as the official page lists them', () => {
    const gpt35 = registry.openai.models.find((m) => m.id === 'gpt-3.5-turbo-0125');
    expect(gpt35).toMatchObject({ aliases: ['gpt-3.5-turbo', 'gpt-3.5-turbo-completions'], shutdownDate: '2026-10-23', replacement: 'gpt-5.6-terra' });
  });
});
