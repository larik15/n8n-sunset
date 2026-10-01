import type { Severity, Verification } from './registry.js';

export type Category = 'n8n-3.0' | 'openai-model' | 'openai-endpoint';

/**
 * When a finding takes effect: on a calendar date (OpenAI shutdowns), or when you
 * upgrade n8n (n8n 3.0 changes, which have no date for a self-hosted instance).
 */
export type Trigger = { kind: 'date'; date: string } | { kind: 'upgrade'; version: string };

/** What a rule reports about one node, before workflow context and dates are attached. */
export interface RuleFinding {
  category: Category;
  ruleId: string;
  severity: Severity;
  /** What breaks. */
  message: string;
  trigger: Trigger;
  replacement: string | null;
  verification: Verification;
  verificationNote?: string;
  sources: string[];
  /** For model findings: the model ID found in the workflow. */
  model?: string;
  /** For endpoint findings: what was found, e.g. "/v1/threads" or "OpenAI-Beta: realtime=v1". */
  endpoint?: string;
  /** Where in the node the problem was found, e.g. "HTTP Request to api.openai.com: jsonBody". */
  locations?: string[];
}

export type Status = 'past' | 'upcoming' | 'on-upgrade';

export interface Finding extends Omit<RuleFinding, 'trigger'> {
  workflow: string;
  workflowId?: string;
  /** False when the export marks the workflow inactive. */
  workflowActive?: boolean;
  workflowArchived?: boolean;
  file: string;
  node: string;
  nodeType: string;
  nodeDisabled: boolean;
  /** "date" for calendar shutdowns, "upgrade" for n8n 3.0 changes. */
  trigger: 'date' | 'upgrade';
  /** YYYY-MM-DD for date findings; null for upgrade findings. */
  date: string | null;
  /** For upgrade findings: the n8n version, e.g. "3.0". */
  upgradeTo?: string;
  /** Human label: the date, or "breaks on upgrade to n8n 3.0" (changes on / on, for other severities). */
  when: string;
  /** Days from the as-of date to the shutdown (negative = already past); null for upgrade findings. */
  daysUntil: number | null;
  status: Status;
  /** Date findings: takes effect within the window or already has. Upgrade findings: false. */
  withinWindow: boolean;
  /** True when this finding sets exit code 1. */
  countsTowardExit: boolean;
}
