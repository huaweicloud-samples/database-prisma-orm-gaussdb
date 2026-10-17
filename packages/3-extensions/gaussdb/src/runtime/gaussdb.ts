import gaussdbAdapter from '@internal/adapter-gaussdb/runtime';
import type { NamespacedEnums } from '@internal/contract/enum-accessor';
import type { Contract } from '@internal/contract/types';
import gaussdbDriver, { suppressIdleConnectionErrors } from '@internal/driver-gaussdb/runtime';
import { instantiateExecutionStack } from '@internal/framework-components/execution';
import { sql as sqlBuilder } from '@internal/sql-builder/runtime';
import type { Db, RawLane } from '@internal/sql-builder/types';
import type { ExtractCodecTypes, SqlStorage } from '@internal/sql-contract/types';
import { orm as ormBuilder } from '@internal/sql-orm-client';
import type { CodecTypesBase } from '@internal/sql-relational-core/expression';
import type { SqlQueryPlan } from '@internal/sql-relational-core/plan';
import type {
  BindSiteParams,
  Declaration,
  ExecutionContext,
  ParamsFromDeclaration,
  PreparedFor,
  Runtime,
  SqlExecutionStackWithDriver,
  SqlMiddleware,
  SqlRuntimeExtensionDescriptor,
  TransactionContext,
  VerifyMarkerOption,
} from '@internal/sql-runtime';
import {
  createExecutionContext,
  createSqlExecutionStack,
  withTransaction,
} from '@internal/sql-runtime';
import gaussdbTarget, { GaussDbContractSerializer } from '@internal/target-gaussdb/runtime';
import { ifDefined } from '@internal/utils/defined';
import { InternalError } from '@internal/utils/internal-error';
import { type Client, Pool } from 'pg';
import { gaussdbError } from '../errors';
import { buildGaussDbStaticContext } from '../static/gaussdb-static';
import {
  type GaussDbBinding,
  type GaussDbBindingInput,
  resolveGaussDbBinding,
  resolveOptionalGaussDbBinding,
} from './binding';
import { GaussDbRuntimeImpl } from './gaussdb-runtime';
import type { NamespacedNativeEnums } from './native-enums';

export type GaussDbTargetId = 'gaussdb';
type OrmClient<TContract extends Contract<SqlStorage>> = ReturnType<typeof ormBuilder<TContract>>;

export interface GaussDbTransactionContext<TContract extends Contract<SqlStorage>>
  extends TransactionContext {
  readonly sql: Db<TContract>;
  readonly orm: OrmClient<TContract>;
  readonly enums: NamespacedEnums<TContract>;
  readonly nativeEnums: NamespacedNativeEnums<TContract>;
}

export interface GaussDbClient<TContract extends Contract<SqlStorage>> {
  readonly sql: Db<TContract>;
  readonly orm: OrmClient<TContract>;
  readonly enums: NamespacedEnums<TContract>;
  readonly nativeEnums: NamespacedNativeEnums<TContract>;
  readonly raw: RawLane<TContract>;
  readonly context: ExecutionContext<TContract>;
  readonly contract: TContract;
  readonly stack: SqlExecutionStackWithDriver<GaussDbTargetId>;
  connect(bindingInput?: GaussDbBindingInput): Promise<Runtime>;
  runtime(): Runtime;
  transaction<R>(fn: (tx: GaussDbTransactionContext<TContract>) => PromiseLike<R>): Promise<R>;
  prepare<D extends Declaration<CT>, Row, CT extends CodecTypesBase = ExtractCodecTypes<TContract>>(
    declaration: D,
    callback: (sql: Db<TContract>, params: BindSiteParams<D>) => SqlQueryPlan<Row>,
  ): Promise<PreparedFor<ParamsFromDeclaration<D, CT>, Row>>;
  close(): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
}

export interface GaussDbOptionsBase {
  readonly extensions?: readonly SqlRuntimeExtensionDescriptor<GaussDbTargetId>[];
  readonly middleware?: readonly SqlMiddleware[];
  readonly verifyMarker?: VerifyMarkerOption;
  readonly poolOptions?: {
    readonly connectionTimeoutMillis?: number;
    readonly idleTimeoutMillis?: number;
  };
}

export interface GaussDbBindingOptions {
  readonly binding?: GaussDbBinding;
  readonly url?: string;
  readonly pg?: Pool | Client;
}

export type GaussDbOptionsWithContract<TContract extends Contract<SqlStorage>> =
  GaussDbBindingOptions &
    GaussDbOptionsBase & {
      readonly contract: TContract;
      readonly contractJson?: never;
    };

export type GaussDbOptionsWithContractJson<TContract extends Contract<SqlStorage>> =
  GaussDbBindingOptions &
    GaussDbOptionsBase & {
      readonly contractJson: unknown;
      readonly contract?: never;
      readonly _contract?: TContract;
    };

export type GaussDbOptions<TContract extends Contract<SqlStorage>> =
  | GaussDbOptionsWithContract<TContract>
  | GaussDbOptionsWithContractJson<TContract>;

function hasContractJson<TContract extends Contract<SqlStorage>>(
  options: GaussDbOptions<TContract>,
): options is GaussDbOptionsWithContractJson<TContract> {
  return 'contractJson' in options;
}

const contractSerializer = new GaussDbContractSerializer();

function resolveContract<TContract extends Contract<SqlStorage>>(
  options: GaussDbOptions<TContract>,
): TContract {
  const contractJson = hasContractJson(options)
    ? options.contractJson
    : contractSerializer.serializeContract(options.contract);
  return contractSerializer.deserializeContract(contractJson) as TContract;
}

function toRuntimeBinding<TContract extends Contract<SqlStorage>>(
  binding: GaussDbBinding,
  options: GaussDbOptions<TContract>,
) {
  if (binding.kind !== 'url') {
    return binding;
  }

  return {
    kind: 'pgPool',
    pool: suppressIdleConnectionErrors(
      new Pool({
        connectionString: binding.url,
        connectionTimeoutMillis: options.poolOptions?.connectionTimeoutMillis ?? 20_000,
        idleTimeoutMillis: options.poolOptions?.idleTimeoutMillis ?? 30_000,
      }),
    ),
  } as const;
}

/**
 * Creates a lazy GaussDB client from either `contractJson` or a TypeScript-authored `contract`.
 * Static query surfaces are available immediately, while `runtime()` instantiates the driver/pool on first call.
 *
 * - No-emit: pass a TypeScript-authored contract. Example: gaussdb({ contract })
 * - Emitted: pass Contract type explicitly. Example: gaussdb<Contract>({ contractJson, url })
 */
export default function gaussdb<TContract extends Contract<SqlStorage>>(
  options: GaussDbOptionsWithContract<TContract>,
): GaussDbClient<TContract>;
export default function gaussdb<TContract extends Contract<SqlStorage>>(
  options: GaussDbOptionsWithContractJson<TContract>,
): GaussDbClient<TContract>;
export default function gaussdb<TContract extends Contract<SqlStorage>>(
  options: GaussDbOptions<TContract>,
): GaussDbClient<TContract> {
  const contract = resolveContract(options);
  let binding = resolveOptionalGaussDbBinding(options);

  const stack = createSqlExecutionStack({
    target: gaussdbTarget,
    adapter: gaussdbAdapter,
    driver: gaussdbDriver,
    extensions: options.extensions ?? [],
  });

  const context = createExecutionContext<TContract, GaussDbTargetId>({
    contract,
    stack,
    driver: gaussdbDriver,
  });
  const {
    sql,
    raw: rawSqlTag,
    enums,
    nativeEnums,
  } = buildGaussDbStaticContext<TContract>(context, stack.adapter.rawCodecInferer);

  let runtimeInstance: Runtime | undefined;
  let runtimeDriver: { connect(binding: unknown): Promise<void> } | undefined;
  let driverConnected = false;
  let connectPromise: Promise<void> | undefined;
  let backgroundConnectError: unknown;
  let closed = false;
  let ownedDispose: (() => Promise<void>) | undefined;

  const connectDriver = async (resolvedBinding: GaussDbBinding): Promise<void> => {
    if (driverConnected) return;
    if (!runtimeDriver) throw new InternalError('GaussDB runtime driver missing');
    if (connectPromise) return connectPromise;
    const runtimeBinding = toRuntimeBinding(resolvedBinding, options);
    if (resolvedBinding.kind === 'url' && runtimeBinding.kind === 'pgPool') {
      const pool = runtimeBinding.pool;
      let disposed = false;
      ownedDispose = async () => {
        if (disposed) return;
        disposed = true;
        await pool.end().then(() => undefined);
      };
    }
    connectPromise = runtimeDriver
      .connect(runtimeBinding)
      .then(() => {
        driverConnected = true;
      })
      .catch(async (err) => {
        backgroundConnectError = err;
        connectPromise = undefined;
        await ownedDispose?.().catch(() => undefined);
        throw err;
      });
    return connectPromise;
  };

  const getRuntime = (): Runtime => {
    if (closed) {
      throw gaussdbError('DRIVER.NOT_CONNECTED', 'GaussDB client is closed', {
        why: 'close() was called on this client.',
        fix: 'Create a new gaussdb(...) client.',
        meta: { extension: 'gaussdb' },
      });
    }

    if (backgroundConnectError !== undefined) {
      throw backgroundConnectError;
    }

    if (runtimeInstance) {
      return runtimeInstance;
    }

    const stackInstance = instantiateExecutionStack(stack);
    const driverDescriptor = stack.driver;
    if (!driverDescriptor) {
      throw new InternalError('Driver descriptor missing from execution stack');
    }

    const driver = driverDescriptor.create({
      cursor: { disabled: true },
    });
    runtimeDriver = driver;
    if (binding !== undefined) {
      void connectDriver(binding).catch(() => undefined);
    }

    runtimeInstance = new GaussDbRuntimeImpl({
      context,
      adapter: stackInstance.adapter,
      driver,
      ...ifDefined('verifyMarker', options.verifyMarker),
      ...ifDefined('middleware', options.middleware),
    });

    return runtimeInstance;
  };

  const orm: OrmClient<TContract> = ormBuilder({
    runtime: {
      query(plan) {
        return getRuntime().query(plan);
      },
      execute(plan) {
        return getRuntime().execute(plan);
      },
      connection() {
        return getRuntime().connection();
      },
    },
    context,
  });

  return {
    sql,
    orm,
    enums,
    nativeEnums,
    raw: rawSqlTag,
    context,
    contract,
    stack,

    async connect(bindingInput) {
      if (closed) {
        throw gaussdbError('DRIVER.NOT_CONNECTED', 'GaussDB client is closed', {
          why: 'close() was called on this client.',
          fix: 'Create a new gaussdb(...) client.',
          meta: { extension: 'gaussdb' },
        });
      }

      if (driverConnected || connectPromise) {
        throw gaussdbError('DRIVER.ALREADY_CONNECTED', 'GaussDB client already connected', {
          fix: 'Call connect() at most once per client.',
          meta: { extension: 'gaussdb' },
        });
      }

      if (bindingInput !== undefined) {
        binding = resolveGaussDbBinding(bindingInput);
      }

      if (binding === undefined) {
        throw gaussdbError(
          'RUNTIME.BINDING_MISSING',
          'GaussDB binding not configured. Pass url/pg/binding to gaussdb(...) or call db.connect({ ... }).',
          { meta: { extension: 'gaussdb' } },
        );
      }

      const runtime = getRuntime();
      if (driverConnected) {
        return runtime;
      }

      await connectDriver(binding);
      return runtime;
    },

    runtime() {
      return getRuntime();
    },

    prepare<
      D extends Declaration<CT>,
      Row,
      CT extends CodecTypesBase = ExtractCodecTypes<TContract>,
    >(
      declaration: D,
      callback: (sql: Db<TContract>, params: BindSiteParams<D>) => SqlQueryPlan<Row>,
    ): Promise<PreparedFor<ParamsFromDeclaration<D, CT>, Row>> {
      return getRuntime().prepare<D, Row, CT>(declaration, (params) => callback(sql, params));
    },

    transaction<R>(fn: (tx: GaussDbTransactionContext<TContract>) => PromiseLike<R>): Promise<R> {
      return withTransaction(getRuntime(), (txCtx) => {
        const rawCodecInferer = stack.adapter.rawCodecInferer;
        const txSql: Db<TContract> = sqlBuilder<TContract>({
          context,
          rawCodecInferer,
        });

        const txOrm: OrmClient<TContract> = ormBuilder({
          runtime: {
            query(plan) {
              return txCtx.query(plan);
            },
            execute(plan) {
              return txCtx.execute(plan);
            },
          },
          context,
        });

        // Use `txCtx` as the prototype instead of spreading it so that live
        // accessors (notably the `invalidated` getter, which reads a closure
        // variable in `withTransaction`) remain wired to the original object.
        // Spreading would evaluate the getter once and freeze its value.
        const tx: GaussDbTransactionContext<TContract> = Object.assign(
          Object.create(txCtx) as TransactionContext,
          { sql: txSql, orm: txOrm, enums, nativeEnums },
        );

        return fn(tx);
      });
    },

    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await connectPromise?.catch(() => undefined);
      await ownedDispose?.();
    },

    [Symbol.asyncDispose](): Promise<void> {
      return this.close();
    },
  };
}
