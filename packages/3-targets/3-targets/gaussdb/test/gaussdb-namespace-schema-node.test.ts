import { parseNaming } from '@internal/sql-schema-ir/naming';
import { describe, expect, it } from 'vitest';
import { GaussDbNamespaceSchemaNode } from '../src/core/schema-ir/gaussdb-namespace-schema-node';
import { GaussDbNativeEnumSchemaNode } from '../src/core/schema-ir/gaussdb-native-enum-schema-node';
import { GaussDbPolicySchemaNode } from '../src/core/schema-ir/gaussdb-policy-schema-node';
import { GaussDbRoleSchemaNode } from '../src/core/schema-ir/gaussdb-role-schema-node';
import { GaussDbTableSchemaNode } from '../src/core/schema-ir/gaussdb-table-schema-node';
import type { SqlSchemaDiffNode } from '../src/core/schema-ir/schema-node-kinds';

const policy = new GaussDbPolicySchemaNode({
  naming: parseNaming('read_own_a1b2c3d4', 'read_own'),
  tableName: 'profiles',
  namespaceId: 'public',
  operation: 'select' as const,
  roles: ['authenticated'],
  using: '(auth.uid() = user_id)',
  permissive: true,
  withCheck: undefined,
  dependsOn: undefined,
});

const tableA = new GaussDbTableSchemaNode({
  name: 'profiles',
  columns: { id: { name: 'id', nativeType: 'int4', nullable: false } },
  foreignKeys: [],
  uniques: [],
  indexes: [],
  policies: [policy],
  rlsEnabled: false,
});

const tableB = new GaussDbTableSchemaNode({
  name: 'orders',
  columns: { id: { name: 'id', nativeType: 'int4', nullable: false } },
  foreignKeys: [],
  uniques: [],
  indexes: [],
  policies: [],
  rlsEnabled: false,
});

const baseInput = {
  schemaName: 'public',
  tables: { profiles: tableA, orders: tableB },
};

describe('GaussDbNamespaceSchemaNode', () => {
  it('id returns schemaName', () => {
    const node = new GaussDbNamespaceSchemaNode(baseInput);
    expect(node.id).toBe('public');
  });

  it('isEqualTo matches by id (schema name)', () => {
    const a = new GaussDbNamespaceSchemaNode(baseInput);
    const same = new GaussDbNamespaceSchemaNode(baseInput);
    const other = new GaussDbNamespaceSchemaNode({ ...baseInput, schemaName: 'other' });
    expect(a.isEqualTo(same)).toBe(true);
    expect(a.isEqualTo(other)).toBe(false);
  });

  it('children() returns table nodes', () => {
    const node = new GaussDbNamespaceSchemaNode(baseInput);
    expect(node.children()).toEqual([tableA, tableB]);
  });

  it('children() returns empty array when no tables', () => {
    const node = new GaussDbNamespaceSchemaNode({ schemaName: 'empty', tables: {} });
    expect(node.children()).toEqual([]);
  });

  it('children() does not include roles (roles are database-level)', () => {
    const node = new GaussDbNamespaceSchemaNode(baseInput);
    for (const child of node.children()) {
      expect(GaussDbRoleSchemaNode.is(child as SqlSchemaDiffNode)).toBe(false);
    }
  });

  it('carries schemaName', () => {
    const node = new GaussDbNamespaceSchemaNode(baseInput);
    expect(node.schemaName).toBe('public');
  });

  it('carries tables keyed by name', () => {
    const node = new GaussDbNamespaceSchemaNode(baseInput);
    expect(Object.keys(node.tables)).toEqual(['profiles', 'orders']);
    expect(node.tables['profiles']).toBe(tableA);
  });

  it('instance is frozen', () => {
    const node = new GaussDbNamespaceSchemaNode(baseInput);
    expect(Object.isFrozen(node)).toBe(true);
  });

  describe('native enums', () => {
    it('carries enum nodes passed directly into children()', () => {
      const enumNode = new GaussDbNativeEnumSchemaNode({
        typeName: 'aal_level',
        namespaceId: 'auth',
        members: ['aal1', 'aal2'],
        control: 'external',
      });
      const node = new GaussDbNamespaceSchemaNode({
        schemaName: 'auth',
        tables: {},
        nativeEnums: [enumNode],
      });
      expect(node.nativeEnums).toEqual([enumNode]);
      expect(node.children()).toEqual([enumNode]);
    });

    it('defaults to empty when nativeEnums is omitted', () => {
      const node = new GaussDbNamespaceSchemaNode(baseInput);
      expect(node.nativeEnums).toEqual([]);
    });

    it('freezes the nativeEnums list', () => {
      const enumNode = new GaussDbNativeEnumSchemaNode({
        typeName: 'status_enum',
        namespaceId: 'public',
        members: ['draft', 'review'],
      });
      const node = new GaussDbNamespaceSchemaNode({
        ...baseInput,
        nativeEnums: [enumNode],
      });
      expect(Object.isFrozen(node.nativeEnums)).toBe(true);
    });

    it('exposes one enum diff node per entry through children()', () => {
      const enumNode = new GaussDbNativeEnumSchemaNode({
        typeName: 'aal_level',
        namespaceId: 'auth',
        members: ['aal1', 'aal2'],
      });
      const node = new GaussDbNamespaceSchemaNode({
        schemaName: 'auth',
        tables: { profiles: tableA },
        nativeEnums: [enumNode],
      });
      const enumChildren = node.children().filter((child) => child.id.startsWith('native_enum:'));
      expect(enumChildren).toEqual([
        expect.objectContaining({
          nodeKind: 'gaussdb-native-enum',
          typeName: 'aal_level',
          namespaceId: 'auth',
          members: ['aal1', 'aal2'],
        }),
      ]);
      expect(node.children()).toHaveLength(2);
    });

    it('threads an entry-level control grade onto the enum node', () => {
      const enumNode = new GaussDbNativeEnumSchemaNode({
        typeName: 'aal_level',
        namespaceId: 'auth',
        members: ['aal1'],
        control: 'external',
      });
      const node = new GaussDbNamespaceSchemaNode({
        schemaName: 'auth',
        tables: {},
        nativeEnums: [enumNode],
      });
      expect(node.children()[0]).toMatchObject({ control: 'external' });
    });

    it('children() stays tables-only when no enums are supplied (regression pin)', () => {
      const node = new GaussDbNamespaceSchemaNode(baseInput);
      expect(node.children()).toEqual([tableA, tableB]);
    });
  });

  describe('GaussDbNamespaceSchemaNode.is', () => {
    it('returns true for a GaussDbNamespaceSchemaNode', () => {
      const node = new GaussDbNamespaceSchemaNode(baseInput);
      expect(GaussDbNamespaceSchemaNode.is(node)).toBe(true);
    });

    it('returns false for a GaussDbTableSchemaNode', () => {
      expect(GaussDbNamespaceSchemaNode.is(tableA)).toBe(false);
    });

    it('returns false for a GaussDbPolicySchemaNode', () => {
      expect(GaussDbNamespaceSchemaNode.is(policy)).toBe(false);
    });
  });

  it('carries a `tables` field readable by legacy per-schema consumers reading SqlSchemaIRNode structurally', () => {
    const node = new GaussDbNamespaceSchemaNode(baseInput);
    expect(Object.keys(node.tables)).toEqual(['profiles', 'orders']);
  });
});
