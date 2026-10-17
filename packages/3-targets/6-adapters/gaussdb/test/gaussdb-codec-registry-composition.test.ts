import type { JsonValue } from '@internal/contract/types';
import type { AnyCodecDescriptor } from '@internal/framework-components/codec';
import { voidParamsSchema } from '@internal/framework-components/codec';
import type { ControlExtensionDescriptor } from '@internal/framework-components/control';
import type { RuntimeExtensionDescriptor } from '@internal/framework-components/execution';
import {
  BinaryExpr,
  CodecJsonValueProjection,
  ColumnRef,
  JsonArrayAggExpr,
  JsonObjectExpr,
  ParamRef,
  type ProjectionExpr,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@internal/sql-relational-core/ast';
import {
  type AnyGaussDbCodecDescriptor,
  gaussdbCodec,
} from '@internal/target-gaussdb/codec-descriptor';
import { gaussdbCodecDescriptorRegistry } from '@internal/target-gaussdb/codecs';
import gaussdbTargetControlDescriptor from '@internal/target-gaussdb/control';
import gaussdbRuntimeTargetDescriptor from '@internal/target-gaussdb/runtime';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { TestSqlContractSerializer as SqlContractSerializer } from '../../../../2-sql/9-family/test/test-sql-contract-serializer';
import { createGaussDbAdapter } from '../src/core/adapter';
import { assembleGaussDbCodecRegistry } from '../src/core/codec-lookup';
import type { GaussDbContract } from '../src/core/types';
import gaussdbAdapterControlDescriptor, {
  createGaussDbCodecRegistryWithBuiltins,
  GaussDbControlAdapter,
} from '../src/exports/control';
import gaussdbRuntimeAdapterDescriptor from '../src/exports/runtime';
import {
  createComposedGaussDbAdapter,
  createComposedGaussDbControlAdapter,
} from './helpers/composed-adapter';
import { defineTestCodec } from './test-codec';

const contract = new SqlContractSerializer().deserializeContract({
  target: 'gaussdb',
  targetFamily: 'sql',
  profileHash: 'sha256:gaussdb-codec-registry-composition',
  roots: {},
  capabilities: {},
  extensions: {},
  meta: {},
  storage: {
    storageHash: 'sha256:gaussdb-codec-registry-composition',
    namespaces: {
      __unbound__: {
        id: '__unbound__',
        entries: {
          table: {
            records: {
              columns: {
                id: { codecId: 'gaussdb/int4@1', nativeType: 'int4', nullable: false },
                document: { codecId: 'arktype/json@1', nativeType: 'jsonb', nullable: false },
                embedding: { codecId: 'gaussdb/vector@1', nativeType: 'vector', nullable: false },
                location: {
                  codecId: 'gaussdb/geometry@1',
                  nativeType: 'geometry',
                  nullable: false,
                },
              },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
      },
    },
  },
  domain: applicationDomainOf({ models: {} }),
}) as GaussDbContract;

function genericDescriptor(codecId: string): AnyCodecDescriptor {
  const codec = defineTestCodec({
    typeId: codecId,
    encode: (value: JsonValue): JsonValue => value,
    decode: (wire: JsonValue): JsonValue => wire,
  });
  return {
    codecId,
    traits: ['equality'],
    targetTypes: [],
    paramsSchema: voidParamsSchema,
    isParameterized: false,
    factory: () => () => codec,
  };
}

function gaussdbDescriptor(
  codecId: string,
  nativeType: string,
  onProjection?: () => void,
): AnyGaussDbCodecDescriptor {
  return gaussdbCodec(genericDescriptor(codecId), {
    nativeType: () => nativeType,
    jsonProjection(expression: ProjectionExpr): ProjectionExpr {
      onProjection?.();
      return expression;
    },
  });
}

function transformingGaussDbDescriptor(
  codecId: string,
  nativeType: string,
  onMaterialize?: () => void,
): AnyGaussDbCodecDescriptor {
  const codec = defineTestCodec({
    typeId: codecId,
    encode: (value: string): string => `encoded:${value}`,
    decode: (wire: string): string => wire,
  });
  const descriptor: AnyCodecDescriptor = {
    codecId,
    traits: ['equality'],
    targetTypes: [nativeType],
    paramsSchema: voidParamsSchema,
    isParameterized: false,
    factory: () => () => {
      onMaterialize?.();
      return codec;
    },
  };
  return gaussdbCodec(descriptor, {
    nativeType: () => nativeType,
    jsonProjection: (expression: ProjectionExpr) => expression,
  });
}

function runtimeExtension(
  id: string,
  descriptors: readonly AnyCodecDescriptor[],
): RuntimeExtensionDescriptor<'sql', 'gaussdb'> {
  return {
    kind: 'extension',
    id,
    version: '0.0.1',
    familyId: 'sql',
    targetId: 'gaussdb',
    types: { codecTypes: { codecDescriptors: descriptors } },
    create() {
      return { familyId: 'sql', targetId: 'gaussdb' };
    },
  };
}

function controlExtension(
  id: string,
  descriptors: readonly AnyCodecDescriptor[],
): ControlExtensionDescriptor<'sql', 'gaussdb'> {
  return {
    kind: 'extension',
    id,
    version: '0.0.1',
    familyId: 'sql',
    targetId: 'gaussdb',
    types: { codecTypes: { codecDescriptors: descriptors } },
    create() {
      return { familyId: 'sql', targetId: 'gaussdb' };
    },
  };
}

function selectWithParam(column: string, codecId: string, value: unknown) {
  return SelectAst.from(TableSource.named('records'))
    .withProjection([ProjectionItem.of('id', ColumnRef.of('records', 'id'))])
    .withWhere(
      BinaryExpr.eq(
        ColumnRef.of('records', column),
        ParamRef.of(value, { name: column, codec: { codecId } }),
      ),
    );
}

describe('GaussDB adapter codec registry composition', () => {
  it('assembles the same immutable ordered target registry for runtime and control components', () => {
    const arktypeJson = gaussdbDescriptor('arktype/json@1', 'jsonb');
    const pgvector = gaussdbDescriptor('gaussdb/vector@1', 'vector');
    const postgis = gaussdbDescriptor('gaussdb/geometry@1', 'geometry');
    const runtimeExtensions = [
      runtimeExtension('arktype-json', [arktypeJson]),
      runtimeExtension('pgvector', [pgvector]),
      runtimeExtension('postgis', [postgis]),
    ];
    const controlExtensions = [
      controlExtension('arktype-json', [arktypeJson]),
      controlExtension('pgvector', [pgvector]),
      controlExtension('postgis', [postgis]),
    ];

    const runtimeRegistry = assembleGaussDbCodecRegistry([
      gaussdbRuntimeTargetDescriptor,
      gaussdbRuntimeAdapterDescriptor,
      ...runtimeExtensions,
    ]);
    const controlRegistry = assembleGaussDbCodecRegistry([
      gaussdbTargetControlDescriptor,
      gaussdbAdapterControlDescriptor,
      ...controlExtensions,
    ]);
    const expectedIds = [
      ...Array.from(gaussdbCodecDescriptorRegistry.values(), (descriptor) => descriptor.codecId),
      'arktype/json@1',
      'gaussdb/vector@1',
      'gaussdb/geometry@1',
    ];

    expect(Object.isFrozen(runtimeRegistry)).toBe(true);
    expect(Object.isFrozen(controlRegistry)).toBe(true);
    expect(Array.from(runtimeRegistry.values(), (descriptor) => descriptor.codecId)).toEqual(
      expectedIds,
    );
    expect(Array.from(controlRegistry.values(), (descriptor) => descriptor.codecId)).toEqual(
      expectedIds,
    );
  });

  it('uses all extension target descriptors in runtime and control lowering with byte-identical SQL', () => {
    const descriptors = [
      gaussdbDescriptor('arktype/json@1', 'jsonb'),
      gaussdbDescriptor('gaussdb/vector@1', 'vector'),
      gaussdbDescriptor('gaussdb/geometry@1', 'geometry'),
    ] as const;
    const runtimeAdapter = createComposedGaussDbAdapter({
      extensions: [
        runtimeExtension('arktype-json', [descriptors[0]]),
        runtimeExtension('pgvector', [descriptors[1]]),
        runtimeExtension('postgis', [descriptors[2]]),
      ],
    });
    const controlAdapter = createComposedGaussDbControlAdapter({
      extensions: [
        controlExtension('arktype-json', [descriptors[0]]),
        controlExtension('pgvector', [descriptors[1]]),
        controlExtension('postgis', [descriptors[2]]),
      ],
    });
    const cases = [
      { column: 'document', codecId: 'arktype/json@1', value: { name: 'Ada' }, cast: 'jsonb' },
      { column: 'embedding', codecId: 'gaussdb/vector@1', value: [0.1, 0.2], cast: 'vector' },
      {
        column: 'location',
        codecId: 'gaussdb/geometry@1',
        value: { type: 'Point', coordinates: [1, 2] },
        cast: 'geometry',
      },
    ];

    for (const testCase of cases) {
      const ast = selectWithParam(testCase.column, testCase.codecId, testCase.value);
      const runtime = runtimeAdapter.lower(ast, { contract });
      const control = controlAdapter.lower(ast, { contract });

      expect(runtime.sql).toContain(`$1::${testCase.cast}`);
      expect(control).toEqual(runtime);
    }
  });

  it('keeps bare construction built-ins-only', () => {
    const adapter = createGaussDbAdapter();
    const ast = selectWithParam('embedding', 'gaussdb/vector@1', [0.1, 0.2]);

    expect(() => adapter.lower(ast, { contract })).toThrow(/codecId "gaussdb\/vector@1"/);
  });

  it('derives direct runtime materialization and native-type rendering from one descriptor contribution', () => {
    let materializations = 0;
    const descriptor = transformingGaussDbDescriptor('app/direct-runtime@1', 'citext', () => {
      materializations += 1;
    });
    const adapter = createGaussDbAdapter({ codecDescriptors: [descriptor] });
    const ast = selectWithParam('document', descriptor.codecId, 'Ada');

    expect(materializations).toBe(1);
    expect(adapter.lower(ast, { contract })).toEqual({
      sql: 'SELECT "records"."id" AS "id" FROM "records" WHERE "records"."document" = $1::citext',
      params: [{ kind: 'literal', value: 'Ada' }],
    });
  });

  it('derives direct control materialization and native-type rendering from one descriptor contribution', async () => {
    const descriptor = transformingGaussDbDescriptor('app/direct-control@1', 'citext');
    const codecRegistry = createGaussDbCodecRegistryWithBuiltins([descriptor]);
    const adapter = new GaussDbControlAdapter(codecRegistry);
    const ast = selectWithParam('document', descriptor.codecId, 'Ada');

    await expect(adapter.lowerToExecuteRequest(ast, { contract })).resolves.toEqual({
      sql: 'SELECT "records"."id" AS "id" FROM "records" WHERE "records"."document" = $1::citext',
      params: ['encoded:Ada'],
    });
  });

  it('rejects raw, wrong-target, and malformed contributions before lowering on both planes', () => {
    const raw = genericDescriptor('app/raw@1');
    const wrongTarget = {
      ...genericDescriptor('app/wrong-target@1'),
      descriptorKind: 'sqlite-codec',
      nativeTypeFor: () => 'text',
      projectJson: (expression: ProjectionExpr) => expression,
    } as const;
    const malformed = {
      ...genericDescriptor('app/malformed@1'),
      descriptorKind: 'gaussdb-codec',
      nativeTypeFor: () => 'text',
      projectJson: undefined,
    } as const;

    for (const descriptor of [raw, wrongTarget, malformed]) {
      expect(() =>
        createComposedGaussDbAdapter({
          extensions: [runtimeExtension('invalid-runtime', [descriptor])],
        }),
      ).toThrow(/not a valid GaussDB codec descriptor/);
      expect(() =>
        createComposedGaussDbControlAdapter({
          extensions: [controlExtension('invalid-control', [descriptor])],
        }),
      ).toThrow(/not a valid GaussDB codec descriptor/);
    }
  });

  it('rejects duplicate target descriptor ids during composition', () => {
    const duplicate = gaussdbDescriptor('gaussdb/text@1', 'text');

    expect(() =>
      createComposedGaussDbAdapter({
        extensions: [runtimeExtension('duplicate-runtime', [duplicate])],
      }),
    ).toThrow(/Duplicate GaussDB codec descriptor id.*gaussdb\/text@1/);
    expect(() =>
      createComposedGaussDbControlAdapter({
        extensions: [controlExtension('duplicate-control', [duplicate])],
      }),
    ).toThrow(/Duplicate codec descriptor.*gaussdb\/text@1/);
  });

  it('asks a composed descriptor how to project every JSON entry it owns', () => {
    let projectionCalls = 0;
    const descriptor = gaussdbDescriptor('app/json-hook@1', 'jsonb', () => {
      projectionCalls += 1;
    });
    const runtimeAdapter = createComposedGaussDbAdapter({
      extensions: [runtimeExtension('json-hook-runtime', [descriptor])],
    });
    const controlAdapter = createComposedGaussDbControlAdapter({
      extensions: [controlExtension('json-hook-control', [descriptor])],
    });
    const projection = new CodecJsonValueProjection(ColumnRef.of('records', 'document'), {
      codecId: descriptor.codecId,
    });
    const ast = SelectAst.from(TableSource.named('records')).withProjection([
      ProjectionItem.of(
        'object',
        JsonObjectExpr.fromEntries([JsonObjectExpr.entry('value', projection)]),
      ),
      ProjectionItem.of('array', JsonArrayAggExpr.of(projection)),
    ]);

    const runtime = runtimeAdapter.lower(ast, { contract });
    const control = controlAdapter.lower(ast, { contract });

    // This descriptor's projection is the identity, so the SQL is unchanged —
    // which is the point: a codec whose canonical JSON is its stored form
    // renders as itself, and the renderer still had to ask to find that out.
    // The call count is what says it asked, once per entry, on both paths.
    expect(runtime.sql).toBe(
      `SELECT json_build_object('value', "records"."document") AS "object", json_agg("records"."document") AS "array" FROM "records"`,
    );
    expect(control).toEqual(runtime);
    expect(projectionCalls).toBe(4);
  });
});
