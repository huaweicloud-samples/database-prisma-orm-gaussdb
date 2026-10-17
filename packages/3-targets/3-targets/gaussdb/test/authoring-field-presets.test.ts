import {
  temporalAuthoringPresets,
  temporalCodecPresetWithPrecision,
  temporalStringAuthoringPresets,
} from '@internal/family-sql/control';
import { collectScalarTypeConstructors } from '@internal/framework-components/authoring';
import { describe, expect, it } from 'vitest';
import { gaussdbAuthoringFieldPresets, gaussdbAuthoringTypes } from '../src/core/authoring';

describe('gaussdbAuthoringFieldPresets', () => {
  it('exposes uuidNative preset with gaussdb/uuid@1 and nativeType uuid', () => {
    expect(gaussdbAuthoringFieldPresets.uuidNative).toMatchObject({
      kind: 'fieldPreset',
      output: {
        codecId: 'gaussdb/uuid@1',
        nativeType: 'uuid',
      },
    });
  });

  it('exposes id.uuidv4Native preset with gaussdb/uuid@1, uuidv4 generator, and id flag', () => {
    expect(gaussdbAuthoringFieldPresets.id.uuidv4Native).toMatchObject({
      kind: 'fieldPreset',
      output: {
        codecId: 'gaussdb/uuid@1',
        nativeType: 'uuid',
        executionDefaults: { onCreate: { kind: 'generator', id: 'uuidv4' } },
        id: true,
      },
    });
  });

  it('exposes id.uuidv7Native preset with gaussdb/uuid@1, uuidv7 generator, and id flag', () => {
    expect(gaussdbAuthoringFieldPresets.id.uuidv7Native).toMatchObject({
      kind: 'fieldPreset',
      output: {
        codecId: 'gaussdb/uuid@1',
        nativeType: 'uuid',
        executionDefaults: { onCreate: { kind: 'generator', id: 'uuidv7' } },
        id: true,
      },
    });
  });

  it('contributes integer representations as bare-eligible top-level types', () => {
    const types = collectScalarTypeConstructors(gaussdbAuthoringTypes);

    expect(types.get('BigIntNumber')).toEqual({
      codecId: 'gaussdb/int8number@1',
      nativeType: 'int8',
    });
    expect(types.get('UnboundedInt')).toEqual({
      codecId: 'gaussdb/unboundedint@1',
      nativeType: 'numeric',
    });
  });

  it('does not expose integer representations as field presets', () => {
    expect(gaussdbAuthoringFieldPresets).not.toHaveProperty('bigIntNumber');
    expect(gaussdbAuthoringFieldPresets).not.toHaveProperty('unboundedInt');
  });

  it('keeps the lossless bigint preset on gaussdb/int8@1, so BigIntNumber is opt-in', () => {
    expect(gaussdbAuthoringFieldPresets.bigint).toEqual({
      kind: 'fieldPreset',
      output: {
        codecId: 'gaussdb/int8@1',
        nativeType: 'int8',
      },
    });
  });
});

describe('gaussdb temporal per-codec presets', () => {
  // The mapping is the whole point of the pair, so it is asserted by id rather than by shape: which
  // representation a spelling selects is what a schema author is choosing between.
  it.each([
    ['timestamp', 'gaussdb/timestamp-temporal@1'],
    ['timestamptz', 'gaussdb/timestamptz-temporal@1'],
    ['createdAt', 'gaussdb/timestamptz-temporal@1'],
    ['updatedAt', 'gaussdb/timestamptz-temporal@1'],
    ['timestampString', 'gaussdb/timestamp-string@1'],
    ['timestamptzString', 'gaussdb/timestamptz-string@1'],
    ['createdAtString', 'gaussdb/timestamptz-string@1'],
    ['updatedAtString', 'gaussdb/timestamptz-string@1'],
  ] as const)('temporal.%s resolves to %s', (helper, codecId) => {
    expect(gaussdbAuthoringFieldPresets.temporal[helper].output.codecId).toBe(codecId);
  });

  it('lowers each pair through the shared factories, so the halves differ only in their codec and their clock', () => {
    expect(gaussdbAuthoringFieldPresets.temporal).toEqual({
      ...temporalAuthoringPresets({
        codecId: 'gaussdb/timestamptz-temporal@1',
        nativeType: 'timestamptz',
        generatorId: 'instantNow',
      }),
      ...temporalStringAuthoringPresets({
        codecId: 'gaussdb/timestamptz-string@1',
        nativeType: 'timestamptz',
      }),
      timestamp: temporalCodecPresetWithPrecision({
        codecId: 'gaussdb/timestamp-temporal@1',
        nativeType: 'timestamp',
        generatorId: 'instantNow',
      }),
      timestamptz: temporalCodecPresetWithPrecision({
        codecId: 'gaussdb/timestamptz-temporal@1',
        nativeType: 'timestamptz',
        generatorId: 'instantNow',
      }),
      timestampString: temporalCodecPresetWithPrecision({
        codecId: 'gaussdb/timestamp-string@1',
        nativeType: 'timestamp',
      }),
      timestamptzString: temporalCodecPresetWithPrecision({
        codecId: 'gaussdb/timestamptz-string@1',
        nativeType: 'timestamptz',
      }),
    });
  });

  it('backs updatedAt and timestamptz with the same codec, so the convenience form is a shorthand', () => {
    expect(gaussdbAuthoringFieldPresets.temporal.updatedAt.output.codecId).toBe(
      gaussdbAuthoringFieldPresets.temporal.timestamptz.output.codecId,
    );
  });

  it('backs updatedAtString and timestamptzString the same way', () => {
    expect(gaussdbAuthoringFieldPresets.temporal.updatedAtString.output.codecId).toBe(
      gaussdbAuthoringFieldPresets.temporal.timestamptzString.output.codecId,
    );
  });

  it.each([
    ['updatedAt', 'instantNow'],
    ['updatedAtString', 'timestampNow'],
  ] as const)('gives %s the %s generator on both phases', (helper, generatorId) => {
    expect(gaussdbAuthoringFieldPresets.temporal[helper].output.executionDefaults).toEqual({
      onCreate: { kind: 'generator', id: generatorId },
      onUpdate: { kind: 'generator', id: generatorId },
    });
  });

  it.each(['createdAt', 'createdAtString'] as const)(
    'gives %s a now() storage default rather than an execution generator',
    (helper) => {
      expect(gaussdbAuthoringFieldPresets.temporal[helper].output).toMatchObject({
        default: { kind: 'function', expression: 'now()' },
      });
    },
  );
});
