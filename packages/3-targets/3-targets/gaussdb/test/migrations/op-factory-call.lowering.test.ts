import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { col, lit } from '@internal/sql-relational-core/contract-free';
import { parseNaming } from '@internal/sql-schema-ir/naming';
import { describe, expect, it } from 'vitest';
import {
  columnExistsAst,
  indexExistsAst,
  nativeEnumTypeExistsAst,
  nativeEnumValueExistsAst,
  schemaExistsAst,
  tableExistsAst,
} from '../../src/contract-free/checks';
import { createSchema, createType, dropType } from '../../src/contract-free/ddl';
import {
  GaussDbAlterIndexRename,
  GaussDbCreateIndex,
  GaussDbDropIndex,
} from '../../src/core/ddl/nodes';
import { GaussDbRlsPolicy } from '../../src/core/gaussdb-rls-policy';
import {
  AddColumnCall,
  AddNativeEnumValueCall,
  AlterColumnTypeCall,
  CreateExtensionCall,
  CreateGaussDbRlsPolicyCall,
  CreateIndexCall,
  CreateNativeEnumTypeCall,
  CreateSchemaCall,
  DataTransformCall,
  DisableRowLevelSecurityCall,
  DropColumnCall,
  DropDefaultCall,
  DropGaussDbRlsPolicyCall,
  DropIndexCall,
  DropNativeEnumTypeCall,
  DropNotNullCall,
  DropTableCall,
  EnableRowLevelSecurityCall,
  RawSqlCall,
  RenameGaussDbRlsPolicyCall,
  RenameIndexCall,
  SetDefaultCall,
  SetNotNullCall,
} from '../../src/core/migrations/op-factory-call';

function recordingCheckLowerer(): { lowerer: ExecuteRequestLowerer; received: unknown[] } {
  const received: unknown[] = [];
  const lowerer: ExecuteRequestLowerer = {
    lower: () => Object.freeze({ sql: 'UNUSED', params: Object.freeze([]) }),
    lowerToExecuteRequest: async (ast) => {
      received.push(ast);
      return Object.freeze({
        sql: `LOWERED ${received.length}`,
        params: Object.freeze([`p${received.length}`]),
      });
    },
  };
  return { lowerer, received };
}

describe('DropTableCall', () => {
  it('lowers typed table-existence checks and drops via qualified DDL', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const call = new DropTableCall('public', 'user');
    const op = await call.toOp(lowerer);

    const checks = tableExistsAst('public', 'user');
    expect(received).toEqual([checks.tablePresent(), checks.tableAbsent()]);
    expect(op.id).toBe('dropTable.user');
    expect(op.operationClass).toBe('destructive');
    expect(op.target).toEqual({
      id: 'gaussdb',
      details: { schema: 'public', objectType: 'table', name: 'user' },
    });
    expect(op.precheck).toEqual([
      { description: 'ensure table "user" exists', sql: 'LOWERED 1', params: ['p1'] },
    ]);
    expect(op.execute).toEqual([
      { description: 'drop table "user"', sql: 'DROP TABLE "public"."user"' },
    ]);
    expect(op.postcheck).toEqual([
      { description: 'verify table "user" does not exist', sql: 'LOWERED 2', params: ['p2'] },
    ]);
    expect(call.label).toBe('Drop table "user"');
  });

  it('toOp() throws when no lowerer is provided', async () => {
    const call = new DropTableCall('public', 'user');
    await expect(async () => call.toOp()).rejects.toThrow('createGaussDbMigrationPlanner');
  });

  it('renders this.dropTable, omitting schema for the unbound namespace', () => {
    expect(new DropTableCall('public', 'user').renderTypeScript()).toBe(
      'this.dropTable({ schema: "public", table: "user" })',
    );
    expect(new DropTableCall('__unbound__', 'user').renderTypeScript()).toBe(
      'this.dropTable({ table: "user" })',
    );
    expect(new DropTableCall('public', 'user').importRequirements()).toEqual([]);
  });
});

describe('AddColumnCall', () => {
  it('lowers a typed AlterTable DDL node and typed column-existence checks', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const call = new AddColumnCall('public', 'user', col('bio', 'text'));
    const op = await call.toOp(lowerer);

    const colChecks = columnExistsAst({ schema: 'public', table: 'user', column: 'bio' });
    expect(received[1]).toEqual(colChecks.columnAbsent());
    expect(received[2]).toEqual(colChecks.columnPresent());
    expect(op.id).toBe('column.public.user.bio');
    expect(op.target).toEqual({
      id: 'gaussdb',
      details: { schema: 'public', objectType: 'column', name: 'bio', table: 'user' },
    });
    expect(op.precheck).toEqual([
      { description: 'ensure column "bio" is missing', sql: 'LOWERED 2', params: ['p2'] },
    ]);
    expect(op.execute).toEqual([{ description: 'add column "bio"', sql: 'LOWERED 1' }]);
    expect(op.postcheck).toEqual([
      { description: 'verify column "bio" exists', sql: 'LOWERED 3', params: ['p3'] },
    ]);
    expect(call.label).toBe('Add column "bio" to "user"');
  });

  it('toOp() throws when no lowerer is provided', async () => {
    const call = new AddColumnCall('public', 'user', col('bio', 'text'));
    await expect(async () => call.toOp()).rejects.toThrow('createGaussDbMigrationPlanner');
  });

  it('renders this.addColumn with column options and imports col plus the default helper', () => {
    const call = new AddColumnCall(
      'public',
      'user',
      col('bio', 'text', { notNull: true, default: lit('active') }),
    );
    expect(call.renderTypeScript()).toBe(
      'this.addColumn({ schema: "public", table: "user", column: col("bio", "text", { notNull: true, default: lit("active") }) })',
    );
    expect(call.importRequirements()).toEqual([
      { moduleSpecifier: '@internal/postgres/migration', symbol: 'col' },
      { moduleSpecifier: '@internal/postgres/migration', symbol: 'lit' },
    ]);
  });
});

describe('DropColumnCall', () => {
  it('lowers typed column-existence checks and drops via qualified DDL', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const call = new DropColumnCall('public', 'user', 'bio');
    const op = await call.toOp(lowerer);

    const colChecks = columnExistsAst({ schema: 'public', table: 'user', column: 'bio' });
    expect(received).toEqual([colChecks.columnPresent(), colChecks.columnAbsent()]);
    expect(op.execute).toEqual([
      { description: 'drop column "bio"', sql: 'ALTER TABLE "public"."user" DROP COLUMN "bio"' },
    ]);
    expect(op.precheck[0]).toMatchObject({ sql: 'LOWERED 1', params: ['p1'] });
    expect(op.postcheck[0]).toMatchObject({ sql: 'LOWERED 2', params: ['p2'] });
    expect(call.label).toBe('Drop column "bio" from "user"');
  });

  it('toOp() throws when no lowerer is provided', async () => {
    const call = new DropColumnCall('public', 'user', 'bio');
    await expect(async () => call.toOp()).rejects.toThrow('createGaussDbMigrationPlanner');
  });

  it('renders this.dropColumn with no facade import', () => {
    const call = new DropColumnCall('public', 'user', 'bio');
    expect(call.renderTypeScript()).toBe(
      'this.dropColumn({ schema: "public", table: "user", column: "bio" })',
    );
    expect(call.importRequirements()).toEqual([]);
  });
});

describe('AlterColumnTypeCall', () => {
  const options = {
    qualifiedTargetType: 'bigint',
    formatTypeExpected: 'bigint',
    rawTargetTypeForLabel: 'bigint',
  };

  it('lowers typed checks and alters the column type with an implicit cast USING clause', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const call = new AlterColumnTypeCall('public', 'user', 'age', options);
    const op = await call.toOp(lowerer);

    expect(received).toHaveLength(3);
    expect(op.execute).toEqual([
      {
        description: 'alter type of "age"',
        sql: 'ALTER TABLE "public"."user" ALTER COLUMN "age" TYPE bigint USING "age"::bigint',
      },
    ]);
    expect(op.precheck).toEqual([
      { description: 'ensure column "age" exists', sql: 'LOWERED 1', params: ['p1'] },
    ]);
    expect(op.postcheck).toEqual([
      {
        description: 'verify column "age" has type "bigint"',
        sql: 'LOWERED 3',
        params: ['p3'],
      },
    ]);
    expect(op.meta).toEqual({ warning: 'TABLE_REWRITE' });
    expect(call.label).toBe('Alter type of "user"."age" to bigint');
  });

  it('uses an explicit USING clause when provided', async () => {
    const { lowerer } = recordingCheckLowerer();
    const call = new AlterColumnTypeCall('public', 'user', 'age', {
      ...options,
      using: 'age::bigint * 2',
    });
    const op = await call.toOp(lowerer);
    expect(op.execute[0]?.sql).toBe(
      'ALTER TABLE "public"."user" ALTER COLUMN "age" TYPE bigint USING age::bigint * 2',
    );
  });

  it('toOp() throws when no lowerer is provided', async () => {
    const call = new AlterColumnTypeCall('public', 'user', 'age', options);
    await expect(async () => call.toOp()).rejects.toThrow('createGaussDbMigrationPlanner');
  });

  it('renders this.alterColumnType with the schema/table/column and options fields', () => {
    const call = new AlterColumnTypeCall('public', 'user', 'age', options);
    const ts = call.renderTypeScript();
    expect(ts).toContain('this.alterColumnType({ schema: "public", table: "user", column: "age"');
    expect(ts).toContain('qualifiedTargetType: "bigint"');
    expect(ts).toContain('formatTypeExpected: "bigint"');
    expect(ts).toContain('rawTargetTypeForLabel: "bigint"');
    expect(call.importRequirements()).toEqual([]);
  });
});

describe('SetNotNullCall', () => {
  it('lowers typed checks and sets NOT NULL', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const call = new SetNotNullCall('public', 'user', 'email');
    const op = await call.toOp(lowerer);

    expect(received).toHaveLength(4);
    expect(op.execute).toEqual([
      {
        description: 'set NOT NULL on "email"',
        sql: 'ALTER TABLE "public"."user" ALTER COLUMN "email" SET NOT NULL',
      },
    ]);
    expect(op.precheck).toEqual([
      { description: 'ensure column "email" exists', sql: 'LOWERED 1', params: ['p1'] },
      { description: 'ensure no NULL values in "email"', sql: 'LOWERED 3', params: ['p3'] },
    ]);
    expect(op.postcheck).toEqual([
      { description: 'verify column "email" is NOT NULL', sql: 'LOWERED 4', params: ['p4'] },
    ]);
    expect(call.label).toBe('Set NOT NULL on "user"."email"');
  });

  it('toOp() throws when no lowerer is provided', async () => {
    const call = new SetNotNullCall('public', 'user', 'email');
    await expect(async () => call.toOp()).rejects.toThrow('createGaussDbMigrationPlanner');
  });

  it('renders this.setNotNull with no facade import', () => {
    const call = new SetNotNullCall('public', 'user', 'email');
    expect(call.renderTypeScript()).toBe(
      'this.setNotNull({ schema: "public", table: "user", column: "email" })',
    );
    expect(call.importRequirements()).toEqual([]);
  });
});

describe('DropNotNullCall', () => {
  it('lowers typed checks and drops NOT NULL', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const call = new DropNotNullCall('public', 'user', 'email');
    const op = await call.toOp(lowerer);

    expect(received).toHaveLength(3);
    expect(op.operationClass).toBe('widening');
    expect(op.execute).toEqual([
      {
        description: 'drop NOT NULL on "email"',
        sql: 'ALTER TABLE "public"."user" ALTER COLUMN "email" DROP NOT NULL',
      },
    ]);
    expect(op.precheck).toEqual([
      { description: 'ensure column "email" exists', sql: 'LOWERED 1', params: ['p1'] },
    ]);
    expect(op.postcheck).toEqual([
      { description: 'verify column "email" is nullable', sql: 'LOWERED 3', params: ['p3'] },
    ]);
    expect(call.label).toBe('Drop NOT NULL on "user"."email"');
  });

  it('toOp() throws when no lowerer is provided', async () => {
    const call = new DropNotNullCall('public', 'user', 'email');
    await expect(async () => call.toOp()).rejects.toThrow('createGaussDbMigrationPlanner');
  });

  it('renders this.dropNotNull with no facade import', () => {
    const call = new DropNotNullCall('public', 'user', 'email');
    expect(call.renderTypeScript()).toBe(
      'this.dropNotNull({ schema: "public", table: "user", column: "email" })',
    );
    expect(call.importRequirements()).toEqual([]);
  });
});

describe('SetDefaultCall', () => {
  it('lowers typed checks and sets the default clause verbatim', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const call = new SetDefaultCall('public', 'user', 'status', "DEFAULT 'pending'");
    const op = await call.toOp(lowerer);

    expect(received).toHaveLength(3);
    expect(op.operationClass).toBe('additive');
    expect(op.execute).toEqual([
      {
        description: 'set default on "status"',
        sql: `ALTER TABLE "public"."user" ALTER COLUMN "status" SET DEFAULT 'pending'`,
      },
    ]);
    expect(op.precheck).toEqual([
      { description: 'ensure column "status" exists', sql: 'LOWERED 1', params: ['p1'] },
    ]);
    expect(op.postcheck).toEqual([
      { description: 'verify column "status" has a default', sql: 'LOWERED 3', params: ['p3'] },
    ]);
    expect(call.label).toBe('Set default on "user"."status"');
  });

  it('honors an explicit widening operationClass', async () => {
    const { lowerer } = recordingCheckLowerer();
    const call = new SetDefaultCall('public', 'user', 'status', "DEFAULT 'pending'", 'widening');
    const op = await call.toOp(lowerer);
    expect(op.operationClass).toBe('widening');
  });

  it('toOp() throws when no lowerer is provided', async () => {
    const call = new SetDefaultCall('public', 'user', 'status', "DEFAULT 'pending'");
    await expect(async () => call.toOp()).rejects.toThrow('createGaussDbMigrationPlanner');
  });

  it('renders this.setDefault, including operationClass only when non-additive', () => {
    const additive = new SetDefaultCall('public', 'user', 'status', "DEFAULT 'pending'");
    expect(additive.renderTypeScript()).toBe(
      'this.setDefault({ schema: "public", table: "user", column: "status", defaultSql: "DEFAULT \'pending\'" })',
    );
    const widening = new SetDefaultCall(
      'public',
      'user',
      'status',
      "DEFAULT 'pending'",
      'widening',
    );
    expect(widening.renderTypeScript()).toBe(
      'this.setDefault({ schema: "public", table: "user", column: "status", defaultSql: "DEFAULT \'pending\'", operationClass: "widening" })',
    );
    expect(additive.importRequirements()).toEqual([]);
  });
});

describe('DropDefaultCall', () => {
  it('lowers a typed AlterTable DDL node and typed default-presence checks', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const call = new DropDefaultCall('public', 'user', 'status');
    const op = await call.toOp(lowerer);

    expect(received).toHaveLength(4);
    expect(op.execute).toEqual([{ description: 'drop default on "status"', sql: 'LOWERED 3' }]);
    expect(op.precheck).toEqual([
      { description: 'ensure column "status" exists', sql: 'LOWERED 1', params: ['p1'] },
    ]);
    expect(op.postcheck).toEqual([
      { description: 'verify column "status" has no default', sql: 'LOWERED 4', params: ['p4'] },
    ]);
    expect(call.label).toBe('Drop default on "user"."status"');
  });

  it('toOp() throws when no lowerer is provided', async () => {
    const call = new DropDefaultCall('public', 'user', 'status');
    await expect(async () => call.toOp()).rejects.toThrow('createGaussDbMigrationPlanner');
  });

  it('renders this.dropDefault with no facade import', () => {
    const call = new DropDefaultCall('public', 'user', 'status');
    expect(call.renderTypeScript()).toBe(
      'this.dropDefault({ schema: "public", table: "user", column: "status" })',
    );
    expect(call.importRequirements()).toEqual([]);
  });
});

describe('AddNativeEnumValueCall', () => {
  it('lowers typed enum checks and appends the value via ALTER TYPE', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const call = new AddNativeEnumValueCall('public', 'status', 'archived');
    const op = await call.toOp(lowerer);

    const typeChecks = nativeEnumTypeExistsAst('public', 'status');
    const valueChecks = nativeEnumValueExistsAst({
      schema: 'public',
      typeName: 'status',
      value: 'archived',
    });
    expect(received).toEqual([
      typeChecks.typePresent(),
      valueChecks.valueAbsent(),
      valueChecks.valuePresent(),
    ]);
    expect(op.execute).toEqual([
      {
        description: 'add value "archived" to enum type "status"',
        sql: `ALTER TYPE "public"."status" ADD VALUE 'archived'`,
      },
    ]);
    expect(op.precheck).toEqual([
      { description: 'ensure enum type "status" exists', sql: 'LOWERED 1', params: ['p1'] },
      {
        description: 'ensure value "archived" is absent from enum type "status"',
        sql: 'LOWERED 2',
        params: ['p2'],
      },
    ]);
    expect(op.postcheck).toEqual([
      {
        description: 'verify value "archived" exists on enum type "status"',
        sql: 'LOWERED 3',
        params: ['p3'],
      },
    ]);
    expect(call.label).toBe('Add value "archived" to enum type "status"');
    expect(call.summary).toContain('A newly added enum value cannot be used until the transaction');
  });

  it('toOp() throws when no lowerer is provided', async () => {
    const call = new AddNativeEnumValueCall('public', 'status', 'archived');
    await expect(async () => call.toOp()).rejects.toThrow('createGaussDbMigrationPlanner');
  });

  it('renders this.addNativeEnumValue with no facade import', () => {
    const call = new AddNativeEnumValueCall('public', 'status', 'archived');
    expect(call.renderTypeScript()).toBe(
      'this.addNativeEnumValue({ schema: "public", typeName: "status", value: "archived" })',
    );
    expect(call.importRequirements()).toEqual([]);
  });
});

describe('CreateNativeEnumTypeCall', () => {
  it('lowers a typed CREATE TYPE node guarded by pg_type existence checks', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const call = new CreateNativeEnumTypeCall('public', 'status', ['active', 'inactive']);
    const op = await call.toOp(lowerer);

    const checks = nativeEnumTypeExistsAst('public', 'status');
    expect(received).toEqual([
      createType({ schema: 'public', name: 'status', values: ['active', 'inactive'] }),
      checks.typeAbsent(),
      checks.typePresent(),
    ]);
    expect(op.precheck).toEqual([
      { description: 'ensure enum type "status" does not exist', sql: 'LOWERED 2', params: ['p2'] },
    ]);
    expect(op.postcheck).toEqual([
      { description: 'verify enum type "status" exists', sql: 'LOWERED 3', params: ['p3'] },
    ]);
    expect(op.execute).toEqual([
      { description: 'create enum type "status"', sql: 'LOWERED 1', params: ['p1'] },
    ]);
    expect(call.label).toBe('Create enum type "status"');
  });

  it('toOp() throws when no lowerer is provided', async () => {
    const call = new CreateNativeEnumTypeCall('public', 'status', ['active', 'inactive']);
    await expect(async () => call.toOp()).rejects.toThrow('createGaussDbMigrationPlanner');
  });

  it('renders this.createNativeEnumType with no facade import', () => {
    const call = new CreateNativeEnumTypeCall('public', 'status', ['active', 'inactive']);
    expect(call.renderTypeScript()).toBe(
      'this.createNativeEnumType({ schema: "public", typeName: "status", members: ["active", "inactive"] })',
    );
    expect(call.importRequirements()).toEqual([]);
  });
});

describe('DropNativeEnumTypeCall', () => {
  it('lowers a typed DROP TYPE node guarded by pg_type existence checks', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const call = new DropNativeEnumTypeCall('public', 'status');
    const op = await call.toOp(lowerer);

    const checks = nativeEnumTypeExistsAst('public', 'status');
    expect(received).toEqual([
      dropType({ schema: 'public', name: 'status' }),
      checks.typePresent(),
      checks.typeAbsent(),
    ]);
    expect(op.precheck).toEqual([
      { description: 'ensure enum type "status" exists', sql: 'LOWERED 2', params: ['p2'] },
    ]);
    expect(op.postcheck).toEqual([
      { description: 'verify enum type "status" does not exist', sql: 'LOWERED 3', params: ['p3'] },
    ]);
    expect(op.execute).toEqual([
      { description: 'drop enum type "status"', sql: 'LOWERED 1', params: ['p1'] },
    ]);
    expect(call.label).toBe('Drop enum type "status"');
  });

  it('toOp() throws when no lowerer is provided', async () => {
    const call = new DropNativeEnumTypeCall('public', 'status');
    await expect(async () => call.toOp()).rejects.toThrow('createGaussDbMigrationPlanner');
  });

  it('renders this.dropNativeEnumType with no facade import', () => {
    const call = new DropNativeEnumTypeCall('public', 'status');
    expect(call.renderTypeScript()).toBe(
      'this.dropNativeEnumType({ schema: "public", typeName: "status" })',
    );
    expect(call.importRequirements()).toEqual([]);
  });
});

describe('CreateSchemaCall', () => {
  it('lowers a bare CREATE SCHEMA node guarded by pg_namespace existence checks', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const call = new CreateSchemaCall('tenant');
    const op = await call.toOp(lowerer);

    const schemaChecks = schemaExistsAst('tenant');
    expect(received).toEqual([
      createSchema({ schema: 'tenant' }),
      schemaChecks.schemaAbsent(),
      schemaChecks.schemaPresent(),
    ]);
    expect(op.id).toBe('schema.tenant');
    expect(op.target).toEqual({ id: 'gaussdb' });
    expect(op.precheck).toEqual([
      { description: 'ensure schema "tenant" does not exist', sql: 'LOWERED 2', params: ['p2'] },
    ]);
    expect(op.postcheck).toEqual([
      { description: 'verify schema "tenant" exists', sql: 'LOWERED 3', params: ['p3'] },
    ]);
    expect(op.execute).toEqual([
      { description: 'Create schema "tenant"', sql: 'LOWERED 1', params: ['p1'] },
    ]);
    expect(call.label).toBe('Create schema "tenant"');
  });

  it('toOp() throws when no lowerer is provided', async () => {
    const call = new CreateSchemaCall('tenant');
    await expect(async () => call.toOp()).rejects.toThrow('createGaussDbMigrationPlanner');
  });

  it('renders this.createSchema with no facade import', () => {
    const call = new CreateSchemaCall('tenant');
    expect(call.renderTypeScript()).toBe('this.createSchema({ schema: "tenant" })');
    expect(call.importRequirements()).toEqual([]);
  });
});

describe('CreateIndexCall', () => {
  it('lowers typed index-existence checks and builds a plain CREATE INDEX', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const call = new CreateIndexCall('public', 'user', 'idx_user_email', { columns: ['email'] });
    const op = await call.toOp(lowerer);

    const checks = indexExistsAst('public', 'idx_user_email');
    const ddlNode = received[0] as GaussDbCreateIndex;
    expect(ddlNode).toBeInstanceOf(GaussDbCreateIndex);
    expect(ddlNode.schema).toBe('public');
    expect(ddlNode.table).toBe('user');
    expect(ddlNode.name).toBe('idx_user_email');
    expect(ddlNode.unique).toBe(false);
    expect(ddlNode.elements).toEqual({ columns: ['email'] });
    expect(received.slice(1)).toEqual([checks.indexPresent(), checks.indexAbsent()]);
    expect(op.execute).toEqual([
      {
        description: 'create index "idx_user_email"',
        sql: 'LOWERED 1',
        params: ['p1'],
      },
    ]);
    expect(op.precheck).toEqual([
      {
        description: 'ensure index "idx_user_email" does not exist',
        sql: 'LOWERED 3',
        params: ['p3'],
      },
    ]);
    expect(op.postcheck).toEqual([
      { description: 'verify index "idx_user_email" exists', sql: 'LOWERED 2', params: ['p2'] },
    ]);
    expect(call.label).toBe('Create index "idx_user_email" on "user"');
  });

  it('renders and executes a USING/WITH clause when type and options are given', async () => {
    const call = new CreateIndexCall(
      'public',
      'user',
      'idx_user_email',
      { columns: ['email'] },
      {
        type: 'btree',
        options: { fillfactor: 90 },
      },
    );
    const { lowerer: recording, received } = recordingCheckLowerer();
    const op = await call.toOp(recording);
    const ddlNode = received[0] as GaussDbCreateIndex;
    expect(ddlNode).toBeInstanceOf(GaussDbCreateIndex);
    expect(ddlNode.type).toBe('btree');
    expect(ddlNode.options).toEqual({ fillfactor: 90 });
    expect(op.execute[0]?.sql).toBe('LOWERED 1');
    expect(call.renderTypeScript()).toBe(
      'this.createIndex({ schema: "public", table: "user", index: "idx_user_email", columns: ["email"], extras: { type: "btree", options: { fillfactor: 90 } } })',
    );
  });

  it('toOp() throws when no lowerer is provided', async () => {
    const call = new CreateIndexCall('public', 'user', 'idx_user_email', { columns: ['email'] });
    await expect(async () => call.toOp()).rejects.toThrow('createGaussDbMigrationPlanner');
  });

  it('renders this.createIndex with no facade import', () => {
    const call = new CreateIndexCall('public', 'user', 'idx_user_email', { columns: ['email'] });
    expect(call.renderTypeScript()).toBe(
      'this.createIndex({ schema: "public", table: "user", index: "idx_user_email", columns: ["email"] })',
    );
    expect(call.importRequirements()).toEqual([]);
  });

  it('renders and executes an expression element with unique and where extras', async () => {
    const call = new CreateIndexCall(
      'public',
      'user',
      'user_email_eq',
      { expression: 'lower(email)' },
      { unique: true, where: 'deleted_at IS NULL' },
    );
    const { lowerer: recording, received } = recordingCheckLowerer();
    const op = await call.toOp(recording);
    const ddlNode = received[0] as GaussDbCreateIndex;
    expect(ddlNode).toBeInstanceOf(GaussDbCreateIndex);
    expect(ddlNode.unique).toBe(true);
    expect(ddlNode.where).toBe('deleted_at IS NULL');
    expect(ddlNode.elements).toEqual({ expression: 'lower(email)' });
    expect(op.execute[0]?.sql).toBe('LOWERED 1');
    expect(call.renderTypeScript()).toBe(
      'this.createIndex({ schema: "public", table: "user", index: "user_email_eq", expression: "lower(email)", extras: { where: "deleted_at IS NULL", unique: true } })',
    );
  });
});

describe('RenameIndexCall', () => {
  it('renders ALTER INDEX RENAME with from-present/to-absent prechecks and to-present postcheck', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const call = new RenameIndexCall('public', 'user', 'old_email_idx', 'user_email_idx_46df9cad');
    const op = await call.toOp(lowerer);

    const fromChecks = indexExistsAst('public', 'old_email_idx');
    const toChecks = indexExistsAst('public', 'user_email_idx_46df9cad');
    expect(received[0]).toEqual(fromChecks.indexPresent());
    expect(received[1]).toEqual(toChecks.indexAbsent());
    expect(received[2]).toEqual(toChecks.indexPresent());
    const ddlNode = received[3] as GaussDbAlterIndexRename;
    expect(ddlNode).toBeInstanceOf(GaussDbAlterIndexRename);
    expect(ddlNode.schema).toBe('public');
    expect(ddlNode.from).toBe('old_email_idx');
    expect(ddlNode.to).toBe('user_email_idx_46df9cad');
    expect(op.operationClass).toBe('widening');
    expect(op.execute).toEqual([
      {
        description: 'rename index "old_email_idx" to "user_email_idx_46df9cad"',
        sql: 'LOWERED 4',
        params: ['p4'],
      },
    ]);
    expect(op.precheck).toEqual([
      {
        description: 'ensure index "old_email_idx" exists',
        sql: 'LOWERED 1',
        params: ['p1'],
      },
      {
        description: 'ensure index "user_email_idx_46df9cad" does not exist',
        sql: 'LOWERED 2',
        params: ['p2'],
      },
    ]);
    expect(op.postcheck).toEqual([
      {
        description: 'verify index "user_email_idx_46df9cad" exists',
        sql: 'LOWERED 3',
        params: ['p3'],
      },
    ]);
    expect(call.label).toBe('Rename index "old_email_idx" to "user_email_idx_46df9cad" on "user"');
  });

  it('toOp() throws when no lowerer is provided', async () => {
    const call = new RenameIndexCall('public', 'user', 'old_email_idx', 'user_email_idx_46df9cad');
    await expect(async () => call.toOp()).rejects.toThrow('createGaussDbMigrationPlanner');
  });

  it('renders this.renameIndex(...) with no facade import', () => {
    const call = new RenameIndexCall('public', 'user', 'old_email_idx', 'user_email_idx_46df9cad');
    expect(call.renderTypeScript()).toBe(
      'this.renameIndex({ schema: "public", table: "user", from: "old_email_idx", to: "user_email_idx_46df9cad" })',
    );
    expect(call.importRequirements()).toEqual([]);
  });

  it('omits schema from the rendered TS for the unbound namespace, like every sibling', () => {
    const call = new RenameIndexCall(
      UNBOUND_NAMESPACE_ID,
      'user',
      'old_email_idx',
      'user_email_idx_46df9cad',
    );
    expect(call.renderTypeScript()).toBe(
      'this.renameIndex({ table: "user", from: "old_email_idx", to: "user_email_idx_46df9cad" })',
    );
  });
});

describe('DropIndexCall', () => {
  it('lowers typed index-existence checks and drops via qualified DDL', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const call = new DropIndexCall('public', 'user', 'idx_user_email');
    const op = await call.toOp(lowerer);

    const checks = indexExistsAst('public', 'idx_user_email');
    const ddlNode = received[0] as GaussDbDropIndex;
    expect(ddlNode).toBeInstanceOf(GaussDbDropIndex);
    expect(ddlNode.schema).toBe('public');
    expect(ddlNode.name).toBe('idx_user_email');
    expect(received.slice(1)).toEqual([checks.indexPresent(), checks.indexAbsent()]);
    expect(op.execute).toEqual([
      { description: 'drop index "idx_user_email"', sql: 'LOWERED 1', params: ['p1'] },
    ]);
    expect(op.precheck).toEqual([
      { description: 'ensure index "idx_user_email" exists', sql: 'LOWERED 2', params: ['p2'] },
    ]);
    expect(op.postcheck).toEqual([
      {
        description: 'verify index "idx_user_email" does not exist',
        sql: 'LOWERED 3',
        params: ['p3'],
      },
    ]);
    expect(call.label).toBe('Drop index "idx_user_email"');
  });

  it('toOp() throws when no lowerer is provided', async () => {
    const call = new DropIndexCall('public', 'user', 'idx_user_email');
    await expect(async () => call.toOp()).rejects.toThrow('createGaussDbMigrationPlanner');
  });

  it('renders this.dropIndex with no facade import', () => {
    const call = new DropIndexCall('public', 'user', 'idx_user_email');
    expect(call.renderTypeScript()).toBe(
      'this.dropIndex({ schema: "public", table: "user", index: "idx_user_email" })',
    );
    expect(call.importRequirements()).toEqual([]);
  });
});

describe('CreateExtensionCall', () => {
  it('builds a bare CREATE EXTENSION op guarded by pg_extension probes', () => {
    const call = new CreateExtensionCall('pgcrypto');
    const op = call.toOp();
    expect(op).toEqual({
      id: 'extension.pgcrypto',
      label: 'Create extension "pgcrypto"',
      operationClass: 'additive',
      target: { id: 'gaussdb' },
      precheck: [
        {
          description: 'ensure extension "pgcrypto" is not already enabled',
          sql: 'SELECT NOT EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname = $1) AS "result"',
          params: ['pgcrypto'],
        },
      ],
      execute: [
        {
          description: 'Create extension "pgcrypto"',
          sql: 'CREATE EXTENSION "pgcrypto"',
        },
      ],
      postcheck: [
        {
          description: 'confirm extension "pgcrypto" is enabled',
          sql: 'SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname = $1) AS "result"',
          params: ['pgcrypto'],
        },
      ],
    });
    expect(call.label).toBe('Create extension "pgcrypto"');
  });

  it('renders createExtension(...) and requires the facade factory import', () => {
    const call = new CreateExtensionCall('pgcrypto');
    expect(call.renderTypeScript()).toBe('createExtension("pgcrypto")');
    expect(call.importRequirements()).toEqual([
      { moduleSpecifier: '@internal/postgres/migration', symbol: 'createExtension' },
    ]);
  });
});

describe('RawSqlCall', () => {
  const op = {
    id: 'custom.raw',
    label: 'Custom raw SQL step',
    operationClass: 'additive' as const,
    target: { id: 'gaussdb' },
    precheck: [],
    execute: [{ description: 'run custom sql', sql: 'SELECT 1' }],
    postcheck: [],
  };

  it('toOp() returns the wrapped op unchanged', () => {
    const call = new RawSqlCall(op);
    expect(call.toOp()).toBe(op);
    expect(call.label).toBe('Custom raw SQL step');
    expect(call.operationClass).toBe('additive');
  });

  it('renders rawSql(...) with the op serialized as a JSON literal', () => {
    const call = new RawSqlCall(op);
    const ts = call.renderTypeScript();
    expect(ts.startsWith('rawSql({')).toBe(true);
    expect(ts).toContain('id: "custom.raw"');
    expect(ts).toContain('label: "Custom raw SQL step"');
    expect(ts).toContain('sql: "SELECT 1"');
  });
});

describe('DataTransformCall', () => {
  it('toOp() always throws MIGRATION.UNFILLED_PLACEHOLDER for the unfilled placeholder', () => {
    const call = new DataTransformCall(
      'Backfill status',
      'backfill-status:check',
      'backfill-status:run',
    );
    expect(() => call.toOp()).toThrow(
      expect.objectContaining({
        code: 'MIGRATION.UNFILLED_PLACEHOLDER',
        meta: { slot: 'Backfill status' },
      }),
    );
  });

  it('defaults operationClass to "data" and carries the check/run slot names', () => {
    const call = new DataTransformCall(
      'Backfill status',
      'backfill-status:check',
      'backfill-status:run',
    );
    expect(call.operationClass).toBe('data');
    expect(call.checkSlot).toBe('backfill-status:check');
    expect(call.runSlot).toBe('backfill-status:run');
  });

  it('renders this.dataTransform with placeholder(...) check/run slots', () => {
    const call = new DataTransformCall(
      'Backfill status',
      'backfill-status:check',
      'backfill-status:run',
    );
    const ts = call.renderTypeScript();
    expect(ts).toContain('this.dataTransform(endContract, "Backfill status", {');
    expect(ts).toContain('check: () => placeholder("backfill-status:check")');
    expect(ts).toContain('run: () => placeholder("backfill-status:run")');
  });

  it('importRequirements() references only the placeholder facade import (endContract comes from the scaffold)', () => {
    const call = new DataTransformCall('Backfill status', 'check', 'run');
    expect(call.importRequirements()).toEqual([
      { moduleSpecifier: '@internal/postgres/migration', symbol: 'placeholder' },
    ]);
  });
});

describe('EnableRowLevelSecurityCall', () => {
  // GaussDB has no `pg_class.relrowsecurity` column (42703, live-probed), so
  // enablement is unobservable — the op carries no catalog checks at all and
  // relies on the server-side idempotence of repeated ALTER TABLE statements.
  it('enables RLS via ALTER TABLE with no unobservable catalog checks', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const call = new EnableRowLevelSecurityCall('public', 'post');
    const op = await call.toOp(lowerer);

    expect(received).toEqual([]);
    expect(op.precheck).toEqual([]);
    expect(op.postcheck).toEqual([]);
    expect(op.execute).toEqual([
      {
        description: 'enable row-level security on "post"',
        sql: 'ALTER TABLE "public"."post" ENABLE ROW LEVEL SECURITY',
      },
    ]);
    expect(call.label).toBe('Enable row-level security on "post"');
  });

  it('toOp() throws when no lowerer is provided', async () => {
    const call = new EnableRowLevelSecurityCall('public', 'post');
    await expect(async () => call.toOp()).rejects.toThrow('createGaussDbMigrationPlanner');
  });

  it('renders this.enableRowLevelSecurity(...) with no facade import', () => {
    const call = new EnableRowLevelSecurityCall('public', 'post');
    expect(call.renderTypeScript()).toBe(
      'this.enableRowLevelSecurity({ schema: "public", table: "post" })',
    );
    expect(call.importRequirements()).toEqual([]);
  });
});

describe('DisableRowLevelSecurityCall', () => {
  it('lowers a typed DDL node with no unobservable catalog checks', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const call = new DisableRowLevelSecurityCall('public', 'post');
    const op = await call.toOp(lowerer);

    expect(received).toHaveLength(1);
    expect(op.precheck).toEqual([]);
    expect(op.postcheck).toEqual([]);
    expect(op.execute).toEqual([
      { description: 'disable row-level security on "post"', sql: 'LOWERED 1', params: ['p1'] },
    ]);
    expect(call.label).toBe('Disable row-level security on "post"');
  });

  it('toOp() throws when no lowerer is provided', async () => {
    const call = new DisableRowLevelSecurityCall('public', 'post');
    await expect(async () => call.toOp()).rejects.toThrow('createGaussDbMigrationPlanner');
  });

  it('renders this.disableRowLevelSecurity(...) with no facade import', () => {
    const call = new DisableRowLevelSecurityCall('public', 'post');
    expect(call.renderTypeScript()).toBe(
      'this.disableRowLevelSecurity({ schema: "public", table: "post" })',
    );
    expect(call.importRequirements()).toEqual([]);
  });
});

function makePolicy(): GaussDbRlsPolicy {
  return new GaussDbRlsPolicy({
    naming: parseNaming('post_owner_a1b2c3d4', 'post_owner'),
    tableName: 'post',
    namespaceId: 'public',
    operation: 'select',
    roles: ['authenticated'],
    using: 'author_id = current_user_id()',
    permissive: true,
    withCheck: undefined,
  });
}

describe('CreateGaussDbRlsPolicyCall', () => {
  // GaussDB has no `pg_policies` catalog (42P01, live-probed) — policy
  // existence is unobservable, so there are no catalog checks and idempotence
  // comes from the leading `DROP POLICY IF EXISTS` (live-probed idempotent).
  it('lowers a typed CREATE POLICY node preceded by a DROP POLICY IF EXISTS step', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const policy = makePolicy();
    const call = new CreateGaussDbRlsPolicyCall('public', 'post', policy);
    const op = await call.toOp(lowerer);

    expect(received).toHaveLength(1);
    expect(op.precheck).toEqual([]);
    expect(op.postcheck).toEqual([]);
    expect(op.execute).toEqual([
      {
        description: 'clear existing RLS policy "post_owner_a1b2c3d4" if present',
        sql: 'DROP POLICY IF EXISTS "post_owner_a1b2c3d4" ON "public"."post"',
      },
      {
        description: 'create RLS policy "post_owner_a1b2c3d4"',
        sql: 'LOWERED 1',
        params: ['p1'],
      },
    ]);
    expect(call.label).toBe('Create RLS policy "post_owner_a1b2c3d4" on "post"');
  });

  it('toOp() throws when no lowerer is provided', async () => {
    const call = new CreateGaussDbRlsPolicyCall('public', 'post', makePolicy());
    await expect(async () => call.toOp()).rejects.toThrow('createGaussDbMigrationPlanner');
  });

  it('renders the full policy literal, omitting the absent withCheck key', () => {
    const call = new CreateGaussDbRlsPolicyCall('public', 'post', makePolicy());
    expect(call.renderTypeScript()).toBe(
      [
        'this.createRlsPolicy({ schema: "public", table: "post", policy: {',
        '  naming: { kind: "wire", prefix: "post_owner", hash: "a1b2c3d4" },',
        '  tableName: "post",',
        '  namespaceId: "public",',
        '  operation: "select",',
        '  roles: ["authenticated"],',
        '  using: "author_id = current_user_id()",',
        '  permissive: true,',
        '} })',
      ].join('\n'),
    );
    expect(call.importRequirements()).toEqual([]);
  });

  it('renders an exact policy literal as the exact naming arm', () => {
    const call = new CreateGaussDbRlsPolicyCall(
      'public',
      'post',
      new GaussDbRlsPolicy({
        naming: parseNaming('Tenant members can read', undefined),
        tableName: 'post',
        namespaceId: 'public',
        operation: 'select',
        roles: ['app_user'],
        using: '(tenant_id = 1)',
        withCheck: undefined,
        permissive: true,
      }),
    );
    expect(call.renderTypeScript()).toBe(
      [
        'this.createRlsPolicy({ schema: "public", table: "post", policy: {',
        '  naming: { kind: "exact", name: "Tenant members can read" },',
        '  tableName: "post",',
        '  namespaceId: "public",',
        '  operation: "select",',
        '  roles: ["app_user"],',
        '  using: "(tenant_id = 1)",',
        '  permissive: true,',
        '} })',
      ].join('\n'),
    );
  });
});

describe('DropGaussDbRlsPolicyCall', () => {
  it('drops via a DROP POLICY IF EXISTS step with no unobservable catalog checks', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const call = new DropGaussDbRlsPolicyCall('public', 'post', 'post_owner_a1b2c3d4');
    const op = await call.toOp(lowerer);

    expect(received).toEqual([]);
    expect(op.precheck).toEqual([]);
    expect(op.postcheck).toEqual([]);
    expect(op.execute).toEqual([
      {
        description: 'drop RLS policy "post_owner_a1b2c3d4"',
        sql: 'DROP POLICY IF EXISTS "post_owner_a1b2c3d4" ON "public"."post"',
      },
    ]);
    expect(call.label).toBe('Drop RLS policy "post_owner_a1b2c3d4" on "post"');
  });

  it('toOp() throws when no lowerer is provided', async () => {
    const call = new DropGaussDbRlsPolicyCall('public', 'post', 'post_owner_a1b2c3d4');
    await expect(async () => call.toOp()).rejects.toThrow('createGaussDbMigrationPlanner');
  });

  it('renders this.dropRlsPolicy(...) with no facade import', () => {
    const call = new DropGaussDbRlsPolicyCall('public', 'post', 'post_owner_a1b2c3d4');
    expect(call.renderTypeScript()).toBe(
      'this.dropRlsPolicy({ schema: "public", table: "post", policy: "post_owner_a1b2c3d4" })',
    );
    expect(call.importRequirements()).toEqual([]);
  });
});

describe('RenameGaussDbRlsPolicyCall', () => {
  it('lowers a typed ALTER POLICY RENAME node with no unobservable catalog checks', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const call = new RenameGaussDbRlsPolicyCall(
      'public',
      'post',
      'post_owner_a1b2c3d4',
      'post_owner_e5f6g7h8',
    );
    const op = await call.toOp(lowerer);

    expect(received).toHaveLength(1);
    expect(op.operationClass).toBe('widening');
    expect(op.precheck).toEqual([]);
    expect(op.postcheck).toEqual([]);
    expect(op.execute).toEqual([
      {
        description: 'rename RLS policy "post_owner_a1b2c3d4" to "post_owner_e5f6g7h8"',
        sql: 'LOWERED 1',
        params: ['p1'],
      },
    ]);
    expect(call.label).toBe(
      'Rename RLS policy "post_owner_a1b2c3d4" to "post_owner_e5f6g7h8" on "post"',
    );
  });

  it('toOp() throws when no lowerer is provided', async () => {
    const call = new RenameGaussDbRlsPolicyCall(
      'public',
      'post',
      'post_owner_a1b2c3d4',
      'post_owner_e5f6g7h8',
    );
    await expect(async () => call.toOp()).rejects.toThrow('createGaussDbMigrationPlanner');
  });

  it('renders this.renameRlsPolicy(...) with no facade import', () => {
    const call = new RenameGaussDbRlsPolicyCall(
      'public',
      'post',
      'post_owner_a1b2c3d4',
      'post_owner_e5f6g7h8',
    );
    expect(call.renderTypeScript()).toBe(
      'this.renameRlsPolicy({ schema: "public", table: "post", from: "post_owner_a1b2c3d4", to: "post_owner_e5f6g7h8" })',
    );
    expect(call.importRequirements()).toEqual([]);
  });
});
