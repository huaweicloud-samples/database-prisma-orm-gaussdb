import type { JsonValue } from '@internal/contract/types';
import {
  type AnyCodecDescriptor,
  type Codec,
  type CodecDescriptor,
  CodecDescriptorImpl,
  type CodecInstanceContext,
  type CodecRef,
  type CodecTrait,
  validateCodecTypeParams,
} from '@internal/framework-components/codec';
import {
  CaseExpr,
  ColumnRef,
  DerivedTableSource,
  FunctionSource,
  JsonArrayAggExpr,
  LiteralExpr,
  NativeJsonValueProjection,
  NullCheckExpr,
  OrderByItem,
  type ProjectionExpr,
  ProjectionItem,
  SelectAst,
  SubqueryExpr,
} from '@internal/sql-relational-core/ast';
import { blindCast } from '@internal/utils/casts';
import { structuredError } from '@internal/utils/structured-error';

const GAUSSDB_CODEC_DESCRIPTOR_KIND = 'gaussdb-codec' as const;
const ARRAY_INPUT_ALIAS = 'array_input';
const ARRAY_ELEMENT_ALIAS = 'array_element';
const ARRAY_VALUE_COLUMN = 'value';
const ARRAY_ORDINALITY_COLUMN = 'ordinality';

export interface AnyGaussDbCodecDescriptor extends AnyCodecDescriptor {
  readonly descriptorKind: typeof GAUSSDB_CODEC_DESCRIPTOR_KIND;
  nativeTypeFor(ref: CodecRef): string;
  projectJson(expression: ProjectionExpr, ref: CodecRef): ProjectionExpr;
}

export abstract class GaussDbCodecDescriptor<P = void>
  extends CodecDescriptorImpl<P>
  implements AnyGaussDbCodecDescriptor
{
  readonly descriptorKind = GAUSSDB_CODEC_DESCRIPTOR_KIND;

  protected abstract nativeType(params: P): string;
  protected abstract jsonProjection(expression: ProjectionExpr, params: P): ProjectionExpr;

  protected jsonArrayProjection(expression: ProjectionExpr, params: P): ProjectionExpr {
    const boundArray = ColumnRef.of(ARRAY_INPUT_ALIAS, ARRAY_VALUE_COLUMN);
    const element = ColumnRef.of(ARRAY_ELEMENT_ALIAS, ARRAY_VALUE_COLUMN);
    const ordinality = ColumnRef.of(ARRAY_ELEMENT_ALIAS, ARRAY_ORDINALITY_COLUMN);
    const projectedElement = CaseExpr.of(
      [{ condition: NullCheckExpr.isNull(element), value: LiteralExpr.of(null) }],
      this.jsonProjection(element, params),
    );
    const aggregate = JsonArrayAggExpr.of(
      new NativeJsonValueProjection(projectedElement),
      'emptyArray',
      [OrderByItem.asc(ordinality)],
    );
    const aggregateQuery = SelectAst.from(
      FunctionSource.of('unnest', [boundArray], {
        alias: ARRAY_ELEMENT_ALIAS,
        columnAliases: [ARRAY_VALUE_COLUMN, ARRAY_ORDINALITY_COLUMN],
      }).withOrdinality(),
    ).withProjection([ProjectionItem.of(ARRAY_VALUE_COLUMN, aggregate)]);
    const arrayResult = CaseExpr.of(
      [{ condition: NullCheckExpr.isNull(boundArray), value: LiteralExpr.of(null) }],
      SubqueryExpr.of(aggregateQuery),
    );
    const inputBinding = SelectAst.noFrom().withProjection([
      ProjectionItem.of(ARRAY_VALUE_COLUMN, expression),
    ]);

    return SubqueryExpr.of(
      SelectAst.from(DerivedTableSource.as(ARRAY_INPUT_ALIAS, inputBinding)).withProjection([
        ProjectionItem.of(ARRAY_VALUE_COLUMN, arrayResult),
      ]),
    );
  }

  nativeTypeFor(ref: CodecRef): string {
    return this.nativeType(this.validateParams(ref));
  }

  projectJson(expression: ProjectionExpr, ref: CodecRef): ProjectionExpr {
    const params = this.validateParams(ref);
    return ref.many === true
      ? this.jsonArrayProjection(expression, params)
      : this.jsonProjection(expression, params);
  }

  private validateParams(ref: CodecRef): P {
    return blindCast<
      P,
      'validateCodecTypeParams synchronously validates this descriptor schema before the typed hook'
    >(validateCodecTypeParams(this, ref));
  }
}

type DescriptorParams<D extends AnyCodecDescriptor> =
  D extends CodecDescriptor<infer P> ? P : never;

export interface GaussDbCodecOptions<P> {
  readonly nativeType: (params: P) => string;
  readonly jsonProjection: (expression: ProjectionExpr, params: P) => ProjectionExpr;
  readonly jsonArrayProjection?: (expression: ProjectionExpr, params: P) => ProjectionExpr;
}

export type AdaptedGaussDbCodecDescriptor<D extends AnyCodecDescriptor> = Pick<
  D,
  keyof CodecDescriptor<DescriptorParams<D>>
> &
  Pick<AnyGaussDbCodecDescriptor, 'descriptorKind' | 'nativeTypeFor' | 'projectJson'>;

class GaussDbCodecDescriptorAdapter<D extends AnyCodecDescriptor> extends GaussDbCodecDescriptor<
  DescriptorParams<D>
> {
  override readonly codecId: string;
  override readonly traits: readonly CodecTrait[];
  override readonly targetTypes: readonly string[];
  override readonly paramsSchema: D['paramsSchema'];
  override readonly renderOutputType?: (params: DescriptorParams<D>) => string | undefined;
  override readonly renderInputType?: (params: DescriptorParams<D>) => string | undefined;
  override readonly renderValueLiteral?: (
    value: JsonValue,
    side: 'output' | 'input',
  ) => string | undefined;
  override readonly factory: (
    params: DescriptorParams<D>,
  ) => (ctx: CodecInstanceContext) => Codec<string, readonly CodecTrait[], unknown, unknown>;

  constructor(
    private readonly descriptor: D,
    private readonly options: GaussDbCodecOptions<DescriptorParams<D>>,
  ) {
    super();
    this.codecId = descriptor.codecId;
    this.traits = descriptor.traits;
    this.targetTypes = descriptor.targetTypes;
    this.paramsSchema = descriptor.paramsSchema;
    this.factory = (params) => descriptor.factory(params);

    const renderOutputType = descriptor.renderOutputType;
    if (renderOutputType !== undefined) {
      this.renderOutputType = (params) => renderOutputType.call(descriptor, params);
    }

    const renderInputType = descriptor.renderInputType;
    if (renderInputType !== undefined) {
      this.renderInputType = (params) => renderInputType.call(descriptor, params);
    }

    const renderValueLiteral = descriptor.renderValueLiteral;
    if (renderValueLiteral !== undefined) {
      this.renderValueLiteral = (value, side) => renderValueLiteral.call(descriptor, value, side);
    }
  }

  override get isParameterized(): boolean {
    return this.descriptor.isParameterized;
  }

  protected override nativeType(params: DescriptorParams<D>): string {
    return this.options.nativeType(params);
  }

  protected override jsonProjection(
    expression: ProjectionExpr,
    params: DescriptorParams<D>,
  ): ProjectionExpr {
    return this.options.jsonProjection(expression, params);
  }

  protected override jsonArrayProjection(
    expression: ProjectionExpr,
    params: DescriptorParams<D>,
  ): ProjectionExpr {
    return this.options.jsonArrayProjection === undefined
      ? super.jsonArrayProjection(expression, params)
      : this.options.jsonArrayProjection(expression, params);
  }
}

export function gaussdbCodec<D extends AnyCodecDescriptor>(
  descriptor: D,
  options: GaussDbCodecOptions<DescriptorParams<D>>,
): AdaptedGaussDbCodecDescriptor<D> {
  return blindCast<
    AdaptedGaussDbCodecDescriptor<D>,
    'the adapter delegates every ordinary descriptor member while adding the validated GaussDB protocol'
  >(new GaussDbCodecDescriptorAdapter(descriptor, options));
}

export function defineGaussDbCodecs<const Descriptors extends readonly AnyGaussDbCodecDescriptor[]>(
  descriptors: Descriptors,
): Descriptors {
  return descriptors;
}

export function isGaussDbCodecDescriptor(value: unknown): value is AnyGaussDbCodecDescriptor {
  return (
    typeof value === 'object' &&
    value !== null &&
    'descriptorKind' in value &&
    value.descriptorKind === GAUSSDB_CODEC_DESCRIPTOR_KIND &&
    'codecId' in value &&
    typeof value.codecId === 'string' &&
    'traits' in value &&
    Array.isArray(value.traits) &&
    'targetTypes' in value &&
    Array.isArray(value.targetTypes) &&
    value.targetTypes.every((targetType) => typeof targetType === 'string') &&
    'paramsSchema' in value &&
    isObjectLike(value.paramsSchema) &&
    '~standard' in value.paramsSchema &&
    isObjectLike(value.paramsSchema['~standard']) &&
    'validate' in value.paramsSchema['~standard'] &&
    typeof value.paramsSchema['~standard'].validate === 'function' &&
    'isParameterized' in value &&
    typeof value.isParameterized === 'boolean' &&
    'factory' in value &&
    typeof value.factory === 'function' &&
    'nativeTypeFor' in value &&
    typeof value.nativeTypeFor === 'function' &&
    'projectJson' in value &&
    typeof value.projectJson === 'function'
  );
}

function isObjectLike(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

export interface GaussDbCodecDescriptorRegistry {
  descriptorFor(codecId: string): AnyGaussDbCodecDescriptor | undefined;
  values(): IterableIterator<AnyGaussDbCodecDescriptor>;
}

class GaussDbCodecDescriptorRegistryImpl implements GaussDbCodecDescriptorRegistry {
  readonly #descriptors: ReadonlyMap<string, AnyGaussDbCodecDescriptor>;

  constructor(descriptors: ReadonlyMap<string, AnyGaussDbCodecDescriptor>) {
    this.#descriptors = descriptors;
    Object.freeze(this);
  }

  descriptorFor(codecId: string): AnyGaussDbCodecDescriptor | undefined {
    return this.#descriptors.get(codecId);
  }

  *values(): IterableIterator<AnyGaussDbCodecDescriptor> {
    yield* this.#descriptors.values();
  }
}

export function buildGaussDbCodecDescriptorRegistry(
  descriptors: ReadonlyArray<unknown>,
): GaussDbCodecDescriptorRegistry {
  const byId = new Map<string, AnyGaussDbCodecDescriptor>();

  for (const descriptor of descriptors) {
    if (!isGaussDbCodecDescriptor(descriptor)) {
      const codecId = candidateCodecId(descriptor);
      throw structuredError(
        'RUNTIME.CODEC_DESCRIPTOR_INVALID',
        `Codec descriptor '${codecId}' is not a valid GaussDB codec descriptor.`,
        {
          why: 'GaussDB codec registries require the gaussdb-codec discriminant and complete target descriptor methods.',
          fix: 'Extend GaussDbCodecDescriptor or adapt a generic descriptor with gaussdbCodec().',
          meta: { codecId },
        },
      );
    }

    if (byId.has(descriptor.codecId)) {
      throw structuredError(
        'RUNTIME.DUPLICATE_CODEC',
        `Duplicate GaussDB codec descriptor id '${descriptor.codecId}'.`,
        {
          why: 'Each codecId must resolve to exactly one GaussDB descriptor during registry composition.',
          fix: 'Remove the duplicate target, adapter, or extension contribution.',
          meta: { codecId: descriptor.codecId, target: 'gaussdb' },
        },
      );
    }

    byId.set(descriptor.codecId, descriptor);
  }

  return new GaussDbCodecDescriptorRegistryImpl(byId);
}

function candidateCodecId(value: unknown): string {
  return typeof value === 'object' &&
    value !== null &&
    'codecId' in value &&
    typeof value.codecId === 'string'
    ? value.codecId
    : '<unknown>';
}
