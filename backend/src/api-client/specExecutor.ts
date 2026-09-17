/**
 * Generic spec-driven API executor.
 *
 * Reads a Swagger/OpenAPI YAML spec and executes HTTP operations dynamically.
 * No hardcoded URLs — the spec is the source of truth for base URL, paths,
 * parameters, and response shapes. Adding a new API means adding a new YAML
 * file and using execute() with the right operationId.
 *
 * This is intentionally lightweight: it parses the spec once, builds an
 * operation index keyed by operationId, and handles path templating + query
 * string assembly. It does NOT validate request bodies against schemas or
 * deeply validate responses — those are the caller's concern.
 */
import yaml from 'js-yaml';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface ParamDef {
  name: string;
  in: 'query' | 'path' | 'header';
  required?: boolean;
  schema?: { type?: string; default?: any };
}

interface OperationDef {
  operationId: string;
  method: string;
  path: string;
  parameters: ParamDef[];
}

interface ParsedSpec {
  servers: { url: string }[];
  operations: Map<string, OperationDef>;
}

const specCache = new Map<string, ParsedSpec>();

function parseSpec(yamlPath: string): ParsedSpec {
  const cached = specCache.get(yamlPath);
  if (cached) return cached;

  const raw = readFileSync(resolve(yamlPath), 'utf-8');
  const doc = yaml.load(raw) as any;

  const servers = Array.isArray(doc.servers) ? doc.servers : [{ url: '' }];
  const operations = new Map<string, OperationDef>();

  for (const [path, pathItem] of Object.entries<any>(doc.paths || {})) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
      const op = pathItem?.[method];
      if (!op || !op.operationId) continue;
      operations.set(op.operationId, {
        operationId: op.operationId,
        method: method.toUpperCase(),
        path,
        parameters: Array.isArray(op.parameters) ? op.parameters : [],
      });
    }
  }

  const parsed: ParsedSpec = { servers, operations };
  specCache.set(yamlPath, parsed);
  return parsed;
}

function buildUrl(
  baseUrl: string,
  pathTemplate: string,
  params: ParamDef[],
  args: Record<string, any>
): { url: string; headers: Record<string, string> } {
  let path = pathTemplate;
  const query = new URLSearchParams();
  const headers: Record<string, string> = {};

  for (const p of params) {
    const val = args[p.name];
    if (p.in === 'path') {
      if (val === undefined || val === null) {
        throw new Error(`Missing required path parameter "${p.name}"`);
      }
      path = path.replace(`{${p.name}}`, encodeURIComponent(String(val)));
    } else if (p.in === 'query') {
      if (val !== undefined && val !== null) {
        query.set(p.name, String(val));
      } else if (p.schema?.default !== undefined) {
        query.set(p.name, String(p.schema.default));
      }
    } else if (p.in === 'header') {
      if (val !== undefined && val !== null) {
        headers[p.name] = String(val);
      }
    }
  }

  const qs = query.toString();
  const url = `${baseUrl.replace(/\/$/, '')}${path}${qs ? `?${qs}` : ''}`;
  return { url, headers };
}

export interface SpecExecutionResult<T = any> {
  ok: boolean;
  data?: T;
  error?: string;
  status?: number;
}

/**
 * Execute an operation from a Swagger/OpenAPI YAML spec by operationId.
 *
 * @param specPath  Path to the YAML file (relative or absolute)
 * @param operationId  The operationId defined in the spec
 * @param args  Key-value map of parameters (path, query, header)
 * @returns  { ok, data, error, status }
 */
export async function execute<T = any>(
  specPath: string,
  operationId: string,
  args: Record<string, any> = {}
): Promise<SpecExecutionResult<T>> {
  try {
    const spec = parseSpec(specPath);
    const op = spec.operations.get(operationId);
    if (!op) {
      return { ok: false, error: `Unknown operationId "${operationId}"` };
    }

    const baseUrl = spec.servers[0]?.url || '';
    const { url, headers } = buildUrl(baseUrl, op.path, op.parameters, args);

    const res = await fetch(url, {
      method: op.method,
      headers: {
        Accept: 'application/json',
        ...headers,
      },
    });

    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}: ${res.statusText}`, status: res.status };
    }

    const data = (await res.json()) as T;
    return { ok: true, data, status: res.status };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}

/** Exposed for testing / introspection. */
export const _specInternals = { parseSpec, buildUrl };
