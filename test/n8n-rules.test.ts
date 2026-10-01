import { describe, expect, it } from 'vitest';
import { checkN8nNode } from '../src/rules/n8n.js';
import { byNode, registry, scanFixture } from './helpers.js';

const DOCS_URL = 'https://docs.n8n.io/changelog/v30-breaking-changes';

describe('n8n3/removed-node', () => {
  const result = scanFixture('rules/removed-nodes.json');

  it.each([
    ['Every night', 'Cron', 'Schedule Trigger node'],
    ['Read import file', 'Read Binary File', 'Read/Write Files from Disk node'],
    ['Mark imported', 'Function', 'Code node in "Run Once for All Items" mode'],
    ['Split rows', 'Item Lists', 'Split Out, Aggregate, Sort, Limit, Remove Duplicates, or Summarize node (whichever matches the operation you use)'],
    ['Store vectors', 'Pinecone: Insert', 'Pinecone Vector Store node ("Insert Documents" operation)'],
  ])('flags "%s" (%s)', (node, displayName, replacement) => {
    const findings = byNode(result, node);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleId: 'n8n3/removed-node',
      category: 'n8n-3.0',
      severity: 'breaking',
      workflow: 'Legacy nightly import',
      replacement,
      date: '2026-10',
      datePrecision: 'month',
      verification: 'verified',
      withinWindow: true,
    });
    expect(findings[0]!.message).toBe(`${displayName} node is removed in n8n 3.0.`);
    expect(findings[0]!.sources).toContain(DOCS_URL);
  });

  it('shows the docs note when no replacement exists, and marks disabled nodes', () => {
    expect(byNode(result, 'Orbit sync')[0]).toMatchObject({
      replacement: 'No replacement: the Orbit service shut down.',
      nodeDisabled: true,
    });
  });

  it('leaves current nodes alone', () => {
    expect(byNode(result, 'Done flag')).toEqual([]);
  });

  it('detects every removed node type in the registry', () => {
    for (const entry of registry.n8n.removedNodes) {
      const findings = checkN8nNode({ name: entry.displayName, type: entry.type, typeVersion: 1, parameters: {} }, registry);
      expect(findings.map((f) => f.ruleId), entry.type).toEqual(['n8n3/removed-node']);
      expect(findings[0]!.severity).toBe(entry.severity);
    }
  });

  it('adds the OpenAI Assistants API warning to the OpenAI Assistant node', () => {
    const [finding] = checkN8nNode({ name: 'Assistant', type: '@n8n/n8n-nodes-langchain.openAiAssistant', typeVersion: 1.1 }, registry);
    expect(finding!.message).toContain('Assistants API itself as shut down on 2026-08-26');
  });
});

describe('n8n3/removed-node: AI Transform (auto-migrated)', () => {
  const result = scanFixture('rules/ai-transform.json');

  it('reports it as info, which does not fail CI', () => {
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ severity: 'info', ruleId: 'n8n3/removed-node' });
    expect(result.findings[0]!.message).toContain('AI Transform node is retired in n8n 3.0.');
    expect(result.summary.breakingWithinWindow).toBe(0);
  });
});

describe('n8n3/ai-agent-v1', () => {
  const result = scanFixture('rules/ai-agent-v1.json');

  it('flags AI Agent 1.x, including nodes without a typeVersion', () => {
    expect(byNode(result, 'SQL agent')[0]).toMatchObject({ ruleId: 'n8n3/ai-agent-v1', severity: 'breaking' });
    expect(byNode(result, 'SQL agent')[0]!.message).toContain('(typeVersion 1.7)');
    expect(byNode(result, 'Old agent without version')[0]!.message).toContain('(typeVersion 1)');
  });

  it('leaves AI Agent 2+ alone', () => {
    expect(byNode(result, 'Current agent')).toEqual([]);
  });
});

describe('n8n3/execute-workflow-source', () => {
  const result = scanFixture('rules/execute-workflow-source.json');

  it.each([
    ['Run local file', 'localFile'],
    ['Run from URL', 'url'],
  ])('flags "%s"', (node, source) => {
    const [finding] = byNode(result, node);
    expect(finding).toMatchObject({ ruleId: 'n8n3/execute-workflow-source', severity: 'breaking' });
    expect(finding!.message).toContain(`(source: ${source})`);
  });

  it('leaves the Database and Parameter sources alone', () => {
    expect(byNode(result, 'Run from database')).toEqual([]);
    expect(byNode(result, 'Run inline JSON')).toEqual([]);
  });
});

describe('n8n3/get-paired-item', () => {
  const result = scanFixture('rules/get-paired-item.json');

  it('flags $getPairedItem in any parameter, with its location', () => {
    expect(byNode(result, 'Attach customer')[0]).toMatchObject({
      ruleId: 'n8n3/get-paired-item',
      locations: ['assignments.assignments[0].value'],
    });
  });

  it('ignores $(...).item and sticky notes', () => {
    expect(byNode(result, 'Attach customer (fixed)')).toEqual([]);
    expect(byNode(result, 'Sticky Note')).toEqual([]);
  });
});

describe('n8n3/code-evaluate-expression', () => {
  const result = scanFixture('rules/code-evaluate-expression.json');

  it('flags $evaluateExpression() in JavaScript Code nodes', () => {
    expect(byNode(result, 'Compute rate')[0]).toMatchObject({ ruleId: 'n8n3/code-evaluate-expression', severity: 'breaking' });
  });

  it('ignores Python and code without the call', () => {
    expect(byNode(result, 'Python step')).toEqual([]);
    expect(byNode(result, 'Plain code')).toEqual([]);
  });
});

describe('n8n3/gmail-trigger-pre-1-4', () => {
  const result = scanFixture('rules/gmail-trigger.json');

  it('flags Gmail Trigger below 1.4 as a behavior change', () => {
    expect(byNode(result, 'Old Gmail Trigger')[0]).toMatchObject({ ruleId: 'n8n3/gmail-trigger-pre-1-4', severity: 'behavior-change' });
    expect(result.summary.breakingWithinWindow).toBe(0);
  });

  it('leaves version 1.4 alone', () => {
    expect(byNode(result, 'New Gmail Trigger')).toEqual([]);
  });
});

describe('n8n3/always-output-data-multi-output', () => {
  const result = scanFixture('rules/always-output-data.json');

  it('flags If/Switch with Always Output Data as verified', () => {
    expect(byNode(result, 'Is VIP?')[0]).toMatchObject({
      ruleId: 'n8n3/always-output-data-multi-output',
      severity: 'behavior-change',
      verification: 'verified',
    });
  });

  it('flags other multi-output nodes as unverified', () => {
    const [finding] = byNode(result, 'Diff datasets');
    expect(finding).toMatchObject({ verification: 'unverified' });
    expect(finding!.verificationNote).toContain('not named on the page');
  });

  it('skips nodes without the setting, single-output nodes, and Loop Over Items before v3', () => {
    expect(byNode(result, 'Route by region')).toEqual([]);
    expect(byNode(result, 'Set defaults')).toEqual([]);
    expect(byNode(result, 'Old batches')).toEqual([]);
  });
});

describe('n8n3/webflow-v1-oauth2', () => {
  const result = scanFixture('rules/webflow-v1.json');

  it('flags Webflow v1 using OAuth2', () => {
    expect(byNode(result, 'Webflow v1 OAuth')[0]).toMatchObject({ ruleId: 'n8n3/webflow-v1-oauth2', severity: 'behavior-change' });
  });

  it('leaves access-token auth and version 2 alone', () => {
    expect(byNode(result, 'Webflow v1 token')).toEqual([]);
    expect(byNode(result, 'Webflow v2 OAuth')).toEqual([]);
  });
});

describe('n8n3/chat-trigger-json-frames', () => {
  const result = scanFixture('rules/chat-trigger.json');

  it('flags Chat Trigger in "Using Response Nodes" mode', () => {
    expect(byNode(result, 'Chat with response nodes')[0]).toMatchObject({ ruleId: 'n8n3/chat-trigger-json-frames' });
  });

  it('leaves other response modes alone', () => {
    expect(byNode(result, 'Chat with last node')).toEqual([]);
  });
});

describe('n8n3/compression-limits', () => {
  const result = scanFixture('rules/compression.json');

  it('flags decompression, which is the default operation', () => {
    expect(byNode(result, 'Unzip upload')[0]).toMatchObject({ ruleId: 'n8n3/compression-limits', severity: 'behavior-change' });
  });

  it('leaves compression alone', () => {
    expect(byNode(result, 'Zip results')).toEqual([]);
  });
});

describe('n8n 3.0 dates', () => {
  it('measures from the first day of the release month', () => {
    const result = scanFixture('rules/removed-nodes.json', { asOf: '2026-08-01', windowDays: 30 });
    expect(result.findings[0]).toMatchObject({ daysUntil: 61, withinWindow: false });
    expect(result.summary.breakingWithinWindow).toBe(0);
  });
});

describe('a clean workflow', () => {
  it('has no findings', () => {
    expect(scanFixture('rules/clean.json').findings).toEqual([]);
  });
});
