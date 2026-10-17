import { computeStorageHash } from '@internal/contract/hashing';
import { coreHash } from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { GaussDbNativeEnum } from '../src/core/gaussdb-native-enum';
import {
  GaussDbSchema,
  GaussDbUnboundSchema,
  gaussdbCreateNamespace,
} from '../src/core/gaussdb-schema';

const emptyTableInput = {
  columns: {},
  uniques: [],
  indexes: [],
  foreignKeys: [],
} as const;

describe('GaussDbSchema', () => {
  it('exposes its id and renders a quoted-identifier qualifier', () => {
    const schema = new GaussDbSchema({ id: 'auth', entries: { table: {} } });
    expect(schema.id).toBe('auth');
    expect(schema.qualifier()).toBe('"auth"');
  });

  it('qualifies a table name with the schema prefix', () => {
    const schema = new GaussDbSchema({ id: 'auth', entries: { table: {} } });
    expect(schema.qualifyTable('users')).toBe('"auth"."users"');
  });

  it('quotes the schema name even when it would otherwise collide with a GaussDB keyword', () => {
    const schema = new GaussDbSchema({ id: 'public', entries: { table: {} } });
    expect(schema.qualifier()).toBe('"public"');
    expect(schema.qualifyTable('users')).toBe('"public"."users"');
  });

  it('normalises plain table inputs into StorageTable instances', () => {
    const schema = new GaussDbSchema({
      id: 'app',
      entries: { table: { users: emptyTableInput } },
    });
    expect(schema.table['users']).toBeInstanceOf(StorageTable);
  });
});

describe('GaussDbUnboundSchema', () => {
  it('exposes the framework-reserved unbound id as its singleton id', () => {
    expect(GaussDbSchema.unbound).toBeInstanceOf(GaussDbUnboundSchema);
    expect(GaussDbSchema.unbound.id).toBe(UNBOUND_NAMESPACE_ID);
  });

  it('carries empty frozen tables on the unbound singleton', () => {
    expect(GaussDbSchema.unbound.entries['table']).toEqual({});
    expect(Object.isFrozen(GaussDbSchema.unbound.entries['table'])).toBe(true);
  });

  it('elides the schema qualifier so emission paths render unqualified output', () => {
    expect(GaussDbSchema.unbound.qualifier()).toBe('');
    expect(GaussDbSchema.unbound.qualifyTable('users')).toBe('"users"');
  });

  it('is a stable singleton — repeated access returns the same instance', () => {
    expect(GaussDbSchema.unbound).toBe(GaussDbSchema.unbound);
  });
});

describe('ddlSchemaName', () => {
  const storageWithPublic = new SqlStorage({
    storageHash: coreHash('test-with-public'),
    namespaces: {
      public: new GaussDbSchema({ id: 'public', entries: { table: {} } }),
      [UNBOUND_NAMESPACE_ID]: GaussDbUnboundSchema.instance,
    },
  });

  const storageWithoutPublic = new SqlStorage({
    storageHash: coreHash('test-without-public'),
    namespaces: {
      auth: new GaussDbSchema({ id: 'auth', entries: { table: {} } }),
      [UNBOUND_NAMESPACE_ID]: GaussDbUnboundSchema.instance,
    },
  });

  it('returns its own id for a named public schema', () => {
    const schema = new GaussDbSchema({ id: 'public', entries: { table: {} } });
    expect(schema.ddlSchemaName(storageWithPublic)).toBe('public');
  });

  it('returns its own id for a named non-public schema', () => {
    const schema = new GaussDbSchema({ id: 'auth', entries: { table: {} } });
    expect(schema.ddlSchemaName(storageWithoutPublic)).toBe('auth');
  });

  it('returns the sentinel for the unbound singleton regardless of sibling namespaces', () => {
    expect(GaussDbUnboundSchema.instance.ddlSchemaName(storageWithPublic)).toBe(
      UNBOUND_NAMESPACE_ID,
    );
    expect(GaussDbUnboundSchema.instance.ddlSchemaName(storageWithoutPublic)).toBe(
      UNBOUND_NAMESPACE_ID,
    );
  });
});

describe('gaussdbCreateNamespace factory', () => {
  it('returns a GaussDbUnboundSchema for the framework-reserved sentinel', () => {
    const namespace = gaussdbCreateNamespace({ id: UNBOUND_NAMESPACE_ID, entries: { table: {} } });
    expect(namespace).toBeInstanceOf(GaussDbUnboundSchema);
    expect(namespace.qualifyTable('users')).toBe('"users"');
  });

  it('materialises a fresh GaussDbSchema instance for any named coordinate', () => {
    const auth = gaussdbCreateNamespace({ id: 'auth', entries: { table: {} } });
    expect(auth).toBeInstanceOf(GaussDbSchema);
    expect(auth.id).toBe('auth');
    expect(auth.qualifyTable('users')).toBe('"auth"."users"');
  });

  it('returns distinct GaussDbSchema instances for distinct named coordinates', () => {
    const auth = gaussdbCreateNamespace({ id: 'auth', entries: { table: {} } });
    const billing = gaussdbCreateNamespace({ id: 'billing', entries: { table: {} } });
    expect(auth).not.toBe(billing);
    expect(auth.id).toBe('auth');
    expect(billing.id).toBe('billing');
  });
});

describe('GaussDbSchema — entries open dictionary', () => {
  it('exact-shape serialization: JSON.stringify emits only id and entries', () => {
    const schema = new GaussDbSchema({
      id: 'public',
      entries: {
        table: { users: emptyTableInput },
      },
    });
    const parsed = JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(['entries', 'id']);
  });

  it('kind is non-enumerable', () => {
    const schema = new GaussDbSchema({ id: 'app', entries: { table: {} } });
    expect(Object.keys(schema)).not.toContain('kind');
    expect(schema.kind).toBe('schema');
  });

  it('entries is frozen after construction', () => {
    const schema = new GaussDbSchema({ id: 'app', entries: { table: {} } });
    expect(Object.isFrozen(schema.entries)).toBe(true);
  });

  it('inner table map is frozen', () => {
    const schema = new GaussDbSchema({
      id: 'app',
      entries: { table: { users: emptyTableInput } },
    });
    expect(Object.isFrozen(schema.entries['table'])).toBe(true);
  });

  it('table getter returns the frozen name-keyed map from entries', () => {
    const schema = new GaussDbSchema({
      id: 'app',
      entries: { table: { users: emptyTableInput } },
    });
    expect(schema.table).toBe(schema.entries['table']);
  });

  it('table getter is non-enumerable', () => {
    const schema = new GaussDbSchema({ id: 'app', entries: { table: {} } });
    expect(Object.keys(schema)).not.toContain('table');
  });

  it('valueSet getter returns the frozen name-keyed map when present', () => {
    const schema = new GaussDbSchema({
      id: 'app',
      entries: {
        table: {},
        valueSet: { Status: { kind: 'value-set', values: ['active'] } },
      },
    });
    expect(schema.valueSet).toBe(schema.entries['valueSet']);
  });

  it('valueSet getter is non-enumerable', () => {
    const schema = new GaussDbSchema({ id: 'app', entries: { table: {} } });
    expect(Object.keys(schema)).not.toContain('valueSet');
  });

  it('valueSet is absent from entries when empty', () => {
    const schema = new GaussDbSchema({ id: 'app', entries: { table: {} } });
    expect(schema.entries['valueSet']).toBeUndefined();
  });

  it('valueSet is present in entries when non-empty', () => {
    const schema = new GaussDbSchema({
      id: 'app',
      entries: {
        table: {},
        valueSet: { Status: { kind: 'value-set', values: ['active'] } },
      },
    });
    expect(schema.entries['valueSet']).toBeDefined();
  });

  it('table is always present in entries even when empty', () => {
    const schema = new GaussDbSchema({ id: 'app', entries: { table: {} } });
    expect(schema.entries['table']).toBeDefined();
  });

  it('entries[kind][name] resolves the same as getter[name] for tables', () => {
    const schema = new GaussDbSchema({
      id: 'app',
      entries: { table: { users: emptyTableInput } },
    });
    expect(schema.entries['table']?.['users']).toBe(schema.table['users']);
  });
});

describe('GaussDbUnboundSchema — entries open dictionary', () => {
  it('exact-shape serialization: JSON.stringify emits only id and entries', () => {
    const parsed = JSON.parse(JSON.stringify(GaussDbUnboundSchema.instance)) as Record<
      string,
      unknown
    >;
    expect(Object.keys(parsed).sort()).toEqual(['entries', 'id']);
  });

  it('table is always present in entries even on unbound singleton', () => {
    expect(GaussDbSchema.unbound.entries['table']).toBeDefined();
  });
});

describe('GaussDbSchema — unknown entity kind', () => {
  it('carries an unknown kind through frozen as-is (permissive-carry)', () => {
    const bogusMap = Object.freeze({ foo: { x: 1 } });
    const schema = new GaussDbSchema({
      id: 'app',
      entries: { table: {}, bogus: bogusMap } as never,
    });
    expect(schema.entries['bogus']).toEqual(bogusMap);
    expect(Object.isFrozen(schema.entries['bogus'])).toBe(true);
  });

  it('unknown kind survives JSON.stringify round-trip', () => {
    const schema = new GaussDbSchema({
      id: 'app',
      entries: { table: {}, bogus: { item: { value: 42 } } } as never,
    });
    const parsed = JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
    expect((parsed['entries'] as Record<string, unknown>)['bogus']).toEqual({
      item: { value: 42 },
    });
  });

  it('forwards an unknown entries kind to the constructor, which carries it (permissive-carry)', () => {
    const schema = gaussdbCreateNamespace({
      id: 'auth',
      entries: { table: {}, bogus: { item: {} } } as never,
    });
    expect(schema.entries['bogus']).toBeDefined();
  });
});

describe('GaussDbSchema — native_enum entries', () => {
  // Keyed by the author handle on input; the constructor re-keys the slot by
  // the entity's physical type name (`aal_level`, ADR 221 coordinate).
  const nativeEnumInput = {
    AalLevel: {
      kind: 'gaussdb-enum',
      typeName: 'aal_level',
      members: ['aal1', 'aal2', 'aal3'],
      control: 'external',
    },
  };

  it('constructs a GaussDbNativeEnum instance from raw entries input', () => {
    const schema = new GaussDbSchema({
      id: 'auth',
      entries: { table: {}, native_enum: nativeEnumInput },
    });
    const nativeEnum = schema.entries.native_enum?.['aal_level'];
    expect(nativeEnum).toBeInstanceOf(GaussDbNativeEnum);
    expect(nativeEnum?.typeName).toBe('aal_level');
    expect(nativeEnum?.members).toEqual(['aal1', 'aal2', 'aal3']);
    expect(nativeEnum?.control).toBe('external');
  });

  it('native_enum is enumerable on entries', () => {
    const schema = new GaussDbSchema({
      id: 'auth',
      entries: { table: {}, native_enum: nativeEnumInput },
    });
    expect(Object.keys(schema.entries)).toContain('native_enum');
  });

  it('native_enum survives a JSON.stringify round-trip', () => {
    const schema = new GaussDbSchema({
      id: 'auth',
      entries: { table: {}, native_enum: nativeEnumInput },
    });
    const parsed = JSON.parse(JSON.stringify(schema)) as {
      entries: Record<string, unknown>;
    };
    expect(parsed.entries['native_enum']).toEqual({
      aal_level: {
        kind: 'gaussdb-enum',
        typeName: 'aal_level',
        members: ['aal1', 'aal2', 'aal3'],
        control: 'external',
      },
    });
  });

  it('is absent from entries when no native_enum input is given', () => {
    const schema = new GaussDbSchema({ id: 'auth', entries: { table: {} } });
    expect(schema.entries.native_enum).toBeUndefined();
  });

  it('rejects two native enums that resolve to the same physical type name', () => {
    // Two distinct handles, same `@@map` type name — no upstream validation
    // stops this, and the physical-name re-key would otherwise silently drop one
    // enum's members. Fail loud instead.
    const collidingInput = {
      RoleA: { kind: 'gaussdb-enum', typeName: 'app_role', members: ['a'] },
      RoleB: { kind: 'gaussdb-enum', typeName: 'app_role', members: ['b'] },
    };
    expect(
      () => new GaussDbSchema({ id: 'auth', entries: { table: {}, native_enum: collidingInput } }),
    ).toThrow(/app_role.*auth|auth.*app_role/);
  });
});

describe('GaussDbSchema — native_enum affects storageHash', () => {
  function hashWithNativeEnum(members: readonly string[]): string {
    return computeStorageHash({
      target: 'gaussdb',
      targetFamily: 'sql',
      storage: {
        namespaces: {
          auth: new GaussDbSchema({
            id: 'auth',
            entries: {
              table: {},
              native_enum: {
                AalLevel: { kind: 'gaussdb-enum', typeName: 'aal_level', members },
              },
            },
          }),
        },
      },
    });
  }

  it('changing native_enum members changes the computed storage hash', () => {
    const twoMembers = hashWithNativeEnum(['aal1', 'aal2']);
    const threeMembers = hashWithNativeEnum(['aal1', 'aal2', 'aal3']);
    expect(twoMembers).not.toBe(threeMembers);
  });

  it('a native_enum-bearing namespace hashes differently than an otherwise-identical enum-free one', () => {
    const withEnum = computeStorageHash({
      target: 'gaussdb',
      targetFamily: 'sql',
      storage: {
        namespaces: {
          auth: new GaussDbSchema({
            id: 'auth',
            entries: {
              table: {},
              native_enum: {
                AalLevel: { kind: 'gaussdb-enum', typeName: 'aal_level', members: ['aal1'] },
              },
            },
          }),
        },
      },
    });
    const withoutEnum = computeStorageHash({
      target: 'gaussdb',
      targetFamily: 'sql',
      storage: {
        namespaces: {
          auth: new GaussDbSchema({ id: 'auth', entries: { table: {} } }),
        },
      },
    });
    expect(withEnum).not.toBe(withoutEnum);
  });
});
