/**
 * Named API route parameters must be scalar identifiers. Express 5 also
 * supports wildcard arrays; do not stringify those into project/user IDs.
 * Keep the original object so omitted optional keys and mutation semantics
 * remain unchanged for existing scalar routes.
 */
export function scalarRouteParams(params: unknown): Record<string, string> {
  if (!isScalarParams(params)) {
    throw new TypeError('Expected scalar route parameters');
  }
  return params;
}

function isScalarParams(params: unknown): params is Record<string, string> {
  return typeof params === 'object'
    && params !== null
    && !Array.isArray(params)
    && Object.values(params).every(value => typeof value === 'string');
}
