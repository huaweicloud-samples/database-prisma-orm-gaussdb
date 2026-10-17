import gaussdbAdapter from '@internal/adapter-gaussdb/runtime';
import type { Contract } from '@internal/contract/types';
import gaussdbDriver, {
  type GaussDbDriverCreateOptions,
  suppressIdleConnectionErrors,
} from '@internal/driver-gaussdb/runtime';
import { instantiateExecutionStack } from '@internal/framework-components/execution';
import { sql as sqlBuilder } from '@internal/sql-builder/runtime';
import type { Db } from '@internal/sql-builder/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import type {
  ExecutionContext,
  Runtime,
  SqlExecutionStackWithDriver,
  SqlMiddleware,
  SqlRuntimeExtensionDescriptor,
  VerifyMarkerOption,
} from '@internal/sql-runtime';
import { createExecutionContext, createSqlExecutionStack } from '@internal/sql-runtime';
import gaussdbTarget, { GaussDbContractSerializer } from '@internal/target-gaussdb/runtime';
import { ifDefined } from '@internal/utils/defined';
import { InternalError } from '@internal/utils/internal-error';
import { Client } from 'pg';
import { validateGaussDbUrl } from './binding';
import type { GaussDbTargetId } from './gaussdb';
import { GaussDbRuntimeImpl } from './gaussdb-runtime';

export type GaussDbServerlessCursorOptions = NonNullable<GaussDbDriverCreateOptions['cursor']>;

export interface GaussDbServerlessClient<TContract extends Contract<SqlStorage>> {
  readonly sql: Db<TContract>;
  readonly context: ExecutionContext<TContract>;
  readonly stack: SqlExecutionStackWithDriver<GaussDbTargetId>;
  readonly contract: TContract;
  connect(binding: { readonly url: string }): Promise<Runtime & AsyncDisposable>;
}

export interface GaussDbServerlessOptionsBase {
  readonly extensions?: readonly SqlRuntimeExtensionDescriptor<GaussDbTargetId>[];
  readonly middleware?: readonly SqlMiddleware[];
  readonly verifyMarker?: VerifyMarkerOption;
  readonly cursor?: GaussDbServerlessCursorOptions;
}

export type GaussDbServerlessOptionsWithContract<TContract extends Contract<SqlStorage>> =
  GaussDbServerlessOptionsBase & {
    readonly contract: TContract;
    readonly contractJson?: never;
  };

export type GaussDbServerlessOptionsWithContractJson<TContract extends Contract<SqlStorage>> =
  GaussDbServerlessOptionsBase & {
    readonly contractJson: unknown;
    readonly contract?: never;
    readonly _contract?: TContract;
  };

export type GaussDbServerlessOptions<TContract extends Contract<SqlStorage>> =
  | GaussDbServerlessOptionsWithContract<TContract>
  | GaussDbServerlessOptionsWithContractJson<TContract>;

function hasContractJson<TContract extends Contract<SqlStorage>>(
  options: GaussDbServerlessOptions<TContract>,
): options is GaussDbServerlessOptionsWithContractJson<TContract> {
  return 'contractJson' in options;
}

const contractSerializer = new GaussDbContractSerializer();

function resolveContract<TContract extends Contract<SqlStorage>>(
  options: GaussDbServerlessOptions<TContract>,
): TContract {
  const contractJson = hasContractJson(options)
    ? options.contractJson
    : contractSerializer.serializeContract(options.contract);
  return contractSerializer.deserializeContract(contractJson) as TContract;
}

/**
 * Per-request GaussDB facade for serverless / edge runtimes (Cloudflare Workers + Hyperdrive,
 * AWS Lambda, Vercel, Deno Deploy, Bun edge, etc.).
 *
 * Construction shape mirrors the Node `gaussdb()` factory but the returned client deliberately
 * omits `orm`, `runtime()`, and `transaction()`. Closure-cached convenience surfaces are unsafe
 * across `fetch` invocations: stale connections after isolate idle, concurrent-query races on a
 * shared `pg.Client`, no clean shutdown. Per-request callers acquire a fresh `Runtime` via
 * `db.connect({ url })` and dispose it via `await using` on scope exit.
 *
 * @example
 * ```ts
 * const db = gaussdbServerless<Contract>({ contractJson });
 *
 * export default {
 *   async fetch(_req: Request, env: Env): Promise<Response> {
 *     await using runtime = await db.connect({ url: env.HYPERDRIVE.connectionString });
 *     const rows = await runtime.query(db.sql.from(t).select(...).build());
 *     return Response.json(rows);
 *   },
 * };
 * ```
 */
export default function gaussdbServerless<TContract extends Contract<SqlStorage>>(
  options: GaussDbServerlessOptionsWithContract<TContract>,
): GaussDbServerlessClient<TContract>;
export default function gaussdbServerless<TContract extends Contract<SqlStorage>>(
  options: GaussDbServerlessOptionsWithContractJson<TContract>,
): GaussDbServerlessClient<TContract>;
export default function gaussdbServerless<TContract extends Contract<SqlStorage>>(
  options: GaussDbServerlessOptions<TContract>,
): GaussDbServerlessClient<TContract> {
  const contract = resolveContract(options);
  const stack = createSqlExecutionStack({
    target: gaussdbTarget,
    adapter: gaussdbAdapter,
    driver: gaussdbDriver,
    extensions: options.extensions ?? [],
  });

  const context = createExecutionContext({
    contract,
    stack,
  });

  const sql: Db<TContract> = sqlBuilder<TContract>({
    context,
    rawCodecInferer: stack.adapter.rawCodecInferer,
  });

  return {
    sql,
    context,
    stack,
    contract,

    async connect(binding) {
      const url = validateGaussDbUrl(binding.url);

      const driverDescriptor = stack.driver;
      if (!driverDescriptor) {
        throw new InternalError('Driver descriptor missing from execution stack');
      }

      const stackInstance = instantiateExecutionStack(stack);
      const driver = driverDescriptor.create({
        ...ifDefined('cursor', options.cursor),
      });

      const client = suppressIdleConnectionErrors(new Client({ connectionString: url }));
      await driver.connect({ kind: 'pgClient', client });

      let runtime: Runtime;
      try {
        runtime = new GaussDbRuntimeImpl({
          context,
          adapter: stackInstance.adapter,
          driver,
          ...ifDefined('verifyMarker', options.verifyMarker),
          ...ifDefined('middleware', options.middleware),
        });
      } catch (err) {
        // The driver is bound to the pg.Client at this point; without a runtime
        // to wrap it, the caller has no handle to dispose. Close the driver so
        // the underlying pg.Client is released even if its TCP socket has not
        // yet opened (lazy connect): keeps cleanup symmetric with successful
        // construction and prevents real socket leaks if pg ever changes its
        // connect semantics.
        await driver.close().catch(() => undefined);
        throw err;
      }

      Object.defineProperty(runtime, Symbol.asyncDispose, {
        value: () => runtime.close(),
        configurable: true,
        writable: false,
        enumerable: false,
      });

      return runtime as Runtime & AsyncDisposable;
    },
  };
}
