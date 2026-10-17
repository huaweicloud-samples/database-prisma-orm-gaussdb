import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { StorageTable } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { GaussDbRlsPolicy } from '../src/core/gaussdb-rls-policy';
import { GaussDbRole } from '../src/core/gaussdb-role';
import { GaussDbSchema } from '../src/core/gaussdb-schema';
import { policyInputFromSerialized } from '../src/core/serialized-rls-policy';

function policyOf(flat: Parameters<typeof policyInputFromSerialized>[0]): GaussDbRlsPolicy {
  return new GaussDbRlsPolicy(policyInputFromSerialized(flat));
}

const emptyTableInput = {
  columns: {},
  uniques: [],
  indexes: [],
  foreignKeys: [],
} as const;

describe('GaussDbRole', () => {
  it('constructs with required fields', () => {
    const role = new GaussDbRole({ name: 'authenticated', namespaceId: UNBOUND_NAMESPACE_ID });
    expect(role.kind).toBe('role');
    expect(role.name).toBe('authenticated');
    expect(role.namespaceId).toBe(UNBOUND_NAMESPACE_ID);
  });

  it('accepts an explicit namespaceId', () => {
    const role = new GaussDbRole({ name: 'anon', namespaceId: 'public' });
    expect(role.namespaceId).toBe('public');
  });

  it('is frozen — mutation throws in strict mode', () => {
    const role = new GaussDbRole({ name: 'authenticated', namespaceId: UNBOUND_NAMESPACE_ID });
    expect(Object.isFrozen(role)).toBe(true);
    expect(() => {
      (role as { name: string }).name = 'mutated';
    }).toThrow();
  });

  it('kind is enumerable and survives JSON round-trip', () => {
    const role = new GaussDbRole({ name: 'authenticated', namespaceId: UNBOUND_NAMESPACE_ID });
    const json = JSON.parse(JSON.stringify(role)) as Record<string, unknown>;
    expect(json['kind']).toBe('role');
    expect(json['name']).toBe('authenticated');
    expect(json['namespaceId']).toBe(UNBOUND_NAMESPACE_ID);
  });

  it('defaults control to external when not provided', () => {
    const role = new GaussDbRole({ name: 'authenticated', namespaceId: UNBOUND_NAMESPACE_ID });
    expect(role.control).toBe('external');
    const json = JSON.parse(JSON.stringify(role)) as Record<string, unknown>;
    expect(json['control']).toBe('external');
  });
});

describe('GaussDbRlsPolicy', () => {
  const policyInput = {
    name: 'user_select_a1b2c3d4',
    prefix: 'user_select',
    tableName: 'user',
    namespaceId: 'public',
    operation: 'select' as const,
    roles: ['authenticated', 'anon'],
    using: 'auth.uid() = user_id',
    withCheck: undefined,
    permissive: true,
  };

  it('constructs with all fields', () => {
    const policy = policyOf(policyInput);
    expect(policy.kind).toBe('policy');
    expect(policy.name).toBe('user_select_a1b2c3d4');
    expect(policy.prefix).toBe('user_select');
    expect(policy.tableName).toBe('user');
    expect(policy.operation).toBe('select');
    expect(policy.roles).toEqual(['authenticated', 'anon']);
    expect(policy.using).toBe('auth.uid() = user_id');
    expect(policy.permissive).toBe(true);
  });

  it('omits withCheck when not provided', () => {
    const policy = policyOf(policyInput);
    expect(Object.hasOwn(policy, 'withCheck')).toBe(false);
    expect('withCheck' in JSON.parse(JSON.stringify(policy))).toBe(false);
  });

  it('omits using when not provided', () => {
    const policy = policyOf({
      name: 'user_insert_a1b2c3d4',
      prefix: 'user_insert',
      tableName: 'user',
      namespaceId: 'public',
      operation: 'insert',
      roles: ['authenticated'],
      withCheck: 'true',
      permissive: false,
      using: undefined,
    });
    expect(Object.hasOwn(policy, 'using')).toBe(false);
  });

  it('freezes the roles array', () => {
    const policy = policyOf(policyInput);
    expect(Object.isFrozen(policy.roles)).toBe(true);
  });

  it('is frozen — mutation throws in strict mode', () => {
    const policy = policyOf(policyInput);
    expect(Object.isFrozen(policy)).toBe(true);
    expect(() => {
      (policy as { name: string }).name = 'mutated';
    }).toThrow();
  });

  it('kind is enumerable and survives JSON round-trip', () => {
    const policy = policyOf(policyInput);
    const json = JSON.parse(JSON.stringify(policy)) as Record<string, unknown>;
    expect(json['kind']).toBe('policy');
    expect(json['name']).toBe('user_select_a1b2c3d4');
    expect(json['prefix']).toBe('user_select');
    expect(json['operation']).toBe('select');
    expect(json['permissive']).toBe(true);
  });

  it('does not share roles array reference with input', () => {
    const roles = ['authenticated', 'anon'];
    const policy = policyOf({ ...policyInput, roles });
    expect(policy.roles).not.toBe(roles);
  });
});

describe('StorageTable', () => {
  it('is frozen after construction', () => {
    const table = new StorageTable(emptyTableInput);
    expect(Object.isFrozen(table)).toBe(true);
  });
});

describe('GaussDbSchema role and policy slots', () => {
  it('exposes empty role and policy maps when not provided', () => {
    const schema = new GaussDbSchema({ id: 'public', entries: { table: {} } });
    expect(schema.role).toEqual({});
    expect(Object.isFrozen(schema.role)).toBe(true);
    expect(schema.policy).toEqual({});
    expect(Object.isFrozen(schema.policy)).toBe(true);
  });

  it('normalises plain role input into GaussDbRole instances', () => {
    const schema = new GaussDbSchema({
      id: 'public',
      entries: {
        table: {},
        role: { authenticated: { name: 'authenticated', namespaceId: UNBOUND_NAMESPACE_ID } },
      },
    });
    const role = schema.role['authenticated'];
    expect(role).toBeInstanceOf(GaussDbRole);
    expect(role?.name).toBe('authenticated');
  });

  it('normalises plain policy input into GaussDbRlsPolicy instances', () => {
    const schema = new GaussDbSchema({
      id: 'public',
      entries: {
        table: {},
        policy: {
          user_select_a1b2c3d4: {
            name: 'user_select_a1b2c3d4',
            prefix: 'user_select',
            tableName: 'user',
            namespaceId: 'public',
            operation: 'select',
            roles: ['authenticated'],
            permissive: true,
          },
        },
      },
    });
    const policy = schema.policy['user_select_a1b2c3d4'];
    expect(policy).toBeInstanceOf(GaussDbRlsPolicy);
    expect(policy?.tableName).toBe('user');
  });

  it('normalises already-constructed role instances (structural equality preserved)', () => {
    const role = new GaussDbRole({ name: 'authenticated', namespaceId: UNBOUND_NAMESPACE_ID });
    const schema = new GaussDbSchema({
      id: 'public',
      entries: { table: {}, role: { authenticated: role } },
    });
    const hydrated = schema.role['authenticated'];
    expect(hydrated).toBeInstanceOf(GaussDbRole);
    expect(hydrated?.name).toBe(role.name);
    expect(hydrated?.namespaceId).toBe(role.namespaceId);
  });

  it('is frozen after construction', () => {
    const schema = new GaussDbSchema({ id: 'public', entries: { table: {} } });
    expect(Object.isFrozen(schema)).toBe(true);
    expect(Object.isFrozen(schema.entries)).toBe(true);
  });
});
