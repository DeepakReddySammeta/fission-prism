import type { ApiConfig, TransformConfig, TransformArgs } from './types';

function getValue(obj: Record<string, unknown>, path: string): unknown {
  // Support nested paths like "author.name" in future
  return obj[path];
}

function applyTransform(value: unknown, transform: TransformConfig['transform'], args?: TransformArgs): unknown {
  switch (transform) {
    case 'identity':
      return value;

    case 'regexReplace': {
      if (typeof value !== 'string' || !args?.pattern) return value;
      const re = new RegExp(args.pattern);
      return value.replace(re, args.replacement ?? '');
    }

    case 'firstOrDefault': {
      if (Array.isArray(value) && value.length > 0) return value[0];
      if (value !== undefined && value !== null) return value;
      return args?.fallback ?? null;
    }

    case 'defaultValue': {
      return value !== undefined && value !== null ? value : args?.value;
    }

    case 'conditionalFormat': {
      if (value === undefined || value === null || value === '') return undefined;
      const template = args?.template ?? '{value}';
      return template.replace(/\{value\}/g, String(value));
    }

    default:
      return value;
  }
}

/**
 * Map a raw API response item to the internal shape defined by the config's
 * mapping transformations. If no mapping is defined, returns the raw item
 * as-is (identity pass-through).
 */
export function mapResponseItem(
  config: ApiConfig,
  rawItem: Record<string, unknown>
): Record<string, unknown> {
  // No mapping configured → identity fallback
  if (!config.mapping) return rawItem;

  const result: Record<string, unknown> = {};

  for (const t of config.mapping.transformations) {
    const rawValue = getValue(rawItem, t.source);
    result[t.target] = applyTransform(rawValue, t.transform, t.args);
  }

  return result;
}
