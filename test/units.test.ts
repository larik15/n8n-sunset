import { describe, expect, it } from 'vitest';
import { daysBetween, effectiveDay, isIsoDay, localToday } from '../src/dates.js';
import { wrap } from '../src/report.js';
import { extractWorkflows } from '../src/workflows.js';

describe('dates', () => {
  it('validates calendar days', () => {
    expect(isIsoDay('2026-10-23')).toBe(true);
    expect(isIsoDay('2026-02-30')).toBe(false);
    expect(isIsoDay('2026-10')).toBe(false);
  });

  it('resolves month-precision dates to the first day', () => {
    expect(effectiveDay('2026-10', 'month')).toBe('2026-10-01');
    expect(effectiveDay('2026-10-23', 'day')).toBe('2026-10-23');
    expect(() => effectiveDay('October', 'month')).toThrow();
  });

  it('counts whole days in both directions', () => {
    expect(daysBetween('2026-10-01', '2026-10-23')).toBe(22);
    expect(daysBetween('2026-10-01', '2025-10-27')).toBe(-339);
    expect(daysBetween('2026-03-01', '2026-04-01')).toBe(31);
  });

  it('uses the local calendar day for today', () => {
    expect(localToday(new Date(2026, 9, 1, 23, 59))).toBe('2026-10-01');
  });
});

describe('wrap', () => {
  it('wraps on spaces and splits words longer than the width', () => {
    expect(wrap('OpenAI shuts down model gpt-4', 12)).toEqual(['OpenAI shuts', 'down model', 'gpt-4']);
    expect(wrap('@n8n/n8n-nodes-langchain.openAi', 10)).toEqual(['@n8n/n8n-n', 'odes-langc', 'hain.openA', 'i']);
    expect(wrap('', 10)).toEqual(['']);
  });
});

describe('extractWorkflows', () => {
  it('names unnamed workflows after the file, numbering array entries', () => {
    const wf = { nodes: [{ name: 'A', type: 'n8n-nodes-base.set' }] };
    expect(extractWorkflows(wf, 'x/one.json').map((w) => w.name)).toEqual(['one.json']);
    expect(extractWorkflows([wf, wf], 'x/all.json').map((w) => w.name)).toEqual(['all.json #1', 'all.json #2']);
  });

  it('ignores malformed nodes', () => {
    const [workflow] = extractWorkflows({ name: 'W', nodes: [null, { name: 'no type' }, { name: 'ok', type: 't' }] }, 'w.json');
    expect(workflow!.nodes.map((n) => n.name)).toEqual(['ok']);
  });
});
