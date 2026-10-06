import { daysBetween } from '../dates.js';

/** What the replacement check needs to know about a model the registry lists. */
export interface ReplacementInfo {
  shutdownDate: string;
  replacement: string | null;
  /** Only an earliest-possible date (Gemini table rows with no release-notes announcement). */
  tentative?: boolean;
}
export type ReplacementLookup = (id: string) => ReplacementInfo | undefined;

const ID = /[A-Za-z0-9][A-Za-z0-9._:-]*[A-Za-z0-9]/g;
const boundary = (id: string) => new RegExp(`(?<![A-Za-z0-9._:-])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_:-]|\\.[A-Za-z0-9])`);

/** Registry IDs named in a replacement text, in order, each once. */
function namedIds(text: string, lookup: ReplacementLookup): string[] {
  return [...new Set(text.match(ID) ?? [])].filter((token) => lookup(token) !== undefined);
}

/** True when the model is already gone, or goes within the window. */
function fading(info: ReplacementInfo, asOf: string, windowDays: number): boolean {
  return daysBetween(asOf, info.shutdownDate) <= windowDays;
}

/**
 * Follows a replacement chain to models that are still available past the window, e.g. gemini-2.5-flash-image ->
 * gemini-3.1-flash-image-preview (shut down) -> gemini-3.1-flash-image. Returns [] when the chain ends without one.
 */
export function resolveSuccessors(id: string, lookup: ReplacementLookup, asOf: string, windowDays: number, seen = new Set<string>()): string[] {
  const info = lookup(id);
  if (!info || !fading(info, asOf, windowDays)) return [id];
  if (seen.has(id) || !info.replacement) return [];
  seen.add(id);
  const next = namedIds(info.replacement, lookup);
  if (next.length === 0) {
    // The replacement names models the registry doesn't list (so they have no known date): keep their ID-like words.
    return [...new Set((info.replacement.match(ID) ?? []).filter((t) => /\d/.test(t) && /-/.test(t)))];
  }
  return [...new Set(next.flatMap((n) => resolveSuccessors(n, lookup, asOf, windowDays, seen)))];
}

/**
 * The provider's replacement text, with a note after every model it names that is itself gone or going within the
 * window: "gemini-3.1-flash-image-preview (itself shut down on 2026-06-25; next: gemini-3.1-flash-image)".
 */
export function annotateReplacement(text: string, lookup: ReplacementLookup, asOf: string, windowDays: number): string {
  let out = text;
  for (const id of namedIds(text, lookup)) {
    const info = lookup(id)!;
    if (!fading(info, asOf, windowDays)) continue;
    const past = info.shutdownDate <= asOf;
    const when = info.tentative
      ? past
        ? `itself past its earliest shutdown date, ${info.shutdownDate}`
        : `itself can shut down from ${info.shutdownDate}`
      : past
        ? `itself shut down on ${info.shutdownDate}`
        : `itself shuts down on ${info.shutdownDate}`;
    const successors = resolveSuccessors(id, lookup, asOf, windowDays).filter((s) => s !== id);
    const note = successors.length ? `${when}; next: ${successors.join(' or ')}` : `${when}; no further replacement listed`;
    out = out.replace(boundary(id), `${id} (${note})`);
  }
  return out;
}
