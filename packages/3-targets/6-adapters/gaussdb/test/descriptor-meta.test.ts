import { describe, expect, it } from 'vitest';
import { gaussdbNativeAuthoringTypes } from '../src/core/control-mutation-defaults';
import { gaussdbAdapterDescriptorMeta } from '../src/core/descriptor-meta';

const storage = gaussdbAdapterDescriptorMeta.types.storage;

type ExpandFn = (input: { nativeType: string; typeParams?: Record<string, unknown> }) => string;
type HooksMap = Record<string, { expandNativeType: ExpandFn }>;

const hooks = gaussdbAdapterDescriptorMeta.types.codecTypes.controlPlaneHooks as HooksMap;

describe('gaussdbAdapterDescriptorMeta capabilities', () => {
  it('descriptor reports sql.scalarList capability', () => {
    expect(gaussdbAdapterDescriptorMeta.capabilities['sql']).toMatchObject({ scalarList: true });
  });

  it('descriptor reports sql.checkConstraint capability', () => {
    expect(gaussdbAdapterDescriptorMeta.capabilities['sql']).toMatchObject({
      checkConstraint: true,
    });
  });

  it('descriptor reports sql.distinctOn capability', () => {
    expect(gaussdbAdapterDescriptorMeta.capabilities['sql']).toMatchObject({
      distinctOn: true,
    });
  });

  it('descriptor reports sql.lateral capability', () => {
    expect(gaussdbAdapterDescriptorMeta.capabilities['sql']).toMatchObject({ lateral: false });
  });
});

describe('expandNativeType hooks via descriptor-meta', () => {
  const lengthCodecIds = [
    'sql/char@1',
    'sql/varchar@1',
    'gaussdb/char@1',
    'gaussdb/varchar@1',
    'gaussdb/bit@1',
    'gaussdb/varbit@1',
    'gaussdb/nvarchar2@1',
    'gaussdb/raw@1',
  ] as const;

  describe('expandLength', () => {
    for (const codecId of lengthCodecIds) {
      describe(codecId, () => {
        const expand = hooks[codecId]!.expandNativeType;

        it('appends length param to native type', () => {
          expect(expand({ nativeType: 'character', typeParams: { length: 10 } })).toBe(
            'character(10)',
          );
        });

        it('returns bare native type when typeParams is missing', () => {
          expect(expand({ nativeType: 'character' })).toBe('character');
        });

        it('returns bare native type when length is absent', () => {
          expect(expand({ nativeType: 'character', typeParams: {} })).toBe('character');
        });

        it('throws for non-integer length', () => {
          expect(() => expand({ nativeType: 'character', typeParams: { length: 1.5 } })).toThrow(
            'Invalid "length" type parameter',
          );
        });

        it('throws for zero length', () => {
          expect(() => expand({ nativeType: 'character', typeParams: { length: 0 } })).toThrow(
            'Invalid "length" type parameter',
          );
        });

        it('throws for negative length', () => {
          expect(() => expand({ nativeType: 'character', typeParams: { length: -1 } })).toThrow(
            'Invalid "length" type parameter',
          );
        });

        it('throws for non-number length', () => {
          expect(() => expand({ nativeType: 'character', typeParams: { length: 'big' } })).toThrow(
            'Invalid "length" type parameter',
          );
        });
      });
    }
  });

  const precisionCodecIds = [
    'gaussdb/timestamp-temporal@1',
    'gaussdb/timestamptz-temporal@1',
    'gaussdb/time-temporal@1',
    'gaussdb/timestamp-string@1',
    'gaussdb/timestamptz-string@1',
    'gaussdb/time-string@1',
    'gaussdb/timetz@1',
    'gaussdb/interval@1',
  ] as const;

  describe('expandPrecision', () => {
    for (const codecId of precisionCodecIds) {
      describe(codecId, () => {
        const expand = hooks[codecId]!.expandNativeType;

        it('appends precision param to native type', () => {
          expect(expand({ nativeType: 'timestamp', typeParams: { precision: 3 } })).toBe(
            'timestamp(3)',
          );
        });

        it('returns bare native type when typeParams is missing', () => {
          expect(expand({ nativeType: 'timestamp' })).toBe('timestamp');
        });

        it('returns bare native type when precision is absent', () => {
          expect(expand({ nativeType: 'timestamp', typeParams: {} })).toBe('timestamp');
        });

        it('throws for non-integer precision', () => {
          expect(() => expand({ nativeType: 'timestamp', typeParams: { precision: 2.5 } })).toThrow(
            'Invalid "precision" type parameter',
          );
        });

        // `timestamp(0)` is a whole-second column, not a missing precision. The authoring surface
        // accepts it (`minimum: 0` on every precision-bearing type constructor), so expansion has
        // to as well — otherwise a schema the emitter accepts fails later, at planning.
        it('renders zero precision rather than rejecting it', () => {
          expect(expand({ nativeType: 'timestamp', typeParams: { precision: 0 } })).toBe(
            'timestamp(0)',
          );
        });

        it('throws for negative precision', () => {
          expect(() => expand({ nativeType: 'timestamp', typeParams: { precision: -1 } })).toThrow(
            'Invalid "precision" type parameter',
          );
        });
      });
    }
  });

  describe('expandNumeric (gaussdb/numeric@1)', () => {
    const expand = hooks['gaussdb/numeric@1']!.expandNativeType;

    it('appends precision only when scale is absent', () => {
      expect(expand({ nativeType: 'numeric', typeParams: { precision: 10 } })).toBe('numeric(10)');
    });

    it('appends precision and scale when both are present', () => {
      expect(expand({ nativeType: 'numeric', typeParams: { precision: 10, scale: 2 } })).toBe(
        'numeric(10,2)',
      );
    });

    it('returns bare native type when typeParams is missing', () => {
      expect(expand({ nativeType: 'numeric' })).toBe('numeric');
    });

    it('returns bare native type when precision is absent', () => {
      expect(expand({ nativeType: 'numeric', typeParams: {} })).toBe('numeric');
    });

    it('accepts zero scale with valid precision', () => {
      expect(expand({ nativeType: 'numeric', typeParams: { precision: 10, scale: 0 } })).toBe(
        'numeric(10,0)',
      );
    });

    it('throws when scale is declared without precision', () => {
      expect(() => expand({ nativeType: 'numeric', typeParams: { scale: 2 } })).toThrow(
        '"scale" requires "precision"',
      );
    });

    it('throws for zero precision', () => {
      expect(() => expand({ nativeType: 'numeric', typeParams: { precision: 0 } })).toThrow(
        'Invalid "precision" type parameter',
      );
    });

    it('throws for negative precision', () => {
      expect(() => expand({ nativeType: 'numeric', typeParams: { precision: -5 } })).toThrow(
        'Invalid "precision" type parameter',
      );
    });

    it('throws for non-integer scale', () => {
      expect(() =>
        expand({ nativeType: 'numeric', typeParams: { precision: 10, scale: 1.5 } }),
      ).toThrow('Invalid "scale" type parameter');
    });
  });

  describe('identityHooks', () => {
    const identityCodecIds = [
      'gaussdb/json@1',
      'gaussdb/jsonb@1',
      'gaussdb/bytea@1',
      'gaussdb/uuid@1',
      'gaussdb/inet@1',
      'gaussdb/clob@1',
      'gaussdb/blob@1',
    ] as const;

    for (const codecId of identityCodecIds) {
      it(`${codecId} returns nativeType unchanged`, () => {
        const expand = hooks[codecId]!.expandNativeType;
        expect(expand({ nativeType: 'uuid' })).toBe('uuid');
        expect(expand({ nativeType: 'uuid', typeParams: {} })).toBe('uuid');
      });
    }
  });
});

describe('storage entries', () => {
  it('includes gaussdb/uuid@1 with nativeType uuid', () => {
    expect(storage).toEqual(
      expect.arrayContaining([
        { typeId: 'gaussdb/uuid@1', familyId: 'sql', targetId: 'gaussdb', nativeType: 'uuid' },
      ]),
    );
  });

  it('includes gaussdb/inet@1 with nativeType inet', () => {
    expect(storage).toEqual(
      expect.arrayContaining([
        { typeId: 'gaussdb/inet@1', familyId: 'sql', targetId: 'gaussdb', nativeType: 'inet' },
      ]),
    );
  });

  it('includes gaussdb/bytea@1 with nativeType bytea', () => {
    expect(storage).toEqual(
      expect.arrayContaining([
        { typeId: 'gaussdb/bytea@1', familyId: 'sql', targetId: 'gaussdb', nativeType: 'bytea' },
      ]),
    );
  });

  it('includes the Oracle-compat codec storage entries', () => {
    expect(storage).toEqual(
      expect.arrayContaining([
        {
          typeId: 'gaussdb/nvarchar2@1',
          familyId: 'sql',
          targetId: 'gaussdb',
          nativeType: 'nvarchar2',
        },
        { typeId: 'gaussdb/clob@1', familyId: 'sql', targetId: 'gaussdb', nativeType: 'clob' },
        { typeId: 'gaussdb/blob@1', familyId: 'sql', targetId: 'gaussdb', nativeType: 'blob' },
        { typeId: 'gaussdb/raw@1', familyId: 'sql', targetId: 'gaussdb', nativeType: 'raw' },
      ]),
    );
  });
});

describe('precision bounds agree between authoring and expansion', () => {
  const precisionBearing = [
    ['Timestamp', 'gaussdb/timestamp-temporal@1', 'timestamp'],
    ['Timestamptz', 'gaussdb/timestamptz-temporal@1', 'timestamptz'],
    ['Time', 'gaussdb/time-temporal@1', 'time'],
    ['Timetz', 'gaussdb/timetz@1', 'timetz'],
    ['TimestampString', 'gaussdb/timestamp-string@1', 'timestamp'],
    ['TimestamptzString', 'gaussdb/timestamptz-string@1', 'timestamptz'],
    ['TimeString', 'gaussdb/time-string@1', 'time'],
  ] as const;

  it.each(precisionBearing)(
    '%s declares a minimum its hook honours',
    (typeName, codecId, nativeType) => {
      const typeConstructor = gaussdbNativeAuthoringTypes[typeName];
      const precisionArg = typeConstructor.args?.find((arg) => arg.name === 'precision');
      const minimum = precisionArg?.kind === 'number' ? precisionArg.minimum : undefined;

      expect(minimum, `${typeName} should declare a precision minimum`).toBeTypeOf('number');
      expect(
        hooks[codecId]!.expandNativeType({ nativeType, typeParams: { precision: minimum } }),
      ).toBe(`${nativeType}(${minimum})`);
    },
  );
});
