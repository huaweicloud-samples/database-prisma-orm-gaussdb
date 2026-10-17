import gaussdbAdapter from '@internal/adapter-gaussdb/runtime';
import { buildNamespacedEnums, type NamespacedEnums } from '@internal/contract/enum-accessor';
import type { Contract } from '@internal/contract/types';
import { createRawLane, sql } from '@internal/sql-builder/runtime';
import type { Db, RawLane } from '@internal/sql-builder/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { RawCodecInferer } from '@internal/sql-relational-core/expression';
import type { ExecutionContext, SqlRuntimeExtensionDescriptor } from '@internal/sql-runtime';
import { createExecutionContext, createSqlExecutionStack } from '@internal/sql-runtime';
import gaussdbTarget, { GaussDbContractSerializer } from '@internal/target-gaussdb/runtime';
import { blindCast } from '@internal/utils/casts';
import type { GaussDbTargetId } from '../runtime/gaussdb';
import { buildNamespacedNativeEnums, type NamespacedNativeEnums } from '../runtime/native-enums';

export interface GaussDbStaticContext<TContract extends Contract<SqlStorage>> {
  readonly context: ExecutionContext<TContract>;
  readonly contract: TContract;
  readonly enums: NamespacedEnums<TContract>;
  readonly nativeEnums: NamespacedNativeEnums<TContract>;
  readonly sql: Db<TContract>;
  readonly raw: RawLane<TContract>;
}

export function buildGaussDbStaticContext<TContract extends Contract<SqlStorage>>(
  context: ExecutionContext<TContract>,
  rawCodecInferer: RawCodecInferer,
): GaussDbStaticContext<TContract> {
  const sqlDb: Db<TContract> = sql<TContract>({ context, rawCodecInferer });
  const raw: RawLane<TContract> = createRawLane<TContract>({ context, rawCodecInferer });
  const enums = Object.freeze(buildNamespacedEnums<TContract>(context.contract.domain));
  const nativeEnums = blindCast<
    NamespacedNativeEnums<TContract>,
    'buildNamespacedNativeEnums returns the namespace-keyed accessor map this contract types'
  >(Object.freeze(buildNamespacedNativeEnums(context.contract.storage)));
  return { context, contract: context.contract, enums, nativeEnums, sql: sqlDb, raw };
}

export default function gaussdbStatic<TContract extends Contract<SqlStorage>>(options: {
  readonly contractJson: unknown;
  readonly extensions?: readonly SqlRuntimeExtensionDescriptor<GaussDbTargetId>[];
}): GaussDbStaticContext<TContract> {
  const contract = blindCast<
    TContract,
    'GaussDbContractSerializer validates and returns a typed contract'
  >(new GaussDbContractSerializer().deserializeContract(options.contractJson));
  const stack = createSqlExecutionStack({
    target: gaussdbTarget,
    adapter: gaussdbAdapter,
    extensions: options.extensions ?? [],
  });
  const context = createExecutionContext({ contract, stack });
  return buildGaussDbStaticContext(context, stack.adapter.rawCodecInferer);
}
