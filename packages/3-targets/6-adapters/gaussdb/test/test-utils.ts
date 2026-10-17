/**
 * Shared test utilities for GaussDB adapter tests.
 *
 * These utilities provide factory functions for creating test contracts,
 * schemas, and other common test fixtures.
 */

import type { Contract } from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage, type StorageTableInput } from '@internal/sql-contract/types';
import { gaussdbCreateNamespace } from '@internal/target-gaussdb/types';
import { createContract } from '@repo/test-utils';

export function createTestContract(
  overrides: { tables?: Record<string, StorageTableInput>; storageHash?: string } = {},
): Contract<SqlStorage> {
  const unboundNs = gaussdbCreateNamespace({
    id: UNBOUND_NAMESPACE_ID,
    entries: { table: overrides.tables ?? {} },
  });
  return createContract<SqlStorage>({
    storage: new SqlStorage({
      storageHash: (overrides.storageHash ?? 'test') as never,
      namespaces: { [UNBOUND_NAMESPACE_ID]: unboundNs },
    }),
  });
}
