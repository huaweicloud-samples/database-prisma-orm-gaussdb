import { buildCodecDescriptorRegistry } from '@internal/sql-relational-core/codec-descriptor-registry';
import type { CodecDescriptorRegistry } from '@internal/sql-relational-core/query-lane-context';
import { buildGaussDbCodecDescriptorRegistry } from './codec-descriptor';
import { codecDescriptors } from './codecs';

/**
 * Registry of every codec descriptor shipped by `@internal/target-gaussdb`.
 *
 * Public consumer surface for the gaussdb codec set: the gaussdb adapter and any other consumer that needs to enumerate or look up a gaussdb codec by id consumes this rather than the raw descriptor array. See ADR 208.
 */
export const gaussdbCodecRegistry: CodecDescriptorRegistry =
  buildCodecDescriptorRegistry(codecDescriptors);

export const gaussdbCodecDescriptorRegistry = buildGaussDbCodecDescriptorRegistry(codecDescriptors);
