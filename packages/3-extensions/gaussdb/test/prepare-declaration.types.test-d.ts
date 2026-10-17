/**
 * Type-test: a prepared declaration completes and checks its codec ids.
 *
 * The declaration is where a caller writes a codec id by hand, so `keyof CT`
 * has to stay a literal union: intersecting the contract's codec map with the
 * open base collapses it to `string` through that type's index signature,
 * which costs the completions and lets an unregistered id typecheck.
 */

import type { ExtractCodecTypes } from '@internal/sql-contract/types';
import { expectTypeOf, test } from 'vitest';
import type { GaussDbClient } from '../src/runtime/gaussdb';
import type { Contract } from './fixtures/generated/contract';

declare const db: GaussDbClient<Contract>;

test('the fixture codec map is not any', () => {
  expectTypeOf<ExtractCodecTypes<Contract>>().not.toBeAny();
});

test('a declaration binds each declared id to its codec input type', async () => {
  const prepared = await db.prepare(
    { id: 'gaussdb/int4@1', email: 'gaussdb/text@1' },
    (_sql, params) => {
      expectTypeOf(params.id.returnType.codecId).toEqualTypeOf<'gaussdb/int4@1'>();
      expectTypeOf(params.email.returnType.codecId).toEqualTypeOf<'gaussdb/text@1'>();
      return null as never;
    },
  );

  type Params = Parameters<typeof prepared.query>[1];
  expectTypeOf<Params['id']>().toEqualTypeOf<number>();
  expectTypeOf<Params['email']>().toEqualTypeOf<string>();
});

test('a declaration naming an id the contract does not carry is rejected', async () => {
  await db.prepare(
    // @ts-expect-error — the declaration names a codec the contract's map has no row for
    { id: 'gaussdb/nonexistent@1' },
    () => null as never,
  );
});
