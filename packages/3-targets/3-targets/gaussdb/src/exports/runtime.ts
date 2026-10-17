import type { AnyCodecDescriptor } from '@internal/framework-components/codec';
import type {
  RuntimeTargetDescriptor,
  RuntimeTargetInstance,
} from '@internal/framework-components/execution';
import { gaussdbTargetDescriptorMetaRuntime } from '../core/descriptor-meta-runtime';

export { GaussDbContractSerializer } from '../core/gaussdb-contract-serializer';
export { GaussDbContractView } from '../core/gaussdb-contract-view';
export { INSTANT_NOW_GENERATOR_ID, instantNow } from '../core/instant-now-generator';

export interface GaussDbRuntimeTargetInstance extends RuntimeTargetInstance<'sql', 'gaussdb'> {}

/**
 * Target-gaussdb deliberately does NOT import `SqlRuntimeTargetDescriptor` from `@internal/sql-runtime`. The target package is a control-plane residence and must not pull the SQL execution-plane package into its dependency closure. The runtime descriptor here is shaped to satisfy the framework's `RuntimeTargetDescriptor` plus the structural `SqlStaticContributions` (`codecs:` returning a descriptor list) that
 * `@internal/sql-runtime` consumers narrow to at composition time.
 *
 * The target itself contributes no codecs — gaussdb-specific codecs ship from the gaussdb adapter and from extension packs (pgvector, arktype-json, etc.).
 */
const gaussdbRuntimeTargetDescriptor: RuntimeTargetDescriptor<
  'sql',
  'gaussdb',
  GaussDbRuntimeTargetInstance
> & {
  readonly codecs: () => readonly AnyCodecDescriptor[];
} = {
  ...gaussdbTargetDescriptorMetaRuntime,
  codecs: () => [],
  create(): GaussDbRuntimeTargetInstance {
    return {
      familyId: 'sql',
      targetId: 'gaussdb',
    };
  },
};

export default gaussdbRuntimeTargetDescriptor;
