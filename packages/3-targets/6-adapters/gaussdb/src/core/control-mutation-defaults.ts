import type { ExecutionMutationDefaultValue } from '@internal/contract/types';
import { timestampNowControlDescriptor } from '@internal/family-sql/control';
import type { AuthoringTypeNamespace } from '@internal/framework-components/authoring';
import type {
  ControlMutationDefaultEntry,
  DefaultFunctionLoweringContext,
  LoweredDefaultResult,
  MutationDefaultGeneratorDescriptor,
  TypedDefaultFunctionCall,
} from '@internal/framework-components/control';
import { builtinGeneratorRegistryMetadata } from '@internal/ids';
import type { FuncCallSig } from '@internal/psl-parser';
import { int, num, oneOf, optional, str } from '@internal/psl-parser';
import { instantNowControlDescriptor } from '@internal/target-gaussdb/control';

function invalidArgumentDiagnostic(input: {
  readonly context: DefaultFunctionLoweringContext;
  readonly span: TypedDefaultFunctionCall['span'];
  readonly message: string;
}): LoweredDefaultResult {
  return {
    ok: false,
    diagnostic: {
      code: 'PSL_INVALID_DEFAULT_FUNCTION_ARGUMENT',
      message: input.message,
      sourceId: input.context.sourceId,
      span: input.span,
    },
  };
}

function executionGenerator(
  id: ExecutionMutationDefaultValue['id'],
  params?: Record<string, unknown>,
): LoweredDefaultResult {
  return {
    ok: true,
    value: {
      kind: 'execution',
      generated: {
        kind: 'generator',
        id,
        ...(params ? { params } : {}),
      },
    },
  };
}

function lowerAutoincrement(): LoweredDefaultResult {
  return {
    ok: true,
    value: {
      kind: 'storage',
      defaultValue: { kind: 'function', expression: 'autoincrement()' },
    },
  };
}

function lowerNow(): LoweredDefaultResult {
  return {
    ok: true,
    value: {
      kind: 'storage',
      defaultValue: { kind: 'function', expression: 'now()' },
    },
  };
}

function lowerUlid(): LoweredDefaultResult {
  return executionGenerator('ulid');
}

function lowerUuid(input: {
  readonly call: TypedDefaultFunctionCall;
  readonly context: DefaultFunctionLoweringContext;
}): LoweredDefaultResult {
  return input.call.args['version'] === 7
    ? executionGenerator('uuidv7')
    : executionGenerator('uuidv4');
}

function lowerCuid(): LoweredDefaultResult {
  return executionGenerator('cuid2');
}

function lowerNanoid(input: {
  readonly call: TypedDefaultFunctionCall;
  readonly context: DefaultFunctionLoweringContext;
}): LoweredDefaultResult {
  const size = input.call.args['size'];
  return typeof size === 'number'
    ? executionGenerator('nanoid', { size })
    : executionGenerator('nanoid');
}

function lowerDbgenerated(input: {
  readonly call: TypedDefaultFunctionCall;
  readonly context: DefaultFunctionLoweringContext;
}): LoweredDefaultResult {
  const expression = input.call.args['expression'];
  if (typeof expression !== 'string' || expression.trim().length === 0) {
    return invalidArgumentDiagnostic({
      context: input.context,
      span: input.call.span,
      message: 'Default function "dbgenerated" argument cannot be empty.',
    });
  }
  return {
    ok: true,
    value: {
      kind: 'storage',
      defaultValue: { kind: 'function', expression },
    },
  };
}

const nowSig: FuncCallSig = {};
const autoincrementSig: FuncCallSig = {};
const ulidSig: FuncCallSig = {};
const uuidSig: FuncCallSig = {
  positional: [{ key: 'version', type: optional(oneOf(num(4), num(7))) }],
};
const cuidSig: FuncCallSig = { positional: [{ key: 'version', type: num(2) }] };
const nanoidSig: FuncCallSig = {
  positional: [{ key: 'size', type: optional(int({ min: 2, max: 255 })) }],
};
const dbgeneratedSig: FuncCallSig = { positional: [{ key: 'expression', type: str() }] };

const gaussdbDefaultFunctionRegistryEntries = [
  [
    'autoincrement',
    {
      signature: autoincrementSig,
      lower: lowerAutoincrement,
      usageSignatures: ['autoincrement()'],
    },
  ],
  ['now', { signature: nowSig, lower: lowerNow, usageSignatures: ['now()'] }],
  [
    'uuid',
    { signature: uuidSig, lower: lowerUuid, usageSignatures: ['uuid()', 'uuid(4)', 'uuid(7)'] },
  ],
  ['cuid', { signature: cuidSig, lower: lowerCuid, usageSignatures: ['cuid(2)'] }],
  ['ulid', { signature: ulidSig, lower: lowerUlid, usageSignatures: ['ulid()'] }],
  [
    'nanoid',
    { signature: nanoidSig, lower: lowerNanoid, usageSignatures: ['nanoid()', 'nanoid(<2-255>)'] },
  ],
  [
    'dbgenerated',
    { signature: dbgeneratedSig, lower: lowerDbgenerated, usageSignatures: ['dbgenerated("...")'] },
  ],
] satisfies ReadonlyArray<readonly [string, ControlMutationDefaultEntry]>;

/**
 * The base PSL scalars as zero-arg type constructors in the unified authoring
 * channel, with explicit `nativeType` values pinned to the codec manifests
 * (`codecLookup.targetTypesFor(codecId)[0]`).
 *
 * The type position is the only storage decider: a mutation-default generator
 * (`@default(uuid())`) never re-picks a column's storage.
 */
export const gaussdbScalarAuthoringTypes = {
  String: {
    kind: 'typeConstructor',
    output: { codecId: 'gaussdb/text@1', nativeType: 'text' },
  },
  Boolean: {
    kind: 'typeConstructor',
    output: { codecId: 'gaussdb/bool@1', nativeType: 'bool' },
  },
  Int: {
    kind: 'typeConstructor',
    output: { codecId: 'gaussdb/int4@1', nativeType: 'int4' },
  },
  BigInt: {
    kind: 'typeConstructor',
    output: { codecId: 'gaussdb/int8@1', nativeType: 'int8' },
  },
  Float: {
    kind: 'typeConstructor',
    output: { codecId: 'gaussdb/float8@1', nativeType: 'float8' },
  },
  Decimal: {
    kind: 'typeConstructor',
    output: { codecId: 'gaussdb/numeric@1', nativeType: 'numeric' },
  },
  DateTime: {
    kind: 'typeConstructor',
    output: { codecId: 'gaussdb/timestamptz-temporal@1', nativeType: 'timestamptz' },
  },
  Json: {
    kind: 'typeConstructor',
    output: { codecId: 'gaussdb/json@1', nativeType: 'json' },
  },
  Jsonb: {
    kind: 'typeConstructor',
    output: { codecId: 'gaussdb/jsonb@1', nativeType: 'jsonb' },
  },
  Bytes: {
    kind: 'typeConstructor',
    output: { codecId: 'gaussdb/bytea@1', nativeType: 'bytea' },
  },
} as const satisfies AuthoringTypeNamespace;

export const gaussdbNativeAuthoringTypes = {
  VarChar: {
    kind: 'typeConstructor',
    args: [{ kind: 'number', name: 'length', integer: true, minimum: 1, optional: true }],
    output: {
      codecId: 'sql/varchar@1',
      nativeType: 'character varying',
      typeParams: { length: { kind: 'arg', index: 0 } },
    },
  },
  Char: {
    kind: 'typeConstructor',
    args: [{ kind: 'number', name: 'length', integer: true, minimum: 1, optional: true }],
    output: {
      codecId: 'sql/char@1',
      nativeType: 'character',
      typeParams: { length: { kind: 'arg', index: 0 } },
    },
  },
  Numeric: {
    kind: 'typeConstructor',
    args: [
      { kind: 'number', name: 'precision', integer: true, minimum: 1, optional: true },
      { kind: 'number', name: 'scale', integer: true, minimum: 0, optional: true },
    ],
    output: {
      codecId: 'gaussdb/numeric@1',
      nativeType: 'numeric',
      typeParams: {
        precision: { kind: 'arg', index: 0 },
        scale: { kind: 'arg', index: 1 },
      },
    },
  },
  Timestamp: {
    kind: 'typeConstructor',
    args: [{ kind: 'number', name: 'precision', integer: true, minimum: 0, optional: true }],
    output: {
      codecId: 'gaussdb/timestamp-temporal@1',
      nativeType: 'timestamp',
      typeParams: { precision: { kind: 'arg', index: 0 } },
    },
  },
  Timestamptz: {
    kind: 'typeConstructor',
    args: [{ kind: 'number', name: 'precision', integer: true, minimum: 0, optional: true }],
    output: {
      codecId: 'gaussdb/timestamptz-temporal@1',
      nativeType: 'timestamptz',
      typeParams: { precision: { kind: 'arg', index: 0 } },
    },
  },
  Time: {
    kind: 'typeConstructor',
    args: [{ kind: 'number', name: 'precision', integer: true, minimum: 0, optional: true }],
    output: {
      codecId: 'gaussdb/time-temporal@1',
      nativeType: 'time',
      typeParams: { precision: { kind: 'arg', index: 0 } },
    },
  },
  Timetz: {
    kind: 'typeConstructor',
    args: [{ kind: 'number', name: 'precision', integer: true, minimum: 0, optional: true }],
    output: {
      codecId: 'gaussdb/timetz@1',
      nativeType: 'timetz',
      typeParams: { precision: { kind: 'arg', index: 0 } },
    },
  },
  Uuid: { kind: 'typeConstructor', output: { codecId: 'gaussdb/uuid@1', nativeType: 'uuid' } },
  Inet: { kind: 'typeConstructor', output: { codecId: 'gaussdb/inet@1', nativeType: 'inet' } },
  SmallInt: { kind: 'typeConstructor', output: { codecId: 'gaussdb/int2@1', nativeType: 'int2' } },
  Real: { kind: 'typeConstructor', output: { codecId: 'gaussdb/float4@1', nativeType: 'float4' } },
  Date: {
    kind: 'typeConstructor',
    output: { codecId: 'gaussdb/date-temporal@1', nativeType: 'date' },
  },
  // The representation-explicit spellings. Same columns, same precision, same native types — the
  // only difference is that a read hands back GaussDB's own text instead of a `Temporal.*`, so a
  // value Temporal cannot express still round-trips. Authoring-only: they claim no introspection
  // mapping, because a bare `timestamptz` column introspects to the Temporal-backed name.
  DateString: {
    kind: 'typeConstructor',
    output: { codecId: 'gaussdb/date-string@1', nativeType: 'date' },
  },
  TimestampString: {
    kind: 'typeConstructor',
    args: [{ kind: 'number', name: 'precision', integer: true, minimum: 0, optional: true }],
    output: {
      codecId: 'gaussdb/timestamp-string@1',
      nativeType: 'timestamp',
      typeParams: { precision: { kind: 'arg', index: 0 } },
    },
  },
  TimestamptzString: {
    kind: 'typeConstructor',
    args: [{ kind: 'number', name: 'precision', integer: true, minimum: 0, optional: true }],
    output: {
      codecId: 'gaussdb/timestamptz-string@1',
      nativeType: 'timestamptz',
      typeParams: { precision: { kind: 'arg', index: 0 } },
    },
  },
  TimeString: {
    kind: 'typeConstructor',
    args: [{ kind: 'number', name: 'precision', integer: true, minimum: 0, optional: true }],
    output: {
      codecId: 'gaussdb/time-string@1',
      nativeType: 'time',
      typeParams: { precision: { kind: 'arg', index: 0 } },
    },
  },
  // Oracle-compat types (A-compat instances). `number` and `varchar2` ride
  // the existing numeric/varchar wire channels (same OIDs, probe-verified
  // 39-digit fidelity and plain string binding); the private-OID types
  // (`nvarchar2`, `clob`, `blob`, `raw`) carry their own codecs. Oracle's
  // `date` is deliberately absent — its wire OID collides with `timestamp`
  // while rejecting ISO input, so contracts are steered to `Timestamp`.
  Number: {
    kind: 'typeConstructor',
    args: [
      { kind: 'number', name: 'precision', integer: true, minimum: 1, optional: true },
      { kind: 'number', name: 'scale', integer: true, minimum: 0, optional: true },
    ],
    output: {
      codecId: 'gaussdb/numeric@1',
      nativeType: 'number',
      typeParams: {
        precision: { kind: 'arg', index: 0 },
        scale: { kind: 'arg', index: 1 },
      },
    },
  },
  // Byte semantics: the length counts UTF-8 bytes (a Chinese character is 3),
  // unlike `nvarchar2` (characters) and unlike PostgreSQL `varchar`.
  VarChar2: {
    kind: 'typeConstructor',
    args: [{ kind: 'number', name: 'length', integer: true, minimum: 1, optional: true }],
    output: {
      codecId: 'sql/varchar@1',
      nativeType: 'varchar2',
      typeParams: { length: { kind: 'arg', index: 0 } },
    },
  },
  NVarChar2: {
    kind: 'typeConstructor',
    args: [{ kind: 'number', name: 'length', integer: true, minimum: 1, optional: true }],
    output: {
      codecId: 'gaussdb/nvarchar2@1',
      nativeType: 'nvarchar2',
      typeParams: { length: { kind: 'arg', index: 0 } },
    },
  },
  Clob: {
    kind: 'typeConstructor',
    output: { codecId: 'gaussdb/clob@1', nativeType: 'clob' },
  },
  Blob: {
    kind: 'typeConstructor',
    output: { codecId: 'gaussdb/blob@1', nativeType: 'blob' },
  },
  Raw: {
    kind: 'typeConstructor',
    args: [{ kind: 'number', name: 'length', integer: true, minimum: 1, optional: true }],
    output: {
      codecId: 'gaussdb/raw@1',
      nativeType: 'raw',
      typeParams: { length: { kind: 'arg', index: 0 } },
    },
  },
} as const satisfies AuthoringTypeNamespace;

export const gaussdbAuthoringTypes = {
  ...gaussdbScalarAuthoringTypes,
  ...gaussdbNativeAuthoringTypes,
} as const satisfies AuthoringTypeNamespace;

export function createGaussDbDefaultFunctionRegistry(): ReadonlyMap<
  string,
  ControlMutationDefaultEntry
> {
  return new Map(gaussdbDefaultFunctionRegistryEntries);
}

export function createGaussDbMutationDefaultGeneratorDescriptors(): readonly MutationDefaultGeneratorDescriptor[] {
  return [
    // The framework's builtin generator metadata keys its applicability set by
    // the pg/* codec-id family; the same codecs ship from this target's registry
    // as gaussdb/*@1, so the set is mapped family-side to keep `@default(uuid())`
    // and friends diagnosing GaussDB String columns correctly.
    ...builtinGeneratorRegistryMetadata.map(
      ({ id, applicableCodecIds }): MutationDefaultGeneratorDescriptor => ({
        id,
        applicableCodecIds: applicableCodecIds.map((codecId) =>
          codecId.replace(/^pg\//, 'gaussdb/'),
        ),
      }),
    ),
    timestampNowControlDescriptor(),
    instantNowControlDescriptor(),
  ];
}
