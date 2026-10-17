import type { CodecControlHooks, ExpandNativeTypeInput } from '@internal/family-sql/control';
import {
  buildOperation,
  type CodecExpression,
  type Expression,
  type TraitExpression,
  toExpr,
} from '@internal/sql-relational-core/expression';
import { gaussdbAggregateDescriptors } from '@internal/target-gaussdb/aggregates';
import {
  PG_BIT_CODEC_ID,
  PG_BLOB_CODEC_ID,
  PG_BOOL_CODEC_ID,
  PG_BYTEA_CODEC_ID,
  PG_CHAR_CODEC_ID,
  PG_CLOB_CODEC_ID,
  PG_DATE_STRING_CODEC_ID,
  PG_DATE_TEMPORAL_CODEC_ID,
  PG_FLOAT_CODEC_ID,
  PG_FLOAT4_CODEC_ID,
  PG_FLOAT8_CODEC_ID,
  PG_INET_CODEC_ID,
  PG_INT_CODEC_ID,
  PG_INT2_CODEC_ID,
  PG_INT4_CODEC_ID,
  PG_INT8_CODEC_ID,
  PG_INTERVAL_CODEC_ID,
  PG_JSON_CODEC_ID,
  PG_JSONB_CODEC_ID,
  PG_NUMERIC_CODEC_ID,
  PG_NVARCHAR2_CODEC_ID,
  PG_RAW_CODEC_ID,
  PG_TEXT_CODEC_ID,
  PG_TIME_STRING_CODEC_ID,
  PG_TIME_TEMPORAL_CODEC_ID,
  PG_TIMESTAMP_STRING_CODEC_ID,
  PG_TIMESTAMP_TEMPORAL_CODEC_ID,
  PG_TIMESTAMPTZ_STRING_CODEC_ID,
  PG_TIMESTAMPTZ_TEMPORAL_CODEC_ID,
  PG_TIMETZ_CODEC_ID,
  PG_UUID_CODEC_ID,
  PG_VARBIT_CODEC_ID,
  PG_VARCHAR_CODEC_ID,
  SQL_CHAR_CODEC_ID,
  SQL_FLOAT_CODEC_ID,
  SQL_INT_CODEC_ID,
  SQL_TEXT_CODEC_ID,
  SQL_VARCHAR_CODEC_ID,
} from '@internal/target-gaussdb/codec-ids';
import { gaussdbCodecRegistry } from '@internal/target-gaussdb/codecs';
import type { QueryOperationTypes } from '../types/operation-types';
import { adapterError } from './adapter-errors';

// ============================================================================ Helper functions for reducing boilerplate ============================================================================

/** Creates a type import spec for codec types */
const codecTypeImport = (named: string) =>
  ({
    package: '@internal/target-gaussdb/codec-types',
    named,
    alias: named,
  }) as const;

function isPositiveInteger(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value > 0
  );
}

function isNonNegativeInteger(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0
  );
}

function expandLength({ nativeType, typeParams }: ExpandNativeTypeInput): string {
  if (!typeParams || !('length' in typeParams)) {
    return nativeType;
  }
  const length = typeParams['length'];
  if (!isPositiveInteger(length)) {
    throw adapterError(
      'RUNTIME.TYPE_PARAMS_INVALID',
      `Invalid "length" type parameter for "${nativeType}": expected a positive integer, got ${JSON.stringify(length)}`,
      { meta: { nativeType, param: 'length', received: length } },
    );
  }
  return `${nativeType}(${length})`;
}

function expandPrecision({ nativeType, typeParams }: ExpandNativeTypeInput): string {
  if (!typeParams || !('precision' in typeParams)) {
    return nativeType;
  }
  const precision = typeParams['precision'];
  if (!isNonNegativeInteger(precision)) {
    throw adapterError(
      'RUNTIME.TYPE_PARAMS_INVALID',
      `Invalid "precision" type parameter for "${nativeType}": expected a non-negative integer, got ${JSON.stringify(precision)}`,
      { meta: { nativeType, param: 'precision', received: precision } },
    );
  }
  return `${nativeType}(${precision})`;
}

function expandNumeric({ nativeType, typeParams }: ExpandNativeTypeInput): string {
  const hasPrecision = typeParams && 'precision' in typeParams;
  const hasScale = typeParams && 'scale' in typeParams;

  if (!hasPrecision && !hasScale) {
    return nativeType;
  }

  if (!hasPrecision && hasScale) {
    throw adapterError(
      'RUNTIME.TYPE_PARAMS_INVALID',
      `Invalid type parameters for "${nativeType}": "scale" requires "precision" to be specified`,
      { meta: { nativeType, param: 'scale' } },
    );
  }

  if (hasPrecision) {
    const precision = typeParams['precision'];
    if (!isPositiveInteger(precision)) {
      throw adapterError(
        'RUNTIME.TYPE_PARAMS_INVALID',
        `Invalid "precision" type parameter for "${nativeType}": expected a positive integer, got ${JSON.stringify(precision)}`,
        { meta: { nativeType, param: 'precision', received: precision } },
      );
    }
    if (hasScale) {
      const scale = typeParams['scale'];
      if (!isNonNegativeInteger(scale)) {
        throw adapterError(
          'RUNTIME.TYPE_PARAMS_INVALID',
          `Invalid "scale" type parameter for "${nativeType}": expected a non-negative integer, got ${JSON.stringify(scale)}`,
          { meta: { nativeType, param: 'scale', received: scale } },
        );
      }
      return `${nativeType}(${precision},${scale})`;
    }
    return `${nativeType}(${precision})`;
  }

  return nativeType;
}

const lengthHooks: CodecControlHooks = { expandNativeType: expandLength };
const precisionHooks: CodecControlHooks = { expandNativeType: expandPrecision };
const numericHooks: CodecControlHooks = { expandNativeType: expandNumeric };
const identityHooks: CodecControlHooks = { expandNativeType: ({ nativeType }) => nativeType };

// ============================================================================ Descriptor metadata ============================================================================

type CodecTypesBase = Record<string, { readonly input: unknown; readonly output: unknown }>;

export function gaussdbQueryOperations<CT extends CodecTypesBase>(): QueryOperationTypes<CT> {
  return {
    ilike: {
      self: { traits: ['textual'] },
      impl: (
        self: TraitExpression<readonly ['textual'], false, CT>,
        pattern: CodecExpression<'gaussdb/text@1', false, CT>,
      ): Expression<{ codecId: 'gaussdb/bool@1'; nullable: false }> => {
        return buildOperation({
          method: 'ilike',
          args: [toExpr(self), toExpr(pattern, { codecId: PG_TEXT_CODEC_ID })],
          returns: { codecId: PG_BOOL_CODEC_ID, nullable: false },
          lowering: { targetFamily: 'sql', strategy: 'infix', template: '{{self}} ILIKE {{arg0}}' },
        });
      },
    },
  };
}

export const gaussdbAdapterDescriptorMeta = {
  kind: 'adapter',
  familyId: 'sql',
  targetId: 'gaussdb',
  id: 'gaussdb',
  version: '0.0.1',
  capabilities: {
    gaussdb: {
      orderBy: true,
      limit: true,
      returning: true,
      jsonAgg: true,
    },
    sql: {
      enums: true,
      returning: true,
      defaultInInsert: true,
      lateral: false,
      scalarList: true,
      checkConstraint: true,
      distinctOn: true,
    },
  },
  types: {
    aggregateDescriptors: gaussdbAggregateDescriptors,
    codecTypes: {
      codecDescriptors: Array.from(gaussdbCodecRegistry.values()),
      import: {
        package: '@internal/target-gaussdb/codec-types',
        named: 'CodecTypes',
        alias: 'GaussDbTypes',
      },
      typeImports: [
        {
          package: '@internal/target-gaussdb/codec-types',
          named: 'JsonValue',
          alias: 'JsonValue',
        },
        codecTypeImport('Char'),
        codecTypeImport('Varchar'),
        codecTypeImport('NVarChar2'),
        codecTypeImport('Numeric'),
        codecTypeImport('Bit'),
        codecTypeImport('VarBit'),
        codecTypeImport('Timestamp'),
        codecTypeImport('Timestamptz'),
        codecTypeImport('Time'),
        codecTypeImport('Timetz'),
        codecTypeImport('Interval'),
        codecTypeImport('TimestampString'),
        codecTypeImport('TimestamptzString'),
        codecTypeImport('TimeString'),
      ],
      controlPlaneHooks: {
        [SQL_CHAR_CODEC_ID]: lengthHooks,
        [SQL_VARCHAR_CODEC_ID]: lengthHooks,
        [PG_CHAR_CODEC_ID]: lengthHooks,
        [PG_VARCHAR_CODEC_ID]: lengthHooks,
        [PG_NUMERIC_CODEC_ID]: numericHooks,
        [PG_BIT_CODEC_ID]: lengthHooks,
        [PG_VARBIT_CODEC_ID]: lengthHooks,
        [PG_TIMESTAMP_TEMPORAL_CODEC_ID]: precisionHooks,
        [PG_TIMESTAMPTZ_TEMPORAL_CODEC_ID]: precisionHooks,
        [PG_TIME_TEMPORAL_CODEC_ID]: precisionHooks,
        [PG_TIMESTAMP_STRING_CODEC_ID]: precisionHooks,
        [PG_TIMESTAMPTZ_STRING_CODEC_ID]: precisionHooks,
        [PG_TIME_STRING_CODEC_ID]: precisionHooks,
        [PG_TIMETZ_CODEC_ID]: precisionHooks,
        [PG_INTERVAL_CODEC_ID]: precisionHooks,
        [PG_NVARCHAR2_CODEC_ID]: lengthHooks,
        [PG_RAW_CODEC_ID]: lengthHooks,
        [PG_JSON_CODEC_ID]: identityHooks,
        [PG_JSONB_CODEC_ID]: identityHooks,
        [PG_BYTEA_CODEC_ID]: identityHooks,
        [PG_CLOB_CODEC_ID]: identityHooks,
        [PG_BLOB_CODEC_ID]: identityHooks,
        [PG_UUID_CODEC_ID]: identityHooks,
        [PG_INET_CODEC_ID]: identityHooks,
      },
    },
    storage: [
      { typeId: PG_TEXT_CODEC_ID, familyId: 'sql', targetId: 'gaussdb', nativeType: 'text' },
      { typeId: SQL_TEXT_CODEC_ID, familyId: 'sql', targetId: 'gaussdb', nativeType: 'text' },
      { typeId: SQL_CHAR_CODEC_ID, familyId: 'sql', targetId: 'gaussdb', nativeType: 'character' },
      {
        typeId: SQL_VARCHAR_CODEC_ID,
        familyId: 'sql',
        targetId: 'gaussdb',
        nativeType: 'character varying',
      },
      { typeId: SQL_INT_CODEC_ID, familyId: 'sql', targetId: 'gaussdb', nativeType: 'int4' },
      { typeId: SQL_FLOAT_CODEC_ID, familyId: 'sql', targetId: 'gaussdb', nativeType: 'float8' },
      { typeId: PG_CHAR_CODEC_ID, familyId: 'sql', targetId: 'gaussdb', nativeType: 'character' },
      {
        typeId: PG_VARCHAR_CODEC_ID,
        familyId: 'sql',
        targetId: 'gaussdb',
        nativeType: 'character varying',
      },
      { typeId: PG_INT_CODEC_ID, familyId: 'sql', targetId: 'gaussdb', nativeType: 'int4' },
      { typeId: PG_FLOAT_CODEC_ID, familyId: 'sql', targetId: 'gaussdb', nativeType: 'float8' },
      { typeId: PG_INT4_CODEC_ID, familyId: 'sql', targetId: 'gaussdb', nativeType: 'int4' },
      { typeId: PG_INT2_CODEC_ID, familyId: 'sql', targetId: 'gaussdb', nativeType: 'int2' },
      { typeId: PG_INT8_CODEC_ID, familyId: 'sql', targetId: 'gaussdb', nativeType: 'int8' },
      { typeId: PG_FLOAT4_CODEC_ID, familyId: 'sql', targetId: 'gaussdb', nativeType: 'float4' },
      { typeId: PG_FLOAT8_CODEC_ID, familyId: 'sql', targetId: 'gaussdb', nativeType: 'float8' },
      { typeId: PG_NUMERIC_CODEC_ID, familyId: 'sql', targetId: 'gaussdb', nativeType: 'numeric' },
      {
        typeId: PG_DATE_TEMPORAL_CODEC_ID,
        familyId: 'sql',
        targetId: 'gaussdb',
        nativeType: 'date',
      },
      {
        typeId: PG_TIMESTAMP_TEMPORAL_CODEC_ID,
        familyId: 'sql',
        targetId: 'gaussdb',
        nativeType: 'timestamp',
      },
      {
        typeId: PG_TIMESTAMPTZ_TEMPORAL_CODEC_ID,
        familyId: 'sql',
        targetId: 'gaussdb',
        nativeType: 'timestamptz',
      },
      {
        typeId: PG_TIME_TEMPORAL_CODEC_ID,
        familyId: 'sql',
        targetId: 'gaussdb',
        nativeType: 'time',
      },
      {
        typeId: PG_DATE_STRING_CODEC_ID,
        familyId: 'sql',
        targetId: 'gaussdb',
        nativeType: 'date',
      },
      {
        typeId: PG_TIMESTAMP_STRING_CODEC_ID,
        familyId: 'sql',
        targetId: 'gaussdb',
        nativeType: 'timestamp',
      },
      {
        typeId: PG_TIMESTAMPTZ_STRING_CODEC_ID,
        familyId: 'sql',
        targetId: 'gaussdb',
        nativeType: 'timestamptz',
      },
      {
        typeId: PG_TIME_STRING_CODEC_ID,
        familyId: 'sql',
        targetId: 'gaussdb',
        nativeType: 'time',
      },
      { typeId: PG_TIMETZ_CODEC_ID, familyId: 'sql', targetId: 'gaussdb', nativeType: 'timetz' },
      { typeId: PG_BOOL_CODEC_ID, familyId: 'sql', targetId: 'gaussdb', nativeType: 'bool' },
      { typeId: PG_BIT_CODEC_ID, familyId: 'sql', targetId: 'gaussdb', nativeType: 'bit' },
      {
        typeId: PG_VARBIT_CODEC_ID,
        familyId: 'sql',
        targetId: 'gaussdb',
        nativeType: 'bit varying',
      },
      {
        typeId: PG_INTERVAL_CODEC_ID,
        familyId: 'sql',
        targetId: 'gaussdb',
        nativeType: 'interval',
      },
      { typeId: PG_JSON_CODEC_ID, familyId: 'sql', targetId: 'gaussdb', nativeType: 'json' },
      { typeId: PG_JSONB_CODEC_ID, familyId: 'sql', targetId: 'gaussdb', nativeType: 'jsonb' },
      { typeId: PG_BYTEA_CODEC_ID, familyId: 'sql', targetId: 'gaussdb', nativeType: 'bytea' },
      {
        typeId: PG_NVARCHAR2_CODEC_ID,
        familyId: 'sql',
        targetId: 'gaussdb',
        nativeType: 'nvarchar2',
      },
      { typeId: PG_CLOB_CODEC_ID, familyId: 'sql', targetId: 'gaussdb', nativeType: 'clob' },
      { typeId: PG_BLOB_CODEC_ID, familyId: 'sql', targetId: 'gaussdb', nativeType: 'blob' },
      { typeId: PG_RAW_CODEC_ID, familyId: 'sql', targetId: 'gaussdb', nativeType: 'raw' },
      { typeId: PG_UUID_CODEC_ID, familyId: 'sql', targetId: 'gaussdb', nativeType: 'uuid' },
      { typeId: PG_INET_CODEC_ID, familyId: 'sql', targetId: 'gaussdb', nativeType: 'inet' },
    ],
    queryOperationTypes: {
      import: {
        package: '@internal/adapter-gaussdb/operation-types',
        named: 'QueryOperationTypes',
        alias: 'GaussDbAdapterQueryOps',
      },
    },
  },
} as const;
