import { describe, expect, it } from 'vitest';
import { byteaColumn, jsonbColumn, jsonColumn } from '../src/exports/column-types';

// Phase C of the codec-registry-unification project retired the schema-
// typed `json(schema)` / `jsonb(schema)` overloads from the gaussdb
// adapter — schema-typed JSON now ships from per-library extension
// packages (`@internal/extension-arktype-json` for arktype). The
// adapter retains only the static raw-JSON / raw-JSONB descriptors.

describe('adapter-gaussdb column-types', () => {
  describe('jsonColumn', () => {
    it('has expected codec and native type', () => {
      expect(jsonColumn).toMatchObject({
        codecId: 'gaussdb/json@1',
        nativeType: 'json',
      });
    });
  });

  describe('jsonbColumn', () => {
    it('has expected codec and native type', () => {
      expect(jsonbColumn).toMatchObject({
        codecId: 'gaussdb/jsonb@1',
        nativeType: 'jsonb',
      });
    });
  });

  describe('byteaColumn', () => {
    it('has expected codec and native type', () => {
      expect(byteaColumn).toMatchObject({
        codecId: 'gaussdb/bytea@1',
        nativeType: 'bytea',
      });
    });
  });
});
