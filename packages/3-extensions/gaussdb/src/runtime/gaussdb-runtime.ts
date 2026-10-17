import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { type Runtime, SqlRuntimeBase } from '@internal/sql-runtime';

/**
 * The GaussDB runtime interface. App code depends on this — `gaussdb()` returns it
 * and `Runtime` (the common interface) is the everyday parameter type.
 *
 * `GaussDbRuntimeImpl` is the implementing class. It is exported so that other
 * extensions (e.g. Supabase) can subclass it; app code never references it directly.
 */
export interface GaussDbRuntime extends Runtime {}

export class GaussDbRuntimeImpl<
  TContract extends Contract<SqlStorage> = Contract<SqlStorage>,
> extends SqlRuntimeBase<TContract> {}
