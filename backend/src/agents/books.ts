/**
 * Books agent — YAML-driven API configuration.
 *
 * The entire API contract (endpoint, parameters, response schema, field
 * mappings, and LLM view) is externalized to `config/books-api.yaml`.
 * This file only wires the generic api-config modules together.
 *
 * Privacy guarantee: the LLM only ever sees field NAMES and TYPES from the
 * YAML's `llmView` section. Actual book data is bound separately via
 * `updateData` envelopes — it never reaches the LLM.
 */

import { getApiConfig } from '../api-config/registry';
import { executeApiEndpoint } from '../api-config/executor';
import { mapResponseItem } from '../api-config/mapper';
import { buildLlmPrompt, buildSchemaHash } from '../api-config/llm-prompt';
import { generateJSON } from '../llm';
import type { ApiConfig } from '../api-config/types';
import type { Envelope } from '../types';
import { A2UI_VERSION } from '../types';
import { createSurface, updateData, booksSurface } from '../orchestrator/envelopes';

export interface Book {
  id: string;
  title: string;
  author: string;
  firstPublishYear: number;
  coverUrl?: string;
}

const API_NAME = 'books-api';

function getConfig(): ApiConfig {
  const config = getApiConfig(API_NAME);
  if (!config) {
    throw new Error(
      `API config "${API_NAME}" not registered. Did you call registerApiConfigs()?`
    );
  }
  return config;
}

/**
 * Query OpenLibrary for books matching `q`.
 * The URL, params, response extraction, and field mapping all come from
 * `config/books-api.yaml` via the generic api-config modules.
 */
export async function searchBooks(q: string, limit = 12): Promise<{ books: Book[]; source: 'live' | 'none' }> {
  const query = q.trim();
  if (!query) return { books: [], source: 'none' };

  const config = getConfig();
  try {
    const rawItems = await executeApiEndpoint(config, 'search', { q: query, limit });
    const books = rawItems
      .map((item) => mapResponseItem(config, item as Record<string, unknown>) as unknown as Book)
      .filter((b) => !!b.title);
    return { books, source: books.length ? 'live' : 'none' };
  } catch {
    return { books: [], source: 'none' };
  }
}

/* ---------------- LLM-driven dynamic UI (privacy-first) ---------------- */

interface LlmComponentTree {
  components: Array<Record<string, unknown>>;
}

/**
 * Build a book-search surface. Tries the LLM first for a dynamic layout;
 * falls back to the static hand-coded `booksSurface()` on any failure.
 *
 * The LLM prompt contains ONLY field names and types from the YAML config.
 * The actual `books` array is sent via a separate `updateData` envelope.
 */
export async function buildBooksSurface(
  surfaceId: string,
  books: Book[],
  source: 'live' | 'none'
): Promise<Envelope[]> {
  // No books → empty state (reuse static surface, it handles this fine)
  if (books.length === 0) {
    return booksSurface(surfaceId, books, source);
  }

  const config = getConfig();
  const prompt = buildLlmPrompt(config);
  const schemaHash = buildSchemaHash(config);

  // Try LLM with schema-hash as cache key — same schema = reusable template
  const llmResult = await generateJSON<LlmComponentTree>(prompt, schemaHash, 12_000);

  if (llmResult?.components?.length) {
    return [
      createSurface(surfaceId, 'Book Search', '#f25011'),
      {
        version: A2UI_VERSION,
        updateComponents: {
          surfaceId,
          components: llmResult.components as any,
        },
      },
      updateData(surfaceId, '/books', books),
    ];
  }

  // Static fallback — the original hand-coded surface
  return booksSurface(surfaceId, books, source);
}

/**
 * Deterministic book-cover color — used when OpenLibrary has no cover_i,
 * so the card still renders a readable accent instead of a blank square.
 */
const COVER_TONES = ['#8B4513', '#2E8B57', '#4682B4', '#CD853F', '#6A5ACD', '#B22222'];

export function bookCoverTone(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return COVER_TONES[h % COVER_TONES.length];
}
