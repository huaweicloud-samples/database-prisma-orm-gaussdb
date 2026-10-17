import { gaussdbCodecDescriptorRegistry } from '@internal/target-gaussdb/codecs';
import { describe, expect, it } from 'vitest';
import { gaussdbRawCodecInferer } from '../src/core/adapter';

const adapter = gaussdbRawCodecInferer;

describe('inferCodec', () => {
  describe('number → gaussdb/int4@1 or gaussdb/float8@1', () => {
    it('maps a safe integer to gaussdb/int4@1', () => {
      expect(adapter.inferCodec(42)).toBe('gaussdb/int4@1');
    });

    it('maps zero to gaussdb/int4@1', () => {
      expect(adapter.inferCodec(0)).toBe('gaussdb/int4@1');
    });

    it('maps negative zero to gaussdb/int4@1', () => {
      expect(adapter.inferCodec(-0)).toBe('gaussdb/int4@1');
    });

    it('maps a fractional number to gaussdb/float8@1', () => {
      expect(adapter.inferCodec(1.5)).toBe('gaussdb/float8@1');
    });

    it('maps a value above MAX_SAFE_INTEGER to gaussdb/float8@1 to avoid silent truncation', () => {
      expect(adapter.inferCodec(Number.MAX_SAFE_INTEGER + 1)).toBe('gaussdb/float8@1');
    });
  });

  // int4 is a signed 32-bit column: an integer outside that range must not be
  // handed to a codec whose native type cannot hold it.
  describe('integers beyond int4 → gaussdb/int8number@1', () => {
    it('maps the largest int4 to gaussdb/int4@1', () => {
      expect(adapter.inferCodec(2_147_483_647)).toBe('gaussdb/int4@1');
    });

    it('maps the smallest int4 to gaussdb/int4@1', () => {
      expect(adapter.inferCodec(-2_147_483_648)).toBe('gaussdb/int4@1');
    });

    it('maps the first integer above the int4 range to gaussdb/int8number@1', () => {
      expect(adapter.inferCodec(2_147_483_648)).toBe('gaussdb/int8number@1');
    });

    it('maps the first integer below the int4 range to gaussdb/int8number@1', () => {
      expect(adapter.inferCodec(-2_147_483_649)).toBe('gaussdb/int8number@1');
    });

    it('maps MAX_SAFE_INTEGER to gaussdb/int8number@1', () => {
      expect(adapter.inferCodec(Number.MAX_SAFE_INTEGER)).toBe('gaussdb/int8number@1');
    });
  });

  describe('bigint → gaussdb/int8@1', () => {
    it('maps a bigint literal to gaussdb/int8@1', () => {
      expect(adapter.inferCodec(1n)).toBe('gaussdb/int8@1');
    });
  });

  describe('string → gaussdb/text@1', () => {
    it('maps a non-empty string to gaussdb/text@1', () => {
      expect(adapter.inferCodec('hello')).toBe('gaussdb/text@1');
    });

    it('maps an empty string to gaussdb/text@1', () => {
      expect(adapter.inferCodec('')).toBe('gaussdb/text@1');
    });
  });

  describe('boolean → gaussdb/bool@1', () => {
    it('maps true to gaussdb/bool@1', () => {
      expect(adapter.inferCodec(true)).toBe('gaussdb/bool@1');
    });

    it('maps false to gaussdb/bool@1', () => {
      expect(adapter.inferCodec(false)).toBe('gaussdb/bool@1');
    });
  });

  describe('Uint8Array → gaussdb/bytea@1', () => {
    it('maps a non-empty Uint8Array to gaussdb/bytea@1', () => {
      expect(adapter.inferCodec(new Uint8Array([1, 2, 3]))).toBe('gaussdb/bytea@1');
    });

    it('maps an empty Uint8Array to gaussdb/bytea@1', () => {
      expect(adapter.inferCodec(new Uint8Array([]))).toBe('gaussdb/bytea@1');
    });
  });

  // An inferred id is only useful if lowering can resolve it: renderTypedParam
  // looks the id up in this registry by exact match, so an id the registry does
  // not carry fails every raw interpolation that infers it.
  describe('inferred ids resolve in the gaussdb codec registry', () => {
    it.each([
      ['safe integer', 42],
      ['fractional number', 1.5],
      ['bigint', 1n],
      ['string', 'hello'],
      ['boolean', true],
      ['Uint8Array', new Uint8Array([1, 2, 3])],
      ['integer beyond the int4 range', 2_147_483_648],
    ] as const)('resolves the id inferred from a %s', (_label, value) => {
      const codecId = adapter.inferCodec(value);

      expect(gaussdbCodecDescriptorRegistry.descriptorFor(codecId)).toBeDefined();
    });
  });

  describe('defence-in-depth throw for unsupported types', () => {
    const throwMsg = 'wrap this value in `param(...)` with an explicit codec';
    // Cast to a wider shape so TypeScript does not prevent passing unsupported
    // values — the purpose of these tests is to exercise the runtime guard.
    const unchecked = adapter as unknown as { inferCodec(v: unknown): string };

    it('throws for Date', () => {
      expect(() => unchecked.inferCodec(new Date())).toThrow(throwMsg);
    });

    it('throws for null', () => {
      expect(() => unchecked.inferCodec(null)).toThrow(throwMsg);
    });

    it('throws for undefined', () => {
      expect(() => unchecked.inferCodec(undefined)).toThrow(throwMsg);
    });

    it('throws for a plain object', () => {
      expect(() => unchecked.inferCodec({ foo: 1 })).toThrow(throwMsg);
    });

    it('throws for an array', () => {
      expect(() => unchecked.inferCodec([1, 2])).toThrow(throwMsg);
    });
  });
});
