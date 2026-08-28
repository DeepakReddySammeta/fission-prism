/**
 * The Fission Prism A2UI catalog — the single `Catalog` every surface renders
 * through. Its `id` MUST match the `catalogId` the backend puts in every
 * `createSurface` envelope (`backend/src/types.ts` `CATALOG_ID`), or
 * `MessageProcessor` throws "Catalog not found".
 */
import { Catalog } from '@a2ui/web_core/v0_9';
import type { ReactComponentImplementation } from '@a2ui/react/v0_9';
import { CATALOG_ID } from '../types';
import { catalogComponents } from './components';
import { catalogFunctions } from './functions';

export const catalog = new Catalog<ReactComponentImplementation>(
  CATALOG_ID,
  catalogComponents,
  catalogFunctions,
);
