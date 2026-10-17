import type { StorageHashBase } from '@internal/contract/types';
import { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import {
  ColumnRef,
  InsertAst,
  InsertOnConflict,
  ParamRef,
  TableSource,
} from '@internal/sql-relational-core/ast';
import { GaussDbSchema } from '@internal/target-gaussdb/types';
import { isStructuredError } from '@internal/utils/structured-error';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { createGaussDbAdapter } from '../src/core/adapter';
import type { GaussDbContract } from '../src/core/types';

// Inlined SqlStorage + GaussDbSchema instead of the blueprint's serializer
// deserialize: this shape is closer to what the production serializer emits,
// and the do-nothing cases read contract table metadata for key-column
// exclusion.
const contract = {
  target: 'gaussdb',
  targetFamily: 'sql',
  profileHash: 'test-profile',
  roots: {},
  capabilities: {},
  extensions: {},
  meta: {},
  storage: new SqlStorage({
    storageHash: 'test-core' as StorageHashBase<'test-core'>,
    namespaces: {
      __unbound__: new GaussDbSchema({
        id: '__unbound__',
        entries: {
          table: {
            user: new StorageTable({
              columns: {
                id: { codecId: 'gaussdb/int4@1', nativeType: 'int4', nullable: false },
                email: { codecId: 'gaussdb/text@1', nativeType: 'text', nullable: false },
                name: { codecId: 'gaussdb/text@1', nativeType: 'text', nullable: true },
              },
              primaryKey: { columns: ['id'] },
              uniques: [{ columns: ['email'] }],
              indexes: [],
              foreignKeys: [],
            }),
            credential: new StorageTable({
              columns: {
                id: { codecId: 'gaussdb/int4@1', nativeType: 'int4', nullable: false },
                email: { codecId: 'gaussdb/text@1', nativeType: 'text', nullable: false },
              },
              primaryKey: { columns: ['id'] },
              uniques: [{ columns: ['email'] }],
              indexes: [],
              foreignKeys: [],
            }),
          },
        },
      }),
    },
  }),
  domain: applicationDomainOf({ models: {} }),
} as GaussDbContract;

describe('GaussDB upsert rendering', () => {
  const adapter = createGaussDbAdapter();

  it('renders do-update-set with an excluded reference as ON DUPLICATE KEY UPDATE', () => {
    const ast = InsertAst.into(TableSource.named('user'))
      .withRows([
        {
          id: ParamRef.of(1, { name: 'id', codec: { codecId: 'gaussdb/int4@1' } }),
          email: ParamRef.of('a@example.com', {
            name: 'email',
            codec: { codecId: 'gaussdb/text@1' },
          }),
          name: ParamRef.of('Ada', { name: 'name', codec: { codecId: 'gaussdb/text@1' } }),
        },
      ])
      .withOnConflict(
        InsertOnConflict.on([ColumnRef.of('user', 'email')]).doUpdateSet({
          name: ColumnRef.of('excluded', 'name'),
        }),
      );

    const sql = adapter.lower(ast, { contract, params: [] }).sql;

    expect(sql).toContain(' ON DUPLICATE KEY UPDATE "name" = excluded."name"');
    expect(sql).not.toContain('ON CONFLICT');
  });

  it('renders do-update-set parameterized values as positional parameters', () => {
    const ast = InsertAst.into(TableSource.named('user'))
      .withRows([
        {
          id: ParamRef.of(1, { name: 'id', codec: { codecId: 'gaussdb/int4@1' } }),
          email: ParamRef.of('a@example.com', {
            name: 'email',
            codec: { codecId: 'gaussdb/text@1' },
          }),
          name: ParamRef.of('Ada', { name: 'name', codec: { codecId: 'gaussdb/text@1' } }),
        },
      ])
      .withOnConflict(
        InsertOnConflict.on([ColumnRef.of('user', 'email')]).doUpdateSet({
          name: ParamRef.of('Grace', { name: 'replacement', codec: { codecId: 'gaussdb/text@1' } }),
        }),
      );

    const sql = adapter.lower(ast, { contract, params: [] }).sql;

    expect(sql).toMatch(/ ON DUPLICATE KEY UPDATE "name" = \$\d+/);
  });

  it('renders do-nothing from a non-insert table column when every insert column is a conflict target', () => {
    const ast = InsertAst.into(TableSource.named('user'))
      .withRows([
        {
          id: ParamRef.of(1, { name: 'id', codec: { codecId: 'gaussdb/int4@1' } }),
        },
      ])
      .withOnConflict(InsertOnConflict.on([ColumnRef.of('user', 'id')]).doNothing());

    const sql = adapter.lower(ast, { contract, params: [] }).sql;

    expect(sql).toBe(
      'INSERT INTO "user" ("id") VALUES ($1) ON DUPLICATE KEY UPDATE "name" = "name"',
    );
  });

  it('renders do-nothing as a self-assignment on a non-conflict insert column', () => {
    const ast = InsertAst.into(TableSource.named('user'))
      .withRows([
        {
          id: ParamRef.of(1, { name: 'id', codec: { codecId: 'gaussdb/int4@1' } }),
          name: ParamRef.of('Ada', { name: 'name', codec: { codecId: 'gaussdb/text@1' } }),
        },
      ])
      .withOnConflict(InsertOnConflict.on([ColumnRef.of('user', 'id')]).doNothing());

    const sql = adapter.lower(ast, { contract, params: [] }).sql;

    expect(sql).toContain(' ON DUPLICATE KEY UPDATE "name" = "name"');
    expect(sql).not.toContain('ON CONFLICT');
  });

  it('renders do-nothing with a non-key self-assignment when the conflict target is a non-PK unique key', () => {
    const ast = InsertAst.into(TableSource.named('user'))
      .withRows([
        {
          id: ParamRef.of(1, { name: 'id', codec: { codecId: 'gaussdb/int4@1' } }),
          name: ParamRef.of('Ada', { name: 'name', codec: { codecId: 'gaussdb/text@1' } }),
          email: ParamRef.of('a@example.com', {
            name: 'email',
            codec: { codecId: 'gaussdb/text@1' },
          }),
        },
      ])
      .withOnConflict(InsertOnConflict.on([ColumnRef.of('user', 'email')]).doNothing());

    const sql = adapter.lower(ast, { contract, params: [] }).sql;

    expect(sql).toContain(' ON DUPLICATE KEY UPDATE "name" = "name"');
    expect(sql).not.toContain('ON CONFLICT');
  });

  it('raises RUNTIME.AST_INVALID for do-nothing when every column of the table is a key column', () => {
    const ast = InsertAst.into(TableSource.named('credential'))
      .withRows([
        {
          id: ParamRef.of(1, { name: 'id', codec: { codecId: 'gaussdb/int4@1' } }),
          email: ParamRef.of('a@example.com', {
            name: 'email',
            codec: { codecId: 'gaussdb/text@1' },
          }),
        },
      ])
      .withOnConflict(InsertOnConflict.on([ColumnRef.of('credential', 'email')]).doNothing());

    let thrown: unknown;
    try {
      adapter.lower(ast, { contract, params: [] });
    } catch (e) {
      thrown = e;
    }
    expect(isStructuredError(thrown)).toBe(true);
    expect(thrown).toMatchObject({
      code: 'RUNTIME.AST_INVALID',
      message: expect.stringContaining(
        'GaussDB cannot render DO NOTHING upsert: every column of this table is a key column. ' +
          'Use doUpdateSet instead.',
      ),
    });
  });

  it('raises RUNTIME.AST_INVALID when do-update-set assigns a conflict-target column', () => {
    const ast = InsertAst.into(TableSource.named('user'))
      .withRows([
        {
          id: ParamRef.of(1, { name: 'id', codec: { codecId: 'gaussdb/int4@1' } }),
          email: ParamRef.of('a@example.com', {
            name: 'email',
            codec: { codecId: 'gaussdb/text@1' },
          }),
        },
      ])
      .withOnConflict(
        InsertOnConflict.on([ColumnRef.of('user', 'email')]).doUpdateSet({
          email: ColumnRef.of('excluded', 'email'),
        }),
      );

    let thrown: unknown;
    try {
      adapter.lower(ast, { contract, params: [] });
    } catch (e) {
      thrown = e;
    }
    expect(isStructuredError(thrown)).toBe(true);
    expect(thrown).toMatchObject({
      code: 'RUNTIME.AST_INVALID',
      message: expect.stringContaining(
        'GaussDB rejects ON DUPLICATE KEY UPDATE assignments to conflict-target columns (got "email"). ' +
          'Remove the assignment to the conflict-target column or assign a different column.',
      ),
    });
  });
});
