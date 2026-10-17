import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { parseNaming } from '@internal/sql-schema-ir/naming';
import { describe, expect, it } from 'vitest';
import {
  GaussDbPolicySchemaNode,
  type GaussDbPolicySchemaNodeInput,
} from '../src/core/schema-ir/gaussdb-policy-schema-node';
import { GaussDbRoleSchemaNode } from '../src/core/schema-ir/gaussdb-role-schema-node';

type FlatPolicy = Omit<GaussDbPolicySchemaNodeInput, 'naming'> & {
  readonly name: string;
  readonly prefix: string | undefined;
};

function policyNode(flat: FlatPolicy): GaussDbPolicySchemaNode {
  const { name: _name, prefix: _prefix, ...rest } = flat;
  return new GaussDbPolicySchemaNode({ ...rest, naming: parseNaming(flat.name, flat.prefix) });
}

const basePolicyInput = {
  name: 'read_own_profiles_a1b2c3d4',
  prefix: 'read_own_profiles',
  tableName: 'profiles',
  namespaceId: 'public',
  operation: 'select' as const,
  roles: ['app_user'],
  using: "owner_id = current_setting('app.uid')::int",
  withCheck: undefined,
  dependsOn: undefined,
  permissive: true,
};

describe('GaussDbPolicySchemaNode', () => {
  it('id returns the wire name', () => {
    const node = policyNode(basePolicyInput);
    expect(node.id).toBe('read_own_profiles_a1b2c3d4');
  });

  it('children() returns empty array (leaf)', () => {
    const node = policyNode(basePolicyInput);
    expect(node.children()).toEqual([]);
  });

  it('isEqualTo returns true for same wire name', () => {
    const a = policyNode(basePolicyInput);
    const b = policyNode({ ...basePolicyInput });
    expect(a.isEqualTo(b)).toBe(true);
  });

  it('isEqualTo returns false for different wire name', () => {
    const a = policyNode(basePolicyInput);
    const b = policyNode({
      ...basePolicyInput,
      name: 'read_own_profiles_deadbeef',
    });
    expect(a.isEqualTo(b)).toBe(false);
  });

  it('isEqualTo throws when other is not a GaussDbPolicySchemaNode', () => {
    const a = policyNode(basePolicyInput);
    const b = new GaussDbRoleSchemaNode({ name: 'app_user', namespaceId: UNBOUND_NAMESPACE_ID });
    expect(() => a.isEqualTo(b)).toThrow();
  });

  it('carries all fields from input', () => {
    const node = policyNode(basePolicyInput);
    expect(node.name).toBe(basePolicyInput.name);
    expect(node.prefix).toBe(basePolicyInput.prefix);
    expect(node.tableName).toBe(basePolicyInput.tableName);
    expect(node.namespaceId).toBe(basePolicyInput.namespaceId);
    expect(node.operation).toBe(basePolicyInput.operation);
    expect(node.roles).toEqual(basePolicyInput.roles);
    expect(node.using).toBe(basePolicyInput.using);
    expect(node.permissive).toBe(basePolicyInput.permissive);
  });

  it('withCheck is absent when not provided', () => {
    const node = policyNode(basePolicyInput);
    expect(Object.hasOwn(node, 'withCheck')).toBe(false);
  });

  it('using is absent when not provided', () => {
    const node = policyNode({
      ...basePolicyInput,
      using: undefined,
      withCheck: 'true',
    });
    expect(Object.hasOwn(node, 'using')).toBe(false);
  });

  it('instance is frozen', () => {
    const node = policyNode(basePolicyInput);
    expect(Object.isFrozen(node)).toBe(true);
  });

  describe('prefix invariant (wire vs exact)', () => {
    it('an exact node carries no prefix — the property is absent', () => {
      const exact = policyNode({
        ...basePolicyInput,
        prefix: undefined,
        name: 'Tenant members can read',
      });
      expect(exact.prefix).toBeUndefined();
      expect(Object.hasOwn(exact, 'prefix')).toBe(false);
    });

    it('a declared prefix must parse back out of the name — parseNaming rejects the pair, so the node is unconstructable', () => {
      expect(() => parseNaming(basePolicyInput.name, 'other')).toThrow(
        /does not match the wire name/,
      );
      expect(() => parseNaming('not_wire_shaped', 'not_wire_shaped')).toThrow(
        /does not match the wire name/,
      );
    });
  });

  describe('isEqualTo — exact mode (prefix absent) compares content', () => {
    const exactInput = {
      ...basePolicyInput,
      prefix: undefined,
      name: 'Tenant members can read',
    };

    it('equal when every compared field matches', () => {
      const a = policyNode(exactInput);
      const b = policyNode({ ...exactInput });
      expect(a.isEqualTo(b)).toBe(true);
    });

    it('operation drift breaks equality', () => {
      const a = policyNode(exactInput);
      const b = policyNode({ ...exactInput, operation: 'update' });
      expect(a.isEqualTo(b)).toBe(false);
    });

    it('permissive drift breaks equality', () => {
      const a = policyNode(exactInput);
      const b = policyNode({ ...exactInput, permissive: false });
      expect(a.isEqualTo(b)).toBe(false);
    });

    it('roles compare sorted — order does not matter, membership does', () => {
      const a = policyNode({ ...exactInput, roles: ['b_role', 'a_role'] });
      const sameSet = policyNode({ ...exactInput, roles: ['a_role', 'b_role'] });
      const differentSet = policyNode({ ...exactInput, roles: ['a_role'] });
      expect(a.isEqualTo(sameSet)).toBe(true);
      expect(a.isEqualTo(differentSet)).toBe(false);
    });

    it('roles compare as a set — a duplicated role name is equal, matching the hash tuple', () => {
      const a = policyNode({ ...exactInput, roles: ['a_role'] });
      const duplicated = policyNode({
        ...exactInput,
        roles: ['a_role', 'a_role'],
      });
      expect(a.isEqualTo(duplicated)).toBe(true);
    });

    it('using compares verbatim byte-for-byte — whitespace variants are unequal', () => {
      const a = policyNode({ ...exactInput, using: '(user_id = 1)' });
      const drifted = policyNode({ ...exactInput, using: '(user_id = 2)' });
      const whitespace = policyNode({ ...exactInput, using: '( user_id = 1 )' });
      expect(a.isEqualTo(drifted)).toBe(false);
      expect(a.isEqualTo(whitespace)).toBe(false);
    });

    it('withCheck compares verbatim; absent equals empty', () => {
      const a = policyNode({ ...exactInput, withCheck: 'true' });
      const b = policyNode({ ...exactInput, withCheck: 'false' });
      expect(a.isEqualTo(b)).toBe(false);

      const absent = policyNode(exactInput);
      const empty = policyNode({ ...exactInput, withCheck: '' });
      expect(absent.isEqualTo(empty)).toBe(true);
    });
  });

  describe('isEqualTo — wire mode stays id-driven', () => {
    it('same wire name is equal even when bodies differ (hash identity covers content)', () => {
      const a = policyNode(basePolicyInput);
      const b = policyNode({
        ...basePolicyInput,
        using: 'a completely different predicate',
        operation: 'select',
      });
      expect(a.isEqualTo(b)).toBe(true);
    });
  });

  describe('GaussDbPolicySchemaNode.is', () => {
    it('returns true for a GaussDbPolicySchemaNode', () => {
      const node = policyNode(basePolicyInput);
      expect(GaussDbPolicySchemaNode.is(node)).toBe(true);
    });

    it('returns false for a GaussDbRoleSchemaNode', () => {
      const role = new GaussDbRoleSchemaNode({
        name: 'app_user',
        namespaceId: UNBOUND_NAMESPACE_ID,
      });
      expect(GaussDbPolicySchemaNode.is(role)).toBe(false);
    });
  });

  describe('dependsOn', () => {
    const dependsOn = [
      [
        { nodeKind: 'gaussdb-database', id: 'database' },
        { nodeKind: 'gaussdb-namespace', id: 'public' },
        { nodeKind: 'gaussdb-table', id: 'profiles' },
      ],
      [
        { nodeKind: 'gaussdb-database', id: 'database' },
        { nodeKind: 'gaussdb-role', id: 'app_user' },
      ],
    ];

    it('is readable when supplied', () => {
      const node = policyNode({ ...basePolicyInput, dependsOn });
      expect(node.dependsOn).toEqual(dependsOn);
    });

    it('is absent when not supplied', () => {
      const node = policyNode(basePolicyInput);
      expect(node.dependsOn).toBeUndefined();
    });

    it('is non-enumerable — excluded from JSON and structural equality', () => {
      const node = policyNode({ ...basePolicyInput, dependsOn });
      expect(Object.keys(node)).not.toContain('dependsOn');
      expect(JSON.parse(JSON.stringify(node))).not.toHaveProperty('dependsOn');
    });

    it('is ignored by isEqualTo', () => {
      const a = policyNode({ ...basePolicyInput, dependsOn });
      const b = policyNode(basePolicyInput);
      expect(a.isEqualTo(b)).toBe(true);
    });
  });
});

describe('GaussDbRoleSchemaNode', () => {
  it('id returns the bare role name', () => {
    const node = new GaussDbRoleSchemaNode({
      name: 'app_user',
      namespaceId: UNBOUND_NAMESPACE_ID,
    });
    // The differ pairs siblings by (nodeKind, id), so a role never collides
    // with a same-named schema even though both use the bare name as id.
    expect(node.id).toBe('app_user');
    expect(node.name).toBe('app_user');
  });

  it('children() returns empty array (leaf)', () => {
    const node = new GaussDbRoleSchemaNode({
      name: 'app_user',
      namespaceId: UNBOUND_NAMESPACE_ID,
    });
    expect(node.children()).toEqual([]);
  });

  it('isEqualTo returns true for same name', () => {
    const a = new GaussDbRoleSchemaNode({ name: 'app_user', namespaceId: UNBOUND_NAMESPACE_ID });
    const b = new GaussDbRoleSchemaNode({ name: 'app_user', namespaceId: UNBOUND_NAMESPACE_ID });
    expect(a.isEqualTo(b)).toBe(true);
  });

  it('isEqualTo returns false for different name', () => {
    const a = new GaussDbRoleSchemaNode({ name: 'app_user', namespaceId: UNBOUND_NAMESPACE_ID });
    const b = new GaussDbRoleSchemaNode({ name: 'anon', namespaceId: UNBOUND_NAMESPACE_ID });
    expect(a.isEqualTo(b)).toBe(false);
  });

  it('isEqualTo throws when other is not a GaussDbRoleSchemaNode', () => {
    const a = new GaussDbRoleSchemaNode({ name: 'app_user', namespaceId: UNBOUND_NAMESPACE_ID });
    const b = policyNode(basePolicyInput);
    expect(() => a.isEqualTo(b)).toThrow();
  });

  it('carries all fields from input', () => {
    const node = new GaussDbRoleSchemaNode({ name: 'app_user', namespaceId: 'public' });
    expect(node.name).toBe('app_user');
    expect(node.namespaceId).toBe('public');
  });

  it('instance is frozen', () => {
    const node = new GaussDbRoleSchemaNode({
      name: 'app_user',
      namespaceId: UNBOUND_NAMESPACE_ID,
    });
    expect(Object.isFrozen(node)).toBe(true);
  });

  describe('GaussDbRoleSchemaNode.is', () => {
    it('returns true for a GaussDbRoleSchemaNode', () => {
      const node = new GaussDbRoleSchemaNode({
        name: 'app_user',
        namespaceId: UNBOUND_NAMESPACE_ID,
      });
      expect(GaussDbRoleSchemaNode.is(node)).toBe(true);
    });

    it('returns false for a GaussDbPolicySchemaNode', () => {
      const policy = policyNode(basePolicyInput);
      expect(GaussDbRoleSchemaNode.is(policy)).toBe(false);
    });
  });
});
