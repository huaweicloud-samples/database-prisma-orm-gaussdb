import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { Runtime } from '@internal/sql-runtime';
import { expectTypeOf, test } from 'vitest';
import type {
  GaussDbOptionsWithContract,
  GaussDbOptionsWithContractJson,
} from '../src/runtime/gaussdb';
import type gaussdbServerless from '../src/runtime/gaussdb-serverless';
import type { GaussDbServerlessClient } from '../src/runtime/gaussdb-serverless';

type TestContract = Contract<SqlStorage>;
type Db = GaussDbServerlessClient<TestContract>;

test('exposes only the static authoring surface plus connect()', () => {
  type Keys = keyof Db;
  expectTypeOf<Keys>().toEqualTypeOf<'sql' | 'context' | 'stack' | 'contract' | 'connect'>();
});

test('does not expose orm', () => {
  type HasOrm = 'orm' extends keyof Db ? true : false;
  expectTypeOf<HasOrm>().toEqualTypeOf<false>();

  const db = {} as Db;
  // @ts-expect-error db.orm is intentionally absent on the serverless facade
  void db.orm;
});

test('does not expose runtime() helper', () => {
  type HasRuntime = 'runtime' extends keyof Db ? true : false;
  expectTypeOf<HasRuntime>().toEqualTypeOf<false>();

  const db = {} as Db;
  // @ts-expect-error db.runtime is intentionally absent on the serverless facade
  void db.runtime;
});

test('does not expose transaction()', () => {
  type HasTransaction = 'transaction' extends keyof Db ? true : false;
  expectTypeOf<HasTransaction>().toEqualTypeOf<false>();

  const db = {} as Db;
  // @ts-expect-error db.transaction is intentionally absent on the serverless facade
  void db.transaction;
});

test('connect() returns Promise<Runtime & AsyncDisposable>', () => {
  const db = {} as Db;
  expectTypeOf(db.connect).parameter(0).toEqualTypeOf<{ readonly url: string }>();
  expectTypeOf<Awaited<ReturnType<Db['connect']>>>().toMatchTypeOf<Runtime>();
  expectTypeOf<Awaited<ReturnType<Db['connect']>>>().toMatchTypeOf<AsyncDisposable>();
});

test('connect() rejects bindings other than { url }', () => {
  const db = {} as Db;
  // @ts-expect-error binding is restricted to { url }; pg/binding shapes are not accepted
  void db.connect({ pg: {} as unknown });
  // @ts-expect-error binding is restricted to { url }; binding shape is not accepted
  void db.connect({ binding: { kind: 'url', url: 'x' } });
});

test('factory accepts the same option keys as the Node gaussdb() factory', async () => {
  const { default: gaussdb } = await import('../src/runtime/gaussdb');
  type NodeOptionKeys = keyof Pick<
    GaussDbOptionsWithContract<TestContract>,
    'contract' | 'extensions' | 'middleware' | 'verifyMarker'
  >;
  type ServerlessOptionKeys = Parameters<typeof gaussdbServerless<TestContract>>[0] extends infer O
    ? Extract<keyof O, 'contract' | 'extensions' | 'middleware' | 'verifyMarker'>
    : never;
  expectTypeOf<ServerlessOptionKeys>().toEqualTypeOf<NodeOptionKeys>();

  type NodeJsonKeys = keyof Pick<
    GaussDbOptionsWithContractJson<TestContract>,
    'contractJson' | 'extensions' | 'middleware' | 'verifyMarker'
  >;
  type ServerlessJsonKeys = Parameters<typeof gaussdbServerless<TestContract>>[0] extends infer O
    ? Extract<keyof O, 'contractJson' | 'extensions' | 'middleware' | 'verifyMarker'>
    : never;
  expectTypeOf<ServerlessJsonKeys>().toEqualTypeOf<NodeJsonKeys>();

  // gaussdb() also accepts these but the unrelated `gaussdb()` ensures the symbol is referenced
  void gaussdb;
});
