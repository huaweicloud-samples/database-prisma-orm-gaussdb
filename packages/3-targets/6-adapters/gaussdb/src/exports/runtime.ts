import type { GeneratedValueSpec } from '@internal/contract/types';
import { timestampNowRuntimeGenerator } from '@internal/family-sql/runtime';
import type { RuntimeAdapterInstance } from '@internal/framework-components/execution';
import { builtinGeneratorIds } from '@internal/ids';
import { generateId } from '@internal/ids/runtime';
import type { Adapter, AnyQueryAst } from '@internal/sql-relational-core/ast';
import type { SqlRuntimeAdapterDescriptor } from '@internal/sql-runtime';
import { gaussdbCodecRegistry } from '@internal/target-gaussdb/codecs';
import { INSTANT_NOW_GENERATOR_ID, instantNow } from '@internal/target-gaussdb/runtime';
import { createGaussDbAdapterWithCodecRegistry, gaussdbRawCodecInferer } from '../core/adapter';
import { assembleGaussDbCodecRegistry } from '../core/codec-lookup';
import { gaussdbAdapterDescriptorMeta, gaussdbQueryOperations } from '../core/descriptor-meta';
import type { GaussDbContract, GaussDbLoweredStatement } from '../core/types';

export interface SqlRuntimeAdapter
  extends RuntimeAdapterInstance<'sql', 'gaussdb'>,
    Adapter<AnyQueryAst, GaussDbContract, GaussDbLoweredStatement> {}

function createGaussDbMutationDefaultGenerators() {
  return [
    ...builtinGeneratorIds.map((id) => ({
      id,
      generate: (params?: Record<string, unknown>) => {
        const spec: GeneratedValueSpec = params ? { id, params } : { id };
        return generateId(spec);
      },
      stability: 'field' as const,
    })),
    timestampNowRuntimeGenerator(),
    {
      id: INSTANT_NOW_GENERATOR_ID,
      generate: () => instantNow(),
      stability: 'query' as const,
    },
  ];
}

const gaussdbRuntimeAdapterDescriptor: SqlRuntimeAdapterDescriptor<'gaussdb', SqlRuntimeAdapter> = {
  ...gaussdbAdapterDescriptorMeta,
  codecs: () => Array.from(gaussdbCodecRegistry.values()),
  queryOperations: () => gaussdbQueryOperations(),
  mutationDefaultGenerators: createGaussDbMutationDefaultGenerators,
  rawCodecInferer: gaussdbRawCodecInferer,
  create(stack): SqlRuntimeAdapter {
    const components = [stack.target, stack.adapter, ...stack.extensions];
    const codecRegistry = assembleGaussDbCodecRegistry(components);
    return createGaussDbAdapterWithCodecRegistry(codecRegistry);
  },
};

export default gaussdbRuntimeAdapterDescriptor;
