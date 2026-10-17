import type { ColumnDefault } from '@internal/contract/types';

export type GaussDbColumnDefault =
  | ColumnDefault
  | { readonly kind: 'sequence'; readonly name: string };
