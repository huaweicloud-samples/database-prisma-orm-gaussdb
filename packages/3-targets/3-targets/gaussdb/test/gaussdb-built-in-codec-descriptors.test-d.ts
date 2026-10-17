import type { CodecInstanceContext } from '@internal/framework-components/codec';
import { expectTypeOf, test } from 'vitest';
import type {
  AnyGaussDbCodecDescriptor,
  GaussDbCodecDescriptorRegistry,
} from '../src/core/codec-descriptor';
import {
  codecDescriptors,
  type PgBitCodec,
  type PgInt4Codec,
  pgBitColumn,
  pgInt4Column,
  pgInt4Descriptor,
} from '../src/core/codecs';
import { gaussdbCodecDescriptorRegistry } from '../src/core/registry';

test('canonical descriptors are target-typed without losing tuple membership', () => {
  expectTypeOf(codecDescriptors).toExtend<readonly AnyGaussDbCodecDescriptor[]>();
  expectTypeOf<(typeof codecDescriptors)[number]>().toExtend<AnyGaussDbCodecDescriptor>();
});

test('target descriptors preserve existing factory and column-helper results', () => {
  expectTypeOf(pgInt4Descriptor.factory()).toEqualTypeOf<
    (ctx: CodecInstanceContext) => PgInt4Codec
  >();
  expectTypeOf(pgInt4Column().codecFactory).toEqualTypeOf<
    (ctx: CodecInstanceContext) => PgInt4Codec
  >();
  expectTypeOf(pgBitColumn({ length: 8 }).codecFactory).toEqualTypeOf<
    (ctx: CodecInstanceContext) => PgBitCodec
  >();
});

test('typed registry exposes only GaussDB descriptors', () => {
  expectTypeOf(gaussdbCodecDescriptorRegistry).toEqualTypeOf<GaussDbCodecDescriptorRegistry>();
  expectTypeOf(gaussdbCodecDescriptorRegistry.descriptorFor('gaussdb/int4@1')).toEqualTypeOf<
    AnyGaussDbCodecDescriptor | undefined
  >();
});
