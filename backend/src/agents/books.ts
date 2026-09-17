import type { BookOption, BookDetail } from '../types';
import { execute } from '../api-client/specExecutor';

const SPEC_PATH = 'src/api-specs/openlibrary.yaml';

/**
 * Search for books via the spec-driven OpenLibrary executor.
 *
 * Calls execute() with the Swagger spec's searchBooks operation.
 * Returns an empty array on failure so the caller can show "no results".
 */
export async function getBookOptions(query: string): Promise<BookOption[]> {
  const result = await execute<any>(SPEC_PATH, 'searchBooks', { q: query, limit: 10 });
  if (result.ok && Array.isArray(result.data?.docs) && result.data.docs.length > 0) {
    return result.data.docs.map((doc: any, i: number) => ({
      id: doc.key || `book-${i}`,
      title: doc.title || 'Unknown Title',
      authors: Array.isArray(doc.author_name) ? doc.author_name : [],
      firstPublishYear: typeof doc.first_publish_year === 'number' ? doc.first_publish_year : undefined,
      publishers: Array.isArray(doc.publisher) ? doc.publisher : undefined,
      isbn: Array.isArray(doc.isbn) ? doc.isbn : undefined,
      coverId: typeof doc.cover_i === 'number' ? doc.cover_i : undefined,
      subjects: Array.isArray(doc.subject) ? doc.subject : undefined,
    }));
  }
  return [];
}

/**
 * Fetch detailed info for a single book by its OpenLibrary key.
 * Uses the spec-driven executor with getBookByKey operation.
 */
export async function getBookDetail(bookKey: string): Promise<BookDetail | null> {
  const result = await execute<any>(SPEC_PATH, 'getBookByKey', { bibKey: bookKey });
  if (!result.ok || !result.data) return null;
  const data = result.data;
  return {
    id: bookKey,
    title: data.title || 'Unknown Title',
    authors: Array.isArray(data.authors) ? data.authors.map((a: any) => a.name || 'Unknown') : [],
    publishDate: typeof data.publish_date === 'string' ? data.publish_date : undefined,
    publishers: Array.isArray(data.publishers) ? data.publishers : undefined,
    isbn10: Array.isArray(data.isbn_10) ? data.isbn_10 : undefined,
    isbn13: Array.isArray(data.isbn_13) ? data.isbn_13 : undefined,
    pages: typeof data.number_of_pages === 'number' ? data.number_of_pages : undefined,
    subjects: Array.isArray(data.subjects) ? data.subjects : undefined,
    coverUrl: data.cover?.medium || data.cover?.small || '',
    description: typeof data.description === 'string' ? data.description : (data.description?.value || ''),
  };
}
