import { describe, expect, it } from 'vitest';
import { byNode, scanFixture } from './helpers.js';

const OPENAI_URL = 'https://platform.openai.com/docs/deprecations';
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
      datePrecision: 'day',
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
