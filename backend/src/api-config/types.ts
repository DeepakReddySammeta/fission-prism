/* ---------- Query param ---------- */
export interface QueryParamConfig {
  name: string;
  type: 'string' | 'number' | 'boolean';
  required?: boolean;
  default?: string | number | boolean;
  description?: string;
}

/* ---------- Path param ---------- */
export interface PathParamConfig {
  name: string;
  type: 'string' | 'number';
  required?: boolean;
  description?: string;
}

/* ---------- Body param ---------- */
export interface BodyParamConfig {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object';
  required?: boolean;
  description?: string;
}

/* ---------- Endpoint ---------- */
export interface EndpointConfig {
  method: string;
  path: string;
  /** Per-endpoint override for the base URL (e.g. a different server for geocoding). */
  baseUrl?: string;
  queryParams?: QueryParamConfig[];
  pathParams?: PathParamConfig[];
  bodyParams?: BodyParamConfig[];
  headers?: Record<string, string>;
}

/* ---------- API section ---------- */
export interface ApiSection {
  name: string;
  description: string;
  baseUrl: string;
  endpoints: Record<string, EndpointConfig>;
}

/* ---------- Response section ---------- */
export interface RawFieldConfig {
  field: string;
  type: string;
  description?: string;
  optional?: boolean;
}

export interface ResponseConfig {
  rootPath: string;
  filter?: string;
  rawSchema: RawFieldConfig[];
}

/* ---------- Mapping section ---------- */
export interface TransformArgs {
  pattern?: string;
  replacement?: string;
  fallback?: unknown;
  value?: unknown;
  template?: string;
  condition?: string;
}

export interface TransformConfig {
  target: string;
  source: string;
  transform: 'identity' | 'regexReplace' | 'firstOrDefault' | 'defaultValue' | 'conditionalFormat';
  args?: TransformArgs;
}

export interface MappingConfig {
  transformations: TransformConfig[];
}

/* ---------- LLM view section ---------- */
export interface LlmViewConfig {
  schemaDescription: string;
  designInstructions: string;
  promptTemplate: string;
}

/* ---------- Top-level config ---------- */
export interface ApiConfig {
  api: ApiSection;
  response: ResponseConfig;
  mapping?: MappingConfig;
  llmView?: LlmViewConfig;
}
