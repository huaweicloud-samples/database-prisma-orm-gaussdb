import { describe, expect, it } from 'vitest';
import { createGaussDbTypeMap } from '../../src/core/psl-infer/gaussdb-type-map';

describe('createGaussDbTypeMap', () => {
  const typeMap = createGaussDbTypeMap();

  it('maps basic scalar types', () => {
    expect(typeMap.resolve('text')).toEqual({ pslType: { name: 'String' }, nativeType: 'text' });
    expect(typeMap.resolve('int4')).toEqual({ pslType: { name: 'Int' }, nativeType: 'int4' });
    expect(typeMap.resolve('bool')).toEqual({ pslType: { name: 'Boolean' }, nativeType: 'bool' });
    expect(typeMap.resolve('float8')).toEqual({ pslType: { name: 'Float' }, nativeType: 'float8' });
    expect(typeMap.resolve('numeric')).toEqual({
      pslType: { name: 'Numeric' },
      nativeType: 'numeric',
    });
    expect(typeMap.resolve('timestamptz')).toEqual({
      pslType: { name: 'Timestamptz' },
      nativeType: 'timestamptz',
    });
    expect(typeMap.resolve('timestamp with time zone')).toEqual({
      pslType: { name: 'Timestamptz' },
      nativeType: 'timestamp with time zone',
    });
    expect(typeMap.resolve('jsonb')).toEqual({ pslType: { name: 'Jsonb' }, nativeType: 'jsonb' });
    expect(typeMap.resolve('bytea')).toEqual({ pslType: { name: 'Bytes' }, nativeType: 'bytea' });
    expect(typeMap.resolve('int8')).toEqual({ pslType: { name: 'BigInt' }, nativeType: 'int8' });
    expect(typeMap.resolve('uuid')).toEqual({
      pslType: { name: 'Uuid' },
      nativeType: 'uuid',
    });
    expect(typeMap.resolve('inet')).toEqual({
      pslType: { name: 'Inet' },
      nativeType: 'inet',
    });
  });

  it('maps alias types', () => {
    expect(typeMap.resolve('integer')).toEqual({ pslType: { name: 'Int' }, nativeType: 'integer' });
    expect(typeMap.resolve('boolean')).toEqual({
      pslType: { name: 'Boolean' },
      nativeType: 'boolean',
    });
    expect(typeMap.resolve('bigint')).toEqual({
      pslType: { name: 'BigInt' },
      nativeType: 'bigint',
    });
    expect(typeMap.resolve('real')).toEqual({
      pslType: { name: 'Real' },
      nativeType: 'real',
    });
    expect(typeMap.resolve('double precision')).toEqual({
      pslType: { name: 'Float' },
      nativeType: 'double precision',
    });
  });

  it('handles parameterized types', () => {
    const result = typeMap.resolve('character varying(255)');
    expect(result).toEqual({
      pslType: { name: 'VarChar', args: ['255'] },
      nativeType: 'character varying(255)',
      typeParams: { baseType: 'character varying', params: '255' },
    });
  });

  it('handles character type with parameter', () => {
    const result = typeMap.resolve('character(20)');
    expect(result).toEqual({
      pslType: { name: 'Char', args: ['20'] },
      nativeType: 'character(20)',
      typeParams: { baseType: 'character', params: '20' },
    });
  });

  it('preserves bare varchar in type position', () => {
    expect(typeMap.resolve('varchar')).toEqual({
      pslType: { name: 'VarChar' },
      nativeType: 'varchar',
    });
  });

  it('preserves non-default timestamp, date, time, json, and integer types', () => {
    expect(typeMap.resolve('timestamp')).toEqual({
      pslType: { name: 'Timestamp' },
      nativeType: 'timestamp',
    });
    expect(typeMap.resolve('time(3)')).toEqual({
      pslType: { name: 'Time', args: ['3'] },
      nativeType: 'time(3)',
      typeParams: { baseType: 'time', params: '3' },
    });
    expect(typeMap.resolve('date')).toEqual({
      pslType: { name: 'Date' },
      nativeType: 'date',
    });
    expect(typeMap.resolve('json')).toEqual({
      pslType: { name: 'Json' },
      nativeType: 'json',
    });
    expect(typeMap.resolve('int2')).toEqual({
      pslType: { name: 'SmallInt' },
      nativeType: 'int2',
    });
  });

  it('maps Oracle-compat private-OID types to their authoring PSL names', () => {
    expect(typeMap.resolve('clob')).toEqual({ pslType: { name: 'Clob' }, nativeType: 'clob' });
    expect(typeMap.resolve('blob')).toEqual({ pslType: { name: 'Blob' }, nativeType: 'blob' });
    expect(typeMap.resolve('raw')).toEqual({ pslType: { name: 'Raw' }, nativeType: 'raw' });
    expect(typeMap.resolve('nvarchar2')).toEqual({
      pslType: { name: 'NVarChar2' },
      nativeType: 'nvarchar2',
    });
  });

  it('keeps the length parameter on a parameterized nvarchar2', () => {
    expect(typeMap.resolve('nvarchar2(30)')).toEqual({
      pslType: { name: 'NVarChar2', args: ['30'] },
      nativeType: 'nvarchar2(30)',
      typeParams: { baseType: 'nvarchar2', params: '30' },
    });
  });

  it('returns unsupported for unknown types', () => {
    expect(typeMap.resolve('geometry')).toEqual({ unsupported: true, nativeType: 'geometry' });
    expect(typeMap.resolve('hstore')).toEqual({ unsupported: true, nativeType: 'hstore' });
    // raw is only resolvable in its bare spelling (format_type drops the
    // parameter) — a parameterized spelling must NOT accidentally resolve.
    expect(typeMap.resolve('raw(32)')).toEqual({ unsupported: true, nativeType: 'raw(32)' });
  });

  it('ignores prototype-chain property names', () => {
    expect(typeMap.resolve('constructor')).toEqual({
      unsupported: true,
      nativeType: 'constructor',
    });
    expect(typeMap.resolve('constructor(1)')).toEqual({
      unsupported: true,
      nativeType: 'constructor(1)',
    });
  });

  it('detects enum types when provided', () => {
    const enumTypes = new Set(['user_role', 'status']);
    const enumTypeMap = createGaussDbTypeMap(enumTypes);

    expect(enumTypeMap.resolve('user_role')).toEqual({
      pslType: { name: 'user_role' },
      nativeType: 'user_role',
    });
    expect(enumTypeMap.resolve('status')).toEqual({
      pslType: { name: 'status' },
      nativeType: 'status',
    });
    expect(enumTypeMap.resolve('text')).toEqual({
      pslType: { name: 'String' },
      nativeType: 'text',
    });
  });
});

describe('representation-explicit spellings stay out of introspection', () => {
  const map = createGaussDbTypeMap();

  it.each([
    ['date', 'Date'],
    ['timestamp', 'Timestamp'],
    ['timestamp without time zone', 'Timestamp'],
    ['timestamptz', 'Timestamptz'],
    ['timestamp with time zone', 'Timestamptz'],
    ['time', 'Time'],
    ['time without time zone', 'Time'],
  ])('resolves %s to the bare %s, never a *String spelling', (nativeType, pslName) => {
    expect(map.resolve(nativeType)).toMatchObject({ pslType: { name: pslName } });
  });

  it('keeps precision on the bare spelling', () => {
    expect(map.resolve('timestamptz(6)')).toMatchObject({
      pslType: { name: 'Timestamptz', args: ['6'] },
    });
  });

  it('never produces a *String name for any native type it knows', () => {
    const natives = [
      'date',
      'timestamp',
      'timestamp without time zone',
      'timestamptz',
      'timestamp with time zone',
      'time',
      'time without time zone',
      'timetz',
      'timestamptz(6)',
      'timestamp(3)',
      'time(3)',
    ];

    const produced = natives.map((nativeType) => map.resolve(nativeType));

    const stringSpellings = produced.flatMap((resolution) =>
      'pslType' in resolution && resolution.pslType.name.endsWith('String')
        ? [resolution.pslType.name]
        : [],
    );

    expect(stringSpellings).toEqual([]);
  });
});
