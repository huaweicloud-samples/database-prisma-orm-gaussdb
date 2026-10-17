import { ColumnRef } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { codecDescriptors } from '../src/core/codecs';

const DDL_TYPES: Readonly<Record<string, string>> = {
  'sql/char@1': 'character',
  'sql/varchar@1': 'character varying',
  'sql/int@1': 'int4',
  'sql/float@1': 'float8',
  'sql/text@1': 'text',
  'gaussdb/text@1': 'text',
  'gaussdb/char@1': 'character',
  'gaussdb/varchar@1': 'character varying',
  'gaussdb/int@1': 'integer',
  'gaussdb/float@1': 'double precision',
  'gaussdb/int4@1': 'integer',
  'gaussdb/int2@1': 'smallint',
  'gaussdb/int8@1': 'bigint',
  'gaussdb/int8number@1': 'bigint',
  'gaussdb/float4@1': 'real',
  'gaussdb/float8@1': 'double precision',
  'gaussdb/numeric@1': 'numeric',
  'gaussdb/unboundedint@1': 'numeric',
  'gaussdb/date-temporal@1': 'date',
  'gaussdb/timestamp-temporal@1': 'timestamp without time zone',
  'gaussdb/timestamptz-temporal@1': 'timestamp with time zone',
  'gaussdb/time-temporal@1': 'time',
  'gaussdb/date-string@1': 'date',
  'gaussdb/timestamp-string@1': 'timestamp without time zone',
  'gaussdb/timestamptz-string@1': 'timestamp with time zone',
  'gaussdb/time-string@1': 'time',
  'gaussdb/timetz@1': 'timetz',
  'gaussdb/bool@1': 'boolean',
  'gaussdb/bit@1': 'bit',
  'gaussdb/varbit@1': 'bit varying',
  'gaussdb/bytea@1': 'bytea',
  'gaussdb/uuid@1': 'uuid',
  'gaussdb/inet@1': 'inet',
  'gaussdb/interval@1': 'interval',
  'gaussdb/json@1': 'json',
  'gaussdb/jsonb@1': 'jsonb',
  'gaussdb/text-array@1': 'text[]',
  'gaussdb/nvarchar2@1': 'nvarchar2',
  'gaussdb/clob@1': 'clob',
  'gaussdb/blob@1': 'blob',
  'gaussdb/raw@1': 'raw',
};

const NEEDS_PARAMS = new Set(['gaussdb/enum@1']);

const parameterless = codecDescriptors.filter((d) => !NEEDS_PARAMS.has(d.codecId));
const source = ColumnRef.of('t', 'c');

describe('every shipped codec declares a GaussDB type', () => {
  it('the table covers exactly the parameterless codecs this package ships', () => {
    expect(parameterless.map((d) => d.codecId).sort()).toEqual(Object.keys(DDL_TYPES).sort());
  });

  it('ships no duplicate codec id', () => {
    const ids = codecDescriptors.map((d) => d.codecId);
    expect(ids).toHaveLength(new Set(ids).size);
  });

  it.each(parameterless.map((d) => [d.codecId, d] as const))('%s renders its type', (id, d) => {
    expect(d.nativeTypeFor({ codecId: id })).toBe(DDL_TYPES[id]);
  });
});

describe('every shipped codec projects a scalar read and lifts an array read', () => {
  it.each(parameterless.map((d) => [d.codecId, d] as const))('%s', (id, d) => {
    const scalar = d.projectJson(source, { codecId: id });
    const lifted = d.projectJson(source, { codecId: id, many: true });

    expect(scalar).toBeDefined();
    expect(lifted).not.toBe(scalar);
  });

  it('passes an identity-projected column through untouched', () => {
    const text = codecDescriptors.find((d) => d.codecId === 'gaussdb/text@1');
    expect(text?.projectJson(source, { codecId: 'gaussdb/text@1' })).toBe(source);
  });

  it('rewrites a column whose wire form JSON cannot carry', () => {
    const bytea = codecDescriptors.find((d) => d.codecId === 'gaussdb/bytea@1');
    expect(bytea?.projectJson(source, { codecId: 'gaussdb/bytea@1' })).not.toBe(source);
  });
});
