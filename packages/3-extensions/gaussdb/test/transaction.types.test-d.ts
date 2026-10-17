import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { expectTypeOf, test } from 'vitest';
import type { GaussDbClient, GaussDbTransactionContext } from '../src/runtime/gaussdb';

type TestContract = Contract<SqlStorage>;

test('transaction context does not expose a transaction method', () => {
  type HasTransaction = 'transaction' extends keyof GaussDbTransactionContext<TestContract>
    ? true
    : false;
  expectTypeOf<HasTransaction>().toEqualTypeOf<false>();
});

test('db.transaction infers the callback return type correctly', () => {
  const db = {} as GaussDbClient<TestContract>;

  const numResult = db.transaction(async (_tx) => 42);
  expectTypeOf(numResult).toEqualTypeOf<Promise<number>>();

  const objResult = db.transaction(async (_tx) => ({ name: 'test' as const, count: 3 }));
  expectTypeOf(objResult).toEqualTypeOf<Promise<{ name: 'test'; count: number }>>();
});

test('tx.sql has the same type as db.sql', () => {
  type DbSql = GaussDbClient<TestContract>['sql'];
  type TxSql = GaussDbTransactionContext<TestContract>['sql'];
  expectTypeOf<TxSql>().toEqualTypeOf<DbSql>();
});

test('tx.orm has the same type as db.orm', () => {
  type DbOrm = GaussDbClient<TestContract>['orm'];
  type TxOrm = GaussDbTransactionContext<TestContract>['orm'];
  expectTypeOf<TxOrm>().toEqualTypeOf<DbOrm>();
});
