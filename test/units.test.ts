import { describe, expect, it } from 'vitest';
import { colorEnabled } from '../src/cli.js';
import { daysBetween, isIsoDay, utcToday } from '../src/dates.js';
import { dedupeOverlapping } from '../src/rules/openai-endpoints.js';
import { apiBase } from '../src/api.js';
import { urlHost } from '../src/rules/openai.js';
import { displayWidth, padEnd, wrap } from '../src/width.js';
import { readWorkflows } from '../src/workflows.js';

describe('dates', () => {
  it('validates calendar days', () => {
    expect(isIsoDay('2026-10-23')).toBe(true);
    expect(isIsoDay('2026-02-30')).toBe(false);
    expect(isIsoDay('2026-10')).toBe(false);
  });

  it('counts whole days in both directions', () => {
    expect(daysBetween('2026-10-01', '2026-10-23')).toBe(22);
    expect(daysBetween('2026-10-01', '2025-10-27')).toBe(-339);
    expect(daysBetween('2026-03-01', '2026-04-01')).toBe(31);
  });

  it('uses the UTC calendar day for today, whatever the local time zone', () => {
    // 23:30 UTC on Sep 30 is already Oct 1 in Europe and still Sep 30 in UTC.
    expect(utcToday(new Date(Date.UTC(2026, 8, 30, 23, 30)))).toBe('2026-09-30');
    expect(utcToday(new Date(Date.UTC(2026, 9, 1, 0, 30)))).toBe('2026-10-01');
  });
});

describe('display width', () => {
  it('counts emoji and CJK as two columns, combining marks as none', () => {
    expect(displayWidth('abc')).toBe(3);
    expect(displayWidth('🚀 Deploy')).toBe(9);
    expect(displayWidth('👩‍💻')).toBe(2);
    expect(displayWidth('✅')).toBe(2);
    expect(displayWidth('日本語')).toBe(6);
    expect(displayWidth('é')).toBe(1);
  });

  it('pads and wraps by display width', () => {
    expect(padEnd('🚀', 4)).toBe('🚀  ');
    expect(wrap('🚀 launch 🚀 now', 9)).toEqual(['🚀 launch', '🚀 now']);
    expect(wrap('OpenAI shuts down model gpt-4', 12)).toEqual(['OpenAI shuts', 'down model', 'gpt-4']);
    expect(wrap('@n8n/n8n-nodes-langchain.openAi', 10)).toEqual(['@n8n/n8n-n', 'odes-langc', 'hain.openA', 'i']);
    expect(wrap('日本語日本語', 5)).toEqual(['日本', '語日', '本語']);
    expect(wrap('', 10)).toEqual(['']);
  });
});

describe('readWorkflows', () => {
  const wf = { nodes: [{ name: 'A', type: 'n8n-nodes-base.set' }] };

  it('names unnamed workflows after the file, numbering array entries', () => {
    expect(readWorkflows(wf, 'x/one.json').workflows.map((w) => w.name)).toEqual(['one.json']);
    expect(readWorkflows([wf, wf], 'x/all.json').workflows.map((w) => w.name)).toEqual(['all.json #1', 'all.json #2']);
  });

  it('ignores malformed nodes', () => {
    const { workflows } = readWorkflows({ name: 'W', nodes: [null, { name: 'no type' }, { name: 'ok', type: 't' }] }, 'w.json');
    expect(workflows[0]!.nodes.map((n) => n.name)).toEqual(['ok']);
  });

  it('reads n8n.io templates in both shapes', () => {
    expect(readWorkflows({ workflow: { name: 'Flat template', ...wf } }, 't.json').workflows.map((w) => w.name)).toEqual(['Flat template']);
    const api = { workflow: { id: 1750, name: 'API template', views: 10, workflow: wf } };
    expect(readWorkflows(api, 't.json').workflows).toMatchObject([{ name: 'API template', id: '1750', nodes: [{ name: 'A' }] }]);
  });

  it('keeps the active and archived flags', () => {
    expect(readWorkflows({ ...wf, active: false, isArchived: true }, 'w.json').workflows[0]).toMatchObject({ active: false, archived: true });
    expect(readWorkflows(wf, 'w.json').workflows[0]).not.toHaveProperty('active');
  });

  it('explains why a JSON file holds no workflow', () => {
    expect(readWorkflows({ name: 'pkg' }, 'p.json').reason).toBe('JSON object without a "nodes" array');
    expect(readWorkflows([], 'p.json').reason).toBe('empty array');
    expect(readWorkflows([1, 2], 'p.json').reason).toBe('array without n8n workflows');
    expect(readWorkflows({ data: [{ id: 1 }] }, 'p.json').reason).toBe('API page ("data") without n8n workflows');
    // An empty API page is what an instance with no workflows returns, so it is not a skipped file.
    expect(readWorkflows({ data: [], nextCursor: null }, 'p.json')).toEqual({ workflows: [] });
    expect(readWorkflows('text', 'p.json').reason).toBe('JSON string, not an object');
    expect(readWorkflows(wf, 'w.json').reason).toBeUndefined();
  });
});

describe('dedupeOverlapping', () => {
  it('drops entries covered by a shorter one', () => {
    expect(dedupeOverlapping(['/v1/threads', '/v1/threads/runs', '/v1/assistants', '/v1/threads'])).toEqual(['/v1/threads', '/v1/assistants']);
    expect(dedupeOverlapping(['options', 'options.baseURL', 'model.value', 'modelId'])).toEqual(['options', 'model.value', 'modelId']);
    expect(dedupeOverlapping(['url', 'urls'])).toEqual(['url', 'urls']);
  });
});

describe('colorEnabled', () => {
  it('follows the TTY by default', () => {
    expect(colorEnabled({}, true, false)).toBe(true);
    expect(colorEnabled({}, false, false)).toBe(false);
  });

  it('treats FORCE_COLOR=0 and false as off, other values as on', () => {
    for (const value of ['0', 'false', 'FALSE']) expect(colorEnabled({ FORCE_COLOR: value }, true, false), value).toBe(false);
    for (const value of ['1', '2', 'true', '']) expect(colorEnabled({ FORCE_COLOR: value }, false, false), value).toBe(true);
  });

  it('honors NO_COLOR only when it is not empty', () => {
    expect(colorEnabled({ NO_COLOR: '1' }, true, false)).toBe(false);
    expect(colorEnabled({ NO_COLOR: '' }, true, false)).toBe(true);
    expect(colorEnabled({ NO_COLOR: '1', FORCE_COLOR: '1' }, true, false)).toBe(false);
  });

  it('always turns color off with --no-color', () => {
    expect(colorEnabled({ FORCE_COLOR: '1' }, true, true)).toBe(false);
  });
});

describe('urlHost', () => {
  it('reads the literal host, without port or credentials', () => {
    expect(urlHost('https://api.openai.com/v1/threads')).toBe('api.openai.com');
    expect(urlHost('=https://api.openai.com:443/v1/threads/{{ $json.id }}')).toBe('api.openai.com');
    expect(urlHost('https://user:pw@API.OPENAI.COM')).toBe('api.openai.com');
    expect(urlHost('https://api.openai.com.evil.example/v1')).toBe('api.openai.com.evil.example');
  });

  it('returns undefined when an expression sets the host', () => {
    expect(urlHost('={{ $vars.OPENAI_BASE }}/threads')).toBeUndefined();
    expect(urlHost('https://{{ $vars.host }}/v1')).toBeUndefined();
  });
});

describe('apiBase', () => {
  it('normalizes trailing and doubled slashes', () => {
    for (const input of ['https://n8n.example.com/api/v1', 'https://n8n.example.com/api/v1/', 'https://n8n.example.com//api/v1', 'https://n8n.example.com//api//v1//']) {
      expect(apiBase(input).href, input).toBe('https://n8n.example.com/api/v1');
    }
    expect(apiBase('https://example.com/n8n//api/v1/').pathname).toBe('/n8n/api/v1');
  });
});
