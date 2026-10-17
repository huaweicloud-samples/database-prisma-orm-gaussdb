import { expectTypeOf, test } from 'vitest';
import type { GaussDbContractView } from '../src/core/gaussdb-contract-view';
import { GaussDbMigration } from '../src/core/migrations/gaussdb-migration';
import type { Contract } from './fixtures/namespaced-contract.d';

/**
 * Emit-then-consume type tests: the migration's `endContract` getter resolves
 * to the precisely-typed, schema-qualified `GaussDbContractView<End>` over the
 * real emitted multi-schema fixture.
 */

class TypedMigration extends GaussDbMigration<Contract, Contract> {
  override readonly endContractJson = {} as Contract;
  override get operations() {
    return [];
  }
}

type EndView = TypedMigration['endContract'];
type StartView = TypedMigration['startContract'];

test('endContract is a GaussDbContractView<Contract>', () => {
  expectTypeOf<EndView>().toEqualTypeOf<GaussDbContractView<Contract>>();
});

test('startContract is GaussDbContractView<Contract> | null', () => {
  expectTypeOf<StartView>().toEqualTypeOf<GaussDbContractView<Contract> | null>();
});

test('endContract.namespace.<schema>.table.<x> resolves per-schema leaves', () => {
  expectTypeOf<
    EndView['namespace']['public']['table']['users']['columns']['email']['codecId']
  >().toEqualTypeOf<'gaussdb/text@1'>();
  expectTypeOf<
    EndView['namespace']['auth']['table']['users']['columns']['token']['codecId']
  >().toEqualTypeOf<'gaussdb/text@1'>();
});

test('cross-schema column access on the migration view is a compile error', () => {
  const view = null as unknown as EndView;
  // @ts-expect-error public.users has no `token` column (that is auth.users)
  view.namespace.public.table.users.columns.token;
});
