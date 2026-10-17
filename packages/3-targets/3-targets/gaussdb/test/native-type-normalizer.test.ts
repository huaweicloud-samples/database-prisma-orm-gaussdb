import { describe, expect, it } from 'vitest';
import {
  normalizeSchemaNativeType,
  toIntrospectedNativeType,
} from '../src/core/native-type-normalizer';

describe('toIntrospectedNativeType', () => {
  it('aliases the Oracle-compat authoring names to their catalog spellings', () => {
    expect(toIntrospectedNativeType('number')).toBe('numeric');
    expect(toIntrospectedNativeType('number(10,2)')).toBe('numeric(10,2)');
    expect(toIntrospectedNativeType('varchar2')).toBe('character varying');
    expect(toIntrospectedNativeType('varchar2(10)')).toBe('character varying(10)');
  });

  it('strips the raw length — format_type does not carry it', () => {
    expect(toIntrospectedNativeType('raw(16)')).toBe('raw');
    expect(toIntrospectedNativeType('raw')).toBe('raw');
  });

  it('leaves every other native type unchanged', () => {
    expect(toIntrospectedNativeType('numeric(10,2)')).toBe('numeric(10,2)');
    expect(toIntrospectedNativeType('nvarchar2(10)')).toBe('nvarchar2(10)');
    expect(toIntrospectedNativeType('clob')).toBe('clob');
    expect(toIntrospectedNativeType('blob')).toBe('blob');
    expect(toIntrospectedNativeType('character varying(50)')).toBe('character varying(50)');
    expect(toIntrospectedNativeType('timestamp(6) without time zone')).toBe(
      'timestamp(6) without time zone',
    );
  });

  it('aliases array forms by their element type', () => {
    expect(toIntrospectedNativeType('number[]')).toBe('numeric[]');
    expect(toIntrospectedNativeType('varchar2(10)[]')).toBe('character varying(10)[]');
    expect(toIntrospectedNativeType('raw(16)[]')).toBe('raw[]');
    expect(toIntrospectedNativeType('text[]')).toBe('text[]');
  });
});

describe('normalizeSchemaNativeType (existing introspection-side normalization)', () => {
  it('keeps its current behavior', () => {
    expect(normalizeSchemaNativeType('varchar(10)')).toBe('character varying(10)');
    expect(normalizeSchemaNativeType('numeric')).toBe('numeric');
  });
});
