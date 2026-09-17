import type { MovieOption, MovieDetail } from '../types';
import { execute } from '../api-client/specExecutor';

const SPEC_PATH = 'src/api-specs/tmdb.yaml';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w342';

function posterUrl(path: string | null | undefined): string {
  if (!path) return '';
  return `${TMDB_IMAGE_BASE}${path}`;
}

/**
 * Search for movies via the spec-driven TMDB executor.
 *
 * Calls execute() with the Swagger spec's searchMovies operation.
 * Returns an empty array on failure so the caller can show "no results".
 */
export async function getMovieOptions(query: string): Promise<MovieOption[]> {
  const result = await execute<any>(SPEC_PATH, 'searchMovies', {
    query,
    api_key: process.env.TMDB_API_KEY || '',
  });
  if (result.ok && Array.isArray(result.data?.results) && result.data.results.length > 0) {
    return result.data.results.map((m: any, i: number) => ({
      id: String(m.id || `movie-${i}`),
      title: m.title || 'Unknown Title',
      overview: m.overview || '',
      posterPath: m.poster_path || '',
      releaseDate: m.release_date || undefined,
      rating: typeof m.vote_average === 'number' ? m.vote_average : undefined,
      genreIds: Array.isArray(m.genre_ids) ? m.genre_ids : [],
    }));
  }
  return [];
}

/**
 * Fetch detailed info for a single movie by its TMDB ID.
 * Uses the spec-driven executor with getMovieById operation.
 */
export async function getMovieDetail(movieId: string): Promise<MovieDetail | null> {
  const result = await execute<any>(SPEC_PATH, 'getMovieById', {
    movieId: Number(movieId),
    api_key: process.env.TMDB_API_KEY || '',
  });
  if (!result.ok || !result.data) return null;
  const data = result.data;
  return {
    id: String(data.id),
    title: data.title || 'Unknown Title',
    overview: data.overview || '',
    posterUrl: posterUrl(data.poster_path),
    backdropUrl: data.backdrop_path ? `https://image.tmdb.org/t/p/w780${data.backdrop_path}` : '',
    releaseDate: data.release_date || undefined,
    runtime: typeof data.runtime === 'number' ? data.runtime : undefined,
    rating: typeof data.vote_average === 'number' ? data.vote_average : undefined,
    genres: Array.isArray(data.genres) ? data.genres.map((g: any) => g.name).filter(Boolean) : [],
    tagline: data.tagline || undefined,
    status: data.status || undefined,
  };
}
