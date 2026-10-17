import type { PslTypeMap, PslTypeResolution } from '@internal/family-sql/psl-infer';

const GAUSSDB_TO_PSL: Record<string, string> = {
  text: 'String',
  bool: 'Boolean',
  boolean: 'Boolean',
  int4: 'Int',
  integer: 'Int',
  int8: 'BigInt',
  bigint: 'BigInt',
  float8: 'Float',
  'double precision': 'Float',
  jsonb: 'Jsonb',
  bytea: 'Bytes',
};

const PRESERVED_NATIVE_TYPES: Record<string, string> = {
  'character varying': 'VarChar',
  character: 'Char',
  char: 'Char',
  varchar: 'VarChar',
  uuid: 'Uuid',
  inet: 'Inet',
  int2: 'SmallInt',
  smallint: 'SmallInt',
  float4: 'Real',
  real: 'Real',
  numeric: 'Numeric',
  decimal: 'Numeric',
  timestamp: 'Timestamp',
  'timestamp without time zone': 'Timestamp',
  timestamptz: 'Timestamptz',
  'timestamp with time zone': 'Timestamptz',
  date: 'Date',
  time: 'Time',
  'time without time zone': 'Time',
  timetz: 'Timetz',
  'time with time zone': 'Timetz',
  json: 'Json',
  // Oracle-compat private-OID types (A-compat instances). `number` and
  // `varchar2` need no entries — GaussDB stores them under the `numeric` /
  // `character varying` catalog aliases, which the entries above already
  // cover (the probe-verified DDL-name loss is a documented boundary). The
  // private-OID types introspect under their own names; `raw`'s length
  // parameter does not survive `format_type`, so only the bare spelling
  // resolves.
  clob: 'Clob',
  blob: 'Blob',
  raw: 'Raw',
  nvarchar2: 'NVarChar2',
};

const PARAMETERIZED_NATIVE_TYPES: Record<string, string> = {
  'character varying': 'VarChar',
  character: 'Char',
  char: 'Char',
  varchar: 'VarChar',
  numeric: 'Numeric',
  decimal: 'Numeric',
  timestamp: 'Timestamp',
  timestamptz: 'Timestamptz',
  time: 'Time',
  timetz: 'Timetz',
  nvarchar2: 'NVarChar2',
};

const PARAMETERIZED_TYPE_PATTERN = /^(.+?)\((.+)\)$/;

function getOwnMappingValue(map: Record<string, string>, key: string): string | undefined {
  return Object.hasOwn(map, key) ? map[key] : undefined;
}

function splitTypeParameterList(params: string): readonly string[] {
  return params
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function createGaussDbTypeMap(enumTypeNames?: ReadonlySet<string>): PslTypeMap {
  return {
    resolve(nativeType: string): PslTypeResolution {
      if (enumTypeNames?.has(nativeType)) {
        return { pslType: { name: nativeType }, nativeType };
      }

      const paramMatch = nativeType.match(PARAMETERIZED_TYPE_PATTERN);
      if (paramMatch) {
        const [, baseType = nativeType, params = ''] = paramMatch;
        const typeName = getOwnMappingValue(PARAMETERIZED_NATIVE_TYPES, baseType);
        if (typeName) {
          return {
            pslType: { name: typeName, args: splitTypeParameterList(params) },
            nativeType,
            typeParams: { baseType, params },
          };
        }
      }

      const preservedType = getOwnMappingValue(PRESERVED_NATIVE_TYPES, nativeType);
      if (preservedType) {
        return {
          pslType: { name: preservedType },
          nativeType,
        };
      }

      const pslType = getOwnMappingValue(GAUSSDB_TO_PSL, nativeType);
      if (pslType) {
        return {
          pslType: { name: pslType },
          nativeType,
        };
      }

      return { unsupported: true, nativeType };
    },
  };
}
