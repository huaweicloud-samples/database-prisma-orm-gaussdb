import { describe, expect, it } from 'vitest';
import { codecDescriptors } from '../src/core/codecs';
import { gaussdbCodecDescriptorRegistry, gaussdbCodecRegistry } from '../src/core/registry';

describe('GaussDB built-in codec descriptors', () => {
  it('builds typed and generic registries over the same ordered descriptors', () => {
    expect(Object.isFrozen(gaussdbCodecDescriptorRegistry)).toBe(true);
    expect([...gaussdbCodecDescriptorRegistry.values()]).toEqual(codecDescriptors);

    for (const descriptor of codecDescriptors) {
      expect(gaussdbCodecDescriptorRegistry.descriptorFor(descriptor.codecId)).toBe(descriptor);
      expect(gaussdbCodecRegistry.descriptorFor(descriptor.codecId)).toBe(descriptor);
    }
  });
});
