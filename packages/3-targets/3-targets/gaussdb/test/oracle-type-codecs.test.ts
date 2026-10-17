import { describe, expect, it } from 'vitest';
import {
  PG_BLOB_CODEC_ID,
  PG_CLOB_CODEC_ID,
  PG_NVARCHAR2_CODEC_ID,
  PG_RAW_CODEC_ID,
} from '../src/core/codec-ids';
import {
  pgBlobColumn,
  pgBlobDescriptor,
  pgClobColumn,
  pgClobDescriptor,
  pgNvarchar2Column,
  pgNvarchar2Descriptor,
  pgRawColumn,
  pgRawDescriptor,
} from '../src/core/codecs';

const instanceCtx = { name: '<test>' };
const callCtx = {};

describe('gaussdb/nvarchar2@1 codec runtime', () => {
  const codec = pgNvarchar2Descriptor.factory({ length: 50 })(instanceCtx);

  it('id proxies through the descriptor', () => {
    expect(codec.id).toBe(PG_NVARCHAR2_CODEC_ID);
  });

  it('round-trips strings verbatim (character semantics, unlike varchar2 bytes)', async () => {
    expect(await codec.encode('中文abc', callCtx)).toBe('中文abc');
    expect(await codec.decode('中文abc', callCtx)).toBe('中文abc');
  });

  it('round-trips through the JSON identity', () => {
    expect(codec.encodeJson('中文abc')).toBe('中文abc');
    expect(codec.decodeJson('中文abc')).toBe('中文abc');
  });

  it('exposes the string traits and the nvarchar2 native type', () => {
    expect(pgNvarchar2Descriptor.traits).toEqual(['equality', 'order', 'textual']);
    expect(pgNvarchar2Descriptor.nativeTypeFor({ codecId: pgNvarchar2Descriptor.codecId })).toBe(
      'nvarchar2',
    );
  });

  it('renders NVarChar2<length> when length is present', () => {
    expect(pgNvarchar2Descriptor.renderOutputType?.({ length: 50 })).toBe('NVarChar2<50>');
  });

  it('returns undefined when length is absent', () => {
    expect(pgNvarchar2Descriptor.renderOutputType?.({})).toBeUndefined();
  });

  it('throws on invalid length', () => {
    const renderer = pgNvarchar2Descriptor.renderOutputType as
      | ((typeParams: Record<string, unknown>) => string | undefined)
      | undefined;
    expect(() => renderer?.({ length: 'bad' })).toThrow(/expected integer "length"/);
  });
});

describe('gaussdb/clob@1 codec runtime', () => {
  const codec = pgClobDescriptor.factory()(instanceCtx);

  it('id proxies through the descriptor', () => {
    expect(codec.id).toBe(PG_CLOB_CODEC_ID);
  });

  it('round-trips a document over 1MB', async () => {
    const big = `${'x'.repeat(600_000)}${'中'.repeat(300_000)}${'y'.repeat(300_001)}`;
    expect(big.length).toBeGreaterThan(1_200_000);
    expect(await codec.encode(big, callCtx)).toBe(big);
    expect(await codec.decode(big, callCtx)).toBe(big);
    expect(codec.encodeJson(big)).toBe(big);
    expect(codec.decodeJson(big)).toBe(big);
  });

  it('round-trips short text verbatim', async () => {
    expect(await codec.encode('hello clob', callCtx)).toBe('hello clob');
    expect(await codec.decode('hello clob', callCtx)).toBe('hello clob');
  });

  it('exposes the string traits and the clob native type', () => {
    expect(pgClobDescriptor.traits).toEqual(['equality', 'order', 'textual']);
    expect(pgClobDescriptor.nativeTypeFor({ codecId: pgClobDescriptor.codecId })).toBe('clob');
  });
});

describe('gaussdb/blob@1 codec runtime', () => {
  const codec = pgBlobDescriptor.factory()(instanceCtx);
  const ramp = new Uint8Array(256);
  for (let i = 0; i < 256; i++) ramp[i] = i;
  const rampHexUpper = Buffer.from(ramp).toString('hex').toUpperCase();

  it('id proxies through the descriptor', () => {
    expect(codec.id).toBe(PG_BLOB_CODEC_ID);
  });

  it('encode passes the payload through as the bindable binary value', async () => {
    const encoded = await codec.encode(ramp, callCtx);
    expect(encoded).toBe(ramp);
  });

  it('decode reads the hex-text wire form into a plain Uint8Array', async () => {
    const decoded = await codec.decode('000102FDFEFF', callCtx);
    expect(decoded).toBeInstanceOf(Uint8Array);
    expect(decoded.constructor).toBe(Uint8Array);
    expect(Array.from(decoded)).toEqual([0x00, 0x01, 0x02, 0xfd, 0xfe, 0xff]);
  });

  it('decode accepts lowercase hex', async () => {
    const decoded = await codec.decode('deadbeef', callCtx);
    expect(Array.from(decoded)).toEqual([0xde, 0xad, 0xbe, 0xef]);
  });

  it('decode of the empty hex string yields an empty Uint8Array', async () => {
    const decoded = await codec.decode('', callCtx);
    expect(decoded).toBeInstanceOf(Uint8Array);
    expect(decoded).toHaveLength(0);
  });

  it('decode rejects non-hex wire text', async () => {
    await expect(codec.decode('zz', callCtx)).rejects.toThrow(
      'gaussdb/blob@1 wire value must be a hex string',
    );
    await expect(codec.decode('abc', callCtx)).rejects.toThrow(
      'gaussdb/blob@1 wire value must be a hex string',
    );
  });

  it('round-trips through the uppercase-hex JSON canonical form', () => {
    const json = codec.encodeJson(ramp);
    expect(json).toBe(rampHexUpper);
    expect(Array.from(codec.decodeJson(json))).toEqual(Array.from(ramp));
  });

  it('decodeJson accepts lowercase hex and rejects non-hex', () => {
    expect(Array.from(codec.decodeJson('deadbeef'))).toEqual([0xde, 0xad, 0xbe, 0xef]);
    expect(() => codec.decodeJson(42)).toThrow(
      'gaussdb/blob@1 database JSON value must be a hex string',
    );
    expect(() => codec.decodeJson('nothex')).toThrow(
      'gaussdb/blob@1 database JSON value must be a hex string',
    );
  });

  it('exposes binary traits and the blob native type', () => {
    expect(pgBlobDescriptor.traits).toEqual(['equality', 'order']);
    expect(pgBlobDescriptor.nativeTypeFor({ codecId: pgBlobDescriptor.codecId })).toBe('blob');
  });
});

describe('gaussdb/raw@1 codec runtime', () => {
  const codec = pgRawDescriptor.factory({ length: 32 })(instanceCtx);

  it('id proxies through the descriptor', () => {
    expect(codec.id).toBe(PG_RAW_CODEC_ID);
  });

  it('encode writes the canonical uppercase hex string', async () => {
    expect(await codec.encode(new Uint8Array([0xde, 0xad, 0xbe, 0xef]), callCtx)).toBe('DEADBEEF');
  });

  it('encode of the empty payload writes the empty string', async () => {
    expect(await codec.encode(new Uint8Array(0), callCtx)).toBe('');
  });

  it('decode reads hex (either case) into a Uint8Array', async () => {
    const decoded = await codec.decode('DEADBEEF', callCtx);
    expect(decoded).toBeInstanceOf(Uint8Array);
    expect(Array.from(decoded)).toEqual([0xde, 0xad, 0xbe, 0xef]);
    expect(Array.from(await codec.decode('cafebabe', callCtx))).toEqual([0xca, 0xfe, 0xba, 0xbe]);
  });

  it('round-trips a 32-byte token through encode then decode', async () => {
    const token = new Uint8Array(32);
    for (let i = 0; i < 32; i++) token[i] = i * 8;
    const wire = await codec.encode(token, callCtx);
    expect(wire).toBe('0008101820283038404850586068707880889098A0A8B0B8C0C8D0D8E0E8F0F8');
    expect(Array.from(await codec.decode(wire, callCtx))).toEqual(Array.from(token));
  });

  it('decode rejects non-hex and odd-length wire text', async () => {
    await expect(codec.decode('zz', callCtx)).rejects.toThrow(
      'gaussdb/raw@1 wire value must be a hex string',
    );
    await expect(codec.decode('abc', callCtx)).rejects.toThrow(
      'gaussdb/raw@1 wire value must be a hex string',
    );
  });

  it('round-trips through the uppercase-hex JSON canonical form', () => {
    const token = new Uint8Array([0x00, 0xff, 0x10]);
    const json = codec.encodeJson(token);
    expect(json).toBe('00FF10');
    expect(Array.from(codec.decodeJson(json))).toEqual([0x00, 0xff, 0x10]);
    expect(() => codec.decodeJson('nope')).toThrow(
      'gaussdb/raw@1 database JSON value must be a hex string',
    );
  });

  it('exposes binary traits and the raw native type', () => {
    expect(pgRawDescriptor.traits).toEqual(['equality', 'order']);
    expect(pgRawDescriptor.nativeTypeFor({ codecId: pgRawDescriptor.codecId })).toBe('raw');
  });
});

describe('oracle-type column helpers', () => {
  it('pgNvarchar2Column packages a ColumnSpec for gaussdb/nvarchar2@1', () => {
    const spec = pgNvarchar2Column({ length: 50 });
    expect(spec.codecId).toBe(PG_NVARCHAR2_CODEC_ID);
    expect(spec.nativeType).toBe('nvarchar2');
    expect(spec.typeParams).toEqual({ length: 50 });
    expect(spec.codecFactory(instanceCtx).id).toBe(PG_NVARCHAR2_CODEC_ID);
  });

  it('pgClobColumn packages a ColumnSpec for gaussdb/clob@1', () => {
    const spec = pgClobColumn();
    expect(spec.codecId).toBe(PG_CLOB_CODEC_ID);
    expect(spec.nativeType).toBe('clob');
    expect(spec.typeParams).toBeUndefined();
    expect(spec.codecFactory(instanceCtx).id).toBe(PG_CLOB_CODEC_ID);
  });

  it('pgBlobColumn packages a ColumnSpec for gaussdb/blob@1', () => {
    const spec = pgBlobColumn();
    expect(spec.codecId).toBe(PG_BLOB_CODEC_ID);
    expect(spec.nativeType).toBe('blob');
    expect(spec.codecFactory(instanceCtx).id).toBe(PG_BLOB_CODEC_ID);
  });

  it('pgRawColumn packages a ColumnSpec for gaussdb/raw@1', () => {
    const spec = pgRawColumn({ length: 32 });
    expect(spec.codecId).toBe(PG_RAW_CODEC_ID);
    expect(spec.nativeType).toBe('raw');
    expect(spec.typeParams).toEqual({ length: 32 });
    expect(spec.codecFactory(instanceCtx).id).toBe(PG_RAW_CODEC_ID);
  });
});
