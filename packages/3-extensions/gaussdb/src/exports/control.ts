/**
 * Control-API facade for GaussDB.
 *
 * Collapses the five-package wiring required to drive control-side
 * operations (`dbInit`, `dbUpdate`, `dbVerify`, `migrate`, …) into
 * a single `createGaussDbControlClient()` call. Mirrors what
 * `@internal/gaussdb/runtime` did for the query side.
 */

import gaussdbAdapter from '@internal/adapter-gaussdb/control';
import {
  type ControlClient,
  type ControlClientOptions,
  createControlClient,
} from '@internal/cli/control-api';
import gaussdbDriver from '@internal/driver-gaussdb/control';
import sql from '@internal/family-sql/control';
import gaussdb from '@internal/target-gaussdb/control';
import { ifDefined } from '@internal/utils/defined';

export interface GaussDbControlClientOptions {
  /**
   * Default GaussDB connection string. When set, operations like `dbInit`
   * auto-connect without an explicit `connect()` call. Equivalent to the
   * `connection` field on the underlying `ControlClientOptions`.
   */
  readonly connection?: string;
  /**
   * Composed extension descriptors. Pass the same descriptors here that
   * the contract was authored against.
   */
  readonly extensions?: ControlClientOptions['extensions'];
}

export function createGaussDbControlClient(
  options: GaussDbControlClientOptions = {},
): ControlClient {
  const clientOptions: ControlClientOptions = {
    family: sql,
    target: gaussdb,
    adapter: gaussdbAdapter,
    driver: gaussdbDriver,
    ...ifDefined('connection', options.connection),
    ...ifDefined('extensions', options.extensions),
  };
  return createControlClient(clientOptions);
}

export type { ControlClient };
