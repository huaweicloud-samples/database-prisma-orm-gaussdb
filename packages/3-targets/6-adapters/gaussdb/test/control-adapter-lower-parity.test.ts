import {
  type AnyQueryAst,
  BinaryExpr,
  ColumnRef,
  DefaultValueExpr,
  DeleteAst,
  InsertAst,
  InsertOnConflict,
  LiteralExpr,
  ParamRef,
  ProjectionItem,
  SelectAst,
  TableSource,
  UpdateAst,
} from '@internal/sql-relational-core/ast';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { TestSqlContractSerializer as SqlContractSerializer } from '../../../../2-sql/9-family/test/test-sql-contract-serializer';
import type { GaussDbContract } from '../src/core/types';
import {
  createComposedGaussDbAdapter,
  createComposedGaussDbControlAdapter,
} from './helpers/composed-adapter';

const contract = new SqlContractSerializer().deserializeContract({
  target: 'gaussdb',
  targetFamily: 'sql',
  profileHash: 'test-profile',
  roots: {},
  capabilities: {},
  extensions: {},
  meta: {},
  storage: {
    storageHash: 'test-core',
    namespaces: {
      __unbound__: {
        id: '__unbound__',
        entries: {
          table: {
            user: {
              columns: {
                id: { codecId: 'gaussdb/int4@1', nativeType: 'int4', nullable: false },
                email: { codecId: 'gaussdb/text@1', nativeType: 'text', nullable: false },
                profile: { codecId: 'gaussdb/jsonb@1', nativeType: 'jsonb', nullable: true },
                settings: { codecId: 'gaussdb/json@1', nativeType: 'json', nullable: true },
              },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
      },
    },
  },
  domain: applicationDomainOf({ models: {} }),
}) as GaussDbContract;

const runtimeAdapter = createComposedGaussDbAdapter({ extensions: [] });
const controlAdapter = createComposedGaussDbControlAdapter({ extensions: [] });

function expectParity(ast: AnyQueryAst): void {
  const runtime = runtimeAdapter.lower(ast, { contract });
  const control = controlAdapter.lower(ast, { contract });
  expect(control).toEqual(runtime);
}

describe('GaussDbControlAdapter.lower / GaussDbAdapterImpl.lower parity', () => {
  it('matches on simple SELECT with literal WHERE', () => {
    const ast = SelectAst.from(TableSource.named('user'))
      .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
      .withWhere(BinaryExpr.eq(ColumnRef.of('user', 'email'), LiteralExpr.of('a@example.com')));
    expectParity(ast);
  });

  it('matches on INSERT with an upsert clause and RETURNING', () => {
    const ast = InsertAst.into(TableSource.named('user'))
      .withRows([
        {
          id: ParamRef.of(1, { name: 'id', codec: { codecId: 'gaussdb/int4@1' } }),
          email: ParamRef.of('a@example.com', {
            name: 'email',
            codec: { codecId: 'gaussdb/text@1' },
          }),
          profile: ParamRef.of(
            { active: true },
            {
              name: 'profile',
              codec: { codecId: 'gaussdb/jsonb@1' },
            },
          ),
        },
        {
          id: ParamRef.of(2, { name: 'id2', codec: { codecId: 'gaussdb/int4@1' } }),
          email: new DefaultValueExpr(),
        },
      ])
      .withOnConflict(
        InsertOnConflict.on([ColumnRef.of('user', 'email')]).doUpdateSet({
          profile: ColumnRef.of('excluded', 'profile'),
        }),
      )
      .withReturning([ProjectionItem.of('id', ColumnRef.of('user', 'id'))]);
    expectParity(ast);
  });

  it('matches on UPDATE with parameterized WHERE', () => {
    const ast = UpdateAst.table(TableSource.named('user'))
      .withSet({
        email: ParamRef.of('b@example.com', {
          name: 'email',
          codec: { codecId: 'gaussdb/text@1' },
        }),
      })
      .withWhere(
        BinaryExpr.eq(
          ColumnRef.of('user', 'id'),
          ParamRef.of(1, { name: 'id', codec: { codecId: 'gaussdb/int4@1' } }),
        ),
      )
      .withReturning([ProjectionItem.of('email', ColumnRef.of('user', 'email'))]);
    expectParity(ast);
  });

  it('matches on DELETE with RETURNING', () => {
    const ast = DeleteAst.from(TableSource.named('user'))
      .withWhere(
        BinaryExpr.eq(
          ColumnRef.of('user', 'id'),
          ParamRef.of(1, { name: 'id', codec: { codecId: 'gaussdb/int4@1' } }),
        ),
      )
      .withReturning([ProjectionItem.of('id', ColumnRef.of('user', 'id'))]);
    expectParity(ast);
  });

  it('matches on JSON and JSONB ParamRef casts', () => {
    const jsonbAst = SelectAst.from(TableSource.named('user'))
      .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
      .withWhere(
        BinaryExpr.eq(
          ColumnRef.of('user', 'profile'),
          ParamRef.of({ active: true }, { name: 'profile', codec: { codecId: 'gaussdb/jsonb@1' } }),
        ),
      );
    const jsonAst = SelectAst.from(TableSource.named('user'))
      .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
      .withWhere(
        BinaryExpr.eq(
          ColumnRef.of('user', 'settings'),
          ParamRef.of(
            { darkMode: true },
            { name: 'settings', codec: { codecId: 'gaussdb/json@1' } },
          ),
        ),
      );
    expectParity(jsonbAst);
    expectParity(jsonAst);

    expect(runtimeAdapter.lower(jsonbAst, { contract }).sql).toContain('::jsonb');
    expect(runtimeAdapter.lower(jsonAst, { contract }).sql).toContain('::json');
  });
});
