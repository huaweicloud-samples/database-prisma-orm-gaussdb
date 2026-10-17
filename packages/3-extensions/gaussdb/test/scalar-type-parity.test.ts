import gaussdbAdapter from '@internal/adapter-gaussdb/control';
import gaussdbDriver from '@internal/driver-gaussdb/control';
import sql from '@internal/family-sql/control';
import {
  collectScalarTypeConstructors,
  type ScalarTypeConstructorOutput,
} from '@internal/framework-components/authoring';
import { createControlStack } from '@internal/framework-components/control';
import { buildSymbolTable } from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import { interpretPslDocumentToSqlContract } from '@internal/sql-contract-psl';
import gaussdb from '@internal/target-gaussdb/control';
import gaussdbPackRef from '@internal/target-gaussdb/pack';
import { gaussdbCreateNamespace } from '@internal/target-gaussdb/types';
import { describe, expect, it } from 'vitest';

const stack = createControlStack({
  family: sql,
  target: gaussdb,
  adapter: gaussdbAdapter,
  driver: gaussdbDriver,
});

const REPRESENTATIVE_SCHEMA = `model sample {
  id        Int      @id
  name      String
  active    Boolean
  big       BigInt
  bounded   BigIntNumber
  unbounded UnboundedInt
  ratio     Float
  price     Decimal
  createdAt DateTime
  payload   Json
  document  Jsonb
  raw       Bytes
}
`;

function emit(scalarColumnDescriptors: ReadonlyMap<string, ScalarTypeConstructorOutput>) {
  const { document, sourceFile } = parse(REPRESENTATIVE_SCHEMA);
  const { table: symbolTable } = buildSymbolTable({
    document,
    sourceFile,
    pslBlockDescriptors: stack.authoringContributions.pslBlockDescriptors,
  });
  return interpretPslDocumentToSqlContract({
    symbolTable,
    sourceFile,
    sourceId: 'schema.prisma',
    target: gaussdbPackRef,
    scalarColumnDescriptors,
    authoringContributions: stack.authoringContributions,
    controlMutationDefaults: stack.controlMutationDefaults,
    composedExtensionContracts: new Map(),
    createNamespace: gaussdbCreateNamespace,
    codecLookup: stack.codecLookup,
    capabilities: stack.capabilities,
  });
}

describe('gaussdb scalar types derived from the unified namespace', () => {
  it('pins every bare-eligible scalar to its zero-arg instantiation', () => {
    const derived = collectScalarTypeConstructors(stack.authoringContributions.type);

    expect(Object.fromEntries(derived)).toEqual({
      String: { codecId: 'gaussdb/text@1', nativeType: 'text' },
      Boolean: { codecId: 'gaussdb/bool@1', nativeType: 'bool' },
      Int: { codecId: 'gaussdb/int4@1', nativeType: 'int4' },
      BigInt: { codecId: 'gaussdb/int8@1', nativeType: 'int8' },
      BigIntNumber: { codecId: 'gaussdb/int8number@1', nativeType: 'int8' },
      UnboundedInt: { codecId: 'gaussdb/unboundedint@1', nativeType: 'numeric' },
      Float: { codecId: 'gaussdb/float8@1', nativeType: 'float8' },
      Inet: { codecId: 'gaussdb/inet@1', nativeType: 'inet' },
      Decimal: { codecId: 'gaussdb/numeric@1', nativeType: 'numeric' },
      DateTime: { codecId: 'gaussdb/timestamptz-temporal@1', nativeType: 'timestamptz' },
      Json: { codecId: 'gaussdb/json@1', nativeType: 'json' },
      Jsonb: { codecId: 'gaussdb/jsonb@1', nativeType: 'jsonb' },
      Bytes: { codecId: 'gaussdb/bytea@1', nativeType: 'bytea' },
      Blob: { codecId: 'gaussdb/blob@1', nativeType: 'blob' },
      Clob: { codecId: 'gaussdb/clob@1', nativeType: 'clob' },
      Raw: { codecId: 'gaussdb/raw@1', nativeType: 'raw' },
      Number: { codecId: 'gaussdb/numeric@1', nativeType: 'number' },
      VarChar: { codecId: 'sql/varchar@1', nativeType: 'character varying' },
      VarChar2: { codecId: 'sql/varchar@1', nativeType: 'varchar2' },
      Char: { codecId: 'sql/char@1', nativeType: 'character' },
      NVarChar2: { codecId: 'gaussdb/nvarchar2@1', nativeType: 'nvarchar2' },
      Numeric: { codecId: 'gaussdb/numeric@1', nativeType: 'numeric' },
      Timestamp: { codecId: 'gaussdb/timestamp-temporal@1', nativeType: 'timestamp' },
      Timestamptz: { codecId: 'gaussdb/timestamptz-temporal@1', nativeType: 'timestamptz' },
      Time: { codecId: 'gaussdb/time-temporal@1', nativeType: 'time' },
      Timetz: { codecId: 'gaussdb/timetz@1', nativeType: 'timetz' },
      Uuid: { codecId: 'gaussdb/uuid@1', nativeType: 'uuid' },
      SmallInt: { codecId: 'gaussdb/int2@1', nativeType: 'int2' },
      Real: { codecId: 'gaussdb/float4@1', nativeType: 'float4' },
      Date: { codecId: 'gaussdb/date-temporal@1', nativeType: 'date' },
      DateString: { codecId: 'gaussdb/date-string@1', nativeType: 'date' },
      TimestampString: { codecId: 'gaussdb/timestamp-string@1', nativeType: 'timestamp' },
      TimestamptzString: { codecId: 'gaussdb/timestamptz-string@1', nativeType: 'timestamptz' },
      TimeString: { codecId: 'gaussdb/time-string@1', nativeType: 'time' },
    });
  });

  it('exposes the derived scalar names as controlStack.scalarTypes', () => {
    expect([...stack.scalarTypes].sort()).toEqual([
      'BigInt',
      'BigIntNumber',
      'Blob',
      'Boolean',
      'Bytes',
      'Char',
      'Clob',
      'Date',
      'DateString',
      'DateTime',
      'Decimal',
      'Float',
      'Inet',
      'Int',
      'Json',
      'Jsonb',
      'NVarChar2',
      'Number',
      'Numeric',
      'Raw',
      'Real',
      'SmallInt',
      'String',
      'Time',
      'TimeString',
      'Timestamp',
      'TimestampString',
      'Timestamptz',
      'TimestamptzString',
      'Timetz',
      'UnboundedInt',
      'Uuid',
      'VarChar',
      'VarChar2',
    ]);
  });

  it('emits a contract whose columns pin the namespace-derived {codecId, nativeType}', () => {
    const result = emit(collectScalarTypeConstructors(stack.authoringContributions.type));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      storage: {
        namespaces: {
          public: {
            entries: {
              table: {
                sample: {
                  columns: {
                    id: { codecId: 'gaussdb/int4@1', nativeType: 'int4' },
                    name: { codecId: 'gaussdb/text@1', nativeType: 'text' },
                    active: { codecId: 'gaussdb/bool@1', nativeType: 'bool' },
                    big: { codecId: 'gaussdb/int8@1', nativeType: 'int8' },
                    bounded: { codecId: 'gaussdb/int8number@1', nativeType: 'int8' },
                    unbounded: { codecId: 'gaussdb/unboundedint@1', nativeType: 'numeric' },
                    ratio: { codecId: 'gaussdb/float8@1', nativeType: 'float8' },
                    price: { codecId: 'gaussdb/numeric@1', nativeType: 'numeric' },
                    createdAt: {
                      codecId: 'gaussdb/timestamptz-temporal@1',
                      nativeType: 'timestamptz',
                    },
                    payload: { codecId: 'gaussdb/json@1', nativeType: 'json' },
                    document: { codecId: 'gaussdb/jsonb@1', nativeType: 'jsonb' },
                    raw: { codecId: 'gaussdb/bytea@1', nativeType: 'bytea' },
                  },
                },
              },
            },
          },
        },
      },
    });
  });
});
