import type { DatePrecision, Severity, Verification } from './registry.js';

export type Category = 'n8n-3.0' | 'openai-model';

/** What a rule reports about one node, before workflow context and dates are attached. */
export interface RuleFinding {
  category: Category;
  ruleId: string;
  severity: Severity;
  /** What breaks. */
  message: string;
  date: string;
  datePrecision: DatePrecision;
  replacement: string | null;
  verification: Verification;
  verificationNote?: string;
  sources: string[];
  /** For model findings: the model ID found in the workflow. */
  model?: string;
  /** Where in the node the problem was found, e.g. "HTTP Request to api.openai.com: jsonBody". */
  locations?: string[];
}

export interface Finding extends RuleFinding {
  workflow: string;
  workflowId?: string;
  file: string;
  node: string;
  nodeType: string;
  nodeDisabled: boolean;
  /** Days from the as-of date to the date the change takes effect (negative = already past). */
  daysUntil: number;
  /** True when the change takes effect within the window, or already has. */
  withinWindow: boolean;
}
