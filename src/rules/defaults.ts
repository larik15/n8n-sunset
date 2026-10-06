import type { RuleFinding } from '../findings.js';
import type { ModelDefault, Registry } from '../registry.js';
import type { WorkflowNode } from '../workflows.js';
import { matchModelId, openAiModelFinding, type ModelIndex } from './openai.js';
import { matchProviderModel, providerFinding, type ProviderIndex } from './providers.js';

/**
 * Models a node uses without naming them in the workflow JSON. n8n does not save a parameter that is left at its
 * default, so an untouched Anthropic Chat Model 1.3 has no "model" at all, and the OpenAI node's Transcribe
 * operation always uses whisper-1. The registry's modelDefaults table says which model that is, per node version.
 */
export interface ModelIndexes {
  openai: ModelIndex;
  anthropic: ProviderIndex;
  gemini: ProviderIndex;
}

/** The node is this node type, version and usage (resource/operation), whatever its model parameter says. */
function matchesUsage(rule: ModelDefault, node: WorkflowNode): boolean {
  if (node.type !== rule.nodeType) return false;
  const version = node.typeVersion ?? 1;
  if (version < rule.minTypeVersion || version > rule.maxTypeVersion) return false;
  for (const [name, value] of Object.entries(rule.when ?? {})) {
    const actual = node.parameters?.[name] ?? rule.whenDefaults?.[name];
    if (actual !== value) return false;
  }
  return true;
}

function applies(rule: ModelDefault, node: WorkflowNode): boolean {
  // A model set in the workflow is checked by the model rules instead.
  return matchesUsage(rule, node) && (rule.fixed === true || node.parameters?.[rule.parameter!] === undefined);
}

const CATEGORY = { openai: 'openai-model', anthropic: 'anthropic-model', gemini: 'gemini-model' } as const;

/**
 * A node-specific replacement text for model findings on this node, whether the model is set or left at its default:
 * e.g. the OpenAI node's text-to-speech offers only tts-1 and tts-1-hd, so OpenAI's replacement can't be picked there.
 */
export function replacementOverride(registry: Registry, node: WorkflowNode): { category: string; text: string } | undefined {
  const rule = registry.modelDefaults.find((r) => r.replacement && !r.fixed && matchesUsage(r, node));
  return rule ? { category: CATEGORY[rule.provider], text: rule.replacement! } : undefined;
}

export function checkModelDefaults(node: WorkflowNode, registry: Registry, indexes: ModelIndexes, asOf: string, windowDays = 30): RuleFinding[] {
  const findings: RuleFinding[] = [];
  for (const rule of registry.modelDefaults) {
    if (!applies(rule, node)) continue;
    const version = node.typeVersion ?? 1;
    const location = rule.fixed ? `${rule.label} (always uses ${rule.model})` : `${rule.label}: ${rule.parameter} not set, n8n default ${rule.model}`;
    const unverifiedNote = rule.fixed
      ? `n8n's node always uses ${rule.model} here (the model is fixed in n8n's code, checked at n8n@2.41.5); the workflow has no model setting. A later n8n release could change that.`
      : `The workflow leaves "${rule.parameter}" unset, so n8n uses its default, which for this node version (${version}) is ${rule.model} at n8n@2.41.5. n8n takes the default from the installed version, so check the node in your n8n.`;
    const options = { unverifiedNote, extraSources: rule.sources, ...(rule.replacement ? { replacement: rule.replacement } : {}) };
    if (rule.provider === 'openai') {
      const match = matchModelId(rule.model, indexes.openai);
      if (match) findings.push(openAiModelFinding(registry, indexes.openai, match, [location], asOf, windowDays, options));
    } else {
      const index = indexes[rule.provider];
      const match = matchProviderModel(rule.model, index);
      if (match) findings.push(providerFinding(registry, index, match, [location], asOf, windowDays, options));
    }
  }
  return findings;
}
