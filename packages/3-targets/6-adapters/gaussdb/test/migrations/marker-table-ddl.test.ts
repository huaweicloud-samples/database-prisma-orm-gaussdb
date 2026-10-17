import {
  buildControlTableBootstrapQueries,
  buildSignMarkerBootstrapQueries,
} from '@internal/target-gaussdb/contract-free';
import type { GaussDbDdlNode } from '@internal/target-gaussdb/ddl';
import { describe, expect, test } from 'vitest';
import { createGaussDbBuiltinCodecLookup } from '../../src/core/codec-lookup';
import { GaussDbControlAdapter } from '../../src/core/control-adapter';
import type { GaussDbContract } from '../../src/core/types';

describe('GaussDB marker table DDL lowering', () => {
  const adapter = new GaussDbControlAdapter(createGaussDbBuiltinCodecLookup());
  const lowererContext = { contract: {} as GaussDbContract };

  async function markerTableSql(): Promise<string> {
    const queries = buildSignMarkerBootstrapQueries();
    const markerTable = queries[1];
    if (!markerTable) {
      throw new Error('expected marker table bootstrap query');
    }
    return (await adapter.lowerToExecuteRequest(markerTable as GaussDbDdlNode, lowererContext)).sql;
  }

  test('declares the invariants column as text[] not null default empty array', async () => {
    expect(await markerTableSql()).toContain(`"invariants" text[] DEFAULT '{}'::text[] NOT NULL`);
  });

  test('keys the marker by `space text` (PRIMARY KEY) instead of the legacy single-row `id`', async () => {
    expect(await markerTableSql()).toMatch(/"space"\s+text\b/);
    expect(await markerTableSql()).toMatch(
      /"space"\s+text\b.*NOT NULL.*PRIMARY KEY|PRIMARY KEY\s*\(\s*"space"\s*\)/,
    );
  });

  test('does not declare a legacy `id smallint` primary-key column', async () => {
    expect(await markerTableSql()).not.toMatch(/id\s+smallint/i);
  });

  test('renders control-table bootstrap DDL without IF NOT EXISTS (GaussDB rejects the clause)', async () => {
    const queries = buildControlTableBootstrapQueries();
    expect(queries.length).toBe(4);
    for (const query of queries) {
      const lowered = await adapter.lowerToExecuteRequest(query as GaussDbDdlNode, lowererContext);
      expect(lowered.sql).not.toContain('IF NOT EXISTS');
    }
  });
});
