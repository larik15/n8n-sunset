import { describe, expect, it } from 'vitest';
import { isIsoDay } from '../src/dates.js';
import { validateRegistry } from '../src/registry.js';
import { DETECTORS } from '../src/rules/n8n.js';
import { daysBetween } from '../src/dates.js';
import { buildModelIndex, matchModelId, openAiLookup } from '../src/rules/openai.js';
import { buildProviderIndex, matchProviderModel, providerLookup } from '../src/rules/providers.js';
import { resolveSuccessors, type ReplacementLookup } from '../src/rules/replacements.js';
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
    expect(registry.sources['openai-deprecations']).toMatchObject({
      url: 'https://developers.openai.com/api/docs/deprecations',
      previousUrl: 'https://platform.openai.com/docs/deprecations',
    });
  });

  it('pins every GitHub link to a commit', () => {
    for (const [key, source] of Object.entries(registry.sources)) {
      for (const url of [source.url, source.repoUrl].filter((u): u is string => Boolean(u?.startsWith('https://github.com/')))) {
        expect(url, key).toMatch(/^https:\/\/github\.com\/[^/]+\/[^/]+\/(tree|blob)\/[0-9a-f]{40}(\/|$)/);
      }
    }
  });

  it('only references sources it defines', () => {
    const refs = [
      ...registry.n8n.release.sources,
      ...registry.n8n.removedNodes.flatMap((n) => n.sources),
      ...registry.n8n.changes.flatMap((c) => c.sources),
      registry.openai.source,
      ...registry.openai.endpoints.flatMap((e) => e.sources),
      ...registry.openai.endpoints.flatMap((e) => (e.nodeUsages ?? []).flatMap((u) => u.sources)),
      registry.anthropic.source,
      registry.gemini.source,
      ...[...registry.anthropic.models, ...registry.gemini.models].flatMap((m) => [...m.sources, ...(m.aliasSources ?? [])]),
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

describe('Anthropic and Gemini sections', () => {
  it('cites each provider page with an HTTPS URL and the day it was read', () => {
    for (const key of ['anthropic-deprecations', 'anthropic-model-ids', 'gemini-deprecations', 'gemini-changelog']) {
      expect(registry.sources[key]!.url, key).toMatch(/^https:\/\/(platform\.claude\.com|ai\.google\.dev)\//);
      expect(registry.sources[key]!.accessed, key).toBe('2026-10-06');
    }
  });

  it('gives every model an ISO date, a recorded announcement, at least one known source, and a replacement or null', () => {
    for (const [name, section] of [['anthropic', registry.anthropic], ['gemini', registry.gemini]] as const) {
      expect(section.models.length, name).toBeGreaterThan(0);
      const labels = section.models.flatMap((m) => [m.id, ...(m.aliases ?? [])]);
      expect(new Set(labels).size, `${name} IDs and aliases are unique`).toBe(labels.length);
      for (const m of section.models) {
        expect(isIsoDay(m.shutdownDate), `${name} ${m.id}`).toBe(true);
        expect(m.announcement, m.id).toBeTruthy();
        expect(m.sources.length, m.id).toBeGreaterThan(0);
        for (const ref of m.sources) expect(registry.sources, ref).toHaveProperty([ref]);
        expect(m.replacement === null || m.replacement.length > 0, m.id).toBe(true);
        expect(VERIFICATION).toContain(m.verification);
      }
    }
  });

  it('only lists dates the providers announced: nothing from a "not sooner than" or "no shutdown date announced" cell', () => {
    // Anthropic's active models and Gemini's undated models would show up here with a placeholder date.
    for (const m of [...registry.anthropic.models, ...registry.gemini.models]) {
      expect(m.shutdownDate, m.id).not.toBe('');
      expect(m.note ?? '', m.id).not.toMatch(/not sooner|no shutdown date/i);
    }
  });

  it('explains what is matched and what is left out', () => {
    expect(registry.anthropic.matching).toContain('claude-sonnet-4-5');
    expect(registry.anthropic.excluded).toContain('claude-mythos-preview');
    expect(registry.gemini.matching).toContain('earliest possible');
    expect(registry.gemini.excluded).toContain('No shutdown date announced');
  });
});

describe('validateRegistry', () => {
  const copy = () => JSON.parse(JSON.stringify(registry)) as typeof registry;

  it('rejects malformed Anthropic or Gemini entries', () => {
    const badDate = copy();
    badDate.anthropic.models[0]!.shutdownDate = 'November 30, 2026';
    expect(() => validateRegistry(badDate)).toThrow('invalid shutdownDate "November 30, 2026"');

    const noSource = copy();
    noSource.gemini.models[0]!.sources = [];
    expect(() => validateRegistry(noSource)).toThrow('cites no source');

    const duplicate = copy();
    duplicate.gemini.models.push({ ...duplicate.gemini.models[0]! });
    expect(() => validateRegistry(duplicate)).toThrow(`lists "${duplicate.gemini.models[0]!.id}" twice`);

    const unknown = copy();
    unknown.anthropic.models[0]!.aliasSources = ['missing-e'];
    expect(() => validateRegistry(unknown)).toThrow('Registry references unknown source: missing-e');
  });

  it('still loads a registry written before Anthropic and Gemini support (--registry files from 0.1.x)', () => {
    const old = copy() as unknown as Record<string, unknown>;
    delete old.anthropic;
    delete old.gemini;
    const loaded = validateRegistry(old as never);
    expect(loaded.anthropic.models).toEqual([]);
    expect(loaded.gemini.models).toEqual([]);
  });

  it('accepts the bundled registry', () => {
    expect(() => validateRegistry(copy())).not.toThrow();
  });

  it('throws on a source key that is not defined, wherever it is used', () => {
    const inChange = copy();
    inChange.n8n.changes[0]!.sources.push('missing-a');
    expect(() => validateRegistry(inChange)).toThrow('Registry references unknown source: missing-a');

    const inLegacy = copy();
    inLegacy.openai.legacyFineTunes.suffixForm!.sources.push('missing-b');
    expect(() => validateRegistry(inLegacy)).toThrow('missing-b');

    const inUsage = copy();
    inUsage.openai.endpoints[0]!.nodeUsages![0]!.sources = ['missing-c', 'missing-d'];
    expect(() => validateRegistry(inUsage)).toThrow('Registry references unknown sources: missing-c, missing-d');
  });

  it('throws when a section is missing or the version is not a date', () => {
    const noEndpoints = copy() as unknown as { openai: { endpoints?: unknown } };
    delete noEndpoints.openai.endpoints;
    expect(() => validateRegistry(noEndpoints as never)).toThrow('missing required sections');
    const badVersion = copy();
    badVersion.registryVersion = 'October';
    expect(() => validateRegistry(badVersion)).toThrow('invalid registryVersion');
  });
});

describe('replacement chains', () => {
  const openai = buildModelIndex(registry.openai.models, registry.openai.legacyFineTunes);
  const anthropic = buildProviderIndex('anthropic', registry.anthropic.models);
  const gemini = buildProviderIndex('gemini', registry.gemini.models);
  const asOf = registry.registryVersion;
  const sections: [string, { id: string; replacement: string | null }[], ReplacementLookup][] = [
    ['openai', registry.openai.models, openAiLookup(openai)],
    ['anthropic', registry.anthropic.models, providerLookup(anthropic)],
    ['gemini', registry.gemini.models, providerLookup(gemini)],
  ];

  it('never ends a suggestion at a model that is gone or goes within 30 days of the registry date', () => {
    for (const [name, models, lookup] of sections) {
      for (const m of models) {
        if (!m.replacement) continue;
        const named = [...new Set(m.replacement.match(/[A-Za-z0-9][A-Za-z0-9._:-]*[A-Za-z0-9]/g) ?? [])].filter((t) => lookup(t));
        for (const id of named) {
          for (const next of resolveSuccessors(id, lookup, asOf, 30)) {
            const info = lookup(next);
            expect(info === undefined || daysBetween(asOf, info.shutdownDate) > 30, `${name} ${m.id} -> ${id} -> ${next}`).toBe(true);
          }
        }
      }
    }
  });

  it('follows the chains the review found', () => {
    const g = providerLookup(gemini);
    expect(resolveSuccessors('gemini-3.1-flash-image-preview', g, asOf, 30)).toEqual(['gemini-3.1-flash-image']);
    expect(resolveSuccessors('veo-3.1-generate-preview', g, asOf, 30)).toEqual(['gemini-omni-1.1-flash']);
    expect(resolveSuccessors('gemini-robotics-er-1.6-preview', g, asOf, 30)).toEqual(['gemini-robotics-er-2-preview']);
  });
});

describe('model defaults', () => {
  const openai = buildModelIndex(registry.openai.models, registry.openai.legacyFineTunes);
  const anthropic = buildProviderIndex('anthropic', registry.anthropic.models);
  const gemini = buildProviderIndex('gemini', registry.gemini.models);

  it('names a listed model, a node type, a version range, and an n8n source pinned to a commit for every rule', () => {
    expect(registry.modelDefaults.map((d) => d.id)).toEqual([
      'anthropic-chat-model-v1', 'anthropic-chat-model-v1.1', 'anthropic-chat-model-v1.2', 'anthropic-chat-model-v1.3',
      'openai-audio-generate', 'openai-audio-transcribe', 'openai-audio-translate', 'gemini-image-generate',
    ]);
    for (const d of registry.modelDefaults) {
      const match = d.provider === 'openai' ? matchModelId(d.model, openai) : matchProviderModel(d.model, d.provider === 'anthropic' ? anthropic : gemini);
      expect(match, d.id).toBeDefined();
      expect(d.nodeType, d.id).toMatch(/^@n8n\/n8n-nodes-langchain\.[A-Za-z]+$/);
      expect(d.minTypeVersion <= d.maxTypeVersion, d.id).toBe(true);
      expect(d.fixed === true || typeof d.parameter === 'string', d.id).toBe(true);
      for (const ref of d.sources) expect(registry.sources[ref]!.url, d.id).toMatch(/^https:\/\/github\.com\/n8n-io\/n8n\/(tree|blob)\/a9c858b4d95f8e09b1f26b608374f211148a2cc4\//);
    }
  });

  it('rejects an incomplete rule and loads registries without the table', () => {
    const copy = JSON.parse(JSON.stringify(registry)) as typeof registry;
    copy.modelDefaults[0]!.model = '';
    expect(() => validateRegistry(copy)).toThrow('modelDefaults entry "anthropic-chat-model-v1" is incomplete');
    const old = JSON.parse(JSON.stringify(registry)) as Record<string, unknown>;
    delete old.modelDefaults;
    expect(validateRegistry(old as never).modelDefaults).toEqual([]);
  });

  it('rejects an unknown dateStatus', () => {
    const copy = JSON.parse(JSON.stringify(registry)) as typeof registry;
    (copy.gemini.models[0] as { dateStatus: string }).dateStatus = 'maybe';
    expect(() => validateRegistry(copy)).toThrow('invalid dateStatus "maybe"');
  });
});
