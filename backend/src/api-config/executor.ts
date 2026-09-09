import type { ApiConfig, EndpointConfig } from './types';

function buildQueryString(
  endpoint: EndpointConfig,
  params: Record<string, unknown>
): string {
  const entries: string[] = [];

  for (const param of endpoint.queryParams || []) {
    const value = params[param.name] ?? param.default;
    if (value === undefined || value === null) {
      if (param.required) {
        throw new Error(`Missing required query param: ${param.name}`);
      }
      continue;
    }
    entries.push(`${encodeURIComponent(param.name)}=${encodeURIComponent(String(value))}`);
  }

  return entries.length ? `?${entries.join('&')}` : '';
}

function buildBody(endpoint: EndpointConfig, params: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!endpoint.bodyParams || endpoint.bodyParams.length === 0) return undefined;
  const body: Record<string, unknown> = {};
  for (const param of endpoint.bodyParams) {
    const value = params[param.name];
    if (value === undefined || value === null) {
      if (param.required) throw new Error(`Missing required body param: ${param.name}`);
      continue;
    }
    body[param.name] = value;
  }
  return Object.keys(body).length > 0 ? body : undefined;
}

function resolvePath(obj: unknown, path: string): unknown {
  if (path === '' || path === '.') return obj;
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Execute an API endpoint defined in the config.
 * Returns the raw item array extracted from response.rootPath.
 */
export async function executeApiEndpoint(
  config: ApiConfig,
  endpointName: string,
  params: Record<string, unknown>
): Promise<unknown[]> {
  const endpoint = config.api.endpoints[endpointName];
  if (!endpoint) {
    throw new Error(`Unknown endpoint: ${endpointName}`);
  }

  // Resolve path params into the URL path
  let resolvedPath = endpoint.path;
  for (const param of endpoint.pathParams || []) {
    const value = params[param.name];
    if (value === undefined || value === null) {
      if (param.required) {
        throw new Error(`Missing required path param: ${param.name}`);
      }
      continue;
    }
    resolvedPath = resolvedPath.replace(`{${param.name}}`, encodeURIComponent(String(value)));
  }

  const query = buildQueryString(endpoint, params);
  const baseUrl = endpoint.baseUrl ?? config.api.baseUrl;
  const url = `${baseUrl}${resolvedPath}${query}`;

  const body = buildBody(endpoint, params);
  const headers: Record<string, string> = endpoint.headers
    ? { ...endpoint.headers }
    : { Accept: 'application/json' };
  if (body) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(url, {
    method: endpoint.method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

  const data = (await res.json()) as Record<string, unknown>;
  const items = resolvePath(data, config.response.rootPath);

  // Some endpoints return a single object (e.g. weather forecast).
  // Wrap it in an array so callers always get a consistent shape.
  const itemArray: unknown[] = Array.isArray(items) ? items : items !== undefined && items !== null ? [items] : [];

  // Apply filter if specified
  if (config.response.filter) {
    return itemArray.filter((item) => {
      try {
        // Simple filter: "item.title" means item must have a truthy title
        const field = config.response!.filter!.replace(/^item\./, '');
        return Boolean((item as Record<string, unknown>)[field]);
      } catch {
        return false;
      }
    });
  }

  return itemArray;
}
