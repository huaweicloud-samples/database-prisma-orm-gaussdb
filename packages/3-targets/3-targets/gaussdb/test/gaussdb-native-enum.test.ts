import { describe, expect, it } from 'vitest';
import { GaussDbNativeEnum } from '../src/core/gaussdb-native-enum';
import { GaussDbRole } from '../src/core/gaussdb-role';
import { GaussDbSchema } from '../src/core/gaussdb-schema';

const aalLevelInput = {
  typeName: 'aal_level',
  members: ['aal1', 'aal2', 'aal3'],
  control: 'external' as const,
};

describe('GaussDbNativeEnum', () => {
  it('constructs with typeName, ordered value-only members, and control', () => {
    const node = new GaussDbNativeEnum(aalLevelInput);
    expect(node.kind).toBe('gaussdb-enum');
    expect(node.typeName).toBe('aal_level');
    expect(node.members).toEqual(['aal1', 'aal2', 'aal3']);
    expect(node.control).toBe('external');
  });

  it('omits control when not provided', () => {
    const node = new GaussDbNativeEnum({
      typeName: 'aal_level',
      members: ['aal1'],
    });
    expect(Object.hasOwn(node, 'control')).toBe(false);
    expect('control' in JSON.parse(JSON.stringify(node))).toBe(false);
  });

  it('freezes the members array', () => {
    const node = new GaussDbNativeEnum(aalLevelInput);
    expect(Object.isFrozen(node.members)).toBe(true);
  });

  it('is frozen — mutation throws in strict mode', () => {
    const node = new GaussDbNativeEnum(aalLevelInput);
    expect(Object.isFrozen(node)).toBe(true);
    expect(() => {
      (node as { typeName: string }).typeName = 'mutated';
    }).toThrow();
  });

  it('kind is enumerable and survives JSON round-trip', () => {
    const node = new GaussDbNativeEnum(aalLevelInput);
    const json = JSON.parse(JSON.stringify(node)) as Record<string, unknown>;
    expect(json['kind']).toBe('gaussdb-enum');
    expect(json['typeName']).toBe('aal_level');
    expect(json['members']).toEqual(aalLevelInput.members);
    expect(json['control']).toBe('external');
  });

  it('does not share the members array reference with input', () => {
    const members = ['aal1'];
    const node = new GaussDbNativeEnum({ typeName: 'aal_level', members });
    expect(node.members).not.toBe(members);
  });

  describe('Contract-IR entity, not a DiffableNode', () => {
    it('has no id property', () => {
      const node = new GaussDbNativeEnum(aalLevelInput);
      expect('id' in node).toBe(false);
    });

    it('has no children method', () => {
      const node = new GaussDbNativeEnum(aalLevelInput);
      expect('children' in node).toBe(false);
    });

    it('has no isEqualTo method', () => {
      const node = new GaussDbNativeEnum(aalLevelInput);
      expect('isEqualTo' in node).toBe(false);
    });
  });

  describe('GaussDbNativeEnum.is guard', () => {
    it('returns true for a real GaussDbNativeEnum', () => {
      expect(GaussDbNativeEnum.is(new GaussDbNativeEnum(aalLevelInput))).toBe(true);
    });

    it('returns false for a node with a different kind', () => {
      const role = new GaussDbRole({ name: 'app_user', namespaceId: 'public' });
      expect(GaussDbNativeEnum.is(role)).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(GaussDbNativeEnum.is(undefined)).toBe(false);
    });
  });
});

describe('GaussDbSchema native_enum slot', () => {
  it('exposes an empty native_enum map when not provided', () => {
    const schema = new GaussDbSchema({ id: 'public', entries: { table: {} } });
    expect(schema.entries.native_enum).toBeUndefined();
  });

  it('normalises plain native_enum input into GaussDbNativeEnum instances', () => {
    const schema = new GaussDbSchema({
      id: 'auth',
      entries: {
        table: {},
        native_enum: { AalLevel: aalLevelInput },
      },
    });
    const node = schema.entries.native_enum?.['aal_level'];
    expect(node).toBeInstanceOf(GaussDbNativeEnum);
    expect(node?.typeName).toBe('aal_level');
    expect(node?.members).toHaveLength(3);
  });
});
