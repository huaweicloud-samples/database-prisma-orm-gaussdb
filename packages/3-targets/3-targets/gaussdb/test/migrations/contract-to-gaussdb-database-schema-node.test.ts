import { asNamespaceId, coreHash, profileHash } from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { namingOfLiveName, parseNaming } from '@internal/sql-schema-ir/naming';
import { SqlForeignKeyIR } from '@internal/sql-schema-ir/types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { GaussDbRlsEnablement } from '../../src/core/gaussdb-rls-enablement';
import { GaussDbRlsPolicy } from '../../src/core/gaussdb-rls-policy';
import { GaussDbRole } from '../../src/core/gaussdb-role';
import { type GaussDbContract, GaussDbSchema } from '../../src/core/gaussdb-schema';
import { contractToGaussDbDatabaseSchemaNode } from '../../src/core/migrations/contract-to-gaussdb-database-schema-node';
import { GaussDbDatabaseSchemaNode } from '../../src/core/schema-ir/gaussdb-database-schema-node';
import { GaussDbNamespaceSchemaNode } from '../../src/core/schema-ir/gaussdb-namespace-schema-node';
import { GaussDbRoleSchemaNode } from '../../src/core/schema-ir/gaussdb-role-schema-node';
import { GaussDbTableSchemaNode } from '../../src/core/schema-ir/gaussdb-table-schema-node';
import type { SqlSchemaDiffNode } from '../../src/core/schema-ir/schema-node-kinds';
import { gaussdbRenderDefault } from '../../src/exports/control';

const TABLE_NAME = 'profiles';
const SCHEMA_NAME = 'public';

function makePolicy(name: string): GaussDbRlsPolicy {
  return new GaussDbRlsPolicy({
    naming: namingOfLiveName(name),
    tableName: TABLE_NAME,
    namespaceId: SCHEMA_NAME,
    operation: 'select',
    roles: ['authenticated'],
    using: '(auth.uid() = user_id)',
    permissive: true,
    withCheck: undefined,
  });
}

const profilesTable = () =>
  new StorageTable({
    columns: {
      id: { nativeType: 'int4', codecId: 'gaussdb/int4@1', nullable: false },
      user_id: { nativeType: 'int4', codecId: 'gaussdb/int4@1', nullable: false },
    },
    primaryKey: { columns: ['id'] },
    foreignKeys: [],
    uniques: [],
    indexes: [],
  });

function makeContract(options: {
  readonly policies?: readonly GaussDbRlsPolicy[];
  readonly roles?: readonly GaussDbRole[];
  readonly rlsMarkedTables?: readonly string[];
}): GaussDbContract {
  const policyEntries: Record<string, GaussDbRlsPolicy> = {};
  for (const p of options.policies ?? []) {
    policyEntries[p.name] = p;
  }
  const roleEntries: Record<string, GaussDbRole> = {};
  for (const r of options.roles ?? []) {
    roleEntries[r.name] = r;
  }
  const rlsEntries: Record<string, GaussDbRlsEnablement> = {};
  for (const tableName of options.rlsMarkedTables ?? []) {
    rlsEntries[tableName] = new GaussDbRlsEnablement({
      tableName,
      namespaceId: SCHEMA_NAME,
    });
  }
  const schema = new GaussDbSchema({
    id: SCHEMA_NAME,
    entries: {
      table: { [TABLE_NAME]: profilesTable() },
      policy: policyEntries,
      role: roleEntries,
      rls: rlsEntries,
    },
  });
  return {
    target: 'gaussdb',
    targetFamily: 'sql',
    profileHash: profileHash('project-from-contract-test'),
    storage: new SqlStorage({
      storageHash: coreHash('project-from-contract-test'),
      namespaces: { [SCHEMA_NAME]: schema },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

const projectionOptions = {
  annotationNamespace: 'pg',
  renderDefault: gaussdbRenderDefault,
} as const;

describe('contractToGaussDbDatabaseSchemaNode', () => {
  it('returns a GaussDbDatabaseSchemaNode root', () => {
    const root = contractToGaussDbDatabaseSchemaNode(makeContract({}), projectionOptions);
    expect(GaussDbDatabaseSchemaNode.is(root)).toBe(true);
    expect(root.id).toBe('database');
  });

  it('groups tables under a namespace node', () => {
    const root = contractToGaussDbDatabaseSchemaNode(makeContract({}), projectionOptions);
    expect(Object.keys(root.namespaces)).toEqual([SCHEMA_NAME]);
    const ns = root.namespaces[SCHEMA_NAME];
    expect(GaussDbNamespaceSchemaNode.is(ns!)).toBe(true);
    expect(Object.keys(ns!.tables)).toEqual([TABLE_NAME]);
    expect(GaussDbTableSchemaNode.is(ns!.tables[TABLE_NAME]!)).toBe(true);
  });

  it('children() of the root are namespace nodes', () => {
    const root = contractToGaussDbDatabaseSchemaNode(makeContract({}), projectionOptions);
    expect(root.children()).toEqual([root.namespaces[SCHEMA_NAME]]);
  });

  it('attaches a SELECT policy to its table within the namespace', () => {
    const policy = makePolicy('read_own_profiles_a1b2c3d4');
    const root = contractToGaussDbDatabaseSchemaNode(
      makeContract({ policies: [policy], rlsMarkedTables: [TABLE_NAME] }),
      projectionOptions,
    );
    const table = root.namespaces[SCHEMA_NAME]?.tables[TABLE_NAME];
    expect(table?.policies).toContainEqual(expect.objectContaining({ name: policy.name }));
  });

  it('stamps the policy dependsOn as its table plus one chain per granted role', () => {
    const policy = makePolicy('read_own_profiles_a1b2c3d4');
    const root = contractToGaussDbDatabaseSchemaNode(
      makeContract({ policies: [policy], rlsMarkedTables: [TABLE_NAME] }),
      projectionOptions,
    );
    const table = root.namespaces[SCHEMA_NAME]?.tables[TABLE_NAME];
    const policyNode = table?.policies.find((p) => p.name === policy.name);
    expect(policyNode?.dependsOn).toEqual([
      [
        { nodeKind: 'gaussdb-database', id: 'database' },
        { nodeKind: 'gaussdb-namespace', id: SCHEMA_NAME },
        { nodeKind: 'gaussdb-table', id: TABLE_NAME },
      ],
      [
        { nodeKind: 'gaussdb-database', id: 'database' },
        { nodeKind: 'gaussdb-role', id: 'authenticated' },
      ],
    ]);
  });

  it('throws at derivation time when a policy targets a table that carries no rls marker', () => {
    const policy = makePolicy('read_own_profiles_a1b2c3d4');
    expect(() =>
      contractToGaussDbDatabaseSchemaNode(makeContract({ policies: [policy] }), projectionOptions),
    ).toThrow(/policy "read_own_profiles".*"profiles".*@@rls/s);
  });

  it('derivation-backstop error names the policy prefix, not the wire hash', () => {
    const policy = makePolicy('read_own_profiles_a1b2c3d4');
    expect(() =>
      contractToGaussDbDatabaseSchemaNode(makeContract({ policies: [policy] }), projectionOptions),
    ).toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining('a1b2c3d4'),
      }),
    );
  });

  it('does not throw for a marker on a table with zero policies', () => {
    const root = contractToGaussDbDatabaseSchemaNode(
      makeContract({ rlsMarkedTables: [TABLE_NAME] }),
      projectionOptions,
    );
    expect(GaussDbDatabaseSchemaNode.is(root)).toBe(true);
  });

  it('stamps rlsEnabled true from marker presence, even with zero policies', () => {
    const root = contractToGaussDbDatabaseSchemaNode(
      makeContract({ rlsMarkedTables: [TABLE_NAME] }),
      projectionOptions,
    );
    expect(root.namespaces[SCHEMA_NAME]?.tables[TABLE_NAME]?.rlsEnabled).toBe(true);
  });

  it('stamps rlsEnabled false on a table without a marker', () => {
    const root = contractToGaussDbDatabaseSchemaNode(makeContract({}), projectionOptions);
    expect(root.namespaces[SCHEMA_NAME]?.tables[TABLE_NAME]?.rlsEnabled).toBe(false);
  });

  it('carries owned DDL schema names in existingSchemas on the root', () => {
    const root = contractToGaussDbDatabaseSchemaNode(makeContract({}), projectionOptions);
    expect(root.existingSchemas).toEqual([SCHEMA_NAME]);
  });

  it('puts roles on the root and yields them as role children of the root', () => {
    const role = new GaussDbRole({ name: 'app_user', namespaceId: 'public' });
    const root = contractToGaussDbDatabaseSchemaNode(
      makeContract({ roles: [role] }),
      projectionOptions,
    );
    expect(root.roles).toContainEqual(expect.objectContaining({ name: 'app_user' }));
    const roleChildren = root
      .children()
      .filter((child) => GaussDbRoleSchemaNode.is(child as SqlSchemaDiffNode));
    expect(roleChildren).toContainEqual(expect.objectContaining({ name: 'app_user' }));
    // Every non-role child is a namespace node.
    for (const child of root.children()) {
      const isRole = GaussDbRoleSchemaNode.is(child as SqlSchemaDiffNode);
      const isNamespace = GaussDbNamespaceSchemaNode.is(child as SqlSchemaDiffNode);
      expect(isRole || isNamespace).toBe(true);
    }
  });

  it('returns an empty root for a null contract', () => {
    const root = contractToGaussDbDatabaseSchemaNode(null, projectionOptions);
    expect(GaussDbDatabaseSchemaNode.is(root)).toBe(true);
    expect(root.namespaces).toEqual({});
    expect(root.roles).toEqual([]);
    expect(root.existingSchemas).toEqual([]);
  });

  it('projects same-named tables in different schemas into their own namespace nodes', () => {
    const thingTable = () =>
      new StorageTable({
        columns: { id: { nativeType: 'int4', codecId: 'gaussdb/int4@1', nullable: false } },
        primaryKey: { columns: ['id'] },
        foreignKeys: [],
        uniques: [],
        indexes: [],
      });
    const contract: GaussDbContract = {
      target: 'gaussdb',
      targetFamily: 'sql',
      profileHash: profileHash('same-name-cross-schema'),
      storage: new SqlStorage({
        storageHash: coreHash('same-name-cross-schema'),
        namespaces: {
          public: new GaussDbSchema({
            id: 'public',
            entries: { table: { thing: thingTable() } },
          }),
          auth: new GaussDbSchema({
            id: 'auth',
            entries: { table: { thing: thingTable() } },
          }),
        },
      }),
      roots: {},
      domain: applicationDomainOf({ models: {} }),
      capabilities: {},
      extensions: {},
      meta: {},
    };

    const root = contractToGaussDbDatabaseSchemaNode(contract, projectionOptions);

    expect(Object.keys(root.namespaces).sort()).toEqual(['auth', 'public']);
    expect(Object.keys(root.namespaces['public']!.tables)).toEqual(['thing']);
    expect(Object.keys(root.namespaces['auth']!.tables)).toEqual(['thing']);
    // The two same-named tables are distinct nodes in distinct namespaces.
    expect(root.namespaces['public']!.tables['thing']).not.toBe(
      root.namespaces['auth']!.tables['thing'],
    );
  });

  it('aliases Oracle-compat authoring type names to their introspected spellings', () => {
    // `number` lands as `numeric` and `varchar2` as `character varying` in
    // GaussDB's catalog (live-probed format_type output); `raw` drops its
    // length. The expected-tree comparison values must carry the catalog
    // spelling, while DDL rendering keeps the authoring name.
    const oracleTable = () =>
      new StorageTable({
        columns: {
          id: { nativeType: 'int4', codecId: 'gaussdb/int4@1', nullable: false },
          amount: {
            nativeType: 'number',
            codecId: 'gaussdb/numeric@1',
            nullable: false,
            typeParams: { precision: 10, scale: 2 },
          },
          label: {
            nativeType: 'varchar2',
            codecId: 'sql/varchar@1',
            nullable: false,
            typeParams: { length: 10 },
          },
          token: {
            nativeType: 'raw',
            codecId: 'gaussdb/raw@1',
            nullable: false,
            typeParams: { length: 16 },
          },
          body: { nativeType: 'clob', codecId: 'gaussdb/clob@1', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        foreignKeys: [],
        uniques: [],
        indexes: [],
      });
    const schema = new GaussDbSchema({
      id: SCHEMA_NAME,
      entries: { table: { [TABLE_NAME]: oracleTable() } },
    });
    const contract: GaussDbContract = {
      target: 'gaussdb',
      targetFamily: 'sql',
      profileHash: profileHash('oracle-alias-test'),
      storage: new SqlStorage({
        storageHash: coreHash('oracle-alias-test'),
        namespaces: { [SCHEMA_NAME as never]: schema },
      }),
      roots: {},
      domain: applicationDomainOf({ models: {} }),
      capabilities: {},
      extensions: {},
      meta: {},
    };
    // Mimic the descriptor's codec-control hooks (expandNumeric/expandLength).
    const root = contractToGaussDbDatabaseSchemaNode(contract, {
      ...projectionOptions,
      expandNativeType: (input: {
        readonly nativeType: string;
        readonly typeParams?: Record<string, unknown>;
      }) => {
        if (!input.typeParams) return input.nativeType;
        if ('length' in input.typeParams) {
          return `${input.nativeType}(${String(input.typeParams['length'])})`;
        }
        return `${input.nativeType}(${String(input.typeParams['precision'])},${String(input.typeParams['scale'])})`;
      },
    });
    const columns = root.namespaces[SCHEMA_NAME]!.tables[TABLE_NAME]!.columns;
    expect(columns['amount']!.resolvedNativeType).toBe('numeric(10,2)');
    expect(columns['label']!.resolvedNativeType).toBe('character varying(10)');
    expect(columns['token']!.resolvedNativeType).toBe('raw');
    expect(columns['body']!.resolvedNativeType).toBe('clob');
  });

  it('throws when a policy references a table absent from its namespace', () => {
    const orphan = new GaussDbRlsPolicy({
      naming: parseNaming('read_orphan_deadbeef', 'read_orphan'),
      tableName: 'missing_table',
      namespaceId: SCHEMA_NAME,
      operation: 'select',
      roles: ['authenticated'],
      permissive: true,
      using: undefined,
      withCheck: undefined,
    });
    expect(() =>
      contractToGaussDbDatabaseSchemaNode(makeContract({ policies: [orphan] }), projectionOptions),
    ).toThrow(/missing_table/);
  });
});

describe('contractToGaussDbDatabaseSchemaNode — FK resolvedReferencedNamespace', () => {
  function contractWithFk(targetNamespaceId: string): GaussDbContract {
    const schema = new GaussDbSchema({
      id: SCHEMA_NAME,
      entries: {
        table: {
          users: new StorageTable({
            columns: { id: { nativeType: 'int4', codecId: 'gaussdb/int4@1', nullable: false } },
            primaryKey: { columns: ['id'] },
            foreignKeys: [],
            uniques: [],
            indexes: [],
          }),
          [TABLE_NAME]: new StorageTable({
            columns: {
              id: { nativeType: 'int4', codecId: 'gaussdb/int4@1', nullable: false },
              user_id: { nativeType: 'int4', codecId: 'gaussdb/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            foreignKeys: [
              {
                source: {
                  namespaceId: asNamespaceId(SCHEMA_NAME),
                  tableName: TABLE_NAME,
                  columns: ['user_id'],
                },
                target: {
                  namespaceId: asNamespaceId(targetNamespaceId),
                  tableName: 'users',
                  columns: ['id'],
                },
              },
            ],
            uniques: [],
            indexes: [],
          }),
        },
      },
    });
    return {
      target: 'gaussdb',
      targetFamily: 'sql',
      profileHash: profileHash('fk-resolution-test'),
      storage: new SqlStorage({
        storageHash: coreHash('fk-resolution-test'),
        namespaces: { [SCHEMA_NAME]: schema },
      }),
      roots: {},
      domain: applicationDomainOf({ models: {} }),
      capabilities: {},
      extensions: {},
      meta: {},
    };
  }

  it('resolves an unbound FK target namespace to the real DDL schema', () => {
    const root = contractToGaussDbDatabaseSchemaNode(
      contractWithFk(UNBOUND_NAMESPACE_ID),
      projectionOptions,
    );
    const fk = root.namespaces[SCHEMA_NAME]?.tables[TABLE_NAME]?.foreignKeys[0];
    expect(fk?.referencedSchema).toBe(UNBOUND_NAMESPACE_ID);
    expect(fk?.resolvedReferencedNamespace).toBe('public');
  });

  it('resolves a named FK target namespace through its DDL schema name', () => {
    const root = contractToGaussDbDatabaseSchemaNode(
      contractWithFk(SCHEMA_NAME),
      projectionOptions,
    );
    const fk = root.namespaces[SCHEMA_NAME]?.tables[TABLE_NAME]?.foreignKeys[0];
    expect(fk?.resolvedReferencedNamespace).toBe('public');
  });

  it('stamps dependsOn as the referenced table (resolved namespace) plus own columns', () => {
    const root = contractToGaussDbDatabaseSchemaNode(
      contractWithFk(UNBOUND_NAMESPACE_ID),
      projectionOptions,
    );
    const fk = root.namespaces[SCHEMA_NAME]?.tables[TABLE_NAME]?.foreignKeys[0];
    expect(fk?.dependsOn).toEqual([
      [
        { nodeKind: 'gaussdb-database', id: 'database' },
        { nodeKind: 'gaussdb-namespace', id: 'public' },
        { nodeKind: 'gaussdb-table', id: 'users' },
      ],
      [
        { nodeKind: 'gaussdb-database', id: 'database' },
        { nodeKind: 'gaussdb-namespace', id: 'public' },
        { nodeKind: 'gaussdb-table', id: TABLE_NAME },
        { nodeKind: 'sql-column', id: 'column:user_id' },
      ],
    ]);
  });

  it('an unbound-namespace contract FK pairs by id with an introspected public FK', () => {
    const root = contractToGaussDbDatabaseSchemaNode(
      contractWithFk(UNBOUND_NAMESPACE_ID),
      projectionOptions,
    );
    const expectedFk = root.namespaces[SCHEMA_NAME]?.tables[TABLE_NAME]?.foreignKeys[0];
    const introspectedFk = new SqlForeignKeyIR({
      columns: ['user_id'],
      referencedTable: 'users',
      referencedColumns: ['id'],
      referencedSchema: 'public',
      name: 'profiles_user_id_fkey',
    });
    expect(expectedFk?.id).toBe(introspectedFk.id);
  });
});

describe('contractToGaussDbDatabaseSchemaNode — unbound-slot projection', () => {
  function contractWithNamespaces(namespaces: Record<string, GaussDbSchema>): GaussDbContract {
    return {
      target: 'gaussdb',
      targetFamily: 'sql',
      profileHash: profileHash('unbound-slot-projection-test'),
      storage: new SqlStorage({
        storageHash: coreHash('unbound-slot-projection-test'),
        namespaces,
      }),
      roots: {},
      domain: applicationDomainOf({ models: {} }),
      capabilities: {},
      extensions: {},
      meta: {},
    };
  }

  it('a roles-only unbound slot alongside named namespaces contributes no "public" node', () => {
    const role = new GaussDbRole({ name: 'anon', namespaceId: UNBOUND_NAMESPACE_ID });
    const unboundSchema = new GaussDbSchema({
      id: UNBOUND_NAMESPACE_ID,
      entries: { table: {}, role: { anon: role } },
    });
    const authSchema = new GaussDbSchema({
      id: 'auth',
      entries: { table: { [TABLE_NAME]: profilesTable() } },
    });
    const root = contractToGaussDbDatabaseSchemaNode(
      contractWithNamespaces({ [UNBOUND_NAMESPACE_ID]: unboundSchema, auth: authSchema }),
      projectionOptions,
    );

    expect(Object.keys(root.namespaces)).toEqual(['auth']);
    expect(root.namespaces['public']).toBeUndefined();
    expect(root.existingSchemas).toEqual(['auth']);
    expect(root.roles).toContainEqual(expect.objectContaining({ name: 'anon' }));
  });

  it('a single-namespace unbound contract with tables and roles keeps its "public" node with tables (unchanged)', () => {
    const role = new GaussDbRole({ name: 'anon', namespaceId: UNBOUND_NAMESPACE_ID });
    const unboundSchema = new GaussDbSchema({
      id: UNBOUND_NAMESPACE_ID,
      entries: { table: { [TABLE_NAME]: profilesTable() }, role: { anon: role } },
    });
    const root = contractToGaussDbDatabaseSchemaNode(
      contractWithNamespaces({ [UNBOUND_NAMESPACE_ID]: unboundSchema }),
      projectionOptions,
    );

    expect(Object.keys(root.namespaces)).toEqual(['public']);
    expect(Object.keys(root.namespaces['public']!.tables)).toEqual([TABLE_NAME]);
    expect(root.existingSchemas).toEqual(['public']);
    expect(root.roles).toContainEqual(expect.objectContaining({ name: 'anon' }));
  });

  it('a bound "public" namespace with tables plus a roles-only unbound slot keeps the public tables (no clobber)', () => {
    const role = new GaussDbRole({ name: 'anon', namespaceId: UNBOUND_NAMESPACE_ID });
    const unboundSchema = new GaussDbSchema({
      id: UNBOUND_NAMESPACE_ID,
      entries: { table: {}, role: { anon: role } },
    });
    const publicSchema = new GaussDbSchema({
      id: 'public',
      entries: { table: { [TABLE_NAME]: profilesTable() } },
    });
    const root = contractToGaussDbDatabaseSchemaNode(
      contractWithNamespaces({ [UNBOUND_NAMESPACE_ID]: unboundSchema, public: publicSchema }),
      projectionOptions,
    );

    expect(Object.keys(root.namespaces)).toEqual(['public']);
    expect(Object.keys(root.namespaces['public']!.tables)).toEqual([TABLE_NAME]);
    expect(root.existingSchemas).toEqual(['public']);
    expect(root.roles).toContainEqual(expect.objectContaining({ name: 'anon' }));
  });
});

describe('contractToGaussDbDatabaseSchemaNode — native_enum projection', () => {
  function contractWithEnum(): GaussDbContract {
    const schema = new GaussDbSchema({
      id: 'auth',
      entries: {
        table: { [TABLE_NAME]: profilesTable() },
        native_enum: {
          AalLevel: {
            kind: 'gaussdb-enum',
            typeName: 'aal_level',
            members: ['aal1', 'aal2', 'aal3'],
            control: 'external',
          },
          FactorType: {
            kind: 'gaussdb-enum',
            typeName: 'factor_type',
            members: ['totp', 'webauthn'],
          },
        },
      },
    });
    return {
      target: 'gaussdb',
      targetFamily: 'sql',
      profileHash: profileHash('native-enum-projection-test'),
      storage: new SqlStorage({
        storageHash: coreHash('native-enum-projection-test'),
        namespaces: { auth: schema },
      }),
      roots: {},
      domain: applicationDomainOf({ models: {} }),
      capabilities: {},
      extensions: {},
      meta: {},
    };
  }

  it('projects entries.native_enum into namespace-node enum children (all grades)', () => {
    const root = contractToGaussDbDatabaseSchemaNode(contractWithEnum(), projectionOptions);
    const ns = root.namespaces['auth'];
    const enumChildren = ns!.children().filter((child) => child.id.startsWith('native_enum:'));
    expect(enumChildren).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          typeName: 'aal_level',
          namespaceId: 'auth',
          members: ['aal1', 'aal2', 'aal3'],
          control: 'external',
        }),
        expect.objectContaining({
          typeName: 'factor_type',
          members: ['totp', 'webauthn'],
        }),
      ]),
    );
    expect(enumChildren).toHaveLength(2);
  });

  it('an enum-free contract projects no enum children and empty plain fields (regression pin)', () => {
    const root = contractToGaussDbDatabaseSchemaNode(makeContract({}), projectionOptions);
    const ns = root.namespaces[SCHEMA_NAME];
    expect(ns?.nativeEnums).toEqual([]);
    expect(ns?.children().every((child) => !child.id.startsWith('native_enum:'))).toBe(true);
  });
});
