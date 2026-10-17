import { SqlSchemaVerifierBase } from '@internal/family-sql/ir';
import { describe, expect, it } from 'vitest';
import { GaussDbSchemaVerifier } from '../src/core/gaussdb-schema-verifier';

describe('GaussDbSchemaVerifier', () => {
  it('extends SqlSchemaVerifierBase', () => {
    const verifier = new GaussDbSchemaVerifier();
    expect(verifier).toBeInstanceOf(SqlSchemaVerifierBase);
  });
});
