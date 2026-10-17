import type { AnyGaussDbCodecDescriptor } from '@internal/target-gaussdb/codec-descriptor';
import { createGaussDbAdapter } from '../src/core/adapter';

declare const descriptor: AnyGaussDbCodecDescriptor;

createGaussDbAdapter({ codecDescriptors: [descriptor] });

createGaussDbAdapter({
  // @ts-expect-error Generic codec lookups cannot be injected independently from target descriptors.
  codecLookup: undefined,
});

createGaussDbAdapter({
  // @ts-expect-error Target descriptor registries cannot be injected independently from materialization.
  codecDescriptorRegistry: undefined,
});
