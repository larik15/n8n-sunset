import { describe, expect, it } from 'vitest';
import { byNode, scanFixture } from './helpers.js';

const OPENAI_URL = 'https://developers.openai.com/api/docs/deprecations';
const endpointFindings = (result: ReturnType<typeof scanFixture>, node: string) =>
  byNode(result, node).filter((f) => f.ruleId === 'openai/endpoint-shutdown');

describe('HTTP Request nodes calling deprecated OpenAI endpoints', () => {
  const result = scanFixture('rules/openai-endpoints-http.json');

  it('flags the Assistants API, with date, replacement and sources', () => {
    const findings = endpointFindings(result, 'Create thread');
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      category: 'openai-endpoint',
      severity: 'breaking',
      workflow: 'Assistant support bot',
      endpoint: '/v1/threads',
      date: '2026-08-26',
      withinWindow: true,
      replacement: 'Responses API and Conversations API',
      verification: 'verified',
      locations: ['HTTP Request to api.openai.com: url'],
    });
    expect(findings[0]!.daysUntil).toBeLessThan(0);
    expect(findings[0]!.message).toBe('OpenAI has shut down the Assistants API (/v1/threads); calls fail.');
    expect(findings[0]!.sources).toEqual([
      OPENAI_URL,
      'https://developers.openai.com/api/docs/assistants/migration',
      'https://github.com/openai/openai-openapi/blob/c300cf282956e5f29c23f00def1d68ab44f8d7ab/openapi.yaml',
    ]);
  });

  it('matches paths below an endpoint, including in expressions', () => {
    expect(endpointFindings(result, 'Run assistant')).toMatchObject([{ endpoint: '/v1/threads' }]);
  });

  it('matches an unversioned path after an expression when the node uses OpenAI credentials', () => {
    expect(endpointFindings(result, 'List assistants')).toMatchObject([{ endpoint: '/v1/assistants', verification: 'verified' }]);
  });

  it('flags the Realtime API Beta by its OpenAI-Beta header', () => {
    expect(endpointFindings(result, 'Realtime beta session')).toMatchObject([
      {
        endpoint: 'OpenAI-Beta: realtime=v1',
        date: '2026-05-12',
        locations: ['HTTP Request to api.openai.com: headerParameters.parameters[0].value'],
      },
    ]);
  });

  it('flags the Videos API', () => {
    expect(endpointFindings(result, 'Create video')).toMatchObject([{ endpoint: '/v1/videos', date: '2026-09-24', replacement: 'None listed by OpenAI' }]);
  });

  it('flags only POST to the exact fine-tuning jobs path', () => {
    const [finding] = endpointFindings(result, 'Create fine-tuning job');
    expect(finding).toMatchObject({ endpoint: 'POST /v1/fine_tuning/jobs', date: '2027-01-06', withinWindow: false, verification: 'verified' });
    expect(finding!.message).toContain('OpenAI already stopped job creation for organizations that had never run fine-tuning (2026-05-07)');
    expect(endpointFindings(result, 'List fine-tuning jobs')).toEqual([]);
    expect(endpointFindings(result, 'Cancel fine-tuning job')).toEqual([]);
  });

  it('reads the method from HTTP Request v1 (requestMethod) and flags legacy endpoints', () => {
    expect(endpointFindings(result, 'Legacy engines call')).toMatchObject([{ endpoint: '/v1/engines', date: '2022-12-03', replacement: '/v1/models' }]);
  });

  it('covers the HTTP Request node used as an AI Agent tool, and adds endpoint notes', () => {
    const [finding] = endpointFindings(result, 'List evals tool');
    expect(finding).toMatchObject({ nodeType: 'n8n-nodes-base.httpRequestTool', endpoint: '/v1/evals', date: '2026-11-30' });
    expect(finding!.message).toContain('Existing evals become read-only on 2026-10-31.');
  });

  it('leaves current endpoints, the assistants=v2 header and other hosts alone', () => {
    expect(endpointFindings(result, 'Responses call')).toEqual([]);
    expect(endpointFindings(result, 'Other API search')).toEqual([]);
    expect(result.findings.filter((f) => f.endpoint?.includes('assistants=v2'))).toEqual([]);
  });
});

describe('n8n OpenAI node, "Assistant" resource', () => {
  const result = scanFixture('rules/openai-node-assistant.json');
  const N8N_OPENAI_NODE = 'https://github.com/n8n-io/n8n/tree/a9c858b4d95f8e09b1f26b608374f211148a2cc4/packages/@n8n/nodes-langchain/nodes/vendors/OpenAi';

  it('flags the default "Message an Assistant" operation, which calls /v1/threads', () => {
    const findings = endpointFindings(result, 'Ask support assistant');
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      category: 'openai-endpoint',
      severity: 'breaking',
      nodeType: '@n8n/n8n-nodes-langchain.openAi',
      endpoint: '/v1/threads',
      date: '2026-08-26',
      withinWindow: true,
      verification: 'verified',
      replacement:
        'OpenAI node version 2: the Text resource\'s "Message a Model" operation (Responses API) or the Conversation resource (Conversations API)',
      locations: ['OpenAI node, "Assistant" resource: resource'],
    });
    expect(findings[0]!.message).toBe(
      'OpenAI has shut down the Assistants API (/v1/threads), which this node\'s "Message an Assistant" operation calls; calls fail.',
    );
    expect(findings[0]!.sources).toEqual(expect.arrayContaining(['https://developers.openai.com/api/docs/deprecations', N8N_OPENAI_NODE]));
  });

  it('maps other operations to /v1/assistants, including nodes without a typeVersion', () => {
    expect(endpointFindings(result, 'Create support assistant')).toMatchObject([{ endpoint: '/v1/assistants' }]);
    expect(endpointFindings(result, 'Create support assistant')[0]!.message).toContain('"Create an Assistant" operation');
    expect(endpointFindings(result, 'List assistants, no version')).toMatchObject([{ endpoint: '/v1/assistants' }]);
  });

  it('leaves version 2, the Text resource and other node types alone', () => {
    expect(endpointFindings(result, 'Message a model (v2)')).toEqual([]);
    expect(endpointFindings(result, 'Text message (v1)')).toEqual([]);
    expect(endpointFindings(result, 'Version 2 node')).toEqual([]);
    expect(endpointFindings(result, 'Other OpenAI node type')).toEqual([]);
  });

  it('reports nothing else for these nodes', () => {
    expect(result.findings.map((f) => f.node).sort()).toEqual(['Ask support assistant', 'Create support assistant', 'List assistants, no version']);
  });
});

describe('n8n OpenAI node, "Video" resource', () => {
  const result = scanFixture('rules/openai-node-video.json');

  it('flags the default Generate operation as a Videos API call', () => {
    const [finding] = endpointFindings(result, 'Generate teaser');
    expect(finding).toMatchObject({
      endpoint: '/v1/videos',
      date: '2026-09-24',
      withinWindow: true,
      replacement: 'None listed by OpenAI',
      verification: 'verified',
      locations: ['OpenAI node, "Video" resource: resource'],
    });
    expect(finding!.message).toBe('OpenAI has shut down the Videos API (/v1/videos), which this node\'s "Generate" operation calls; calls fail.');
    expect(finding!.daysUntil).toBeLessThan(0);
  });

  it('also reports the Sora model as a separate model finding', () => {
    expect(byNode(result, 'Generate teaser').map((f) => f.ruleId).sort()).toEqual(['openai/endpoint-shutdown', 'openai/model-shutdown']);
  });

  it('flags an explicit Generate operation on version 2', () => {
    expect(endpointFindings(result, 'Generate with explicit operation')).toMatchObject([{ endpoint: '/v1/videos' }]);
  });

  it('leaves other resources and version 1 alone', () => {
    expect(endpointFindings(result, 'Generate image')).toEqual([]);
    expect(endpointFindings(result, 'Version 1 node')).toEqual([]);
    expect(endpointFindings(result, 'Future version 2.4')).toEqual([]);
  });
});

describe('OpenAI Assistant node', () => {
  const result = scanFixture('rules/openai-assistant-node.json');

  it('flags the default "Use Existing Assistant" operation as an Assistants API call', () => {
    const [finding] = endpointFindings(result, 'Support assistant');
    expect(finding).toMatchObject({
      nodeType: '@n8n/n8n-nodes-langchain.openAiAssistant',
      endpoint: '/v1/assistants, /v1/threads',
      date: '2026-08-26',
      withinWindow: true,
      verification: 'verified',
      locations: ['OpenAI Assistant node: mode'],
    });
    expect(finding!.message).toBe(
      'OpenAI has shut down the Assistants API (/v1/assistants, /v1/threads), which this node\'s "Use Existing Assistant" operation calls; calls fail.',
    );
    expect(finding!.sources).toEqual(
      expect.arrayContaining([
        'https://github.com/n8n-io/n8n/blob/a9c858b4d95f8e09b1f26b608374f211148a2cc4/packages/@n8n/nodes-langchain/nodes/agents/OpenAiAssistant/OpenAiAssistant.node.ts',
        'https://github.com/langchain-ai/langchainjs/blob/6b914bceb4acd4664b12091770a2ddcbf5d8457e/libs/langchain-classic/src/experimental/openai_assistant/index.ts',
      ]),
    );
  });

  it('flags "Use New Assistant" on nodes without a typeVersion', () => {
    expect(endpointFindings(result, 'New triage assistant')[0]!.message).toContain('"Use New Assistant" operation');
  });

  it('lists the already-broken finding first, then the n8n 3.0 removal, which points back to it', () => {
    for (const node of ['Support assistant', 'New triage assistant']) {
      const findings = byNode(result, node);
      expect(findings.map((f) => [f.ruleId, f.status, f.date]), node).toEqual([
        ['openai/endpoint-shutdown', 'past', '2026-08-26'],
        ['n8n3/removed-node', 'on-upgrade', null],
      ]);
      expect(findings[1]!.message).toContain('It already fails today: it calls the Assistants API, which OpenAI shut down on 2026-08-26');
      expect(findings[1]!.replacement).toBe(findings[0]!.replacement);
    }
  });
});

describe('Code nodes calling deprecated OpenAI endpoints', () => {
  const result = scanFixture('rules/openai-endpoints-code.json');

  it('flags /v1 paths in code that talks to api.openai.com, skipping URLs on other hosts', () => {
    expect(endpointFindings(result, 'Assistants via helpers')).toMatchObject([
      { endpoint: '/v1/threads', locations: ['Code node source: jsCode'] },
    ]);
  });

  it('flags endpoints in Python code', () => {
    expect(endpointFindings(result, 'Prompt objects in Python')).toMatchObject([
      { endpoint: '/v1/prompts', date: '2026-11-30', withinWindow: false, locations: ['Code node source: pythonCode'] },
    ]);
  });

  it('flags the OpenAI-Beta: realtime=v1 header in code', () => {
    expect(endpointFindings(result, 'Realtime beta socket')).toMatchObject([{ endpoint: 'OpenAI-Beta: realtime=v1' }]);
  });

  it('marks method-specific endpoints as unverified in code, where the method is unknown', () => {
    const [finding] = endpointFindings(result, 'Fine-tune in code');
    expect(finding).toMatchObject({ endpoint: 'POST /v1/fine_tuning/jobs', verification: 'unverified' });
    expect(finding!.verificationNote).toContain('request method could not be determined');
  });

  it('ignores code that does not call OpenAI, and other hosts in code that does', () => {
    expect(endpointFindings(result, 'Other vendor assistants')).toEqual([]);
    expect(endpointFindings(result, 'OpenAI plus other video API')).toEqual([]);
  });
});

describe('hosts with a port', () => {
  it('treats api.openai.com:443 as OpenAI', () => {
    const result = scanFixture('rules/openai-false-positives.json');
    expect(endpointFindings(result, 'Assistants with port')).toMatchObject([{ endpoint: '/v1/assistants', date: '2026-08-26' }]);
  });
});

describe('reusable prompt objects', () => {
  const result = scanFixture('rules/openai-prompt-objects.json');
  const MIGRATION = 'https://developers.openai.com/api/docs/guides/prompting/migrate-from-prompt-object';

  it('flags a prompt object ID in a Responses request body', () => {
    const [finding] = endpointFindings(result, 'Responses with prompt object');
    expect(finding).toMatchObject({
      endpoint: 'prompt object pmpt_abc123',
      date: '2026-11-30',
      status: 'upcoming',
      withinWindow: false,
      locations: ['HTTP Request to api.openai.com: jsonBody'],
    });
    expect(finding!.message).toBe('OpenAI shuts down reusable prompt objects (prompt object pmpt_abc123); calls will fail.');
    expect(finding!.sources).toContain(MIGRATION);
  });

  it('flags a prompt object ID in code that calls OpenAI', () => {
    expect(endpointFindings(result, 'Prompt object in code')).toMatchObject([{ endpoint: 'prompt object pmpt_xyz789' }]);
  });

  it("flags the OpenAI node's \"Message a Model\" prompt option, with defaults left out of the export", () => {
    const [finding] = endpointFindings(result, 'Message a Model with prompt');
    expect(finding).toMatchObject({
      endpoint: 'prompt object pmpt_node1',
      locations: ['OpenAI node, "Message a Model" prompt option: options.promptConfig.promptOptions.promptId'],
    });
    expect(finding!.message).toBe(
      "OpenAI shuts down reusable prompt objects (prompt object pmpt_node1), which this node's \"Message a Model\" operation uses; calls will fail.",
    );
    expect(endpointFindings(result, 'Prompt option stored as array')).toMatchObject([{ endpoint: 'prompt object pmpt_array' }]);
  });

  it('ignores an empty prompt ID, other operations and other hosts', () => {
    expect(endpointFindings(result, 'Empty prompt ID')).toEqual([]);
    expect(endpointFindings(result, 'Classify operation')).toEqual([]);
    expect(endpointFindings(result, 'Other host')).toEqual([]);
  });
});
