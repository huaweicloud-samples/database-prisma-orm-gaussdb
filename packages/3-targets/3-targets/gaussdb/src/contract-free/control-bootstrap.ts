import { APP_SPACE_ID } from '@internal/framework-components/control';
import type { DdlNode } from '@internal/sql-relational-core/ast';
import { col, fn, lit } from '@internal/sql-relational-core/contract-free';
import { createSchema, createTable } from './ddl';

const markerColumns = [
  col('space', 'text', { notNull: true, primaryKey: true, default: lit(APP_SPACE_ID) }),
  col('core_hash', 'text', { notNull: true }),
  col('profile_hash', 'text', { notNull: true }),
  col('contract_json', 'jsonb'),
  col('canonical_version', 'int'),
  col('updated_at', 'timestamptz', { notNull: true, default: fn('now()') }),
  col('app_tag', 'text'),
  col('meta', 'jsonb', { notNull: true, default: lit('{}') }),
  col('invariants', 'text[]', { notNull: true, default: lit('{}') }),
] as const;

const ledgerColumns = [
  col('id', 'bigserial', { primaryKey: true }),
  col('created_at', 'timestamptz', { notNull: true, default: fn('now()') }),
  col('space', 'text', { notNull: true }),
  // Nullable, unlike the postgres blueprint: A-compatibility GaussDB turns an
  // empty-string text value into NULL server-side, and fabricated migration
  // edges (the contract-free runner path) legitimately carry an empty name.
  col('migration_name', 'text'),
  col('migration_hash', 'text', { notNull: true }),
  col('origin_core_hash', 'text'),
  col('origin_profile_hash', 'text'),
  col('destination_core_hash', 'text', { notNull: true }),
  col('destination_profile_hash', 'text'),
  col('operations', 'jsonb', { notNull: true }),
] as const;

// Content-addressed contract store: one row per distinct contract,
// keyed by its storage hash. The ledger's `origin_core_hash` /
// `destination_core_hash` are contract identifiers that resolve here by
// hash equality (no FK — a baseline origin has no stored contract by
// definition), so both endpoints of every edge are direct lookups and a
// contract revisited by a rollback cycle is stored exactly once.
const contractColumns = [
  col('core_hash', 'text', { notNull: true, primaryKey: true }),
  col('created_at', 'timestamptz', { notNull: true, default: fn('now()') }),
  col('contract_json', 'jsonb', { notNull: true }),
] as const;

// GaussDB rejects `CREATE SCHEMA/TABLE IF NOT EXISTS` (42601), so the
// bootstrap DDL renders bare CREATE statements; idempotence comes from the
// migration runner tolerating the duplicate-object codes (42P06/42P07).

const markerTable = createTable({
  schema: 'prisma_contract',
  table: 'marker',
  columns: markerColumns,
});

const ledgerTable = createTable({
  schema: 'prisma_contract',
  table: 'ledger',
  columns: ledgerColumns,
});

const contractTable = createTable({
  schema: 'prisma_contract',
  table: 'contract',
  columns: contractColumns,
});

const controlSchema = createSchema({ schema: 'prisma_contract' });

export function buildSignMarkerBootstrapQueries(): readonly DdlNode[] {
  return [controlSchema, markerTable];
}

export function buildControlTableBootstrapQueries(): readonly DdlNode[] {
  return [controlSchema, markerTable, ledgerTable, contractTable];
}
