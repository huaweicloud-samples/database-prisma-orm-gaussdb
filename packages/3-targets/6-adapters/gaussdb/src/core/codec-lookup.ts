import type { ComponentMetadata } from '@internal/framework-components/components';
import { extractCodecLookup } from '@internal/framework-components/control';
import {
  type AnyGaussDbCodecDescriptor,
  buildGaussDbCodecDescriptorRegistry,
} from '@internal/target-gaussdb/codec-descriptor';
import { gaussdbCodecDescriptorRegistry } from '@internal/target-gaussdb/codecs';
import type { GaussDbCodecRegistry } from './types';

function buildGaussDbCodecRegistry(descriptors: ReadonlyArray<unknown>): GaussDbCodecRegistry {
  const descriptorRegistry = buildGaussDbCodecDescriptorRegistry(descriptors);
  const validatedDescriptors = Array.from(descriptorRegistry.values());
  const codecRegistry = extractCodecLookup([
    {
      id: 'gaussdb-codecs',
      types: { codecTypes: { codecDescriptors: validatedDescriptors } },
    },
  ]);
  const registry: GaussDbCodecRegistry = {
    ...codecRegistry,
    descriptorFor: (codecId) => descriptorRegistry.descriptorFor(codecId),
    values: () => descriptorRegistry.values(),
  };
  return Object.freeze(registry);
}

export function assembleGaussDbCodecRegistry(
  components: ReadonlyArray<Pick<ComponentMetadata, 'types'>>,
): GaussDbCodecRegistry {
  const descriptors = components.flatMap(
    (component) => component.types?.codecTypes?.codecDescriptors ?? [],
  );
  return buildGaussDbCodecRegistry(descriptors);
}

export function createGaussDbCodecRegistryWithBuiltins(
  codecDescriptors: readonly AnyGaussDbCodecDescriptor[] = [],
): GaussDbCodecRegistry {
  return buildGaussDbCodecRegistry([
    ...gaussdbCodecDescriptorRegistry.values(),
    ...codecDescriptors,
  ]);
}

/**
 * Build a coherent GaussDB codec registry populated with built-in descriptors only.
 *
 * The returned registry supports both ordinary codec materialization and GaussDB target behavior. Stack-composed paths build the same combined registry from their complete ordered descriptor contributions.
 */
export function createGaussDbBuiltinCodecLookup(): GaussDbCodecRegistry {
  return createGaussDbCodecRegistryWithBuiltins();
}
