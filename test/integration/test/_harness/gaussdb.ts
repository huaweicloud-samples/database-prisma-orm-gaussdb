import type { Contract } from '@internal/contract/types';
import gaussdb from '@internal/gaussdb/runtime';
import type { SqlStorage } from '@internal/sql-contract/types';
import { GaussDbContractSerializer } from '@internal/target-gaussdb/runtime';
import { timeouts, withClient } from '@repo/test-utils';
import { afterAll } from 'vitest';

/**
 * Real-GaussDB harness for the gaussdb journeys.
 *
 * The Postgres port harness pushes contracts through plan → apply onto a
 * PGlite dev server; GaussDB has no embedded substitute, so this harness runs
 * only when `GAUSSDB_URL` points at a real instance (suites skip otherwise).
 * The journey tables (`gj_` prefix, `public` schema) are materialised with
 * hand-written A-mode-compatible DDL — idempotent drop + create, no
 * `create schema if not exists` — matching the emitted journey contract, rows
 * are cleared between tests, and the tables are dropped when the file ends.
 *
 * Every gj_ reference is explicitly `public.`-qualified: the contract's
 * namespace is public, while the session search_path is `"$user",public`, so
 * an unqualified statement would land in a user-named schema when the
 * connected database happens to have one (e.g. the instance's `postgres`
 * database has an `appuser` schema) and the ORM's `public.gj_*` queries
 * would then miss the tables.
 */

export const skipIfNoGaussDb = !process.env['GAUSSDB_URL'];

const serializer = new GaussDbContractSerializer();

type GaussDbClient<TContract extends Contract<SqlStorage>> = ReturnType<typeof gaussdb<TContract>>;

export interface GaussDbPortContext<TContract extends Contract<SqlStorage>> {
  /** Full GaussDB facade for SQL builder and runtime access. */
  readonly client: GaussDbClient<TContract>;
  /** ORM handle: `db.<namespace>.<Model>...` (the facade's `orm`). */
  readonly db: GaussDbClient<TContract>['orm'];
  /** Interactive transaction: `transaction(async (tx) => { tx.orm.<ns>.<Model>... })`. */
  readonly transaction: GaussDbClient<TContract>['transaction'];
  readonly contract: TContract;
}

export interface WithGaussDbOptions {
  /** The emitted `contract.json` (imported with `{ type: 'json' }`). */
  readonly contractJson: unknown;
}

const JOURNEY_TABLES = ['public.gj_posts', 'public.gj_users', 'public.gj_oracle_types'] as const;

let schemaReady = false;

async function pushJourneySchema(connectionString: string): Promise<void> {
  await withClient(connectionString, async (client) => {
    for (const table of JOURNEY_TABLES) {
      await client.query(`drop table if exists ${table}`);
    }
    await client.query(`create table public.gj_users (
      id integer primary key,
      name text not null,
      email text not null,
      invited_by_id integer,
      bio text
    )`);
    await client.query('create unique index gj_users_email_key on public.gj_users (email)');
    await client.query(`create table public.gj_posts (
      id integer primary key,
      title text not null,
      user_id integer not null,
      views integer not null
    )`);
    // Oracle-compat columns, declared with the GaussDB native type names the
    // contract's authoring types lower to (migration DDL rendering is not
    // wired yet, so the journey materialises them by hand).
    await client.query(`create table public.gj_oracle_types (
      id integer primary key,
      amount number,
      label varchar2(50),
      name_label nvarchar2(50),
      body clob,
      payload blob,
      token raw(32)
    )`);
  });
}

async function clearJourneyRows(connectionString: string): Promise<void> {
  await withClient(connectionString, async (client) => {
    for (const table of JOURNEY_TABLES) {
      await client.query(`delete from ${table}`);
    }
  });
}

export async function dropJourneySchema(): Promise<void> {
  const url = process.env['GAUSSDB_URL'];
  if (url === undefined) {
    return;
  }
  await withClient(url, async (client) => {
    for (const table of JOURNEY_TABLES) {
      await client.query(`drop table if exists ${table}`);
    }
  });
}

afterAll(dropJourneySchema, timeouts.spinUpPpgDev);

export async function withGaussDb<TContract extends Contract<SqlStorage>>(
  options: WithGaussDbOptions,
  fn: (ctx: GaussDbPortContext<TContract>) => Promise<void>,
): Promise<void> {
  const url = process.env['GAUSSDB_URL'];
  if (url === undefined) {
    throw new Error('withGaussDb() requires GAUSSDB_URL');
  }

  const contract = serializer.deserializeContract(
    JSON.parse(JSON.stringify(options.contractJson)),
  ) as TContract;

  if (schemaReady) {
    await clearJourneyRows(url);
  } else {
    await pushJourneySchema(url);
    schemaReady = true;
  }

  const client = gaussdb<TContract>({
    contract,
    url,
    verifyMarker: false,
  });
  const runtime = await client.connect();
  try {
    await fn({
      client,
      db: client.orm,
      transaction: client.transaction.bind(client),
      contract,
    });
  } finally {
    await runtime.close();
  }
}

export { timeouts };
