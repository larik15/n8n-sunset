import { fileURLToPath } from 'node:url';
import { loadRegistry } from '../src/registry.js';
import { scanWorkflows, type ScanResult } from '../src/scan.js';
import { loadWorkflows } from '../src/workflows.js';

/** The day the registry data was collected; tests pin it so results never drift. */
export const AS_OF = '2026-10-01';

export const registry = loadRegistry();

export const fixturesDir = fileURLToPath(new URL('./fixtures/', import.meta.url));

export function fixture(path: string): string {
  return fileURLToPath(new URL(`./fixtures/${path}`, import.meta.url));
}

export function scanFixture(path: string, options: { asOf?: string; windowDays?: number; targets?: string[] } = {}): ScanResult {
  const { workflows } = loadWorkflows([fixture(path)]);
  return scanWorkflows(workflows, registry, { asOf: options.asOf ?? AS_OF, windowDays: options.windowDays ?? 30, targets: options.targets ?? [] });
}

export function byNode(result: ScanResult, node: string) {
  return result.findings.filter((f) => f.node === node);
}
