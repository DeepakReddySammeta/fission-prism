import { readdirSync } from 'fs';
import { resolve, basename, extname } from 'path';
import { loadApiConfig } from './loader';
import type { ApiConfig } from './types';

interface RegisteredApi {
  name: string;
  path: string;
  config: ApiConfig;
}

const registry = new Map<string, RegisteredApi>();

/**
 * Scan a directory for YAML API configs and register them.
 * Accepts:
 *  - OpenAPI 3.0 specs (any .yaml / .yml file with openapi: 3.x.x)
 *  - Legacy custom format files (any .yaml / .yml)
 *
 * Files are registered by their basename without extension.
 * E.g. `books-api.yaml` → `"books-api"`, `weather.yaml` → `"weather"`.
 */
export function registerApiConfigs(dirPath: string): void {
  const files = readdirSync(dirPath);

  for (const file of files) {
    const ext = extname(file).toLowerCase();
    if (ext !== '.yaml' && ext !== '.yml') continue;

    const fullPath = resolve(dirPath, file);
    const name = basename(file, ext);

    try {
      const config = loadApiConfig(fullPath);
      registry.set(name, { name, path: fullPath, config });
      console.log(`[api-config] Registered "${name}" from ${file} (${config.api.name})`);
    } catch (err) {
      console.warn(`[api-config] Skipped ${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/** Look up a registered API config by its registered name. */
export function getApiConfig(name: string): ApiConfig | undefined {
  return registry.get(name)?.config;
}

/** Look up a registered API by its registered name (includes path). */
export function getRegisteredApi(name: string): RegisteredApi | undefined {
  return registry.get(name);
}

/** List all registered API names. */
export function listRegisteredApis(): string[] {
  return Array.from(registry.keys());
}
