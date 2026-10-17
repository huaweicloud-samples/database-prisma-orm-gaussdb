/**
 * Constructive type tests for the gaussdb per-target descriptor record layer.
 *
 * Coverage:
 * - every entry in the internal descriptor list (`codecDescriptors`) satisfies the GaussDB target protocol while retaining its concrete type;
 * - trait literals survive on each descriptor class — {@link DescriptorCodecTraits} reads `traits` directly off the descriptor, so the literal tuple shape (`readonly ['equality', 'order', 'numeric']`) is preserved rather than widened to `readonly CodecTrait[]`;
 * - the resolved `CodecTypes` projection contains the codec-id keys consumers reference at the no-emit authoring chain.
 *
 * Negative coverage (`// @ts-expect-error`) proves that a regression in trait preservation or a missing codec id breaks the test compile.
 */

import type { CodecTrait } from '@internal/framework-components/codec';
import { expectTypeOf, test } from 'vitest';
import type { AnyGaussDbCodecDescriptor } from '../src/core/codec-descriptor';
import {
  type codecDescriptors,
  type PgInt4Descriptor,
  type PgNumericDescriptor,
  pgInt4Descriptor,
  pgNumericDescriptor,
} from '../src/core/codecs';
import type { CodecTypes } from '../src/exports/codec-types';

test('canonical list entries extend AnyGaussDbCodecDescriptor', () => {
  expectTypeOf<(typeof codecDescriptors)[number]>().toExtend<AnyGaussDbCodecDescriptor>();
});

test('pgInt4Descriptor.traits is a readonly literal tuple, not widened', () => {
  type Traits = PgInt4Descriptor['traits'];
  expectTypeOf<Traits>().toEqualTypeOf<readonly ['equality', 'order', 'numeric']>();
  expectTypeOf<Traits[number]>().toExtend<CodecTrait>();
});

test('pgNumericDescriptor.traits preserves the same literal tuple', () => {
  type Traits = PgNumericDescriptor['traits'];
  expectTypeOf<Traits>().toEqualTypeOf<readonly ['equality', 'order', 'numeric']>();
});

test('pgInt4Descriptor.codecId is the literal `gaussdb/int4@1`', () => {
  expectTypeOf(pgInt4Descriptor.codecId).toEqualTypeOf<'gaussdb/int4@1'>();
});

test('pgNumericDescriptor.codecId is the literal `gaussdb/numeric@1`', () => {
  expectTypeOf(pgNumericDescriptor.codecId).toEqualTypeOf<'gaussdb/numeric@1'>();
});

test('CodecTypes is keyed by codec id and exposes input/output/traits', () => {
  expectTypeOf<CodecTypes['gaussdb/int4@1']>().toExtend<{
    readonly input: number;
    readonly output: number;
    readonly traits: 'equality' | 'order' | 'numeric';
  }>();

  expectTypeOf<CodecTypes['gaussdb/varchar@1']>().toExtend<{
    readonly input: string;
    readonly output: string;
  }>();
});

test('widened trait shape on pgInt4 fails the equality check', () => {
  type Traits = PgInt4Descriptor['traits'];
  // @ts-expect-error -- traits literal tuple is preserved, not widened to CodecTrait[]
  expectTypeOf<Traits>().toEqualTypeOf<readonly CodecTrait[]>();
});

test('non-existent codec id is absent from CodecTypes', () => {
  // @ts-expect-error -- `gaussdb/nonexistent@1` is not a registered codec id
  type _Missing = CodecTypes['gaussdb/nonexistent@1'];
});
