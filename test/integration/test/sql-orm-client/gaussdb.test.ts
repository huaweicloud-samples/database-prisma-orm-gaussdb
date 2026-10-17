import { SqlQueryError } from '@internal/sql-errors';
import type { NVarChar2, Varchar } from '@internal/target-gaussdb/codec-types';
import { blindCast } from '@internal/utils/casts';
import { isStructuredError } from '@internal/utils/structured-error';
import { describe, expect, it } from 'vitest';
import { skipIfNoGaussDb, timeouts, withGaussDb } from '../_harness/gaussdb';
import type { Contract } from './fixtures/gaussdb-journeys/generated/contract';
import contractJson from './fixtures/gaussdb-journeys/generated/contract.json' with {
  type: 'json',
};

// Real-GaussDB journeys (A-compat mode). The whole suite skips unless
// GAUSSDB_URL points at an instance; the harness materialises the gj_ tables
// with A-mode-compatible DDL and drops them when the file ends.

describe.skipIf(skipIfNoGaussDb)('gaussdb orm journeys', () => {
  it(
    'create, find, update, and delete round-trip through returning',
    async () => {
      await withGaussDb<Contract>({ contractJson }, async ({ db }) => {
        const created = await db.public.User.create({
          id: 1,
          name: 'Ada',
          email: 'ada@example.com',
          invitedById: null,
          bio: null,
        });
        expect(created).toEqual({
          id: 1,
          name: 'Ada',
          email: 'ada@example.com',
          invitedById: null,
          bio: null,
        });

        const found = await db.public.User.select('id', 'name', 'email', 'invitedById', 'bio')
          .where({ id: 1 })
          .first();
        expect(found).toEqual({
          id: 1,
          name: 'Ada',
          email: 'ada@example.com',
          invitedById: null,
          bio: null,
        });

        const updated = await db.public.User.where({ id: 1 }).update({ name: 'Ada Lovelace' });
        expect(updated).toEqual({
          id: 1,
          name: 'Ada Lovelace',
          email: 'ada@example.com',
          invitedById: null,
          bio: null,
        });

        const deleted = await db.public.User.where({ id: 1 }).delete();
        expect(deleted).toEqual({
          id: 1,
          name: 'Ada Lovelace',
          email: 'ada@example.com',
          invitedById: null,
          bio: null,
        });

        const after = await db.public.User.select('id').where({ id: 1 }).first();
        expect(after).toBeNull();
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'upsert() hits the update branch on a primary key conflict',
    async () => {
      await withGaussDb<Contract>({ contractJson }, async ({ db }) => {
        await db.public.User.create({
          id: 2,
          name: 'Grace',
          email: 'grace@example.com',
          invitedById: null,
          bio: null,
        });

        const upserted = await db.public.User.upsert({
          create: {
            id: 2,
            name: 'Grace',
            email: 'grace@example.com',
            invitedById: null,
            bio: null,
          },
          update: { name: 'Grace Hopper' },
        });
        expect(upserted).toEqual({
          id: 2,
          name: 'Grace Hopper',
          email: 'grace@example.com',
          invitedById: null,
          bio: null,
        });

        const reread = await db.public.User.select('id', 'name').where({ id: 2 }).first();
        expect(reread).toEqual({ id: 2, name: 'Grace Hopper' });
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'upsert() inserts and returns the new row on a miss',
    async () => {
      await withGaussDb<Contract>({ contractJson }, async ({ db }) => {
        const upserted = await db.public.User.upsert({
          create: {
            id: 3,
            name: 'Linus',
            email: 'linus@example.com',
            invitedById: null,
            bio: 'kernel',
          },
          update: { name: 'ignored' },
        });
        expect(upserted).toEqual({
          id: 3,
          name: 'Linus',
          email: 'linus@example.com',
          invitedById: null,
          bio: 'kernel',
        });

        const reread = await db.public.User.select('id', 'name', 'bio').where({ id: 3 }).first();
        expect(reread).toEqual({ id: 3, name: 'Linus', bio: 'kernel' });
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'interactive transactions commit and roll back',
    async () => {
      await withGaussDb<Contract>({ contractJson }, async ({ db, transaction }) => {
        await transaction(async (tx) => {
          await tx.orm.public.User.create({
            id: 4,
            name: 'Commit',
            email: 'commit@example.com',
            invitedById: null,
            bio: null,
          });
        });
        const committed = await db.public.User.select('id', 'name').where({ id: 4 }).first();
        expect(committed).toEqual({ id: 4, name: 'Commit' });

        const rolledBack = transaction(async (tx) => {
          await tx.orm.public.User.create({
            id: 5,
            name: 'Rollback',
            email: 'rollback@example.com',
            invitedById: null,
            bio: null,
          });
          throw new Error('journey rollback');
        });
        await expect(rolledBack).rejects.toThrow('journey rollback');

        const vanished = await db.public.User.select('id').where({ id: 5 }).first();
        expect(vanished).toBeNull();
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'distinctOn() keeps one row per key using orderBy precedence',
    async () => {
      await withGaussDb<Contract>({ contractJson }, async ({ db }) => {
        await db.public.Post.createAll([
          { id: 1, title: 'p1', userId: 1, views: 10 },
          { id: 2, title: 'p2', userId: 1, views: 30 },
          { id: 3, title: 'p3', userId: 2, views: 20 },
        ]);

        const rows = await db.public.Post.select('id', 'userId', 'views')
          .orderBy([(post) => post.userId.asc(), (post) => post.views.desc()])
          .distinctOn('userId')
          .all();
        expect(rows).toEqual([
          { id: 2, userId: 1, views: 30 },
          { id: 3, userId: 2, views: 20 },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'lateralJoin() is rejected with ORM.CAPABILITY_MISSING (sql.lateral=false)',
    async () => {
      await withGaussDb<Contract>({ contractJson }, async ({ client }) => {
        // The capability gate types lateralJoin away on this contract, so the
        // call goes through the same loose shape the builder's own structured
        // -error tests use.
        const users = client.sql.public.gj_users as unknown as {
          lateralJoin: (
            alias: string,
            builder: (lateral: {
              from(table: unknown): { select(...columns: string[]): unknown };
            }) => unknown,
          ) => unknown;
        };

        let error: unknown;
        try {
          users.lateralJoin('latestPost', (lateral) =>
            lateral.from(client.sql.public.gj_posts).select('id'),
          );
        } catch (e) {
          error = e;
        }

        expect(isStructuredError(error)).toBe(true);
        expect(error).toMatchObject({
          code: 'ORM.CAPABILITY_MISSING',
          message: 'lateralJoin() requires capability sql.lateral',
          meta: { method: 'lateralJoin', capability: 'sql.lateral' },
        });
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'empty strings round-trip as null (A-mode known difference)',
    async () => {
      await withGaussDb<Contract>({ contractJson }, async ({ db }) => {
        await db.public.User.create({
          id: 6,
          name: 'Bio',
          email: 'bio@example.com',
          invitedById: null,
          bio: '',
        });

        const found = await db.public.User.select('bio').where({ id: 6 }).first();
        expect(found).toEqual({ bio: null });
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'upsert() on a unique non-PK conflict target with the PK in the insert payload keeps the existing row',
    async () => {
      await withGaussDb<Contract>({ contractJson }, async ({ db }) => {
        await db.public.User.create({
          id: 7,
          name: 'Existing',
          email: 'existing@example.com',
          invitedById: null,
          bio: null,
        });

        // The renderer excludes all key columns (primary key + every unique
        // key) from the do-nothing self-assignment, so this renders
        // ON DUPLICATE KEY UPDATE on a non-key column — DO NOTHING semantics:
        // the conflicting row keeps its values and RETURNING returns it.
        // Verified on live DB.
        const upserted = await db.public.User.upsert({
          create: {
            id: 8,
            name: 'Contender',
            email: 'existing@example.com',
            invitedById: null,
            bio: null,
          },
          update: {},
          conflictOn: { email: 'existing@example.com' },
        });

        expect(upserted).toEqual({
          id: 7,
          name: 'Existing',
          email: 'existing@example.com',
          invitedById: null,
          bio: null,
        });

        const reread = await db.public.User.select('id', 'name', 'email', 'invitedById', 'bio')
          .where({ id: 7 })
          .first();
        expect(reread).toEqual({
          id: 7,
          name: 'Existing',
          email: 'existing@example.com',
          invitedById: null,
          bio: null,
        });

        const contender = await db.public.User.select('id').where({ id: 8 }).first();
        expect(contender).toBeNull();
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'raw ON DUPLICATE KEY UPDATE on the primary key is rejected by the server',
    async () => {
      await withGaussDb<Contract>({ contractJson }, async ({ db, client }) => {
        await db.public.User.create({
          id: 9,
          name: 'P2',
          email: 'p2@example.com',
          invitedById: null,
          bio: null,
        });

        const plan = client.raw.sql`
          insert into public.gj_users (id, name, email) values (${9}, ${'p2-contender'}, ${'p2-contender@example.com'})
          on duplicate key update id = id
        `
          .affectedCount()
          .build();

        // Real-database evidence for the README's "rejects primary-key updates
        // in ON DUPLICATE KEY UPDATE" entry: sqlState 0A000, message
        // "INSERT ON DUPLICATE KEY UPDATE cannot be used to update primary key
        // or unique key."
        const result = client.runtime().execute(plan);
        await expect(result).rejects.toMatchObject({
          sqlState: '0A000',
          message:
            'INSERT ON DUPLICATE KEY UPDATE cannot be used to update primary key or unique key.',
        });
        expect(SqlQueryError.is(await result.catch((e: unknown) => e))).toBe(true);
      });
    },
    timeouts.spinUpPpgDev,
  );
});

// Oracle-compat type journeys (A-compat instances). The gj_oracle_types
// columns are materialised with the GaussDB native type names by the harness;
// these journeys exercise the runtime codec channels against the real wire.

describe.skipIf(skipIfNoGaussDb)('gaussdb oracle-type journeys', () => {
  it(
    'number round-trips 39-digit and small-decimal precision through the numeric channel',
    async () => {
      await withGaussDb<Contract>({ contractJson }, async ({ db }) => {
        const big = '123456789012345678901234567.890123456789';
        await db.public.OracleTypes.create({
          id: 1,
          amount: big,
          label: null,
          nameLabel: null,
          body: null,
          payload: null,
          token: null,
        });

        const found = await db.public.OracleTypes.select('id', 'amount').where({ id: 1 }).first();
        expect(found).toEqual({ id: 1, amount: big });

        const updated = await db.public.OracleTypes.where({ id: 1 }).update({
          amount: '0.125',
        });
        expect(updated).toEqual({
          id: 1,
          amount: '0.125',
          label: null,
          nameLabel: null,
          body: null,
          payload: null,
          token: null,
        });

        const reread = await db.public.OracleTypes.select('amount').where({ id: 1 }).first();
        expect(reread).toEqual({ amount: '0.125' });
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'varchar2 accepts Chinese within its byte budget and rejects past it (byte semantics)',
    async () => {
      await withGaussDb<Contract>({ contractJson }, async ({ db }) => {
        // 16 Chinese characters are 48 UTF-8 bytes — inside varchar2(50).
        const sixteen = blindCast<Varchar<50>, 'varchar2 byte-budget literal'>('中'.repeat(16));
        const created = await db.public.OracleTypes.create({
          id: 2,
          amount: null,
          label: sixteen,
          nameLabel: null,
          body: null,
          payload: null,
          token: null,
        });
        expect(created).toEqual({
          id: 2,
          amount: null,
          label: sixteen,
          nameLabel: null,
          body: null,
          payload: null,
          token: null,
        });

        // 17 Chinese characters are 51 bytes — one byte past varchar2(50),
        // even though 17 < 50 characters. Real-database evidence for the
        // README's byte-semantics warning.
        const overflow = db.public.OracleTypes.create({
          id: 3,
          amount: null,
          label: blindCast<Varchar<50>, 'varchar2 byte-budget literal'>('中'.repeat(17)),
          nameLabel: null,
          body: null,
          payload: null,
          token: null,
        });
        await expect(overflow).rejects.toMatchObject({
          sqlState: '22001',
          message: 'value too long for type character varying(50)',
        });
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'nvarchar2 round-trips Chinese by character count (character semantics)',
    async () => {
      await withGaussDb<Contract>({ contractJson }, async ({ db }) => {
        // 20 Chinese characters are 60 UTF-8 bytes — beyond varchar2(50)'s
        // byte budget, well inside nvarchar2(50)'s character budget.
        const twenty = blindCast<NVarChar2<50>, 'nvarchar2 character-budget literal'>(
          '数据库字符语义测试中文字符串零一二三四五六七八九十',
        );
        const created = await db.public.OracleTypes.create({
          id: 4,
          amount: null,
          label: null,
          nameLabel: twenty,
          body: null,
          payload: null,
          token: null,
        });
        expect(created).toEqual({
          id: 4,
          amount: null,
          label: null,
          nameLabel: twenty,
          body: null,
          payload: null,
          token: null,
        });

        const found = await db.public.OracleTypes.select('nameLabel').where({ id: 4 }).first();
        expect(found).toEqual({ nameLabel: twenty });
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'clob round-trips a document over 1MB',
    async () => {
      await withGaussDb<Contract>({ contractJson }, async ({ db }) => {
        const body = `${'x'.repeat(600_000)}中${'y'.repeat(600_000)}`;
        expect(body.length).toBeGreaterThan(1_200_000);

        const created = await db.public.OracleTypes.create({
          id: 5,
          amount: null,
          label: null,
          nameLabel: null,
          body,
          payload: null,
          token: null,
        });
        expect(created).toEqual({
          id: 5,
          amount: null,
          label: null,
          nameLabel: null,
          body,
          payload: null,
          token: null,
        });

        const found = await db.public.OracleTypes.select('body').where({ id: 5 }).first();
        expect(found).toEqual({ body });
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'blob round-trips a binary payload including 0x00 bytes',
    async () => {
      await withGaussDb<Contract>({ contractJson }, async ({ db }) => {
        const payload = new Uint8Array(256);
        for (let i = 0; i < 256; i++) payload[i] = i;

        const created = await db.public.OracleTypes.create({
          id: 6,
          amount: null,
          label: null,
          nameLabel: null,
          body: null,
          payload,
          token: null,
        });
        expect(created).toEqual({
          id: 6,
          amount: null,
          label: null,
          nameLabel: null,
          body: null,
          payload,
          token: null,
        });

        const found = await db.public.OracleTypes.select('payload').where({ id: 6 }).first();
        expect(found).toEqual({ payload });
        expect(Array.from(found?.payload ?? [])).toHaveLength(256);

        // The renderer emits `payload = $1::blob` with the binary bind — the
        // node-pg Buffer bind in expression position (the section-A open
        // question) and the private-OID equality channel end to end.
        const matched = await db.public.OracleTypes.select('id').where({ payload }).first();
        expect(matched).toEqual({ id: 6 });
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'raw round-trips a token and matches it back through an equality predicate',
    async () => {
      await withGaussDb<Contract>({ contractJson }, async ({ db }) => {
        const token = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0xca, 0xfe, 0xba, 0xbe]);

        const created = await db.public.OracleTypes.create({
          id: 7,
          amount: null,
          label: null,
          nameLabel: null,
          body: null,
          payload: null,
          token,
        });
        expect(created).toEqual({
          id: 7,
          amount: null,
          label: null,
          nameLabel: null,
          body: null,
          payload: null,
          token,
        });

        // The renderer emits `token = $1::raw` with the hex string — the
        // private-OID equality channel end to end.
        const found = await db.public.OracleTypes.select('id', 'token').where({ token }).first();
        expect(found).toEqual({ id: 7, token });
      });
    },
    timeouts.spinUpPpgDev,
  );
});
