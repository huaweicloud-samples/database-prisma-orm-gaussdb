import type { SqlControlAdapterDescriptor } from '@internal/family-sql/control';
import type { SqlControlAdapter } from '@internal/family-sql/control-adapter';
import { escapeLiteral, qualifyName, quoteIdentifier } from '@internal/target-gaussdb/sql-utils';
import { assembleGaussDbCodecRegistry } from '../core/codec-lookup';
import { GaussDbControlAdapter } from '../core/control-adapter';
import {
  createGaussDbDefaultFunctionRegistry,
  createGaussDbMutationDefaultGeneratorDescriptors,
  gaussdbAuthoringTypes,
} from '../core/control-mutation-defaults';
import { gaussdbAdapterDescriptorMeta } from '../core/descriptor-meta';

const gaussdbAdapterDescriptor: SqlControlAdapterDescriptor<'gaussdb'> = {
  ...gaussdbAdapterDescriptorMeta,
  authoring: { type: gaussdbAuthoringTypes, valueObjectStorageType: 'Jsonb' },
  controlMutationDefaults: {
    defaultFunctionRegistry: createGaussDbDefaultFunctionRegistry(),
    generatorDescriptors: createGaussDbMutationDefaultGeneratorDescriptors(),
  },
  create(stack): SqlControlAdapter<'gaussdb'> {
    const components = [
      stack.target,
      ...(stack.adapter === undefined ? [] : [stack.adapter]),
      ...stack.extensions,
    ];
    const codecRegistry = assembleGaussDbCodecRegistry(components);
    return new GaussDbControlAdapter(codecRegistry);
  },
};

export default gaussdbAdapterDescriptor;

export { parseGaussDbDefault } from '@internal/target-gaussdb/default-normalizer';
export { normalizeSchemaNativeType } from '@internal/target-gaussdb/native-type-normalizer';
export {
  createGaussDbBuiltinCodecLookup,
  createGaussDbCodecRegistryWithBuiltins,
} from '../core/codec-lookup';
export { GaussDbControlAdapter } from '../core/control-adapter';
export { escapeLiteral, qualifyName, quoteIdentifier };
