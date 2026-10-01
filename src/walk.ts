export interface StringLeaf {
  value: string;
  /** Path relative to the node's parameters, e.g. "bodyParameters.parameters[0].value". */
  path: string;
  /** Last key on the path (array indexes excluded). */
  key: string;
  /** The object or array holding the value. */
  parent: unknown;
}

/** n8n's resource locator: { __rl: true, value, mode, cachedResultName, cachedResultUrl }. */
const isResourceLocator = (value: object): value is { __rl: true; value?: unknown } => (value as { __rl?: unknown }).__rl === true;

/**
 * Yields every string inside a node's parameters, depth first. Resource locators contribute only
 * their `value`: cachedResultName and cachedResultUrl are display copies the editor stores.
 */
export function* stringLeaves(value: unknown, path = '', key = '', parent: unknown = undefined): Generator<StringLeaf> {
  if (typeof value === 'string') {
    yield { value, path, key, parent };
  } else if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) yield* stringLeaves(value[i], `${path}[${i}]`, key, value);
  } else if (typeof value === 'object' && value !== null) {
    if (isResourceLocator(value)) {
      yield* stringLeaves(value.value, path ? `${path}.value` : 'value', 'value', value);
      return;
    }
    for (const [k, v] of Object.entries(value)) yield* stringLeaves(v, path ? `${path}.${k}` : k, k, value);
  }
}
