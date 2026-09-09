import { readFileSync } from 'fs';
import { resolve } from 'path';
import YAML from 'yaml';
import type { ApiConfig, ApiSection, EndpointConfig, QueryParamConfig, PathParamConfig, BodyParamConfig, RawFieldConfig, TransformConfig, LlmViewConfig, MappingConfig } from './types';

const cache = new Map<string, { mtime: number; config: ApiConfig }>();

/* -------------------------------------------------------------------------- */
/*  Validation                                                                */
/* -------------------------------------------------------------------------- */

function validateApiConfig(config: unknown): asserts config is ApiConfig {
  const c = config as any;

  if (!c?.api || typeof c.api !== 'object') {
    throw new Error('Missing "api" section in config');
  }
  if (!c.api.baseUrl || typeof c.api.baseUrl !== 'string') {
    throw new Error('Missing "api.baseUrl" in config');
  }
  if (!c.api.endpoints || typeof c.api.endpoints !== 'object') {
    throw new Error('Missing "api.endpoints" in config');
  }

  if (!c?.response || typeof c.response !== 'object') {
    throw new Error('Missing "response" section in config');
  }
  if (!c.response.rootPath || typeof c.response.rootPath !== 'string') {
    throw new Error('Missing "response.rootPath" in config');
  }
  if (!Array.isArray(c.response.rawSchema)) {
    throw new Error('Missing or invalid "response.rawSchema" in config');
  }

  // mapping is optional (e.g. weather doesn't need it)
  if (c?.mapping) {
    if (!Array.isArray(c.mapping.transformations)) {
      throw new Error('Invalid "mapping.transformations" in config');
    }
  }

  // llmView is optional (e.g. weather doesn't need it)
  if (c?.llmView) {
    if (!c.llmView.schemaDescription || typeof c.llmView.schemaDescription !== 'string') {
      throw new Error('Missing "llmView.schemaDescription" in config');
    }
    if (!c.llmView.designInstructions || typeof c.llmView.designInstructions !== 'string') {
      throw new Error('Missing "llmView.designInstructions" in config');
    }
    if (!c.llmView.promptTemplate || typeof c.llmView.promptTemplate !== 'string') {
      throw new Error('Missing "llmView.promptTemplate" in config');
    }
  }
}

/* -------------------------------------------------------------------------- */
/*  OpenAPI normalizer                                                        */
/* -------------------------------------------------------------------------- */

function isOpenApi(doc: unknown): boolean {
  const d = doc as any;
  if (!d) return false;
  if (d.openapi && String(d.openapi).startsWith('3.')) return true;
  // fallback: check for swagger 2.0
  if (d.swagger && String(d.swagger).startsWith('2.')) return true;
  return false;
}

function openapiTypeToParamType(t?: string): 'string' | 'number' | 'boolean' {
  if (t === 'integer' || t === 'number') return 'number';
  if (t === 'boolean') return 'boolean';
  return 'string';
}

function buildQueryParams(parameters?: any[]): QueryParamConfig[] {
  if (!parameters) return [];
  return parameters
    .filter((p) => p.in === 'query')
    .map((p) => ({
      name: p.name,
      type: openapiTypeToParamType(p.schema?.type || p.type),
      required: p.required === true,
      default: p.schema?.default ?? p.default,
      description: p.description,
    }));
}

function buildPathParams(parameters?: any[]): PathParamConfig[] {
  if (!parameters) return [];
  return parameters
    .filter((p) => p.in === 'path')
    .map((p) => {
      const rawType = openapiTypeToParamType(p.schema?.type || p.type);
      const type: PathParamConfig['type'] = rawType === 'boolean' ? 'string' : rawType;
      return {
        name: p.name,
        type,
        required: p.required === true,
        description: p.description,
      };
    });
}

function buildBodyParams(requestBody?: any): BodyParamConfig[] | undefined {
  if (!requestBody) return undefined;
  const jsonContent = requestBody.content?.['application/json'];
  if (!jsonContent?.schema) return undefined;
  const schema = jsonContent.schema;
  if (schema.type === 'object' && schema.properties) {
    return Object.entries(schema.properties).map(([name, prop]: [string, any]) => ({
      name,
      type: openapiTypeToParamType(prop.type),
      required: schema.required?.includes(name) || false,
      description: prop.description,
    }));
  }
  return undefined;
}

function buildRawSchema(schema?: any): RawFieldConfig[] {
  if (!schema || schema.type !== 'object' || !schema.properties) return [];
  return Object.entries(schema.properties).map(([field, prop]: [string, any]) => ({
    field,
    type: prop.type === 'array' ? `${prop.items?.type || 'unknown'}[]` : prop.type,
    description: prop.description,
    optional: !schema.required?.includes(field),
  }));
}

function normalizeOpenApi(doc: any): ApiConfig {
  const servers = Array.isArray(doc.servers) && doc.servers.length > 0
    ? String(doc.servers[0].url).replace(/\/$/, '')
    : '';

  const endpoints: Record<string, EndpointConfig> = {};

  for (const [path, pathItem] of Object.entries(doc.paths || {})) {
    if (!pathItem || typeof pathItem !== 'object') continue;

    for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
      const op = (pathItem as any)[method];
      if (!op) continue;

      const operationId = op.operationId || `${method}_${path.replace(/[^a-zA-Z0-9]/g, '_')}`;

      // Build headers from securitySchemes (basic apiKey header support)
      const headers: Record<string, string> = {};
      if (op.security && doc.components?.securitySchemes) {
        for (const sec of op.security) {
          for (const [key, _] of Object.entries(sec)) {
            const scheme = doc.components.securitySchemes[key];
            if (scheme?.type === 'apiKey' && scheme.in === 'header') {
              headers[scheme.name] = `{{${key}}}`; // placeholder — agent resolves at runtime
            }
          }
        }
      }

      const parameters = [...((pathItem as any).parameters || []), ...(op.parameters || [])];

      // Per-endpoint server override (e.g. Open-Meteo geocoding lives on a different host)
      const pathServers = (pathItem as any).servers;
      const endpointBaseUrl = Array.isArray(pathServers) && pathServers.length > 0
        ? String(pathServers[0].url).replace(/\/$/, '')
        : undefined;

      endpoints[operationId] = {
        method: method.toUpperCase(),
        path,
        baseUrl: endpointBaseUrl,
        queryParams: buildQueryParams(parameters),
        pathParams: buildPathParams(parameters),
        bodyParams: buildBodyParams(op.requestBody),
        headers: Object.keys(headers).length > 0 ? headers : undefined,
      };
    }
  }

  const apiSection: ApiSection = {
    name: doc.info?.title || 'api',
    description: doc.info?.description || '',
    baseUrl: servers,
    endpoints,
  };

  // --- Response extraction ---
  // Use x-a2ui-response extension if present, otherwise try to infer from first 200 response
  let response: ApiConfig['response'];
  const xResponse = doc['x-a2ui-response'];
  if (xResponse) {
    response = {
      rootPath: xResponse.rootPath || '',
      filter: xResponse.filter,
      rawSchema: (xResponse.rawSchema || []).map((f: any) => ({
        field: f.field,
        type: f.type,
        description: f.description,
        optional: f.optional,
      })),
    };
  } else {
    // Infer from first GET operation's 200 response
    const firstPathItem = Object.values(doc.paths || {})[0] as any;
    const firstOp = firstPathItem?.get || firstPathItem?.post;
    const successResponse = firstOp?.responses?.['200'];
    const ref = successResponse?.content?.['application/json']?.schema;
    const schema = resolveRef(ref, doc);
    response = {
      rootPath: '',
      rawSchema: buildRawSchema(schema),
    };
  }

  // --- Mapping ---
  let mapping: MappingConfig | undefined;
  const xMapping = doc['x-a2ui-mapping'];
  if (xMapping?.transformations) {
    mapping = {
      transformations: xMapping.transformations.map((t: any): TransformConfig => ({
        target: t.target,
        source: t.source,
        transform: t.transform,
        args: t.args,
      })),
    };
  }

  // --- LLM View ---
  let llmView: LlmViewConfig | undefined;
  const xLlmView = doc['x-a2ui-llmView'];
  if (xLlmView) {
    llmView = {
      schemaDescription: xLlmView.schemaDescription,
      designInstructions: xLlmView.designInstructions,
      promptTemplate: xLlmView.promptTemplate,
    };
  }

  const normalized: ApiConfig = {
    api: apiSection,
    response,
    mapping,
    llmView,
  };

  validateApiConfig(normalized);
  return normalized;
}

function resolveRef(ref: any, doc: any): any {
  if (!ref) return undefined;
  if (ref.$ref) {
    const parts = ref.$ref.replace(/^#\//, '').split('/');
    let current = doc;
    for (const part of parts) {
      current = current?.[part];
    }
    return current;
  }
  return ref;
}

/* -------------------------------------------------------------------------- */
/*  Public API                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Load and validate an API config file.
 * Supports:
 *  - Legacy custom YAML format (our own shape)
 *  - OpenAPI 3.0 specs with x-a2ui-* extensions
 *
 * Caches by file mtime unless API_CONFIG_HOT_RELOAD is set.
 */
export function loadApiConfig(yamlPath: string): ApiConfig {
  const fullPath = resolve(yamlPath);
  const hotReload = process.env.API_CONFIG_HOT_RELOAD === 'true';

  if (!hotReload) {
    const cached = cache.get(fullPath);
    if (cached) {
      try {
        const { mtime } = require('fs').statSync(fullPath);
        if (mtime.getTime() === cached.mtime) {
          return cached.config;
        }
      } catch {
        // stat failed, fall through to re-read
      }
    }
  }

  const content = readFileSync(fullPath, 'utf-8');
  const parsed = YAML.parse(content);

  let config: ApiConfig;
  if (isOpenApi(parsed)) {
    config = normalizeOpenApi(parsed);
  } else {
    config = parsed;
    validateApiConfig(config);
  }

  let mtime = 0;
  try {
    mtime = require('fs').statSync(fullPath).mtime.getTime();
  } catch {
    // ignore stat failure
  }

  cache.set(fullPath, { mtime, config });
  return config;
}

/**
 * Peek at a YAML file without full validation — useful for format detection.
 */
export function peekApiConfig(yamlPath: string): { format: 'openapi' | 'legacy'; raw: unknown } {
  const content = readFileSync(resolve(yamlPath), 'utf-8');
  const parsed = YAML.parse(content);
  return { format: isOpenApi(parsed) ? 'openapi' : 'legacy', raw: parsed };
}
